<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListServiceInstancesOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import InlineMetricsStrip from "$lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { errorMessage } from "$lib/format";
  import { loadJobsPageData } from "$lib/jobs_page.ts";
  import { getTrellis } from "$lib/trellis";
  import type {
    JobsListOutput,
  } from "@qlever-llc/trellis/sdk/jobs";

  type ServiceInstance = AuthListServiceInstancesOutput["instances"][number];
  type Job = JobsListOutput["jobs"][number];
  type OverviewInstance = {
    service: string;
    id: string;
    status: "Active" | "Disabled";
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

  let loading = $state(true);
  let error = $state<string | null>(null);
  let instances = $state<ServiceInstance[]>([]);
  let sessionCount = $state(0);
  let connectionCount = $state(0);
  let jobsUnavailableMessage = $state<string | null>(null);
  let jobs = $state<Job[]>([]);

  const activeInstances = $derived(instances.filter((instance) => !instance.disabled).length);
  const disabledInstances = $derived(instances.filter((instance) => instance.disabled).length);
  const displayInstances = $derived(instances.map(toOverviewInstance));
  const displayJobs = $derived(toOverviewJobs(jobs));
  const serviceInstanceTotal = $derived(instances.length);
  const disabledTotal = $derived(disabledInstances);
  const activeJobCount = $derived(jobs.filter((job) => job.state === "active").length);
  const totalJobCount = $derived(jobs.length);

  const topology = $derived([
    { icon: "box", label: "Service instances", value: serviceInstanceTotal, detail: `${activeInstances} active / ${disabledTotal} disabled`, tone: "text-success bg-success/10" },
    { icon: "users", label: "Sessions", value: sessionCount, detail: "live auth sessions", tone: "text-info bg-info/10" },
    { icon: "activity", label: "Connections", value: connectionCount, detail: "current transports", tone: "text-secondary bg-secondary/10" },
    { icon: "grid", label: "Jobs", value: totalJobCount, detail: `${activeJobCount} active`, tone: "text-warning bg-warning/10" },
  ]);

  const metrics = $derived([
    { label: "Service Instances", value: serviceInstanceTotal, detail: `/ ${disabledTotal} disabled` },
    { label: "Sessions", value: sessionCount },
    { label: "Connections", value: connectionCount },
    { label: "Jobs", value: totalJobCount, badge: `${activeJobCount} active`, badgeClass: "badge-success" },
    { label: "Warnings", value: "Not loaded", detail: "Open Contracts" },
  ]);

  function toOverviewInstance(instance: ServiceInstance): OverviewInstance {
    return {
      service: instance.deploymentId,
      id: instance.instanceId,
      status: instance.disabled ? "Disabled" : "Active",
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
    if (status === "Healthy" || status === "Active" || status === "Completed") return "healthy";
    if (status === "Degraded" || status === "Retry" || status === "Pending") return "degraded";
    if (status === "Failed" || status === "Dead") return "unhealthy";
    return "offline";
  }

  function toneForType(type: OverviewInstance["type"]): string {
    return {
      portal: "text-secondary bg-secondary/10",
      device: "text-info bg-info/10",
      service: "text-success bg-success/10",
    }[type];
  }

  async function load() {
    loading = true;
    error = null;
    jobsUnavailableMessage = null;
    try {
      const [sessionsRes, connectionsRes, instancesRes] = await Promise.all([
        trellis.request("Auth.ListSessions", {}).take(),
        trellis.request("Auth.ListConnections", {}).take(),
        trellis.request("Auth.ListServiceInstances", {}).take(),
      ]);
      if (isErr(sessionsRes)) { error = errorMessage(sessionsRes); return; }
      if (isErr(connectionsRes)) { error = errorMessage(connectionsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      sessionCount = sessionsRes.sessions?.length ?? 0;
      connectionCount = connectionsRes.connections?.length ?? 0;
      instances = instancesRes.instances ?? [];

      const jobsData = await loadJobsPageData({
        listServices: () => trellis.request("Jobs.ListServices", {}),
        listJobs: (filter) => trellis.request("Jobs.List", filter),
      }).catch((jobsError: unknown) => ({
        available: false,
        message: `Jobs admin runtime is unavailable: ${errorMessage(jobsError)}`,
        services: [],
        jobs: [],
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
      <div class="alert alert-error mb-4"><span>{error}</span></div>
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
            <a href={resolve("/admin/services/instances")} class="btn btn-ghost btn-sm">View all <Icon name="arrowRight" size={16} /></a>
          </div>
          {#if displayInstances.length === 0}
            <EmptyState title="No service instances" description="Provisioned service instances will appear here after they are registered." class="m-5" />
          {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table min-w-[860px] table-fixed">
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
            </table>
          </div>
          {/if}
          <div class="flex h-14 items-center justify-between border-t border-base-300 px-5 text-sm text-base-content/60">
            <span>Showing {displayInstances.length === 0 ? "0" : `1–${displayInstances.length}`} of {serviceInstanceTotal}</span>
            <a href={resolve("/admin/services/instances")} class="btn btn-ghost btn-sm">View all service instances <Icon name="arrowRight" size={16} /></a>
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
              <div class="alert alert-info"><span>{jobsUnavailableMessage}</span></div>
              <p class="text-xs text-base-content/60">Overview metrics remain available without the Jobs runtime.</p>
            </div>
          {:else if displayJobs.length === 0}
            <EmptyState title="No jobs" description="Job queues will appear here when the Jobs API reports active or retained work." class="m-5" />
          {:else}
          <div class="overflow-x-auto">
            <table class="table table-xs trellis-table">
              <thead><tr><th>Job</th><th>State</th><th>Count</th><th>Oldest</th></tr></thead>
              <tbody>
                {#each displayJobs as job (job.key)}
                  <tr><td class="trellis-identifier">{job.job}</td><td><StatusBadge label={job.state} status={statusVariant(job.state)} /></td><td>{job.count}</td><td>{job.oldest}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
          {/if}
        </section>

        <section class="card trellis-card overflow-hidden bg-base-100">
          <div class="flex h-14 items-center justify-between border-b border-base-300 px-5"><h2 class="card-title text-base">Contract Warnings</h2><a href={resolve("/admin/contracts")} class="btn btn-ghost btn-xs">View all</a></div>
          <EmptyState title="No contract warnings loaded" description="Open Contracts to inspect installed contract analysis and derived runtime permissions." class="m-5" />
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
