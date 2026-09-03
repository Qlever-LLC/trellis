<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilitiesListOutput,
    AuthCapabilityGroupsListOutput,
    AuthPortalsGrantOverridesListOutput,
    AuthPortalsGrantOverridesPutInput,
    AuthPortalsListOutput,
  } from "@trellis/apis/trellis.auth";
  import { goto } from "$app/navigation";
  import { resolve } from "$lib/console_paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import ChoiceRow from "$lib/components/ChoiceRow.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import SelectionGroup from "$lib/components/SelectionGroup.svelte";
  import { errorMessage } from "$lib/format";
  import { hasDuplicateRoleMapping } from "$lib/portal-grants";
  import { getTrellis } from "$lib/trellis";

  type Capability = AuthCapabilitiesListOutput["entries"][number];
  type Group = AuthCapabilityGroupsListOutput["entries"][number];
  type Portal = AuthPortalsListOutput["entries"][number];
  type Policy = AuthPortalsGrantOverridesListOutput["entries"][number];
  type RoleDraft = {
    id: string;
    providerId: string;
    role: string;
    directCapabilities: string;
    capabilityGroupKeys: string;
  };

  const trellis = getTrellis();
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let portals = $state.raw<Portal[]>([]);
  let capabilities = $state.raw<Capability[]>([]);
  let groups = $state.raw<Group[]>([]);
  let existing = $state.raw<Policy | null>(null);
  let portalId = $state("");
  let participantId = $state("");
  let directCapabilities = $state<string[]>([]);
  let capabilityGroupKeys = $state<string[]>([]);
  let roleMappings = $state<RoleDraft[]>([]);
  let providerIds = $state.raw<string[]>([]);

  const busy = $derived(loading || saving);
  const sortedCapabilities = $derived(capabilities.toSorted((left, right) => left.capability.localeCompare(right.capability)));
  const sortedGroups = $derived(groups.toSorted((left, right) => left.groupKey.localeCompare(right.groupKey)));
  const providerOptions = $derived(providerIds);
  const effectivePreview = $derived.by(() => {
    const selected = new SvelteSet(expand(directCapabilities, capabilityGroupKeys));
    for (const mapping of roleMappings) {
      for (const capability of expand(list(mapping.directCapabilities), list(mapping.capabilityGroupKeys))) selected.add(capability);
    }
    return [...selected].sort((left, right) => left.localeCompare(right));
  });

  function list(value: string): string[] {
    return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))].sort();
  }

  function caughtMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : "Portal grant request failed.";
  }

  async function loadProviders(): Promise<void> {
    if (!portalId) {
      providerIds = [];
      return;
    }
    const response = await trellis.authPortalsGet({ portalId }).take();
    if (isErr(response)) throw new Error(errorMessage(response));
    providerIds = response.portal.loginSettings.providers ?? [];
  }

  function expand(direct: string[], groupKeys: string[]): string[] {
    const selected = new SvelteSet(direct);
    const groupMap = new Map(groups.map((group) => [group.groupKey, group]));
    const pending = [...groupKeys];
    const visited = new SvelteSet<string>();
    while (pending.length > 0) {
      const key = pending.pop();
      if (!key || visited.has(key)) continue;
      visited.add(key);
      const group = groupMap.get(key);
      if (!group) continue;
      for (const capability of group.capabilities) selected.add(capability);
      pending.push(...group.includedGroups);
    }
    return [...selected];
  }

  function addRoleMapping(): void {
    roleMappings.push({ id: ulid(), providerId: providerOptions[0] ?? "", role: "", directCapabilities: "", capabilityGroupKeys: "" });
  }

  function applyPolicy(policy: Policy): void {
    existing = policy;
    portalId = policy.portalId;
    participantId = policy.participantId;
    directCapabilities = [...policy.directCapabilities];
    capabilityGroupKeys = [...policy.capabilityGroupKeys];
    roleMappings = policy.roleMappings.map((mapping) => ({
      id: ulid(), providerId: mapping.providerId, role: mapping.role,
      directCapabilities: mapping.directCapabilities.join(", "),
      capabilityGroupKeys: mapping.capabilityGroupKeys.join(", "),
    }));
  }

  async function load(): Promise<void> {
    try {
      const [portalResponse, capabilityResponse, groupResponse, policyResponse] = await Promise.all([
        trellis.authPortalsList({ limit: 100 }).take(),
        trellis.authCapabilitiesList({ limit: 100 }).take(),
        trellis.authCapabilityGroupsList({ limit: 500, offset: 0 }).take(),
        trellis.authPortalsGrantOverridesList({ limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(portalResponse)) throw new Error(errorMessage(portalResponse));
      if (isErr(capabilityResponse)) throw new Error(errorMessage(capabilityResponse));
      if (isErr(groupResponse)) throw new Error(errorMessage(groupResponse));
      if (isErr(policyResponse)) throw new Error(errorMessage(policyResponse));
      portals = portalResponse.entries;
      capabilities = capabilityResponse.entries;
      groups = groupResponse.entries;
      const targetPortal = page.url.searchParams.get("portalId");
      const targetParticipant = page.url.searchParams.get("participantId");
      const policy = policyResponse.entries.find((item) => item.portalId === targetPortal && item.participantId === targetParticipant);
      if (policy) applyPolicy(policy);
      else portalId = portals.find((portal) => !portal.disabled)?.portalId ?? "";
      await loadProviders();
    } catch (cause) {
      error = caughtMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    const mappings = roleMappings.map((mapping) => ({
      providerId: mapping.providerId.trim(), role: mapping.role.trim(),
      directCapabilities: list(mapping.directCapabilities), capabilityGroupKeys: list(mapping.capabilityGroupKeys),
    }));
    if (!portalId || !participantId.trim() || mappings.some((mapping) => !mapping.providerId || !mapping.role)) {
      error = "Portal, application participant, provider, and role values are required.";
      return;
    }
    if (hasDuplicateRoleMapping(mappings)) {
      error = "Each provider and role pair may appear only once.";
      return;
    }
    saving = true;
    try {
      const input = {
        portalId, participantId: participantId.trim(), directCapabilities: directCapabilities.toSorted(),
        capabilityGroupKeys: capabilityGroupKeys.toSorted(), roleMappings: mappings,
        expectedVersion: existing?.version ?? null, idempotencyKey: ulid(),
      } satisfies AuthPortalsGrantOverridesPutInput;
      const response = await trellis.authPortalsGrantOverridesPut(input).take();
      if (isErr(response)) throw new Error(errorMessage(response));
      await goto(resolve("/admin/grants"));
    } catch (cause) {
      error = caughtMessage(cause);
    } finally {
      saving = false;
    }
  }

  onMount(() => void load());
</script>

<section class="mx-auto max-w-6xl space-y-4">
  <a class="btn btn-ghost btn-sm" href={resolve("/admin/grants")}>Back to portal grants</a>
  {#if error}<Notice variant="error">{error}</Notice>{/if}
  {#if loading}
    <Panel><LoadingState label="Loading portal policy inputs" /></Panel>
  {:else}
    <form class="space-y-4" onsubmit={save}>
      <Panel title={existing ? "Edit portal grant policy" : "New portal grant policy"} eyebrow="Trusted browser authority">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="form-control"><span class="trellis-field-label">Login portal</span><select class="select select-bordered select-sm mt-1" value={portalId} onchange={(event) => { portalId = event.currentTarget.value; void loadProviders(); }} disabled={busy || existing !== null} required><option value="">Select portal...</option>{#each portals as portal (portal.portalId)}<option value={portal.portalId} disabled={portal.disabled}>{portal.displayName} · {portal.portalId}</option>{/each}</select></label>
          <label class="form-control"><span class="trellis-field-label">Application participant</span><input class="input input-bordered input-sm trellis-identifier mt-1" bind:value={participantId} disabled={busy || existing !== null} placeholder="example.app@v1" required /></label>
        </div>
        <p class="trellis-field-help mt-2">The policy is exact to this portal and participant. Missing policies always fall back to ordinary consent.</p>
      </Panel>

      <div class="grid gap-3 lg:grid-cols-2">
        <Panel title="Base capability groups" eyebrow="All logins">
          <SelectionGroup title="Capability groups" count={capabilityGroupKeys.length} bodyClass="max-h-72 overflow-y-auto rounded border border-base-300 bg-base-100/40">
            {#each sortedGroups as group (group.groupKey)}<ChoiceRow>{#snippet input()}<input class="checkbox checkbox-sm" type="checkbox" bind:group={capabilityGroupKeys} value={group.groupKey} disabled={busy} />{/snippet}<span class="min-w-0"><span class="trellis-identifier block truncate">{group.groupKey}</span><span class="trellis-field-help">{group.capabilities.length} direct · {group.includedGroups.length} nested</span></span></ChoiceRow>{:else}<p class="p-3 text-xs text-base-content/55">No capability groups.</p>{/each}
          </SelectionGroup>
        </Panel>
        <Panel title="Base direct capabilities" eyebrow="All logins">
          <SelectionGroup title="Direct capabilities" count={directCapabilities.length} bodyClass="max-h-72 overflow-y-auto rounded border border-base-300 bg-base-100/40">
            {#each sortedCapabilities as capability (capability.capability)}<ChoiceRow>{#snippet input()}<input class="checkbox checkbox-sm" type="checkbox" bind:group={directCapabilities} value={capability.capability} disabled={busy} />{/snippet}<span class="min-w-0"><span class="trellis-identifier block truncate" title={capability.capability}>{capability.capability}</span><span class="trellis-field-help">{capability.description}</span></span></ChoiceRow>{:else}<p class="p-3 text-xs text-base-content/55">No capabilities.</p>{/each}
          </SelectionGroup>
        </Panel>
      </div>

      <Panel title="Provider role mappings" eyebrow="Exact verified roles">
        {#snippet actions()}<button class="btn btn-outline btn-xs" type="button" onclick={addRoleMapping} disabled={busy}>Add role</button>{/snippet}
        <DataTable size="xs" fixed class="min-w-[900px] border border-base-300">
          <colgroup><col style="width: 18%" /><col style="width: 18%" /><col style="width: 29%" /><col style="width: 29%" /><col style="width: 6%" /></colgroup>
          <thead><tr><th>Provider</th><th>Exact role</th><th>Direct capabilities</th><th>Capability groups</th><th></th></tr></thead>
          <tbody>
            {#each roleMappings as mapping (mapping.id)}
              <tr>
                <td><select class="select select-bordered select-xs w-full" bind:value={mapping.providerId} disabled={busy} required><option value="">Select...</option>{#each providerOptions as provider (provider)}<option value={provider}>{provider}</option>{/each}</select></td>
                <td><input class="input input-bordered input-xs trellis-identifier w-full" bind:value={mapping.role} placeholder="Engineering" disabled={busy} required /></td>
                <td><textarea class="textarea textarea-bordered textarea-xs trellis-identifier min-h-14 w-full" bind:value={mapping.directCapabilities} placeholder="api::read, api::write" disabled={busy}></textarea></td>
                <td><textarea class="textarea textarea-bordered textarea-xs trellis-identifier min-h-14 w-full" bind:value={mapping.capabilityGroupKeys} placeholder="operators, auditors" disabled={busy}></textarea></td>
                <td class="text-right"><button class="btn btn-ghost btn-xs" type="button" onclick={() => roleMappings = roleMappings.filter((item) => item.id !== mapping.id)} disabled={busy}>Remove</button></td>
              </tr>
            {:else}<tr><td colspan="5" class="text-base-content/55">No role mappings. Base policy applies to every authenticated provider identity.</td></tr>{/each}
          </tbody>
        </DataTable>
      </Panel>

      <Panel title="Effective preview" eyebrow="Configured upper bound">
        <div class="flex items-start justify-between gap-4"><div><p class="text-sm font-medium">{effectivePreview.length} configured capabilities</p><p class="trellis-field-help">Required participant authority is always added at runtime. Optional bundles are never autoapproved.</p><div class="trellis-identifier mt-2 max-h-28 overflow-auto text-xs text-base-content/65">{effectivePreview.join(", ") || "Required participant authority only"}</div></div><div class="flex shrink-0 gap-2"><a class="btn btn-ghost btn-sm" href={resolve("/admin/grants")}>Cancel</a><button class="btn btn-primary btn-sm" type="submit" disabled={busy}>{saving ? "Saving..." : "Save policy"}</button></div></div>
      </Panel>
    </form>
  {/if}
</section>
