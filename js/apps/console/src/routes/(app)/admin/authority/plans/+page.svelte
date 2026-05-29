<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type { DeploymentAuthorityKind, DeploymentAuthorityPlan } from "@qlever-llc/trellis/auth";
  import { base } from "$app/paths";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { authorityPlanRows } from "$lib/authority_console";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type AuthorityKind = DeploymentAuthorityKind;
  type PlanState = "pending" | "accepted" | "rejected" | "expired";
  type PlanClassification = "update" | "migration";
  type PlanListInput = {
    deploymentId?: string;
    state?: PlanState;
    classification?: PlanClassification;
    kind?: AuthorityKind;
    limit: number;
    offset?: number;
  };
  type DeploymentAuthority = { deploymentId: string; kind: AuthorityKind };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type AuthorityPlansRequest = {
    (method: "Auth.DeploymentAuthority.Plans.List", input: PlanListInput): RpcTakeable<{ entries?: DeploymentAuthorityPlan[]; total?: number }>;
    (method: "Auth.DeploymentAuthority.List", input: { kind?: AuthorityKind; limit: number; offset: number }): RpcTakeable<{ entries?: DeploymentAuthority[] }>;
  };

  const trellis = getTrellis();
  const request = trellis.request.bind(trellis) as AuthorityPlansRequest;
  const states: (PlanState | "")[] = ["", "pending", "accepted", "rejected", "expired"];
  const classifications: (PlanClassification | "")[] = ["", "update", "migration"];
  const kinds: (AuthorityKind | "")[] = ["", "service", "device", "app", "cli", "native", "device-user"];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let plans = $state.raw<DeploymentAuthorityPlan[]>([]);
  let authorities = $state.raw<DeploymentAuthority[]>([]);
  let stateFilter = $state<PlanState | "">("");
  let classificationFilter = $state<PlanClassification | "">("");
  let kindFilter = $state<AuthorityKind | "">("");
  let search = $state("");

  const authorityKinds = $derived(new Map(authorities.map((authority) => [authority.deploymentId, authority.kind])));
  const rows = $derived.by(() => {
    const term = search.trim().toLowerCase();
    const kindsByDeployment = authorityKinds;
    return authorityPlanRows(plans)
      .filter((row) =>
        !term || row.searchableText.includes(term) ||
        (kindsByDeployment.get(row.deploymentId) ?? "").includes(term)
      )
      .toSorted((left, right) => {
        if (left.state === "pending" && right.state !== "pending") return -1;
        if (left.state !== "pending" && right.state === "pending") return 1;
        return right.createdAt.localeCompare(left.createdAt);
      });
  });
  const pendingCount = $derived(plans.filter((plan) => planState(plan) === "pending").length);

  function planState(plan: DeploymentAuthorityPlan): PlanState {
    if ("state" in plan && isPlanState(plan.state)) return plan.state;
    return "pending";
  }

  function isPlanState(value: unknown): value is PlanState {
    return value === "pending" || value === "accepted" || value === "rejected" || value === "expired";
  }

  function statusVariant(state: PlanState): "healthy" | "degraded" | "unhealthy" | "offline" {
    if (state === "accepted") return "healthy";
    if (state === "pending") return "degraded";
    if (state === "rejected") return "unhealthy";
    return "offline";
  }

  function diffSummary(row: ReturnType<typeof authorityPlanRows>[number]): string {
    const contracts = row.requiredContracts + row.optionalContracts;
    const surfaces = row.requiredSurfaces + row.optionalSurfaces;
    return `${contracts} contracts · ${surfaces} surfaces · ${row.resources} resources · ${row.capabilities} capabilities`;
  }

  function planHref(planId: string): string {
    return `${base}/admin/authority/plans/${encodeURIComponent(planId)}`;
  }

  async function load() {
    loading = true;
    error = null;
    const input: PlanListInput = { limit: 500, offset: 0 };
    if (stateFilter) input.state = stateFilter;
    if (classificationFilter) input.classification = classificationFilter;
    if (kindFilter) input.kind = kindFilter;
    try {
      const [plansResponse, authoritiesResponse] = await Promise.all([
        request("Auth.DeploymentAuthority.Plans.List", input).take(),
        request("Auth.DeploymentAuthority.List", { ...(kindFilter ? { kind: kindFilter } : {}), limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(plansResponse)) { error = errorMessage(plansResponse); return; }
      if (isErr(authoritiesResponse)) { error = errorMessage(authoritiesResponse); return; }
      plans = plansResponse.entries ?? [];
      authorities = authoritiesResponse.entries ?? [];
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Authority plans" description="Review pending and historical deployment authority update and migration plans.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}

  <Panel>
    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold uppercase tracking-wide text-base-content/70">Plan register</h2>
        <p class="text-xs text-base-content/50">{pendingCount} pending · {plans.length} loaded</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="form-control w-36">
          <span class="label py-1 text-xs text-base-content/60">State</span>
          <select class="select select-bordered select-sm" bind:value={stateFilter} aria-label="Filter by state">
            {#each states as state (state || "all-states")}
              <option value={state}>{state || "All states"}</option>
            {/each}
          </select>
        </label>
        <label class="form-control w-40">
          <span class="label py-1 text-xs text-base-content/60">Class</span>
          <select class="select select-bordered select-sm" bind:value={classificationFilter} aria-label="Filter by classification">
            {#each classifications as classification (classification || "all-classes")}
              <option value={classification}>{classification || "All classes"}</option>
            {/each}
          </select>
        </label>
        <label class="form-control w-40">
          <span class="label py-1 text-xs text-base-content/60">Kind</span>
          <select class="select select-bordered select-sm" bind:value={kindFilter} aria-label="Filter by deployment kind">
            {#each kinds as kind (kind || "all-kinds")}
              <option value={kind}>{kind || "All kinds"}</option>
            {/each}
          </select>
        </label>
        <label class="input input-bordered input-sm mt-6 flex items-center gap-2">
          <Icon name="search" size={14} class="text-base-content/50" />
          <input bind:value={search} class="grow" placeholder="Search plans" aria-label="Search plans" />
        </label>
        <button class="btn btn-outline btn-sm mt-6" onclick={load} disabled={loading}>Apply</button>
      </div>
    </div>

    {#if loading}
      <LoadingState label="Loading authority plans" />
    {:else if rows.length === 0}
      <EmptyState title="No authority plans" description="No pending or historical authority plans match the current filters." />
    {:else}
      <DataTable>
        <thead><tr><th>Plan</th><th>State</th><th>Class</th><th>Kind</th><th>Deployment</th><th>Diff preview</th><th>Created</th></tr></thead>
        <tbody>
          {#each rows as row (row.planId)}
            <tr class="hover:bg-base-200/60">
              <td><a class="trellis-identifier font-medium link-hover" href={planHref(row.planId)}>{row.planId}</a></td>
              <td><StatusBadge label={row.state} status={statusVariant(row.state)} /></td>
              <td><span class="badge badge-outline badge-xs">{row.classification}</span></td>
              <td><span class="badge badge-outline badge-xs">{authorityKinds.get(row.deploymentId) ?? "unknown"}</span></td>
              <td class="trellis-identifier text-xs text-base-content/70">{row.deploymentId}</td>
              <td><div class="text-sm">{diffSummary(row)}</div><div class="trellis-identifier truncate text-xs text-base-content/50">{row.contractId}</div></td>
              <td class="whitespace-nowrap text-base-content/60">{formatDate(row.createdAt)}</td>
            </tr>
          {/each}
        </tbody>
      </DataTable>
    {/if}
  </Panel>
</section>
