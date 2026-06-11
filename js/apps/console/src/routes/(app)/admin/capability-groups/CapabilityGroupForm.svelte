<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilitiesListOutput,
    AuthCapabilityGroupsListOutput,
    AuthCapabilityGroupsPutInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import ChoiceRow from "$lib/components/ChoiceRow.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import SelectionGroup from "$lib/components/SelectionGroup.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type CapabilityView = AuthCapabilitiesListOutput["entries"][number];
  type CapabilityGroupView = AuthCapabilityGroupsListOutput["entries"][number];
  type CapabilityDeploymentSection = {
    key: string;
    title: string;
    subtitle: string | null;
    deploymentId: string | null;
    capabilities: CapabilityView[];
  };

  let { mode, targetGroupKey = null }: { mode: "create" | "edit"; targetGroupKey?: string | null } = $props();

  const trellis = getTrellis();

  let loading = $state(true);
  let capabilitiesLoading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let groups = $state.raw<CapabilityGroupView[]>([]);
  let capabilities = $state.raw<CapabilityView[]>([]);
  let selectedGroup = $state<CapabilityGroupView | null>(null);

  let formGroupKey = $state("");
  let formDisplayName = $state("");
  let formDescription = $state("");
  let selectedCapabilities = $state<string[]>([]);
  let selectedIncludedGroups = $state<string[]>([]);

  const editingExisting = $derived(mode === "edit");
  const isBuiltInSelection = $derived(selectedGroup?.groupKey === "admin");
  const busy = $derived(loading || saving);
  const editable = $derived(!busy && !isBuiltInSelection);
  const catalogedCapabilityKeys = $derived(new Set(capabilities.map((capability) => capability.key)));
  const catalogedSelectedCapabilities = $derived(selectedCapabilities.filter((key) => catalogedCapabilityKeys.has(key)));
  const totalCapabilityAssignments = $derived(catalogedSelectedCapabilities.length);
  const sortedGroups = $derived(groups.slice().sort(compareGroups));
  const capabilityDeploymentSections = $derived.by(() => {
    const sections: CapabilityDeploymentSection[] = [];
    for (const capability of capabilities) {
      const key = capabilityDeploymentSectionKey(capability);
      const existing = sections.find((section) => section.key === key);
      if (existing) {
        existing.capabilities.push(capability);
      } else {
        sections.push({
          key,
          title: capabilityDeploymentSectionTitle(capability),
          subtitle: capabilityDeploymentSectionSubtitle(capability),
          deploymentId: capability.deploymentId ?? null,
          capabilities: [capability],
        });
      }
    }

    return sections
      .map((section) => ({
        ...section,
        capabilities: uniqueCapabilitiesByKey(section.capabilities).sort((left, right) =>
          (left.contractDisplayName ?? left.contractId ?? "").localeCompare(right.contractDisplayName ?? right.contractId ?? "") ||
          localCapabilityKey(left.key).localeCompare(localCapabilityKey(right.key))
        ),
      }))
      .sort((left, right) => {
        if (left.key === "platform") return -1;
        if (right.key === "platform") return 1;
        return left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
      });
  });

  function compareGroups(left: CapabilityGroupView, right: CapabilityGroupView): number {
    if ((left.groupKey === "admin") !== (right.groupKey === "admin")) return left.groupKey === "admin" ? -1 : 1;
    return left.groupKey.localeCompare(right.groupKey);
  }

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function capabilityDeploymentSectionKey(capability: CapabilityView): string {
    if (capability.source === "platform") return "platform";
    return capability.deploymentId ?? capability.contractId ?? capability.contractDisplayName ?? "contract";
  }

  function capabilityDeploymentSectionTitle(capability: CapabilityView): string {
    if (capability.source === "platform") return "Platform";
    return capability.deploymentId ?? "Unassigned deployment";
  }

  function capabilityDeploymentSectionSubtitle(capability: CapabilityView): string | null {
    if (capability.source === "platform") return null;
    return capability.contractDisplayName ?? capability.contractId ?? null;
  }

  function capabilityContractLabel(capability: CapabilityView): string {
    return capability.contractDisplayName ?? capability.contractId ?? "Contract";
  }

  function capabilityDirectionLabel(capability: CapabilityView): string {
    return capability.direction === "given" ? "Given" : "Creates";
  }

  function capabilityRowKey(capability: CapabilityView): string {
    return [
      capability.deploymentId ?? "platform",
      capability.key,
      capability.direction ?? "",
      capability.contractId ?? "",
      capability.contractDigest ?? "",
    ].join("\u001f");
  }

  function uniqueCapabilitiesByKey(items: CapabilityView[]): CapabilityView[] {
    return [...new Map(items.map((capability) => [capability.key, capability])).values()];
  }

  function uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
  }

  function withLoadTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} did not respond.`)), 10_000);
      }),
    ]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
  }

  function applyGroup(group: CapabilityGroupView) {
    selectedGroup = group;
    formGroupKey = group.groupKey;
    formDisplayName = group.displayName;
    formDescription = group.description;
    selectedCapabilities = uniqueSorted(group.capabilities);
    selectedIncludedGroups = uniqueSorted(group.includedGroups);
  }

  async function load() {
    loading = true;
    error = null;
    saved = null;
    try {
      const groupsResponse = await withLoadTimeout(
        trellis.request("Auth.CapabilityGroups.List", { limit: 500, offset: 0 }).take(),
        "Capability groups",
      );
      if (isErr(groupsResponse)) {
        error = errorMessage(groupsResponse);
        return;
      }
      groups = groupsResponse.entries ?? [];

      if (editingExisting) {
        if (!targetGroupKey) {
          error = "Group key is required.";
          return;
        }
        const group = groups.find((item) => item.groupKey === targetGroupKey);
        if (!group) {
          error = `Capability group ${targetGroupKey} was not found.`;
          return;
        }
        applyGroup(group);
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }

    void loadCapabilities();
  }

  async function loadCapabilities() {
    capabilitiesLoading = true;
    try {
      const capabilitiesResponse = await withLoadTimeout(
        trellis.request("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
        "Capabilities",
      );
      if (isErr(capabilitiesResponse)) {
        error = errorMessage(capabilitiesResponse);
        return;
      }
      capabilities = (capabilitiesResponse.entries ?? []).slice().sort((left, right) => left.key.localeCompare(right.key));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      capabilitiesLoading = false;
    }
  }

  async function save(event?: SubmitEvent) {
    event?.preventDefault();
    if (!editable) return;
    const groupKey = formGroupKey.trim();
    const displayName = formDisplayName.trim();
    const description = formDescription.trim();
    if (!groupKey || !displayName || !description) {
      error = "Group key, display name, and description are required.";
      saved = null;
      return;
    }

    saving = true;
    error = null;
    saved = null;
    try {
      const input = {
        groupKey,
        displayName,
        description,
        capabilities: uniqueSorted(catalogedSelectedCapabilities),
        includedGroups: uniqueSorted(selectedIncludedGroups.filter((key) => key !== groupKey)),
      } satisfies AuthCapabilityGroupsPutInput;
      const response = await trellis.request("Auth.CapabilityGroups.Put", input).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = `Capability group ${groupKey} saved.`;
      if (!editingExisting) await goto(resolve("/admin/capability-groups"));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="mx-auto max-w-5xl space-y-4">
  <div>
    <a class="btn btn-ghost btn-sm" href={resolve("/admin/capability-groups")}>Back to capability groups</a>
  </div>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}
  {#if saved}
    <Notice variant="success">{saved}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading capability group" /></Panel>
  {:else}
    <form class="space-y-4" onsubmit={save}>
      <Panel title={editingExisting ? formDisplayName : "New capability group"} eyebrow={isBuiltInSelection ? "Built-in" : "Group"}>
        {#snippet actions()}
          {#if isBuiltInSelection}
            <span class="badge badge-neutral badge-sm">read-only</span>
          {/if}
          <span class="trellis-metadata text-[0.65rem]">Updated {selectedGroup ? formatDate(selectedGroup.updatedAt) : "not saved"}</span>
        {/snippet}

        {#if isBuiltInSelection}
          <div class="mb-3 rounded border border-base-300 bg-base-100/50 px-3 py-2 text-xs text-base-content/65">
            The built-in admin group is managed by the platform and cannot be changed here.
          </div>
        {/if}

        <div class="grid gap-3 md:grid-cols-2">
          <label class="form-control">
            <span class="trellis-field-label">Group key</span>
            <input class="input input-bordered input-sm mt-1 w-full trellis-identifier" bind:value={formGroupKey} disabled={busy || editingExisting} required />
          </label>
          <label class="form-control">
            <span class="trellis-field-label">Display name</span>
            <input class="input input-bordered input-sm mt-1 w-full" bind:value={formDisplayName} disabled={!editable} required />
          </label>
          <label class="form-control md:col-span-2">
            <span class="trellis-field-label">Description</span>
            <textarea class="textarea textarea-bordered textarea-sm mt-1 min-h-20 w-full" bind:value={formDescription} disabled={!editable} required></textarea>
          </label>
        </div>
      </Panel>

      <Panel title="Capabilities" eyebrow="Assignments">
        {#snippet actions()}
          {#if capabilitiesLoading}
            <span class="loading loading-spinner loading-xs text-base-content/45"></span>
          {:else}
            <span class="trellis-metadata text-[0.65rem]">{totalCapabilityAssignments} total</span>
          {/if}
        {/snippet}

        <div class="max-h-[28rem] overflow-y-auto rounded border border-base-300 bg-base-100/40">
          {#each capabilityDeploymentSections as section (section.key)}
            <section class="border-b border-base-300 last:border-b-0">
              <div class="flex items-center justify-between gap-3 bg-base-200/60 px-3 py-2">
                <div class="min-w-0">
                  <h3 class="truncate text-xs font-semibold uppercase tracking-wide text-base-content/70" title={section.title}>{section.title}</h3>
                  {#if section.subtitle}
                    <p class="trellis-identifier mt-0.5 truncate text-[0.65rem] text-base-content/50" title={section.subtitle}>{section.subtitle}</p>
                  {/if}
                </div>
                <span class="badge badge-ghost badge-sm shrink-0">{section.capabilities.length}</span>
              </div>

              <DataTable class="capability-selection-table bg-base-100/20" tableClass="text-xs" fixed overflow="none">
                <thead>
                  <tr>
                    <th class="w-10">Use</th>
                    <th>Capability</th>
                    <th class="hidden w-[28%] lg:table-cell">Contract</th>
                    <th class="w-20">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {#each section.capabilities as capability (capabilityRowKey(capability))}
                    <tr>
                      <td class="align-top">
                        <input class="checkbox checkbox-sm" type="checkbox" bind:group={selectedCapabilities} value={capability.key} disabled={!editable} aria-label={`Select ${capability.displayName}`} />
                      </td>
                      <td class="max-w-0 align-top">
                        <div class="truncate font-medium text-base-content" title={capability.displayName}>{capability.displayName}</div>
                        <div class="trellis-identifier mt-0.5 truncate text-base-content/50" title={capability.key}>{localCapabilityKey(capability.key)}</div>
                        <div class="mt-1 truncate text-base-content/55" title={capability.description}>{capability.description}</div>
                      </td>
                      <td class="hidden max-w-0 align-top lg:table-cell">
                        <div class="truncate text-base-content/70" title={capabilityContractLabel(capability)}>{capabilityContractLabel(capability)}</div>
                        {#if capability.contractId}
                          <div class="trellis-identifier mt-0.5 truncate text-base-content/45" title={capability.contractId}>{capability.contractId}</div>
                        {/if}
                      </td>
                      <td class="align-top">
                        <span class="badge badge-outline badge-xs">{capability.source === "platform" ? "Platform" : capabilityDirectionLabel(capability)}</span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </DataTable>
            </section>
          {:else}
            <div class="px-3 py-4 trellis-metadata text-xs">No capabilities returned.</div>
          {/each}
        </div>
      </Panel>

      <Panel title="Included groups" eyebrow="Nested membership">
        <p class="trellis-field-help mb-2">Nested groups included by this group. Self-inclusion is disabled.</p>
        <SelectionGroup title="Included groups" count={selectedIncludedGroups.length} bodyClass="max-h-64 overflow-y-auto rounded border border-base-300 bg-base-100/40">
          {#each sortedGroups as group (group.groupKey)}
            {#if group.groupKey !== formGroupKey}
              <ChoiceRow>
                {#snippet input()}
                  <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedIncludedGroups} value={group.groupKey} disabled={!editable} />
                {/snippet}
                <span class="min-w-0">
                  <span class="flex items-center gap-2">
                    <span class="trellis-identifier font-medium">{group.groupKey}</span>
                    {#if group.groupKey === "admin"}<span class="badge badge-neutral badge-xs">built-in</span>{/if}
                  </span>
                  <span class="mt-0.5 block truncate text-base-content/60" title={group.displayName}>{group.displayName}</span>
                  <span class="trellis-field-help block">{group.capabilities.length} capabilities, {group.includedGroups.length} included groups</span>
                </span>
              </ChoiceRow>
            {/if}
          {:else}
            <div class="px-2 py-3 trellis-metadata text-xs">No capability groups returned.</div>
          {/each}
        </SelectionGroup>
      </Panel>

      <div class="flex justify-end gap-2">
        <a class="btn btn-ghost btn-sm" href={resolve("/admin/capability-groups")}>Cancel</a>
        {#if !isBuiltInSelection}
          <button class="btn btn-outline btn-sm" type="submit" disabled={busy}>{saving ? "Saving" : "Save group"}</button>
        {/if}
      </div>
    </form>
  {/if}
</section>
