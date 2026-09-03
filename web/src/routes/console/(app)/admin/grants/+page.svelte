<script lang="ts">
  import { ulid } from "ulid";
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilityGroupsListOutput,
    AuthPortalsGrantOverridesListOutput,
  } from "@trellis/apis/trellis.auth";
  import { resolve } from "$lib/console_paths";
  import { onMount } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import BulkActionBar from "$lib/components/BulkActionBar.svelte";
  import BulkResult from "$lib/components/BulkResult.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { bulkExpectedCount, bulkTargetDetails, runBulk, toggleAll, toggleId } from "$lib/bulk.ts";
  import { getTrellis } from "$lib/trellis";

  type Policy = AuthPortalsGrantOverridesListOutput["entries"][number];
  type Group = AuthCapabilityGroupsListOutput["entries"][number];

  const trellis = getTrellis();
  let loading = $state(true);
  let removing = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let search = $state("");
  let policies = $state.raw<Policy[]>([]);
  let groups = $state.raw<Group[]>([]);
  let confirmationModal: ConfirmationModal | undefined = $state();
  let selectedPolicies = $state(new Set<string>());
  let bulkBusy = $state(false);
  let bulkResult = $state<{ succeeded: number; failed: string[] } | null>(null);
  let failedPolicies = $state.raw<Policy[]>([]);

  const busy = $derived(loading || removing !== null || bulkBusy);
  const groupMap = $derived(new Map(groups.map((group) => [group.groupKey, group])));
  const filteredPolicies = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return policies;
    return policies.filter((policy) => JSON.stringify(policy).toLowerCase().includes(term));
  });
  const selectablePolicyKeys = $derived(filteredPolicies.map((policy) => key(policy)));

  function caughtMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : "Portal grant request failed.";
  }

  function key(policy: Policy): string {
    return `${policy.portalId}\u001f${policy.participantId}`;
  }

  function expandCapabilities(direct: string[], groupKeys: string[]): string[] {
    const capabilities = new SvelteSet(direct);
    const pending = [...groupKeys];
    const visited = new SvelteSet<string>();
    while (pending.length > 0) {
      const groupKey = pending.pop();
      if (!groupKey || visited.has(groupKey)) continue;
      visited.add(groupKey);
      const group = groupMap.get(groupKey);
      if (!group) continue;
      for (const capability of group.capabilities) capabilities.add(capability);
      pending.push(...group.includedGroups);
    }
    return [...capabilities].sort((left, right) => left.localeCompare(right));
  }

  function effectiveCapabilities(policy: Policy): string[] {
    const capabilities = new SvelteSet(expandCapabilities(policy.directCapabilities, policy.capabilityGroupKeys));
    for (const mapping of policy.roleMappings) {
      for (const capability of expandCapabilities(mapping.directCapabilities, mapping.capabilityGroupKeys)) {
        capabilities.add(capability);
      }
    }
    return [...capabilities].sort((left, right) => left.localeCompare(right));
  }

  async function load(preserveSaved = false): Promise<void> {
    loading = true;
    error = null;
    if (!preserveSaved) saved = null;
    try {
      const [policyResponse, groupResponse] = await Promise.all([
        trellis.authPortalsGrantOverridesList({ limit: 500, offset: 0 }).take(),
        trellis.authCapabilityGroupsList({ limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(policyResponse)) throw new Error(errorMessage(policyResponse));
      if (isErr(groupResponse)) throw new Error(errorMessage(groupResponse));
      policies = policyResponse.entries.toSorted((left, right) => key(left).localeCompare(key(right)));
      groups = groupResponse.entries;
    } catch (cause) {
      error = caughtMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function requestRemove(policy: Policy): Promise<void> {
    const confirmed = await confirmationModal?.confirm({
      title: "Remove portal grant policy?",
      message: "Affected portal-managed identity authorities are revoked immediately.",
      confirmLabel: "Remove policy",
      targetLabel: "Portal / app",
      targetName: `${policy.portalId} / ${policy.participantId}`,
      expectedValue: policy.participantId,
    });
    if (!confirmed) return;
    removing = key(policy);
    error = null;
    saved = null;
    try {
      const response = await trellis.authPortalsGrantOverridesRemove({
        portalId: policy.portalId,
        participantId: policy.participantId,
        expectedVersion: policy.version,
        idempotencyKey: ulid(),
      }).take();
      if (isErr(response)) throw new Error(errorMessage(response));
      saved = "Portal grant policy removed.";
      await load(true);
    } catch (cause) {
      error = caughtMessage(cause);
    } finally {
      removing = null;
    }
  }

  async function removePolicies(targets: Policy[]) {
    bulkBusy = true;
    bulkResult = null;
    const outcome = await runBulk(targets, async (policy) => {
      const response = await trellis.authPortalsGrantOverridesRemove({
        portalId: policy.portalId,
        participantId: policy.participantId,
        expectedVersion: policy.version,
        idempotencyKey: ulid(),
      }).take();
      if (isErr(response)) throw new Error(errorMessage(response));
    });
    failedPolicies = outcome.failed.map((failure) => failure.target);
    for (const policy of targets) selectedPolicies.delete(key(policy));
    bulkResult = {
      succeeded: outcome.succeeded,
      failed: outcome.failed.map((failure) => `${failure.target.portalId} / ${failure.target.participantId}: ${failure.reason}`),
    };
    bulkBusy = false;
    void load(true);
  }

  async function requestBulkRemove() {
    const targets = filteredPolicies.filter((policy) => selectedPolicies.has(key(policy)));
    if (targets.length === 0) return;
    const confirmed = await confirmationModal?.confirm({
      title: `Remove ${targets.length} portal grant polic${targets.length === 1 ? "y" : "ies"}?`,
      message: "Affected portal-managed identity authorities are revoked immediately.",
      confirmLabel: `Remove ${targets.length}`,
      targetLabel: "Portal policies",
      targetName: `${targets.length} policies`,
      expectedValue: bulkExpectedCount(targets.length),
      details: bulkTargetDetails(targets.map((policy) => `${policy.portalId} / ${policy.participantId}`)),
    });
    if (!confirmed) return;
    await removePolicies(targets);
  }

  onMount(() => void load());
</script>

<section class="space-y-4">
  <PageToolbar title="Portal grants" description="Autoapprove browser authority from an exact login portal, application participant, provider, and role.">
    {#snippet actions()}
      <label class="sr-only" for="grant-search">Search portal grant policies</label>
      <input id="grant-search" class="input input-bordered input-sm w-72" placeholder="Search portal or app" bind:value={search} />
      <a class="btn btn-outline btn-sm" href={resolve("/admin/grants/new")}>New policy</a>
      <button class="btn btn-ghost btn-sm" onclick={() => void load()} disabled={busy}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}
  {#if saved}<Notice variant="success">{saved}</Notice>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading portal grant policies" /></Panel>
  {:else}
    <Panel title="Portal grant policies" eyebrow="Trusted browser authority">
      {#if bulkResult}
        <BulkResult
          succeeded={bulkResult.succeeded}
          failed={bulkResult.failed}
          pastTense="policies removed"
          onRetry={failedPolicies.length > 0 ? () => void removePolicies(failedPolicies) : undefined}
          onDismiss={() => { bulkResult = null; }}
        />
      {:else if selectedPolicies.size > 0}
        <BulkActionBar count={selectedPolicies.size} noun="policy" onClear={() => selectedPolicies.clear()}>
          {#snippet actions()}
            <button class="btn btn-error btn-outline btn-sm" disabled={busy} onclick={() => void requestBulkRemove()}>
              {bulkBusy ? "Removing…" : "Remove selected"}
            </button>
          {/snippet}
        </BulkActionBar>
      {/if}
      {#if policies.length === 0}
        <EmptyState title="No portal grant policies" description="Browser logins continue through ordinary per-user consent." />
      {:else}
        <DataTable size="xs" fixed class="min-w-[980px] border-b border-base-300 bg-base-100/30">
          <colgroup>
            <col style="width: 4%" />
            <col style="width: 15%" /><col style="width: 20%" /><col style="width: 18%" />
            <col style="width: 20%" /><col style="width: 17%" /><col style="width: 6%" />
          </colgroup>
          <thead><tr>
            <th>
              <span class="sr-only">Select all policies</span>
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                aria-label="Select all policies"
                disabled={busy || selectablePolicyKeys.length === 0}
                checked={selectablePolicyKeys.length > 0 && selectablePolicyKeys.every((id) => selectedPolicies.has(id))}
                indeterminate={selectablePolicyKeys.some((id) => selectedPolicies.has(id)) && !selectablePolicyKeys.every((id) => selectedPolicies.has(id))}
                onchange={() => toggleAll(selectedPolicies, selectablePolicyKeys)}
              />
            </th>
            <th>Portal</th><th>Application</th><th>Base policy</th><th>Provider roles</th><th>Effective preview</th><th class="text-right">Actions</th></tr></thead>
          <tbody>
            {#each filteredPolicies as policy (key(policy))}
              {@const effective = effectiveCapabilities(policy)}
              <tr>
                <td class="align-top">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    aria-label={`Select {policy.portalId} {policy.participantId}`}
                    disabled={busy}
                    checked={selectedPolicies.has(key(policy))}
                    onchange={() => toggleId(selectedPolicies, key(policy))}
                  />
                </td>
                <td class="align-top"><div class="trellis-identifier truncate" title={policy.portalId}>{policy.portalId}</div><div class="trellis-metadata mt-1">v{policy.version} · {formatDate(policy.updatedAt)}</div></td>
                <td class="align-top"><div class="trellis-identifier truncate" title={policy.participantId}>{policy.participantId}</div></td>
                <td class="align-top"><div class="text-xs">{policy.directCapabilities.length} direct · {policy.capabilityGroupKeys.length} groups</div><div class="trellis-identifier mt-1 max-h-14 overflow-auto text-xs text-base-content/55">{[...policy.directCapabilities, ...policy.capabilityGroupKeys.map((group) => `@${group}`)].join(", ") || "Required only"}</div></td>
                <td class="align-top">
                  {#each policy.roleMappings as mapping (`${mapping.providerId}\u001f${mapping.role}`)}
                    <div class="mb-1 flex min-w-0 gap-1"><span class="badge badge-outline badge-xs">{mapping.providerId}</span><span class="trellis-identifier truncate text-xs" title={mapping.role}>{mapping.role}</span></div>
                  {:else}<span class="text-xs text-base-content/45">No role mappings</span>{/each}
                </td>
                <td class="align-top"><div class="text-xs font-medium">{effective.length} configured capabilities</div><div class="trellis-identifier mt-1 max-h-14 overflow-auto text-xs text-base-content/55" title={effective.join("\n")}>{effective.join(", ") || "Required only"}</div></td>
                <td class="whitespace-nowrap text-right align-top">
                  <a class="btn btn-ghost btn-xs" href={resolve(`/admin/grants/new?portalId=${encodeURIComponent(policy.portalId)}&participantId=${encodeURIComponent(policy.participantId)}`)}>Edit</a>
                  <button class="btn btn-ghost btn-xs" onclick={() => void requestRemove(policy)} disabled={busy}>Remove</button>
                </td>
              </tr>
            {:else}<tr><td colspan="7" class="text-base-content/55">No policies match the current filter.</td></tr>{/each}
          </tbody>
        </DataTable>
      {/if}
    </Panel>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
