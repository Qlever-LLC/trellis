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

  type Portal = { portalId: string; displayName: string; builtIn: boolean; disabled: boolean };
  type Route = { routeId: string; portalId: string; contractId: string | null; origin: string | null; disabled: boolean; updatedAt: string };

  const trellis = getTrellis();
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let portals = $state.raw<Portal[]>([]);
  let routes = $state.raw<Route[]>([]);
  let routeId = $state("");
  let portalId = $state("trellis.builtin.login");
  let contractId = $state("");
  let origin = $state("");
  let disabled = $state(false);

  const activeRoutes = $derived(routes.filter((route) => !route.disabled).length);

  function portalName(id: string): string {
    return portals.find((portal) => portal.portalId === id)?.displayName ?? id;
  }

  function edit(route: Route) {
    routeId = route.routeId;
    portalId = route.portalId;
    contractId = route.contractId ?? "";
    origin = route.origin ?? "";
    disabled = route.disabled;
  }

  function resetForm() {
    routeId = "";
    portalId = portals[0]?.portalId ?? "trellis.builtin.login";
    contractId = "";
    origin = "";
    disabled = false;
  }

  async function load() {
    loading = true;
    error = null;
    saved = null;
    try {
      const [portalsResponse, routesResponse] = await Promise.all([
        trellis.request("Auth.Portals.List", {}).take(),
        trellis.request("Auth.Portals.LoginRoutes.List", {}).take(),
      ]);
      if (isErr(portalsResponse)) { error = errorMessage(portalsResponse); return; }
      if (isErr(routesResponse)) { error = errorMessage(routesResponse); return; }
      portals = portalsResponse.portals;
      routes = routesResponse.routes;
      if (!portals.some((portal) => portal.portalId === portalId)) resetForm();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.LoginRoutes.Put", {
        routeId: routeId.trim() || undefined,
        portalId,
        contractId: contractId.trim() || null,
        origin: origin.trim() || null,
        disabled,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      saved = `Route ${response.route.routeId} saved.`;
      resetForm();
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  async function remove(route: Route) {
    saving = true;
    error = null;
    saved = null;
    try {
      const response = await trellis.request("Auth.Portals.LoginRoutes.Remove", { routeId: route.routeId }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      saved = response.success ? `Route ${route.routeId} removed.` : `Route ${route.routeId} was already absent.`;
      await load();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Login portal selection" description="Route browser login starts to a portal by contract and origin.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/portals")}>Back to portals</a>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading || saving}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}<div class="alert alert-error"><span>{error}</span></div>{/if}
  {#if saved}<div class="alert alert-success"><span>{saved}</span></div>{/if}

  <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
    {#if loading}
      <Panel><LoadingState label="Loading login routes" /></Panel>
    {:else if routes.length === 0}
      <EmptyState title="No login routes" description="Portal selection falls back to the built-in login portal." />
    {:else}
      <Panel title="Selection routes" eyebrow={`${activeRoutes} active / ${routes.length} total`} class="overflow-hidden">
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table border-b border-base-300 bg-base-100/30">
            <thead><tr><th>Route</th><th>Portal</th><th>Match</th><th>Status</th><th>Updated</th><th class="text-right">Actions</th></tr></thead>
            <tbody>
              {#each routes as route (route.routeId)}
                <tr>
                  <td class="font-mono text-xs">{route.routeId}</td>
                  <td><div class="font-medium">{portalName(route.portalId)}</div><div class="font-mono text-xs text-base-content/50">{route.portalId}</div></td>
                  <td class="font-mono text-xs"><div>{route.contractId ?? "*"}</div><div class="text-base-content/50">{route.origin ?? "*"}</div></td>
                  <td><span class="badge badge-sm {route.disabled ? 'badge-neutral' : 'badge-success'}">{route.disabled ? "disabled" : "active"}</span></td>
                  <td class="text-xs text-base-content/60">{formatDate(route.updatedAt)}</td>
                  <td class="text-right"><button class="btn btn-ghost btn-xs" onclick={() => edit(route)}>Edit</button><button class="btn btn-error btn-outline btn-xs" onclick={() => remove(route)} disabled={saving}>Remove</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Panel>
    {/if}

    <Panel title={routeId ? "Update route" : "Add route"} eyebrow="Selection rule">
      <div class="space-y-3">
        <label class="form-control">
          <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Route ID</span>
          <input class="input input-bordered input-sm font-mono" bind:value={routeId} placeholder="Auto-generated when empty" />
        </label>
        <label class="form-control">
          <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Portal</span>
          <select class="select select-bordered select-sm" bind:value={portalId}>
            {#each portals as portal (portal.portalId)}
              <option value={portal.portalId}>{portal.displayName} ({portal.portalId})</option>
            {/each}
          </select>
        </label>
        <label class="form-control">
          <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Contract ID</span>
          <input class="input input-bordered input-sm font-mono" bind:value={contractId} placeholder="Any contract" />
        </label>
        <label class="form-control">
          <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Origin</span>
          <input class="input input-bordered input-sm font-mono" bind:value={origin} placeholder="Any origin" />
        </label>
        <label class="flex items-center justify-between rounded border border-base-300 px-3 py-2 text-sm">
          <span>Disabled</span>
          <input class="toggle toggle-sm" type="checkbox" bind:checked={disabled} />
        </label>
        <div class="flex justify-end gap-2">
          <button class="btn btn-ghost btn-sm" onclick={resetForm} disabled={saving}>Clear</button>
          <button class="btn btn-primary btn-sm" onclick={save} disabled={saving || portals.length === 0}>{saving ? "Saving" : "Save route"}</button>
        </div>
      </div>
    </Panel>
  </div>
</section>
