<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type { AuthCapabilityGroupsListOutput } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type CapabilityGroupView = AuthCapabilityGroupsListOutput["groups"][number];

  const trellis = getTrellis();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let deletingGroupKey = $state<string | null>(null);
  let groups = $state.raw<CapabilityGroupView[]>([]);

  const sortedGroups = $derived(groups.slice().sort(compareGroups));
  const busy = $derived(loading || deletingGroupKey !== null);

  function compareGroups(left: CapabilityGroupView, right: CapabilityGroupView): number {
    if ((left.groupKey === "admin") !== (right.groupKey === "admin")) return left.groupKey === "admin" ? -1 : 1;
    return left.groupKey.localeCompare(right.groupKey);
  }

  function closeActionMenus(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("[data-action-menu]")) return;

    for (const menu of document.querySelectorAll<HTMLDetailsElement>("[data-action-menu]")) {
      menu.open = false;
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const response = await trellis.request("Auth.CapabilityGroups.List", { limit: 500, offset: 0 }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      groups = response.groups ?? [];
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function deleteGroup(group: CapabilityGroupView) {
    if (group.groupKey === "admin") return;
    if (!confirm(`Delete capability group ${group.groupKey}?`)) return;
    deletingGroupKey = group.groupKey;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.CapabilityGroups.Delete", { groupKey: group.groupKey }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = `Capability group ${group.groupKey} deleted.`;
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      deletingGroupKey = null;
    }
  }

  onMount(() => { void load(); });
</script>

<svelte:document onclick={closeActionMenus} />

<section class="space-y-4">
  <PageToolbar title="Capability groups" description="Manage reusable auth capability sets and nested group inclusion.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={busy}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}
  {#if saved}
    <div class="alert alert-success"><span>{saved}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading capability groups" /></Panel>
  {:else}
    <Panel title="Capability groups" eyebrow={`${groups.length} groups`}>
      {#snippet actions()}
        <a class="btn btn-outline btn-xs" href={resolve("/admin/capability-groups/new")}>New group</a>
      {/snippet}

      {#if groups.length === 0}
        <EmptyState title="No capability groups" description="Create a group to bundle common capability assignments." />
      {:else}
        <div class="overflow-visible">
          <table class="table table-sm trellis-table capability-groups-table border-b border-base-300 bg-base-100/30">
            <thead>
              <tr>
                <th class="w-[30%]">Group</th>
                <th>Description</th>
                <th class="w-24">Caps</th>
                <th class="w-24">Includes</th>
                <th class="hidden w-32 lg:table-cell">Updated</th>
                <th class="w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each sortedGroups as group (group.groupKey)}
                <tr>
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
                  <td class="align-top text-right">
                    <details class="dropdown dropdown-end" data-action-menu>
                      <summary class="btn btn-ghost btn-xs">Actions</summary>
                      <ul class="menu dropdown-content z-30 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2">
                        <li><a href={resolve(`/admin/capability-groups/edit?groupKey=${encodeURIComponent(group.groupKey)}`)}>Edit</a></li>
                        {#if group.groupKey !== "admin"}
                          <li>
                            <button class="text-error" onclick={() => deleteGroup(group)} disabled={busy}>{deletingGroupKey === group.groupKey ? "Deleting" : "Delete"}</button>
                          </li>
                        {/if}
                      </ul>
                    </details>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Panel>
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
