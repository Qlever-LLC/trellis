<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthCapabilitiesListOutput,
    AuthCapabilityGroupsListOutput,
    AuthCapabilityGroupsPutInput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getNotifications } from "../../../../lib/notifications.svelte";
  import { getTrellis } from "../../../../lib/trellis";

  type CapabilityView = AuthCapabilitiesListOutput["capabilities"][number];
  type CapabilityGroupView = AuthCapabilityGroupsListOutput["groups"][number];

  const trellis = getTrellis();
  const notifications = getNotifications();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let savePending = $state(false);
  let deletePending = $state(false);
  let groups = $state<CapabilityGroupView[]>([]);
  let capabilities = $state<CapabilityView[]>([]);
  let selectedGroupKey = $state<string | null>(null);
  let mode = $state<"create" | "edit">("create");
  let formGroupKey = $state("");
  let formDisplayName = $state("");
  let formDescription = $state("");
  let selectedCapabilities = $state<string[]>([]);
  let uncatalogedCapabilitiesText = $state("");
  let selectedIncludedGroups = $state<string[]>([]);

  const selectedGroup = $derived(groups.find((group) => group.groupKey === selectedGroupKey) ?? null);
  const isBuiltInSelection = $derived(selectedGroup?.groupKey === "admin");
  const catalogedCapabilityKeys = $derived(new Set(capabilities.map((capability) => capability.key)));
  const catalogedSelectedCapabilities = $derived(selectedCapabilities.filter((key) => catalogedCapabilityKeys.has(key)));
  const uncatalogedSelectedCapabilities = $derived(
    selectedCapabilities.filter((key) => !catalogedCapabilityKeys.has(key)).sort(),
  );
  const totalCapabilityAssignments = $derived(uniqueSorted([...catalogedSelectedCapabilities, ...parseLines(uncatalogedCapabilitiesText)]).length);
  const editable = $derived(mode === "create" || !isBuiltInSelection);
  const sortedGroups = $derived(groups.slice().sort(compareGroups));

  function compareGroups(left: CapabilityGroupView, right: CapabilityGroupView): number {
    if ((left.groupKey === "admin") !== (right.groupKey === "admin")) return left.groupKey === "admin" ? -1 : 1;
    return left.groupKey.localeCompare(right.groupKey);
  }

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function parseLines(value: string): string[] {
    return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  }

  function uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
  }

  function selectCreate() {
    mode = "create";
    selectedGroupKey = null;
    formGroupKey = "";
    formDisplayName = "";
    formDescription = "";
    selectedCapabilities = [];
    uncatalogedCapabilitiesText = "";
    selectedIncludedGroups = [];
  }

  function selectGroup(group: CapabilityGroupView) {
    mode = "edit";
    selectedGroupKey = group.groupKey;
    formGroupKey = group.groupKey;
    formDisplayName = group.displayName;
    formDescription = group.description;
    selectedCapabilities = uniqueSorted(group.capabilities);
    uncatalogedCapabilitiesText = group.capabilities.filter((key) => !catalogedCapabilityKeys.has(key)).sort().join("\n");
    selectedIncludedGroups = uniqueSorted(group.includedGroups);
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [groupsResponse, capabilitiesResponse] = await Promise.all([
        trellis.request("Auth.CapabilityGroups.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(groupsResponse)) { error = errorMessage(groupsResponse); return; }
      if (isErr(capabilitiesResponse)) { error = errorMessage(capabilitiesResponse); return; }
      groups = groupsResponse.groups ?? [];
      capabilities = (capabilitiesResponse.capabilities ?? []).slice().sort((left, right) => left.key.localeCompare(right.key));
      if (selectedGroupKey) {
        const updatedSelection = groups.find((group) => group.groupKey === selectedGroupKey);
        if (updatedSelection) selectGroup(updatedSelection);
        else selectCreate();
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function saveGroup() {
    if (!editable) return;
    const groupKey = formGroupKey.trim();
    const displayName = formDisplayName.trim();
    const description = formDescription.trim();
    if (!groupKey || !displayName || !description) {
      error = "Group key, display name, and description are required.";
      return;
    }

    savePending = true;
    error = null;
    try {
      const input = {
        groupKey,
        displayName,
        description,
        capabilities: uniqueSorted([...catalogedSelectedCapabilities, ...parseLines(uncatalogedCapabilitiesText)]),
        includedGroups: uniqueSorted(selectedIncludedGroups.filter((key) => key !== groupKey)),
      } satisfies AuthCapabilityGroupsPutInput;
      const response = await trellis.request("Auth.CapabilityGroups.Put", input).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Capability group ${groupKey} saved.`, "Saved");
      selectedGroupKey = groupKey;
      mode = "edit";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      savePending = false;
    }
  }

  async function deleteGroup() {
    if (!selectedGroup || isBuiltInSelection) return;
    if (!confirm(`Delete capability group ${selectedGroup.groupKey}?`)) return;
    deletePending = true;
    error = null;
    try {
      const response = await trellis.request("Auth.CapabilityGroups.Delete", { groupKey: selectedGroup.groupKey }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      notifications.success(`Capability group ${selectedGroup.groupKey} deleted.`, "Deleted");
      selectCreate();
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      deletePending = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Capability Groups" description="Manage reusable auth capability sets and nested group inclusion.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <button class="btn btn-primary btn-sm" onclick={selectCreate}>New group</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="border-y border-base-300 bg-base-100 px-4 py-5"><LoadingState label="Loading capability groups" /></div>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section class="min-w-0 space-y-2 overflow-visible">
        <div class="flex items-center justify-between gap-3 border-y border-base-300 bg-base-100/45 px-4 py-3">
          <div class="min-w-0">
            <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">Group registry</p>
            <p class="mt-1 text-sm text-base-content/60">Built-in groups are listed with custom groups.</p>
          </div>
          <span class="badge badge-ghost badge-sm">{groups.length} groups</span>
        </div>

        {#if groups.length === 0}
          <EmptyState title="No capability groups" description="Create a group to bundle common capability assignments." />
        {:else}
          <table class="table table-sm trellis-table capability-groups-table border-b border-base-300 bg-base-100/30">
            <thead>
              <tr>
                <th class="w-[30%]">Group</th>
                <th>Description</th>
                <th class="w-24">Caps</th>
                <th class="w-24">Includes</th>
                <th class="hidden w-32 lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {#each sortedGroups as group (group.groupKey)}
                <tr class={["cursor-pointer hover:bg-base-200/70", selectedGroupKey === group.groupKey && "bg-base-200"]} onclick={() => selectGroup(group)}>
                  <td class="max-w-0 align-top">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="trellis-identifier truncate font-semibold" title={group.groupKey}>{group.groupKey}</span>
                      {#if group.groupKey === "admin"}
                        <span class="badge badge-neutral badge-xs shrink-0">built-in</span>
                      {:else}
                        <span class="badge badge-ghost badge-xs shrink-0">custom</span>
                      {/if}
                    </div>
                    <div class="truncate text-xs text-base-content/60" title={group.displayName}>{group.displayName}</div>
                  </td>
                  <td class="max-w-0 align-top text-xs text-base-content/60"><div class="truncate" title={group.description}>{group.description}</div></td>
                  <td class="align-top"><span class="badge badge-ghost badge-sm">{group.capabilities.length}</span></td>
                  <td class="align-top"><span class="badge badge-ghost badge-sm">{group.includedGroups.length}</span></td>
                  <td class="hidden align-top text-xs text-base-content/60 lg:table-cell">{formatDate(group.updatedAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      <aside class="min-w-0 border-y border-base-300 bg-base-100">
        <form class="divide-y divide-base-300" onsubmit={(event) => { event.preventDefault(); void saveGroup(); }}>
          <section class="px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-base-content/45">{mode === "create" ? "Create" : "Edit"}</p>
                <h2 class="truncate text-base font-bold">{mode === "create" ? "New capability group" : formDisplayName}</h2>
              </div>
              {#if isBuiltInSelection}
                <span class="badge badge-neutral badge-sm">read-only</span>
              {/if}
            </div>
          </section>

          <section class="space-y-3 px-4 py-3">
            <label class="block">
              <span class="trellis-field-label">Group key</span>
              <input class="input input-bordered input-sm mt-1 w-full trellis-identifier" bind:value={formGroupKey} disabled={mode === "edit"} required />
            </label>
            <label class="block">
              <span class="trellis-field-label">Display name</span>
              <input class="input input-bordered input-sm mt-1 w-full" bind:value={formDisplayName} disabled={!editable} required />
            </label>
            <label class="block">
              <span class="trellis-field-label">Description</span>
              <textarea class="textarea textarea-bordered textarea-sm mt-1 min-h-20 w-full" bind:value={formDescription} disabled={!editable} required></textarea>
            </label>
          </section>

          <section class="px-4 py-3">
            <div class="mb-2 flex items-baseline justify-between gap-2">
              <div>
                <h3 class="trellis-field-label">Cataloged capabilities</h3>
                <p class="trellis-field-help">Exact capability keys selected from the catalog.</p>
              </div>
              <span class="trellis-metadata text-xs">{totalCapabilityAssignments} total</span>
            </div>
            <div class="max-h-72 overflow-y-auto border-y border-base-300">
              {#each capabilities as capability (capability.key)}
                <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 py-2 text-xs hover:bg-base-200/60">
                  <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilities} value={capability.key} disabled={!editable} />
                  <span class="min-w-0 pr-2">
                    <span class="block truncate font-medium" title={capability.description}>{capability.description}</span>
                    <span class="trellis-identifier block break-all text-base-content/50">{localCapabilityKey(capability.key)}</span>
                  </span>
                </label>
              {:else}
                <div class="px-2 py-3 text-xs text-base-content/60">No cataloged capabilities returned.</div>
              {/each}
            </div>
            {#if uncatalogedSelectedCapabilities.length > 0}
              <p class="mt-2 text-xs text-base-content/50">{uncatalogedSelectedCapabilities.length} uncataloged capabilities preserved below.</p>
            {/if}
            <label class="mt-3 block">
              <span class="trellis-field-label">Uncataloged capabilities</span>
              <textarea class="textarea textarea-bordered textarea-sm mt-1 min-h-20 w-full trellis-identifier text-xs" bind:value={uncatalogedCapabilitiesText} disabled={!editable} placeholder="one capability key per line"></textarea>
            </label>
          </section>

          <section class="px-4 py-3">
            <h3 class="trellis-field-label">Included groups</h3>
            <p class="trellis-field-help mb-2">Nested groups included by this group. Self-inclusion is disabled.</p>
            <div class="max-h-48 overflow-y-auto border-y border-base-300">
              {#each sortedGroups as group (group.groupKey)}
                {#if group.groupKey !== formGroupKey}
                  <label class="grid cursor-pointer grid-cols-[auto_1fr] gap-2 py-2 text-xs hover:bg-base-200/60">
                    <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedIncludedGroups} value={group.groupKey} disabled={!editable} />
                    <span class="min-w-0 pr-2">
                      <span class="flex items-center gap-2">
                        <span class="trellis-identifier font-medium">{group.groupKey}</span>
                        {#if group.groupKey === "admin"}<span class="badge badge-neutral badge-xs">built-in</span>{/if}
                      </span>
                      <span class="block truncate text-base-content/50" title={group.displayName}>{group.displayName}</span>
                    </span>
                  </label>
                {/if}
              {/each}
            </div>
          </section>

          <section class="flex flex-wrap justify-between gap-2 px-4 py-3">
            <button class="btn btn-error btn-outline btn-sm" type="button" onclick={deleteGroup} disabled={!selectedGroup || isBuiltInSelection || deletePending}>{deletePending ? "Deleting..." : "Delete"}</button>
            <button class="btn btn-primary btn-sm" type="submit" disabled={!editable || savePending}>{savePending ? "Saving..." : "Save group"}</button>
          </section>
        </form>
      </aside>
    </div>
  {/if}
</section>

<style>
  .capability-groups-table {
    min-width: 0;
    table-layout: fixed;
    width: 100%;
  }

  .capability-groups-table thead {
    background-color: color-mix(in oklab, var(--color-base-content) 3.5%, transparent);
  }
</style>
