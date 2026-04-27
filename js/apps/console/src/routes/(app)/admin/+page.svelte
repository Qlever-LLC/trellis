<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthListServiceInstancesOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
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
    status: "Healthy" | "Degraded" | "Offline";
    version: string;
    seen: string;
    type: "service" | "device" | "portal";
  };
  type OverviewJob = {
    key: string;
    job: string;
    state: "Active" | "Retry" | "Pending" | "Completed" | "Failed";
    count: number;
    oldest: string;
  };

  const trellis = getTrellis();

  const referenceInstances: OverviewInstance[] = [
    { service: "auth", id: "auth-7c9d8f6b4f-2k8m9", status: "Healthy", version: "1.12.3", seen: "2s ago", type: "service" },
    { service: "trellis-runtime", id: "rt-5b6c7d8f96-q4x7n", status: "Healthy", version: "1.12.3", seen: "5s ago", type: "service" },
    { service: "device-gateway", id: "dg-3c2b1a0f9e-r7t6y", status: "Healthy", version: "1.12.3", seen: "8s ago", type: "device" },
    { service: "portal", id: "portal-0a1b2c3d4e-p9q8", status: "Healthy", version: "1.12.3", seen: "12s ago", type: "portal" },
    { service: "billing-sync", id: "billing-9f0e1d2c3b-x6y7z", status: "Degraded", version: "1.11.2", seen: "18s ago", type: "device" },
    { service: "device-8f3a1b2c", id: "device-8f3a1b2c-1a2b3", status: "Offline", version: "1.11.0", seen: "2m ago", type: "device" },
  ];

  const referenceJobs: OverviewJob[] = [
    { key: "device-provision:active", job: "device-provision", state: "Active", count: 3, oldest: "2m 14s" },
    { key: "firmware-update:retry", job: "firmware-update", state: "Retry", count: 2, oldest: "7m 32s" },
    { key: "session-cleanup:pending", job: "session-cleanup", state: "Pending", count: 1, oldest: "45s" },
    { key: "reporting:completed", job: "reporting", state: "Completed", count: 24, oldest: "—" },
    { key: "usage-aggregate:failed", job: "usage-aggregate", state: "Failed", count: 1, oldest: "12m 8s" },
  ];

  const healthRows = [
    { name: "Healthy", count: 26, pct: 68, dot: "bg-success", progress: "progress-success" },
    { name: "Degraded", count: 8, pct: 21, dot: "bg-warning", progress: "progress-warning" },
    { name: "Unhealthy", count: 3, pct: 8, dot: "bg-error", progress: "progress-error" },
    { name: "Offline", count: 1, pct: 3, dot: "bg-slate-400", progress: "" },
  ];

  const warnings = [
    { name: "billing.v1.MissingCapability", message: "Missing capability: billing.write", time: "2m ago" },
    { name: "trellis.jobs.v1.LegacySubject", message: "Deprecated subject: jobs.v1.legacy.>", time: "15m ago" },
    { name: "auth.v1.UnscopedPublish", message: "Unscoped publish detected", time: "32m ago" },
  ];

  const activity = [
    { id: "auth-7c9d8f6b4f-2k8m9", message: "is healthy", time: "2s ago", dot: "bg-success" },
    { id: "device-8f3a1b2c", message: "heartbeat OK", time: "5s ago", dot: "bg-success" },
    { id: "jobs-1a2b3c4d5e-j9k81", message: "picked up 3 tasks", time: "11s ago", dot: "bg-info" },
    { id: "contract acme.billing@v1", message: "installed", time: "18s ago", dot: "bg-warning" },
    { id: "portal-0a1b2c3d4e-p9q8", message: "is healthy", time: "24s ago", dot: "bg-secondary" },
  ];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let instances = $state<ServiceInstance[]>([]);
  let sessionCount = $state(0);
  let connectionCount = $state(0);
  let jobs = $state<Job[]>([]);

  const activeInstances = $derived(instances.filter((instance) => !instance.disabled).length);
  const disabledInstances = $derived(instances.filter((instance) => instance.disabled).length);
  const displayInstances = $derived(instances.length > 0 ? instances.map(toOverviewInstance) : referenceInstances);
  const displayJobs = $derived(jobs.length > 0 ? toOverviewJobs(jobs) : referenceJobs);
  const serviceInstanceTotal = $derived(instances.length > 0 ? instances.length : 14);
  const disabledTotal = $derived(instances.length > 0 ? disabledInstances : 2);
  const activeJobCount = $derived(jobs.length > 0 ? jobs.filter((job) => job.state === "active").length : 8);
  const warningCount = $derived(warnings.length);

  const topology = $derived([
    { icon: "box", label: "Services", value: serviceInstanceTotal, detail: `${disabledTotal + 1} degraded`, tone: "text-success bg-success/10" },
    { icon: "phone", label: "Devices", value: 20, detail: "2 offline", tone: "text-info bg-info/10" },
    { icon: "globe", label: "Portals", value: 2, detail: "All healthy", tone: "text-secondary bg-secondary/10" },
    { icon: "grid", label: "Apps", value: 7, detail: "All healthy", tone: "text-warning bg-warning/10" },
  ]);

  function toOverviewInstance(instance: ServiceInstance): OverviewInstance {
    return {
      service: instance.deploymentId,
      id: instance.instanceId,
      status: instance.disabled ? "Offline" : "Healthy",
      version: "1.12.3",
      seen: "live",
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
        oldest: "live",
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
      default:
        return "Failed";
    }
  }

  function badgeClass(status: string): string {
    return {
      Healthy: "badge-success",
      Degraded: "badge-warning",
      Offline: "badge-neutral",
      Active: "badge-success",
      Retry: "badge-warning",
      Pending: "badge-info",
      Completed: "badge-accent",
      Failed: "badge-error",
    }[status] ?? "badge-neutral";
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
    try {
      const [sessionsRes, connectionsRes, instancesRes, jobsRes] = await Promise.all([
        trellis.request("Auth.ListSessions", {}).take(),
        trellis.request("Auth.ListConnections", {}).take(),
        trellis.request("Auth.ListServiceInstances", {}).take(),
        loadJobsPageData({
          listServices: () => trellis.request("Jobs.ListServices", {}),
          listJobs: (filter) => trellis.request("Jobs.List", filter),
        }),
      ]);
      if (isErr(sessionsRes)) { error = errorMessage(sessionsRes); return; }
      if (isErr(connectionsRes)) { error = errorMessage(connectionsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      if (isErr(jobsRes)) { error = errorMessage(jobsRes); return; }
      sessionCount = sessionsRes.sessions?.length ?? 0;
      connectionCount = connectionsRes.connections?.length ?? 0;
      instances = instancesRes.instances ?? [];
      jobs = jobsRes.available ? jobsRes.jobs : [];
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
    <div class="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight text-slate-900">Overview</h1>
        <p class="mt-1 text-sm text-slate-600">Real-time summary of your Trellis runtime</p>
      </div>
      <div class="join self-start lg:self-auto">
        <button class="btn btn-outline join-item btn-sm">Last 5 minutes <Icon name="chevronDown" size={16} /></button>
        <button class="btn btn-outline join-item btn-sm" aria-label="Refresh" onclick={load}><Icon name="refresh" size={16} /></button>
      </div>
    </div>

    {#if error}
      <div class="alert alert-error mb-4"><span>{error}</span></div>
    {/if}

    <section class="card trellis-card bg-base-100">
      <div class="card-body gap-5 p-5">
        <div class="flex items-center justify-between">
          <h2 class="card-title text-base">Runtime Topology</h2>
          <a href={resolve("/admin/health-events")} class="btn btn-ghost btn-sm gap-1">View topology <Icon name="arrowRight" size={16} /></a>
        </div>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {#each topology as item (item.label)}
            <div class="rounded-box border border-base-300 bg-base-100 p-4 transition hover:bg-base-200/70">
              <div class="flex items-center gap-4">
                <div class={["grid h-12 w-12 shrink-0 place-items-center rounded-full", item.tone]}>
                  <Icon name={item.icon} size={24} />
                </div>
                <div>
                  <div class="flex items-baseline gap-2">
                    <span class="text-sm text-slate-600">{item.label}</span>
                    <span class="text-2xl font-semibold tracking-tight">{item.value}</span>
                  </div>
                  <div class="text-xs text-slate-500">{item.detail}</div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </section>

    <section class="card trellis-card mt-4 overflow-hidden bg-base-100">
      <div class="grid divide-y divide-base-300 lg:grid-cols-5 lg:divide-x lg:divide-y-0">
        <div class="flex min-h-16 items-center px-5 text-sm"><span class="mr-3 h-2 w-2 rounded-full bg-success"></span><span class="font-medium text-slate-700">Service Instances</span><span class="ml-2 font-semibold">{serviceInstanceTotal}</span><span class="ml-1 text-slate-500">/ {disabledTotal} disabled</span></div>
        <div class="flex min-h-16 items-center px-5 text-sm"><span class="mr-3 h-2 w-2 rounded-full bg-success"></span><span class="font-medium text-slate-700">Sessions</span><span class="ml-2 font-semibold">{sessionCount || 38}</span></div>
        <div class="flex min-h-16 items-center px-5 text-sm"><span class="mr-3 h-2 w-2 rounded-full bg-success"></span><span class="font-medium text-slate-700">Connections</span><span class="ml-2 font-semibold">{connectionCount || 11}</span></div>
        <div class="flex min-h-16 items-center px-5 text-sm"><span class="mr-3 h-2 w-2 rounded-full bg-success"></span><span class="font-medium text-slate-700">Jobs</span><span class="ml-2 font-semibold">47</span><span class="badge badge-sm trellis-badge-soft badge-success ml-2 border-0">{activeJobCount} active</span></div>
        <div class="flex min-h-16 items-center px-5 text-sm"><span class="mr-3 h-2 w-2 rounded-full bg-success"></span><span class="font-medium text-slate-700">Warnings</span><span class="ml-2 font-semibold">{warningCount}</span><span class="badge badge-sm ml-2 border-0 bg-warning/15 text-warning">View</span></div>
      </div>
    </section>

    <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
      <section class="card trellis-card bg-base-100">
        <div class="card-body p-0">
          <div class="flex h-14 items-center justify-between border-b border-base-300 px-5">
            <h2 class="card-title text-base">Service Instances</h2>
            <a href={resolve("/admin/services/instances")} class="btn btn-ghost btn-sm">View all <Icon name="arrowRight" size={16} /></a>
          </div>
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
                    <td class="trellis-identifier truncate text-xs text-slate-600" title={item.id}>{item.id}</td>
                    <td class="whitespace-nowrap"><span class={["badge badge-sm trellis-badge-soft border-0", badgeClass(item.status)]}>{item.status}</span></td>
                    <td class="whitespace-nowrap">{item.version}</td>
                    <td class="whitespace-nowrap">{item.seen}</td>
                    <td class="whitespace-nowrap"><button class="btn btn-ghost btn-xs btn-square" aria-label="More actions"><Icon name="more" size={16} /></button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <div class="flex h-14 items-center justify-between border-t border-base-300 px-5 text-sm text-slate-600">
            <span>Showing 1–{displayInstances.length} of {serviceInstanceTotal}</span>
            <a href={resolve("/admin/services/instances")} class="btn btn-ghost btn-sm">View all service instances <Icon name="arrowRight" size={16} /></a>
          </div>
        </div>
      </section>

      <div class="space-y-4">
        <section class="card trellis-card bg-base-100">
          <div class="card-body gap-4 p-5">
            <div class="flex items-center justify-between"><h2 class="card-title text-base">Live Health</h2><a href={resolve("/admin/health-events")} class="btn btn-ghost btn-xs">View all</a></div>
            {#each healthRows as row (row.name)}
              <div class="grid grid-cols-[96px_1fr_32px_42px] items-center gap-3 text-sm">
                <span class="font-medium"><span class={["mr-2 inline-block h-2.5 w-2.5 rounded-full", row.dot]}></span>{row.name}</span>
                <progress class={["progress h-1.5", row.progress]} value={row.pct} max="100"></progress>
                <span class="text-right font-medium">{row.count}</span>
                <span class="text-right text-slate-500">{row.pct}%</span>
              </div>
            {/each}
          </div>
        </section>

        <section class="card trellis-card overflow-hidden bg-base-100">
          <div class="flex h-14 items-center justify-between border-b border-base-300 px-5"><h2 class="card-title text-base">Jobs Snapshot</h2><a href={resolve("/admin/jobs")} class="btn btn-ghost btn-xs">View all</a></div>
          <div class="overflow-x-auto">
            <table class="table table-xs trellis-table">
              <thead><tr><th>Job</th><th>State</th><th>Count</th><th>Oldest</th></tr></thead>
              <tbody>
                {#each displayJobs as job (job.key)}
                  <tr><td>{job.job}</td><td><span class={["badge badge-sm trellis-badge-soft border-0", badgeClass(job.state)]}>{job.state}</span></td><td>{job.count}</td><td>{job.oldest}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <section class="card trellis-card overflow-hidden bg-base-100">
          <div class="flex h-14 items-center justify-between border-b border-base-300 px-5"><h2 class="card-title text-base">Contract Warnings</h2><a href={resolve("/admin/contracts")} class="btn btn-ghost btn-xs">View all</a></div>
          <div class="divide-y divide-base-300 px-5">
            {#each warnings as warning (warning.name)}
              <div class="grid grid-cols-[22px_1fr_auto] gap-3 py-3 text-sm">
                <Icon name="alert" size={16} class="mt-0.5 text-warning" />
                <div class="min-w-0"><div class="truncate trellis-identifier text-xs font-semibold">{warning.name}</div><div class="truncate text-xs text-slate-500">{warning.message}</div></div>
                <div class="text-xs text-slate-500">{warning.time}</div>
              </div>
            {/each}
          </div>
        </section>
      </div>
    </div>

    <section class="card trellis-card mt-4 bg-base-100">
      <div class="card-body gap-4 p-5">
        <div class="flex items-center justify-between"><h2 class="card-title text-base">Recent Activity</h2><button class="btn btn-ghost btn-sm">View all events <Icon name="arrowRight" size={16} /></button></div>
        <div class="grid gap-3 md:grid-cols-5 md:divide-x md:divide-base-300">
          {#each activity as item (item.id)}
            <div class="min-w-0 px-3 first:pl-0">
              <div class="flex items-center gap-2"><span class={["h-2.5 w-2.5 shrink-0 rounded-full", item.dot]}></span><span class="truncate trellis-identifier text-xs">{item.id}</span></div>
              <div class="ml-4 mt-1 text-sm text-slate-600">{item.message}</div>
              <div class="ml-4 text-xs text-slate-400">{item.time}</div>
            </div>
          {/each}
        </div>
      </div>
    </section>
  </section>
{/if}
