<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type {
    AuthDeviceUserAuthoritiesReviewsListOutput,
    AuthServiceInstancesListOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import type { DeploymentAuthorityKind, DeploymentAuthorityPlan } from "@qlever-llc/trellis/auth";
  import { base, resolve } from "$app/paths";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { errorMessage } from "$lib/format";
  import { loadJobsPageData } from "$lib/jobs_page.ts";
  import {
    contractDependencyProviderContract,
    contractDependencyRequiredThing,
    isContractDependencyBlock,
  } from "$lib/catalog_issues";
  import { getTrellis } from "$lib/trellis";
  import type {
    JobsListOutput,
  } from "@qlever-llc/trellis/sdk/jobs";

  type ServiceInstance = AuthServiceInstancesListOutput["entries"][number];
  type Job = JobsListOutput["entries"][number];
  type DeploymentAuthority = { deploymentId: string; kind: DeploymentAuthorityKind; disabled: boolean };
  type DeviceReview = AuthDeviceUserAuthoritiesReviewsListOutput["entries"][number];
  type CatalogIssue = {
    issueId: string;
    kind: string;
    contractId?: string;
    message: string;
    deploymentIds?: string[];
  };
  type CatalogOutput = {
    catalog: {
      issues?: CatalogIssue[];
    };
  };
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type CoreRequest = {
    (method: "Trellis.Catalog", input: Record<string, never>): RpcTakeable<CatalogOutput>;
  };
  type AuthorityRequest = {
    (method: "Auth.DeploymentAuthority.List", input: { limit: number; offset: number }): RpcTakeable<{ entries?: DeploymentAuthority[] }>;
    (method: "Auth.DeploymentAuthority.Plans.List", input: { state: "pending"; limit: number; offset: number }): RpcTakeable<{ entries?: DeploymentAuthorityPlan[] }>;
  };
  type OverviewInstance = {
    service: string;
    id: string;
    status: "Enabled" | "Disabled";
    version: string;
    seen: string;
    type: "service" | "device" | "portal";
  };
  type OverviewJob = {
    key: string;
    job: string;
    state: string;
    count: number;
    oldest: string;
  };

  const trellis = getTrellis();
  const coreRequest = trellis.request.bind(trellis) as CoreRequest;
  const authorityRequest = trellis.request.bind(trellis) as AuthorityRequest;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let catalogIssueError = $state<string | null>(null);
  let instances = $state<ServiceInstance[]>([]);
  let sessionCount = $state(0);
  let connectionCount = $state(0);
  let jobsUnavailableMessage = $state<string | null>(null);
  let jobs = $state<Job[]>([]);
  let catalogIssues = $state.raw<CatalogIssue[]>([]);
  let deploymentAuthorities = $state.raw<DeploymentAuthority[]>([]);
  let pendingAuthorityPlans = $state.raw<DeploymentAuthorityPlan[]>([]);
  let pendingDeviceReviews = $state.raw<DeviceReview[]>([]);

  const activeInstances = $derived(instances.filter((instance) => !instance.disabled).length);
  const disabledInstances = $derived(instances.filter((instance) => instance.disabled).length);
  const displayInstances = $derived(instances.map(toOverviewInstance));
  const displayJobs = $derived(toOverviewJobs(jobs));
  const serviceInstanceTotal = $derived(instances.length);
  const disabledTotal = $derived(disabledInstances);
  const activeJobCount = $derived(jobs.filter((job) => job.state === "active").length);
  const totalJobCount = $derived(jobs.length);
  const pendingWorkTotal = $derived(pendingDeviceReviews.length + pendingAuthorityPlans.length);
  const serviceAuthorityTotal = $derived(deploymentAuthorities.filter((authority) => authority.kind === "service" && !authority.disabled).length);
  const deviceAuthorityTotal = $derived(deploymentAuthorities.filter((authority) => authority.kind === "device" && !authority.disabled).length);
  const dependencyBlocks = $derived(catalogIssues.filter(isContractDependencyBlock));
  const catalogWarningCount = $derived(dependencyBlocks.length);

  const topology = $derived([
    { icon: "box", label: "Service instances", value: serviceInstanceTotal, detail: `${activeInstances} enabled / ${disabledTotal} disabled`, tone: "text-neutral bg-base-300/60" },
    { icon: "users", label: "Sessions", value: sessionCount, detail: "live auth sessions", tone: "text-info bg-info/10" },
    { icon: "activity", label: "Connections", value: connectionCount, detail: "current transports", tone: "text-secondary bg-secondary/10" },
    { icon: "grid", label: "Jobs", value: totalJobCount, detail: `${activeJobCount} active`, tone: "text-warning bg-warning/10" },
  ]);

  const metrics = $derived([
    { label: "Service Instances", value: serviceInstanceTotal, detail: `/ ${disabledTotal} disabled` },
    { label: "Sessions", value: sessionCount },
    { label: "Connections", value: connectionCount },
    { label: "Jobs", value: totalJobCount, badge: `${activeJobCount} active`, badgeClass: "badge-neutral" },
    { label: "Warnings", value: catalogWarningCount, detail: catalogIssueError ? "Catalog unavailable" : "contract blocks" },
  ]);

  function dependencyKindText(requiredThing: string): string | null {
    if (requiredThing === "a required surface") return null;
    const separator = requiredThing.indexOf(" ");
    if (separator < 1) return null;
    const kind = requiredThing.slice(0, separator);
    return kind === "RPC" ? "RPC" : kind.toLowerCase();
  }

  function dependencySurfaceName(requiredThing: string): string | null {
    const separator = requiredThing.indexOf(" ");
    return separator > 0 ? requiredThing.slice(separator + 1) : null;
  }

  function toOverviewInstance(instance: ServiceInstance): OverviewInstance {
    return {
      service: instance.deploymentId,
      id: instance.instanceId,
      status: instance.disabled ? "Disabled" : "Enabled",
      version: "—",
      seen: "known",
      type: "service",
    };
  }

  function toOverviewJobs(records: Job[]): OverviewJob[] {
    const grouped: Record<string, OverviewJob> = {};
    for (const job of records) {
      const key = `${job.service}:${job.type}:${job.state}`;
      const existing = grouped[key];
      if (existing) {
        existing.count += 1;
        continue;
      }
      grouped[key] = {
        key,
        job: job.type,
        state: formatJobState(job.state),
        count: 1,
        oldest: "—",
      };
    }
    return Object.values(grouped).slice(0, 5);
  }

  function formatJobState(state: Job["state"]): OverviewJob["state"] {
    switch (state) {
      case "active":
        return "Active";
      case "retry":
        return "Retry";
      case "pending":
        return "Pending";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      case "expired":
        return "Expired";
      case "dead":
        return "Dead";
      default:
        return state;
    }
  }

  function statusVariant(status: string): "healthy" | "degraded" | "unhealthy" | "offline" {
    if (status === "Healthy") return "healthy";
    if (status === "Degraded" || status === "Retry" || status === "Pending") return "degraded";
    if (status === "Failed" || status === "Dead") return "unhealthy";
    return "offline";
  }

  function toneForType(type: OverviewInstance["type"]): string {
    return {
      portal: "text-secondary bg-secondary/10",
      device: "text-info bg-info/10",
      service: "text-neutral bg-base-300/60",
    }[type];
  }

  async function load() {
    loading = true;
    error = null;
    catalogIssueError = null;
    jobsUnavailableMessage = null;
    try {
      const [sessionsRes, connectionsRes, instancesRes, authoritiesRes, authorityPlansRes, deviceReviewsRes, catalogRes] = await Promise.all([
        trellis.request("Auth.Sessions.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.Connections.List", { limit: 500, offset: 0 }).take(),
        trellis.request("Auth.ServiceInstances.List", { limit: 500, offset: 0 }).take(),
        authorityRequest("Auth.DeploymentAuthority.List", { limit: 500, offset: 0 }).take(),
        authorityRequest("Auth.DeploymentAuthority.Plans.List", { state: "pending", limit: 500, offset: 0 }).take(),
        trellis.request("Auth.DeviceUserAuthorities.Reviews.List", { state: "pending", limit: 500, offset: 0 }).take(),
        coreRequest("Trellis.Catalog", {}).take(),
      ]);
      if (isErr(sessionsRes)) { error = errorMessage(sessionsRes); return; }
      if (isErr(connectionsRes)) { error = errorMessage(connectionsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      if (isErr(authoritiesRes)) { error = errorMessage(authoritiesRes); return; }
      if (isErr(authorityPlansRes)) { error = errorMessage(authorityPlansRes); return; }
      if (isErr(deviceReviewsRes)) { error = errorMessage(deviceReviewsRes); return; }
      if (isErr(catalogRes)) catalogIssueError = errorMessage(catalogRes);
      sessionCount = sessionsRes.entries?.length ?? 0;
      connectionCount = connectionsRes.entries?.length ?? 0;
      instances = instancesRes.entries ?? [];
      deploymentAuthorities = authoritiesRes.entries ?? [];
      pendingAuthorityPlans = authorityPlansRes.entries ?? [];
      pendingDeviceReviews = deviceReviewsRes.entries ?? [];
      catalogIssues = isErr(catalogRes) ? [] : catalogRes.catalog.issues ?? [];

      const jobsData = await loadJobsPageData({
        listServices: (input) => trellis.request("Jobs.ListServices", input),
        listJobs: (filter) => trellis.request("Jobs.List", filter),
      }).catch((jobsError: unknown) => ({
        available: false,
        message: `Jobs admin runtime is unavailable: ${errorMessage(jobsError)}`,
        services: [],
        jobs: [],
        count: 0,
        offset: 0,
        limit: 50,
      }));
      jobs = jobsData.available ? jobsData.jobs : [];
      jobsUnavailableMessage = jobsData.available ? null : jobsData.message ?? "Jobs admin runtime is unavailable.";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

{#if loading}
  <LoadingState label="Loading overview" />
{:else}
  <section>
    <PageToolbar title="Overview" description="Real-time summary of your Trellis runtime">
      {#snippet actions()}
      <div class="join">
        <button class="btn btn-outline join-item btn-sm">Last 5 minutes <Icon name="chevronDown" size={16} /></button>
        <button class="btn btn-outline join-item btn-sm" aria-label="Refresh" onclick={load}><Icon name="refresh" size={16} /></button>
      </div>
      {/snippet}
    </PageToolbar>

    {#if error}
      <Notice variant="error" class="mb-4">{error}</Notice>
    {/if}

    {#if dependencyBlocks.length > 0 || catalogIssueError}
      <Notice variant="warning" class="mb-4 items-start">
        <div class="min-w-0">
          <div class="font-medium">Contract dependency block</div>
          <div class="mt-1 text-sm">
            {#if catalogIssueError}
              Catalog issue status is unavailable: {catalogIssueError}
            {:else if dependencyBlocks[0]}
              {@const issue = dependencyBlocks[0]}
              {@const blockedDeployment = issue.deploymentIds?.[0] ?? issue.contractId ?? "Service"}
              {@const requiredThing = contractDependencyRequiredThing(issue)}
              {@const requiredKind = dependencyKindText(requiredThing)}
              {@const requiredName = dependencySurfaceName(requiredThing)}
              {@const providerContract = contractDependencyProviderContract(issue)}
              A <span class="trellis-identifier font-semibold">{blockedDeployment}</span> instance was blocked because its contract
              {#if requiredKind && requiredName}
                requires an undefined {requiredKind} <span class="trellis-identifier font-semibold">{requiredName}</span> from
                <span class="trellis-identifier font-semibold">{providerContract}</span>.
              {:else}
                requires <span class="trellis-identifier font-semibold">{providerContract}</span>, but that contract is not currently active or did not advertise the required API.
              {/if}
            {/if}
          </div>
        </div>
        <a class="btn btn-warning btn-outline btn-sm" href={resolve("/admin/services")}>Open services</a>
      </Notice>
    {/if}

    <Panel title="Runtime Topology" class="overflow-hidden">
      {#snippet actions()}
        <a href={resolve("/admin/health-events")} class="btn btn-ghost btn-sm gap-1">View topology <Icon name="arrowRight" size={16} /></a>
      {/snippet}
      <div class="divide-y divide-base-300 rounded-box border border-base-300">
          {#each topology as item (item.label)}
            <div class="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm transition hover:bg-base-200/50">
              <div class={["grid h-8 w-8 shrink-0 place-items-center rounded-full", item.tone]}>
                <Icon name={item.icon} size={16} />
              </div>
              <div class="min-w-0"><div class="font-medium">{item.label}</div><div class="truncate text-xs text-base-content/55">{item.detail}</div></div>
              <div class="text-right font-semibold tabular-nums">{item.value}</div>
            </div>
          {/each}
      </div>
    </Panel>

    <InlineMetricsStrip metrics={metrics} class="mt-4" />

    <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
      <section class="card trellis-card bg-base-100">
        <div class="card-body p-0">
          <div class="flex h-14 items-center justify-between border-b border-base-300 px-5">
            <h2 class="card-title text-base">Service Instances</h2>
            <a href={resolve("/admin/services")} class="btn btn-ghost btn-sm">View services <Icon name="arrowRight" size={16} /></a>
          </div>
          {#if displayInstances.length === 0}
            <EmptyState title="No service instances" description="Provisioned service instances will appear here after they are registered." class="m-5" />
          {:else}
          <DataTable class="min-w-[860px]" fixed>
              <colgroup>
                <col class="w-[28%]" />
                <col class="w-[32%]" />
                <col class="w-[14%]" />
                <col class="w-[10%]" />
                <col class="w-[12%]" />
                <col class="w-[4%]" />
              </colgroup>
              <thead><tr><th>Service</th><th>Instance ID</th><th>Status</th><th>Version</th><th>Last Seen</th><th></th></tr></thead>
              <tbody>
                {#each displayInstances as item (item.id)}
                  <tr>
                    <td>
                      <div class="flex min-w-0 items-center gap-3">
                        <span class={["grid h-8 w-8 shrink-0 place-items-center rounded-full", toneForType(item.type)]}><Icon name="box" size={16} /></span>
                        <span class="truncate font-medium" title={item.service}>{item.service}</span>
                      </div>
                    </td>
                    <td class="trellis-identifier truncate text-xs text-base-content/60" title={item.id}>{item.id}</td>
                    <td class="whitespace-nowrap"><StatusBadge label={item.status} status={statusVariant(item.status)} /></td>
                    <td class="whitespace-nowrap">{item.version}</td>
                    <td class="whitespace-nowrap">{item.seen}</td>
                    <td class="whitespace-nowrap"><button class="btn btn-ghost btn-xs btn-square" aria-label="More actions"><Icon name="more" size={16} /></button></td>
                  </tr>
                {/each}
              </tbody>
          </DataTable>
          {/if}
          <div class="flex h-14 items-center justify-between border-t border-base-300 px-5 text-sm text-base-content/60">
            <span>Showing {displayInstances.length === 0 ? "0" : `1–${displayInstances.length}`} of {serviceInstanceTotal}</span>
            <a href={resolve("/admin/services")} class="btn btn-ghost btn-sm">View service runtime <Icon name="arrowRight" size={16} /></a>
          </div>
        </div>
      </section>

      <div class="space-y-4">
        <section class="card trellis-card bg-base-100">
          <div class="card-body gap-4 p-5">
            <div class="flex items-center justify-between"><h2 class="card-title text-base">Live Health</h2><a href={resolve("/admin/health-events")} class="btn btn-ghost btn-xs">View all</a></div>
            <EmptyState title="Live health opens in Health Events" description="Heartbeat-derived healthy, degraded, unhealthy, and offline states require the live health event stream." class="py-4" />
          </div>
        </section>

        <section class="card trellis-card overflow-hidden bg-base-100">
          <div class="flex h-14 items-center justify-between border-b border-base-300 px-5"><h2 class="card-title text-base">Jobs Snapshot</h2><a href={resolve("/admin/jobs")} class="btn btn-ghost btn-xs">View all</a></div>
          {#if jobsUnavailableMessage}
            <div class="m-5 space-y-2">
              <Notice variant="info">{jobsUnavailableMessage}</Notice>
              <p class="text-xs text-base-content/60">Overview metrics remain available without the Jobs runtime.</p>
            </div>
          {:else if displayJobs.length === 0}
            <EmptyState title="No jobs" description="Job queues will appear here when the Jobs API reports active or retained work." class="m-5" />
          {:else}
          <DataTable size="xs">
              <thead><tr><th>Job</th><th>State</th><th>Count</th><th>Oldest</th></tr></thead>
              <tbody>
                {#each displayJobs as job (job.key)}
                  <tr><td class="trellis-identifier">{job.job}</td><td><StatusBadge label={job.state} status={statusVariant(job.state)} /></td><td>{job.count}</td><td>{job.oldest}</td></tr>
                {/each}
              </tbody>
          </DataTable>
          {/if}
        </section>

        <section class="card trellis-card overflow-hidden bg-base-100">
          <div class="flex h-14 items-center justify-between border-b border-base-300 px-5"><h2 class="card-title text-base">Pending Work</h2><span class="badge badge-sm {pendingWorkTotal > 0 ? 'badge-warning' : 'badge-ghost'}">{pendingWorkTotal} pending</span></div>
          {#if pendingWorkTotal === 0}
            <div class="px-5 py-3 text-sm text-base-content/60">No device activation reviews or authority plans waiting.</div>
          {:else}
            <div class="divide-y divide-base-300 text-sm">
              <a class="flex items-center justify-between px-5 py-2.5 hover:bg-base-200/50" href={`${base}/admin/authority/plans`}>Authority plans <span class="badge badge-warning badge-sm">{pendingAuthorityPlans.length}</span></a>
              <a class="flex items-center justify-between px-5 py-2.5 hover:bg-base-200/50" href={resolve("/admin/services")}>Service deployment authority <span class="badge badge-outline badge-sm">{serviceAuthorityTotal}</span></a>
              <a class="flex items-center justify-between px-5 py-2.5 hover:bg-base-200/50" href={resolve("/admin/devices")}>Device reviews / authority <span class="badge badge-outline badge-sm">{pendingDeviceReviews.length + deviceAuthorityTotal}</span></a>
            </div>
          {/if}
        </section>
      </div>
    </div>

    <Panel title="Recent Activity" class="mt-4">
      {#snippet actions()}
        <a href={resolve("/admin/health-events")} class="btn btn-ghost btn-sm">View health events <Icon name="arrowRight" size={16} /></a>
      {/snippet}
        <EmptyState title="No activity feed connected" description="Use Health Events for the live heartbeat stream until activity events are available in the overview." class="py-4" />
    </Panel>
  </section>
{/if}
