<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthDeploymentAuthorityListOutput,
    AuthDeploymentAuthorityPlansListOutput,
    AuthDeploymentsListOutput,
    AuthServiceInstancesListOutput,
  } from "@trellis/apis/trellis.auth";
  import type { HealthQueryOutput } from "@trellis/apis/trellis.health";
  import { resolve } from "$lib/console_paths";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type Deployment = AuthDeploymentsListOutput["entries"][number];
  type ServiceInstance = AuthServiceInstancesListOutput["entries"][number];
  type DeploymentAuthority = AuthDeploymentAuthorityListOutput["entries"][number];
  type AuthorityPlan = AuthDeploymentAuthorityPlansListOutput["entries"][number];
  type ContractRef = { contractId: string; digest: string };
  type HealthParticipant = HealthQueryOutput["entries"][number];
  const trellis = getTrellis();
  const RPC_TIMEOUT_MS = 10_000;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let subscriptionError = $state<string | null>(null);
  let deployments = $state.raw<Deployment[]>([]);
  let instances = $state.raw<ServiceInstance[]>([]);
  let deploymentAuthorities = $state.raw<DeploymentAuthority[]>([]);
  let pendingAuthorityPlans = $state.raw<AuthorityPlan[]>([]);
  let healthParticipants = $state.raw<HealthParticipant[]>([]);
  let search = $state("");

  const serviceDeploymentIds = $derived(new Set(deployments.map((deployment) => deployment.deploymentId)));
  const serviceAuthorityRows = $derived.by(() =>
    deploymentAuthorities
      .filter((authority) => authority.materialization?.participantKind === "service" && serviceDeploymentIds.has(authority.deploymentId))
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
  );
  const filteredDeployments = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return deployments;
    return deployments.filter((deployment) => deployment.deploymentId.toLowerCase().includes(term));
  });
  const disabledCount = $derived(deployments.filter((deployment) => deployment.state === "disabled").length);
  const pendingPlanCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const plan of pendingAuthorityPlans) {
      counts[plan.subjectId] = (counts[plan.subjectId] ?? 0) + 1;
    }
    return counts;
  });

  function contractRefsForHealthService(service: HealthParticipant | null): ContractRef[] {
    return service?.contractDigests.map((digest) => ({
      contractId: service.contractId,
      digest,
    })) ?? [];
  }

  function healthServiceForDeployment(deploymentId: string): HealthParticipant | null {
    return healthParticipants.find((participant) =>
      participant.participantKind === "service" &&
      participant.deploymentIds.includes(deploymentId)
    ) ?? null;
  }

  function statusLabel(status: string): string {
    if (status === "healthy") return "Healthy";
    if (status === "degraded") return "Degraded";
    if (status === "unhealthy") return "Unhealthy";
    if (status === "offline") return "Offline";
    return status;
  }

  function badgeClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy") return "badge-success";
    if (status === "Degraded" || status === "degraded") return "badge-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "badge-error";
    return "badge-neutral";
  }

  function dotClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy") return "bg-success";
    if (status === "Degraded" || status === "degraded") return "bg-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "bg-error";
    return "bg-base-content/30";
  }

  function formatSeenAt(value: string | undefined): string {
    return value ? formatDate(value) : "-";
  }

  function objectRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  function deploymentCompatibilityMode(deployment: Deployment): string {
    const mode = objectRecord(deployment)?.contractCompatibilityMode;
    return typeof mode === "string" ? mode : "strict";
  }

  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  function authoritySummary(authority: DeploymentAuthority): string {
    return plural(authority.desiredGrantSet.permissions.length, "permission");
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const [deploymentsRes, instancesRes, authoritiesRes, plansRes] = await Promise.all([
        trellis.authDeploymentsList({ kind: "service", limit: 100 }).take(),
        trellis.authServiceInstancesList({ limit: 100 }).take(),
        trellis.authDeploymentAuthorityList({ limit: 100 }).take(),
        trellis.authDeploymentAuthorityPlansList({ state: "pending", limit: 100 }).take(),
      ]);
      if (isErr(deploymentsRes)) { error = errorMessage(deploymentsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      if (isErr(authoritiesRes)) { error = errorMessage(authoritiesRes); return; }
      if (isErr(plansRes)) { error = errorMessage(plansRes); return; }
      deployments = (deploymentsRes.entries ?? []).filter((deployment): deployment is Deployment => deployment.kind === "service");
      instances = instancesRes.entries ?? [];
      deploymentAuthorities = authoritiesRes.entries ?? [];
      pendingAuthorityPlans = plansRes.entries ?? [];
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function loadHealth(): Promise<void> {
    const result = await trellis.healthQuery({ participantKinds: ["service"], limit: 200, offset: 0 },
      { timeout: RPC_TIMEOUT_MS },
    ).take();
    if (isErr(result)) {
      subscriptionError = errorMessage(result);
      return;
    }
    healthParticipants = result.entries;
    subscriptionError = null;
  }

  onMount(() => {
    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    void load();
    void loadHealth();
    void (async () => {
      try {
        const result = await trellis.healthWatch(
          { participantKinds: ["service"] },
          { signal: controller.signal },
        ).take();
        if (isErr(result)) {
          subscriptionError = errorMessage(result);
          return;
        }
        for await (const event of result) {
          if (event.type === "ready") continue;
          if (refreshTimer !== undefined) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void loadHealth(), 250);
        }
      } catch (cause) {
        if (!controller.signal.aborted) subscriptionError = errorMessage(cause);
      }
    })();

    return () => {
      controller.abort();
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    };
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Service runtime" description="Service deployments, runtime instances, and active health.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
      <a class="btn btn-outline btn-sm" href={resolve("/(app)/admin/services/new")}>Create service</a>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}
  {#if subscriptionError}<Notice variant="warning">Health projection unavailable: {subscriptionError}</Notice>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading services" /></Panel>
  {:else}
    {#if serviceAuthorityRows.length > 0}
      <Panel title="Deployment authority" eyebrow={`${serviceAuthorityRows.length} service desired-state record${serviceAuthorityRows.length === 1 ? "" : "s"}`}>
        <DataTable>
          <thead><tr><th>Deployment</th><th>Desired version</th><th>Desired authority</th><th>Pending review</th><th>Status</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            {#each serviceAuthorityRows as authority (authority.deploymentId)}
              <tr class="hover:bg-base-200/60">
                <td class="trellis-identifier font-medium">{authority.deploymentId}</td>
                <td class="trellis-identifier text-xs text-base-content/60">{authority.version}</td>
                <td>{authoritySummary(authority)}</td>
                <td>{#if (pendingPlanCounts[authority.deploymentId] ?? 0) > 0}<span class="badge badge-warning badge-xs">{pendingPlanCounts[authority.deploymentId]} pending</span>{:else}<span class="text-xs text-base-content/40">none</span>{/if}</td>
                <td><span class="badge badge-outline badge-xs">{authority.state}</span></td>
                <td class="text-base-content/60">{formatDate(authority.updatedAt)}</td>
                <td><a class="btn btn-warning btn-outline btn-xs" href={resolve("/(app)/admin/services/[deploymentId]", { deploymentId: authority.deploymentId })}>Inspect</a></td>
              </tr>
            {/each}
          </tbody>
        </DataTable>
      </Panel>
    {/if}

    <Panel>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold uppercase tracking-wide text-base-content/70">Services fleet</h2>
          <p class="text-xs text-base-content/50">{deployments.length} deployment{deployments.length === 1 ? "" : "s"} · {disabledCount} disabled / archived</p>
        </div>
        <label class="input input-bordered input-sm flex items-center gap-2">
          <Icon name="search" size={14} class="text-base-content/50" />
          <input bind:value={search} class="grow" placeholder="Search deployments" aria-label="Search deployments" />
        </label>
      </div>

      {#if deployments.length === 0}
        <EmptyState title="No deployments" description="Run services create to add a deployment." />
      {:else}
        <DataTable>
          <thead><tr><th>Deployment</th><th>Status</th><th>Instances</th><th>Mode</th><th>Heartbeat</th><th>Contracts</th></tr></thead>
          <tbody>
            {#each filteredDeployments as deployment (deployment.deploymentId)}
              {@const serviceInstances = instances.filter((instance) => instance.deploymentId === deployment.deploymentId)}
              {@const activeServiceInstances = serviceInstances.filter((instance) => instance.state === "active")}
               {@const healthService = healthServiceForDeployment(deployment.deploymentId)}
               {@const rowStatus = deployment.state === "disabled" ? "Disabled" : (healthService ? statusLabel(healthService.effectiveStatus) : (activeServiceInstances.length > 0 ? "Enabled" : "No instances"))}
              {@const refs = contractRefsForHealthService(healthService)}
              <tr class="hover:bg-base-200/60">
                <td class="min-w-72">
                  <a class="btn btn-ghost h-auto min-h-0 justify-start gap-2 px-2 py-1 text-left" href={resolve("/(app)/admin/services/[deploymentId]", { deploymentId: deployment.deploymentId })}>
                    <span class={["h-2.5 w-2.5 rounded-full", dotClassForStatus(rowStatus)]}></span><span class="trellis-identifier font-medium">{deployment.deploymentId}</span>
                  </a>
                </td>
                <td><span class={["badge badge-sm", badgeClassForStatus(rowStatus)]}>{rowStatus}</span></td>
                <td>{activeServiceInstances.length}/{serviceInstances.length} enabled</td>
                <td>{#if deploymentCompatibilityMode(deployment) === "mutable-dev"}<span class="badge badge-warning badge-xs">mutable-dev</span>{:else}<span class="badge badge-outline badge-xs">strict</span>{/if}</td>
                <td class="text-base-content/60">{healthService ? formatSeenAt(healthService.lastSeenAt) : "-"}</td>
                <td>
                  <div class="flex flex-wrap gap-1">
                    {#each refs as ref (`${ref.contractId}:${ref.digest}`)}
                      <span class="badge badge-outline badge-sm trellis-identifier" title={ref.digest}>{ref.contractId}</span>
                    {:else}
                      <span class="text-xs text-base-content/50">No live contract</span>
                    {/each}
                  </div>
                </td>
              </tr>
            {:else}
              <tr><td colspan="6" class="text-base-content/50">No matching deployments.</td></tr>
            {/each}
          </tbody>
        </DataTable>
      {/if}
    </Panel>

  {/if}
</section>
