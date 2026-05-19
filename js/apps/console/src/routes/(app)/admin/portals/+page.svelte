<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
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
    createdAt: string;
    updatedAt: string;
  };

  type Route = {
    routeId: string;
    portalId: string;
    contractId: string | null;
    origin: string | null;
    disabled: boolean;
    updatedAt: string;
  };

  const trellis = getTrellis();
  let loading = $state(true);
  let removingPortalId = $state<string | null>(null);
  let removingRouteId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let portals = $state.raw<Portal[]>([]);
  let routes = $state.raw<Route[]>([]);

  const activeRouteCount = $derived(routes.filter((route) => !route.disabled).length);
  const activePortalCount = $derived(portals.filter((portal) => !portal.disabled).length);
  const busy = $derived(loading || removingPortalId !== null || removingRouteId !== null);
  const sortedRoutes = $derived.by(() => [...routes].sort((a, b) => routeSortKey(a).localeCompare(routeSortKey(b))));
  const routeCountsByPortal = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const route of routes) counts[route.portalId] = (counts[route.portalId] ?? 0) + 1;
    return counts;
  });

  function closeActionMenus(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("[data-action-menu]")) return;

    for (const menu of document.querySelectorAll<HTMLDetailsElement>("[data-action-menu]")) {
      menu.open = false;
    }
  }

  function routeMatch(route: Route): string {
    return `${route.contractId ?? "any contract"} / ${route.origin ?? "any origin"}`;
  }

  function routeKind(route: Route): string {
    if (route.contractId && route.origin) return "contract + origin";
    if (route.contractId) return "contract only";
    if (route.origin) return "origin only";
    return "default route";
  }

  function routePriority(route: Route): number {
    if (route.contractId && route.origin) return 1;
    if (route.contractId) return 2;
    if (route.origin) return 3;
    return 4;
  }

  function routeSortKey(route: Route): string {
    return `${route.disabled ? 1 : 0}:${routePriority(route)}:${routeMatch(route)}:${route.portalId}`;
  }

  function portalName(id: string): string {
    return portals.find((portal) => portal.portalId === id)?.displayName ?? id;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [portalsResponse, routesResponse] = await Promise.all([
        trellis.request("Auth.Portals.List", {}).take(),
        trellis.request("Auth.Portals.LoginRoutes.List", {}).take(),
      ]);
      if (isErr(portalsResponse)) {
        error = errorMessage(portalsResponse);
        return;
      }
      if (isErr(routesResponse)) {
        error = errorMessage(routesResponse);
        return;
      }
      portals = portalsResponse.portals;
      routes = routesResponse.routes;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function removePortal(portal: Portal) {
    if (portal.builtIn || (routeCountsByPortal[portal.portalId] ?? 0) > 0) return;
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

  async function removeRoute(route: Route) {
    removingRouteId = route.routeId;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.LoginRoutes.Remove", { routeId: route.routeId }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = response.success ? "Route removed." : "Route was already absent.";
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      removingRouteId = null;
    }
  }

  onMount(() => { void load(); });
</script>

<svelte:document onclick={closeActionMenus} />

<section class="space-y-4">
  <PageToolbar title="Portals" description="Manage login portals and the global route rules that select them.">
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
    <Panel><LoadingState label="Loading portals" /></Panel>
  {:else}
    <Panel title="Portals" eyebrow={`${activePortalCount} active / ${portals.length} visible`}>
      {#snippet actions()}
        <a class="btn btn-outline btn-xs" href={resolve("/admin/portals/new")}>New portal</a>
      {/snippet}

      {#if portals.length === 0}
        <EmptyState title="No portals" description="Create a portal, then add a route rule to target it." />
      {:else}
        <div class="overflow-visible">
          <table class="table table-sm trellis-table border-b border-base-300 bg-base-100/30">
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
                {@const routeCount = routeCountsByPortal[portal.portalId] ?? 0}
                <tr>
                  <td>
                    <div class="font-medium">{portal.displayName}</div>
                    <div class="font-mono text-xs text-base-content/55">{portal.portalId}</div>
                  </td>
                  <td class="hidden max-w-[22rem] truncate font-mono text-xs md:table-cell">{portal.entryUrl ?? "built-in"}</td>
                  <td><span class="badge badge-sm {portal.builtIn ? 'badge-info' : 'badge-neutral'}">{portal.builtIn ? "built-in" : "external"}</span></td>
                  <td><span class="badge badge-sm {portal.disabled ? 'badge-neutral' : 'badge-success'}">{portal.disabled ? "disabled" : "active"}</span></td>
                  <td class="font-mono text-xs">{routeCount}</td>
                  <td class="hidden text-xs text-base-content/60 lg:table-cell">{formatDate(portal.updatedAt)}</td>
                  <td class="text-right">
                    <details class="dropdown dropdown-end" data-action-menu>
                      <summary class="btn btn-ghost btn-xs">Actions</summary>
                      <ul class="menu dropdown-content z-30 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2">
                        <li><a href={resolve(`/admin/portals/edit?portalId=${encodeURIComponent(portal.portalId)}`)}>Edit</a></li>
                        {#if !portal.builtIn}
                          <li>
                            <button class="text-error" onclick={() => removePortal(portal)} disabled={busy || routeCount > 0} title={routeCount > 0 ? "Remove routes first" : "Delete portal"}>{removingPortalId === portal.portalId ? "Deleting" : "Delete"}</button>
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

    <Panel title="Route" eyebrow={`${activeRouteCount} active / ${routes.length} total`}>
      {#snippet actions()}
        <a class="btn btn-outline btn-xs" href={resolve("/admin/portals/login/selection")}>New route</a>
      {/snippet}

      {#if routes.length === 0}
        <div class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <p class="text-base-content/60">No active rules are configured. Browser login falls back to the built-in portal.</p>
        </div>
      {:else}
        <div class="overflow-visible">
          <table class="table table-sm trellis-table border-b border-base-300 bg-base-100/30">
            <thead>
              <tr>
                <th>Match</th>
                <th>Selected portal</th>
                <th>Status</th>
                <th class="hidden lg:table-cell">Updated</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each sortedRoutes as route (route.routeId)}
                <tr>
                  <td class="font-mono text-xs"><div>{routeMatch(route)}</div><div class="text-base-content/50">{routeKind(route)}</div></td>
                  <td>
                    <div class="font-medium">{portalName(route.portalId)}</div>
                    <div class="font-mono text-xs text-base-content/50">{route.portalId}</div>
                  </td>
                  <td><span class="badge badge-sm {route.disabled ? 'badge-neutral' : 'badge-success'}">{route.disabled ? "disabled" : "active"}</span></td>
                  <td class="hidden text-xs text-base-content/60 lg:table-cell">{formatDate(route.updatedAt)}</td>
                  <td class="text-right">
                    <details class="dropdown dropdown-end" data-action-menu>
                      <summary class="btn btn-ghost btn-xs">Actions</summary>
                      <ul class="menu dropdown-content z-30 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2">
                        <li><a href={resolve(`/admin/portals/login/selection?routeId=${encodeURIComponent(route.routeId)}`)}>Edit</a></li>
                        <li><button class="text-error" onclick={() => removeRoute(route)} disabled={busy}>{removingRouteId === route.routeId ? "Deleting" : "Delete"}</button></li>
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
