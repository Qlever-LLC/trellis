<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type Portal = { portalId: string; displayName: string; builtIn: boolean; disabled: boolean };
  type Route = { routeId: string; portalId: string; contractId: string | null; origin: string | null; disabled: boolean; updatedAt: string };
  type EvaluationRule = { order: string; match: string; source: string };

  const trellis = getTrellis();
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let portals = $state.raw<Portal[]>([]);
  let routes = $state.raw<Route[]>([]);
  let editingRouteId = $state("");
  let portalId = $state("trellis.builtin.login");
  let contractId = $state("");
  let origin = $state("");
  let disabled = $state(false);

  const activeRoutes = $derived(routes.filter((route) => !route.disabled).length);
  const previewMatch = $derived(ruleMatch(contractId, origin));
  const evaluationRules: EvaluationRule[] = [
    { order: "1", match: "Contract + origin", source: "Exact route for both fields" },
    { order: "2", match: "Contract only", source: "Route with matching contract and any origin" },
    { order: "3", match: "Origin only", source: "Route with matching origin and any contract" },
    { order: "4", match: "Default route", source: "Route with blank contract and origin" },
    { order: "5", match: "Built-in fallback", source: "Trellis login if no active route matches" },
  ];

  function ruleMatch(contract: string | null, routeOrigin: string | null): string {
    const contractPart = contract?.trim() || "any contract";
    const originPart = routeOrigin?.trim() || "any origin";
    return `${contractPart} / ${originPart}`;
  }

  function portalName(id: string): string {
    return portals.find((portal) => portal.portalId === id)?.displayName ?? id;
  }

  function edit(route: Route) {
    editingRouteId = route.routeId;
    portalId = route.portalId;
    contractId = route.contractId ?? "";
    origin = route.origin ?? "";
    disabled = route.disabled;
  }

  function resetForm() {
    editingRouteId = "";
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
      const routeId = page.url.searchParams.get("routeId");
      const route = routeId ? routes.find((candidate) => candidate.routeId === routeId) : null;
      if (route) edit(route);
      else if (!portals.some((portal) => portal.portalId === portalId)) resetForm();
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
        routeId: editingRouteId.trim() || undefined,
        portalId,
        contractId: contractId.trim() || null,
        origin: origin.trim() || null,
        disabled,
      }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      saved = "Portal route saved.";
      resetForm();
      if (page.url.searchParams.has("routeId")) {
        await goto(resolve("/admin/portals/login/selection"), { replaceState: true });
      }
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
      saved = response.success ? "Portal route removed." : "Portal route was already absent.";
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
  <PageToolbar title="Add portal route" description="Route browser login starts to a visible portal by contract and origin.">
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
      <EmptyState title="No portal routes" description="Login falls back to the built-in portal." />
    {:else}
      <Panel title="Portal routes" eyebrow={`${activeRoutes} active / ${routes.length} total`}>
        <div class="overflow-x-auto">
          <table class="table table-sm trellis-table border-b border-base-300 bg-base-100/30">
            <thead><tr><th>Match</th><th>Target portal</th><th>Status</th><th class="hidden lg:table-cell">Updated</th><th class="text-right">Actions</th></tr></thead>
            <tbody>
              {#each routes as route (route.routeId)}
                <tr>
                  <td class="font-mono text-xs"><div>{route.contractId ?? "any contract"}</div><div class="text-base-content/50">{route.origin ?? "any origin"}</div></td>
                  <td><div class="font-medium">{portalName(route.portalId)}</div><div class="font-mono text-xs text-base-content/50">{route.portalId}</div></td>
                  <td><span class="badge badge-sm {route.disabled ? 'badge-neutral' : 'badge-success'}">{route.disabled ? "disabled" : "active"}</span></td>
                  <td class="hidden text-xs text-base-content/60 lg:table-cell">{formatDate(route.updatedAt)}</td>
                  <td class="text-right"><button class="btn btn-ghost btn-xs" onclick={() => edit(route)}>Edit</button><button class="btn btn-error btn-outline btn-xs" onclick={() => remove(route)} disabled={saving}>Remove</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Panel>
    {/if}

    <div class="space-y-4">
      <Panel title={editingRouteId ? "Update portal route" : "Add portal route"} eyebrow="Selection rule">
        <div class="space-y-3">
          <p class="text-xs text-base-content/60">Only visible portals can be targeted. If a custom portal is missing, wait for it to appear in the portals list before adding a route.</p>
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
            <input class="input input-bordered input-sm font-mono" bind:value={contractId} placeholder="Blank for any contract" />
          </label>
          <label class="form-control">
            <span class="label-text text-xs uppercase tracking-wide text-base-content/55">Origin</span>
            <input class="input input-bordered input-sm font-mono" bind:value={origin} placeholder="Blank for any origin" />
          </label>
          <p class="text-xs text-base-content/55">Blank contract and origin create the default/global route.</p>
          <label class="flex items-center justify-between rounded border border-base-300 px-3 py-2 text-sm">
            <span>Disabled</span>
            <input class="toggle toggle-sm" type="checkbox" bind:checked={disabled} />
          </label>
          <div class="flex justify-end gap-2">
            <button class="btn btn-ghost btn-sm" onclick={resetForm} disabled={saving}>Clear</button>
            <button class="btn btn-outline btn-sm" onclick={save} disabled={saving || portals.length === 0}>{saving ? "Saving" : "Save route"}</button>
          </div>
        </div>
      </Panel>
      <Panel title="Rule evaluation" eyebrow="Selection order">
        <div class="space-y-3">
          <div class="rounded border border-base-300 bg-base-200/40 px-3 py-2 text-xs">
            <div class="uppercase tracking-wide text-base-content/45">Current form preview</div>
            <div class="mt-1 font-mono text-base-content/75">{previewMatch} -> {portalName(portalId)}</div>
          </div>
          <div class="overflow-x-auto">
            <table class="table table-xs border-b border-base-300 bg-base-100/30">
              <thead><tr><th>Order</th><th>Rule</th><th>Source</th></tr></thead>
              <tbody>
                {#each evaluationRules as rule (rule.order)}
                  <tr><td class="font-mono">{rule.order}</td><td>{rule.match}</td><td class="text-base-content/60">{rule.source}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </div>
  </div>
</section>
