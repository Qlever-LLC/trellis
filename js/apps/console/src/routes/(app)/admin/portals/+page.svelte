<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import ActionMenu from "$lib/components/ActionMenu.svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type Portal = {
    portalId: string;
    displayName: string;
    entryUrl: string | null;
    builtIn: boolean;
    disabled: boolean;
    routeCount: number;
    activeRouteCount: number;
    createdAt: string;
    updatedAt: string;
  };

  const trellis = getTrellis();
  let loading = $state(true);
  let removingPortalId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let portals = $state.raw<Portal[]>([]);
  let confirmationModal: ConfirmationModal | undefined = $state();

  const activePortalCount = $derived(portals.filter((portal) => !portal.disabled).length);
  const busy = $derived(loading || removingPortalId !== null);

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
      const portalsResponse = await trellis.request("Auth.Portals.List", { limit: 500, offset: 0 }).take();
      if (isErr(portalsResponse)) {
        error = errorMessage(portalsResponse);
        return;
      }
      portals = portalsResponse.entries;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function removePortal(portal: Portal) {
    if (portal.builtIn || portal.routeCount > 0) return;
    removingPortalId = portal.portalId;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.Remove", { portalId: portal.portalId }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = response.success ? "Portal removed." : "Portal was already absent.";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      removingPortalId = null;
    }
  }

  async function requestRemovePortal(portal: Portal) {
    if (portal.builtIn || portal.routeCount > 0) return;
    const confirmed = await confirmationModal?.confirm({
      title: "Delete portal?",
      message: "This removes the portal record. Portal routes must be removed first.",
      confirmLabel: "Delete portal",
      targetLabel: "Portal",
      targetName: portal.portalId,
      expectedValue: portal.portalId,
    });
    if (confirmed) await removePortal(portal);
  }

  onMount(() => { void load(); });
</script>

<svelte:document onclick={closeActionMenus} />

<section class="space-y-4">
  <PageToolbar title="Portals" description="Manage login portal records and their portal-scoped route rules.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={busy}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}
  {#if saved}
    <Notice variant="success">{saved}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading portals" /></Panel>
  {:else}
    <Panel title="Portals" eyebrow={`${activePortalCount} active / ${portals.length} visible`}>
      {#snippet actions()}
        <a class="btn btn-outline btn-xs" href={resolve("/admin/portals/new")}>New portal</a>
      {/snippet}

      {#if portals.length === 0}
        <EmptyState title="No portals" description="Create a portal, then add route rules from its portal record." />
      {:else}
        <DataTable class="border-b border-base-300 bg-base-100/30" overflow="visible">
            <thead>
              <tr>
                <th>Portal</th>
                <th class="hidden md:table-cell">Entry URL</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Routes</th>
                <th class="hidden lg:table-cell">Updated</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each portals as portal (portal.portalId)}
                <tr>
                  <td>
                    <div class="font-medium">{portal.displayName}</div>
                    <div class="font-mono text-xs text-base-content/55">{portal.portalId}</div>
                  </td>
                  <td class="hidden max-w-[22rem] truncate font-mono text-xs md:table-cell">{portal.entryUrl ?? "built-in"}</td>
                  <td><span class="badge badge-sm {portal.builtIn ? 'badge-info' : 'badge-neutral'}">{portal.builtIn ? "built-in" : "external"}</span></td>
                  <td><span class="badge badge-sm {portal.disabled ? 'badge-neutral' : 'badge-success'}">{portal.disabled ? "disabled" : "active"}</span></td>
                  <td class="font-mono text-xs">{portal.activeRouteCount} / {portal.routeCount}</td>
                  <td class="hidden text-xs text-base-content/60 lg:table-cell">{formatDate(portal.updatedAt)}</td>
                  <td class="text-right">
                    <ActionMenu widthClass="w-44" dataActionMenu>
                        <li><a href={resolve(`/admin/portals/edit?portalId=${encodeURIComponent(portal.portalId)}`)}>Edit</a></li>
                        {#if !portal.builtIn}
                          <li>
                            <button class="text-error" onclick={() => requestRemovePortal(portal)} disabled={busy || portal.routeCount > 0} title={portal.routeCount > 0 ? "Remove routes first" : "Delete portal"}>{removingPortalId === portal.portalId ? "Deleting" : "Delete"}</button>
                          </li>
                        {/if}
                    </ActionMenu>
                  </td>
                </tr>
              {/each}
            </tbody>
        </DataTable>
      {/if}
    </Panel>

  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />
