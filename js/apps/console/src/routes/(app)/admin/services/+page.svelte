<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import { ok } from "@qlever-llc/result";
  import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
  import type {
    AuthListServiceInstancesOutput,
    AuthListServiceDeploymentsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import type {
    JobsListOutput,
  } from "@qlever-llc/trellis/sdk/jobs";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import {
    appendHealthEvent,
    pruneExpiredHealthInstances,
    summarizeHealthServices,
    upsertHealthInstance,
    type HealthFeedEvent,
    type HealthInstanceView,
  } from "../../../../lib/health_events.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { loadJobsPageData } from "../../../../lib/jobs_page.ts";
  import { getTrellis } from "../../../../lib/trellis";

  type Deployment = AuthListServiceDeploymentsOutput["deployments"][number];
  type ServiceInstance = AuthListServiceInstancesOutput["instances"][number];
  type Job = JobsListOutput["jobs"][number];
  type Tab = "instances" | "jobs" | "contracts" | "events";

  const trellis = getTrellis();
  const STALE_REFRESH_MS = 5_000;

  let loading = $state(true);
  let error = $state<string | null>(null);
  let jobsUnavailableMessage = $state<string | null>(null);
  let subscriptionError = $state<string | null>(null);

  let deployments = $state.raw<Deployment[]>([]);
  let instances = $state.raw<ServiceInstance[]>([]);
  let jobs = $state.raw<Job[]>([]);
  let recentEvents = $state.raw<HealthFeedEvent[]>([]);
  let healthInstances = $state.raw<Record<string, HealthInstanceView>>({});
  let now = $state(Date.now());

  let selectedDeploymentId = $state("");
  let activeTab = $state<Tab>("instances");
  let search = $state("");

  const selectedDeployment = $derived(deployments.find((deployment) => deployment.deploymentId === selectedDeploymentId) ?? null);
  const selectedInstances = $derived(instances.filter((instance) => instance.deploymentId === selectedDeploymentId));
  const activeInstances = $derived(selectedInstances.filter((instance) => !instance.disabled));
  const selectedInstanceIds = $derived(new Set(selectedInstances.map((instance) => instance.instanceId)));
  const healthServices = $derived(summarizeHealthServices(healthInstances, now));
  const selectedHealthService = $derived.by(() => {
    const byServiceName = healthServices.find((service) => service.serviceName === selectedDeploymentId);
    if (byServiceName) return byServiceName;
    return healthServices.find((service) => service.instances.some((instance) => selectedInstanceIds.has(instance.instanceId))) ?? null;
  });
  const selectedEvents = $derived(
    recentEvents.filter((event) => event.heartbeat.service.name === selectedDeploymentId || selectedInstanceIds.has(event.heartbeat.service.instanceId)),
  );
  const selectedJobs = $derived(jobs.filter((job) => job.service === selectedDeploymentId));
  const filteredDeployments = $derived.by(() => {
    const term = search.trim().toLowerCase();
    if (!term) return deployments;
    return deployments.filter((deployment) =>
      deployment.deploymentId.toLowerCase().includes(term) || deployment.namespaces.some((namespace) => namespace.toLowerCase().includes(term))
    );
  });
  const disabledCount = $derived(deployments.filter((deployment) => deployment.disabled).length);
  const selectedStatus = $derived.by(() => {
    if (selectedDeployment?.disabled) return { label: "Disabled", status: "offline" as const };
    if (selectedHealthService) return { label: selectedHealthService.status, status: selectedHealthService.status };
    if (activeInstances.length > 0) return { label: "Active", status: "healthy" as const };
    return { label: "No instances", status: "offline" as const };
  });

  function syncSelectedDeployment(nextDeployments: Deployment[]) {
    if (nextDeployments.some((deployment) => deployment.deploymentId === selectedDeploymentId)) return;
    selectedDeploymentId = nextDeployments[0]?.deploymentId ?? "";
  }

  function formatRuntime(runtime?: string, runtimeVersion?: string): string {
    if (!runtime) return "Not instrumented";
    return runtimeVersion ? `${runtime} ${runtimeVersion}` : runtime;
  }

  function formatMaybeDate(value?: string): string {
    return value ? formatDate(value) : "—";
  }

  function formatSeenAt(value?: number): string {
    return value ? formatDate(new Date(value).toISOString()) : "No heartbeat yet";
  }

  function statusForJob(state: Job["state"]): "healthy" | "degraded" | "unhealthy" | "offline" {
    if (state === "completed" || state === "active") return "healthy";
    if (state === "pending" || state === "retry") return "degraded";
    if (state === "failed" || state === "dead") return "unhealthy";
    return "offline";
  }

  function statusLabel(status: string): string {
    if (status === "healthy") return "Healthy";
    if (status === "degraded") return "Degraded";
    if (status === "unhealthy") return "Unhealthy";
    if (status === "offline") return "Offline";
    return status;
  }

  function badgeClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy" || status === "Active") return "badge-success";
    if (status === "Degraded" || status === "degraded") return "badge-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "badge-error";
    return "badge-neutral";
  }

  function dotClassForStatus(status: string): string {
    if (status === "Healthy" || status === "healthy" || status === "Active") return "bg-success";
    if (status === "Degraded" || status === "degraded") return "bg-warning";
    if (status === "Unhealthy" || status === "unhealthy") return "bg-error";
    return "bg-base-content/30";
  }

  function selectDeployment(nextDeploymentId: string) {
    selectedDeploymentId = nextDeploymentId;
  }

  async function load() {
    loading = true;
    error = null;
    jobsUnavailableMessage = null;
    try {
      const [deploymentsRes, instancesRes, jobsData] = await Promise.all([
        trellis.request("Auth.ListServiceDeployments", {}).take(),
        trellis.request("Auth.ListServiceInstances", {}).take(),
        loadJobsPageData({
          listServices: () => trellis.request("Jobs.ListServices", {}),
          listJobs: (filter) => trellis.request("Jobs.List", filter),
        }),
      ]);
      if (isErr(deploymentsRes)) { error = errorMessage(deploymentsRes); return; }
      if (isErr(instancesRes)) { error = errorMessage(instancesRes); return; }
      if (isErr(jobsData)) { error = errorMessage(jobsData); return; }
      deployments = deploymentsRes.deployments ?? [];
      instances = instancesRes.instances ?? [];
      jobs = jobsData.jobs;
      jobsUnavailableMessage = jobsData.available ? null : jobsData.message ?? "Jobs admin runtime is unavailable.";
      syncSelectedDeployment(deployments);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function ingestHeartbeat(heartbeat: HealthHeartbeat) {
    const receivedAt = Date.now();
    healthInstances = upsertHealthInstance(pruneExpiredHealthInstances(healthInstances, receivedAt), heartbeat, receivedAt);
    recentEvents = appendHealthEvent(recentEvents, heartbeat, receivedAt);
    now = receivedAt;
  }

  function handleHeartbeat(heartbeat: HealthHeartbeat) {
    ingestHeartbeat(heartbeat);
    return ok(undefined);
  }

  onMount(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      healthInstances = pruneExpiredHealthInstances(healthInstances, currentTime);
      now = currentTime;
    }, STALE_REFRESH_MS);

    void load();
    void (async () => {
      try {
        const result = await trellis.event("Health.Heartbeat", {}, handleHeartbeat, {
          mode: "ephemeral",
          replay: "new",
          signal: controller.signal,
        });
        if (result.isErr()) subscriptionError = errorMessage(result.error);
      } catch (e) {
        subscriptionError = errorMessage(e);
      }
    })();

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Service deployments" description="Inspect service deployments, instances, contracts, jobs, and events.">
    {#snippet actions()}
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}
  {#if subscriptionError}
    <div class="alert alert-warning"><span>Heartbeat subscription unavailable: {subscriptionError}</span></div>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading services" /></Panel>
  {:else}
    <div class="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Panel title="Deployments" eyebrow={`${deployments.length} deployment${deployments.length === 1 ? "" : "s"}`} class="min-w-0">
        <div class="mb-3">
          <label class="input input-bordered input-sm flex items-center gap-2">
            <Icon name="search" size={14} class="text-base-content/50" />
            <input bind:value={search} class="grow" placeholder="Search deployments or namespaces" />
          </label>
        </div>

        {#if deployments.length === 0}
          <EmptyState title="No deployments" description="Run services create to add a deployment." />
        {:else}
          <div class="space-y-2">
            {#each filteredDeployments as deployment (deployment.deploymentId)}
              {@const serviceInstances = instances.filter((instance) => instance.deploymentId === deployment.deploymentId)}
              {@const activeServiceInstances = serviceInstances.filter((instance) => !instance.disabled)}
              {@const healthService = healthServices.find((service) => service.serviceName === deployment.deploymentId || service.instances.some((instance) => serviceInstances.some((serviceInstance) => serviceInstance.instanceId === instance.instanceId)))}
              {@const rowStatus = deployment.disabled ? "Disabled" : (healthService ? statusLabel(healthService.status) : (activeServiceInstances.length > 0 ? "Active" : "No instances"))}
              <button
                type="button"
                class={[
                  "w-full rounded-box border p-3 text-left transition-colors",
                  selectedDeploymentId === deployment.deploymentId ? "border-primary bg-primary/5" : "border-base-300 bg-base-100 hover:border-base-content/20",
                ]}
                onclick={() => selectDeployment(deployment.deploymentId)}
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class={["h-2.5 w-2.5 rounded-full", dotClassForStatus(rowStatus)]}></span>
                      <span class="trellis-identifier truncate font-medium">{deployment.deploymentId}</span>
                    </div>
                    <div class="mt-1 text-xs text-base-content/60">{activeServiceInstances.length}/{serviceInstances.length} active instances</div>
                  </div>
                  <span class={["badge badge-sm", badgeClassForStatus(rowStatus)]}>{rowStatus}</span>
                </div>
              </button>
            {:else}
              <EmptyState title="No matches" description="Try a different deployment name or namespace." class="py-4" />
            {/each}
          </div>
        {/if}

        {#snippet footer()}
          <span>{disabledCount} disabled / archived</span>
        {/snippet}
      </Panel>

      <div class="min-w-0 space-y-4">
        {#if !selectedDeployment}
          <Panel><EmptyState title="Select a deployment" description="Choose a deployment from the left rail to inspect runtime state." /></Panel>
        {:else}
          <Panel title="Deployment summary" eyebrow="Runtime drill-in" class="min-w-0">
            {#snippet actions()}
              <details class="dropdown dropdown-end">
                <summary class="btn btn-outline btn-sm">Actions <Icon name="chevronDown" size={14} /></summary>
                <ul class="menu dropdown-content z-10 mt-2 w-72 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
                  <li><a href={resolve("/admin/services/new")}>Create service deployment</a></li>
                  <li><a href={resolve("/admin/services/instances")}>Manage service instances</a></li>
                  <li><a href={resolve(`/admin/services/contracts?deployment=${encodeURIComponent(selectedDeployment.deploymentId)}`)}>Manage service contracts</a></li>
                  <li><a href={resolve("/admin/jobs")}>View deployment jobs</a></li>
                  <li><a href={resolve("/admin/health-events")}>View heartbeat stream</a></li>
                </ul>
              </details>
            {/snippet}

            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="flex min-w-0 items-start gap-3">
                <div class="rounded-box bg-primary/10 p-3 text-primary"><Icon name="server" size={24} /></div>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="trellis-identifier truncate text-xl font-semibold">{selectedDeployment.deploymentId}</h2>
                    <StatusBadge label={selectedStatus.label} status={selectedStatus.status} />
                  </div>
                  <div class="trellis-identifier mt-1 text-base-content/60">Deployment ID: {selectedDeployment.deploymentId}</div>
                  <div class="mt-2 flex flex-wrap gap-1">
                    {#each selectedDeployment.namespaces as namespace (namespace)}
                      <span class="badge badge-outline badge-xs">{namespace}</span>
                    {:else}
                      <span class="text-xs text-base-content/60">No namespaces</span>
                    {/each}
                  </div>
                </div>
              </div>
            </div>

            <dl class="mt-5 divide-y divide-base-300 rounded-box border border-base-300 text-sm">
              <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Last heartbeat</dt><dd class="font-medium">{formatSeenAt(selectedHealthService?.lastSeenAt)}</dd></div>
              <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Version / runtime</dt><dd><div class="font-medium">{selectedHealthService?.version ?? "Not instrumented"}</div><div class="text-xs text-base-content/60">{formatRuntime(selectedHealthService?.runtime, selectedHealthService?.instances[0]?.runtimeVersion)}</div></dd></div>
              <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Instances</dt><dd class="font-medium">{activeInstances.length}/{selectedInstances.length} active / total</dd></div>
              <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Contracts</dt><dd class="font-medium">{selectedDeployment.appliedContracts.length}</dd></div>
              <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Jobs</dt><dd class="font-medium">{jobsUnavailableMessage ? "Unavailable" : selectedJobs.length}</dd></div>
              <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Capabilities</dt><dd class="font-medium">{new Set(selectedInstances.flatMap((instance) => instance.capabilities)).size}</dd></div>
              <div class="grid grid-cols-[11rem_minmax(0,1fr)] gap-4 px-4 py-3"><dt class="text-base-content/60">Telemetry</dt><dd class="font-medium">{selectedHealthService ? "Heartbeat instrumented" : "No heartbeat yet / Not instrumented"}</dd></div>
            </dl>
          </Panel>

          <Panel title="Details" eyebrow="Deployment operations" class="min-w-0">
            <div class="tabs tabs-bordered mb-4">
              {#each ["instances", "jobs", "contracts", "events"] as tab (tab)}
                <button class={["tab capitalize", activeTab === tab && "tab-active"]} onclick={() => (activeTab = tab as Tab)}>{tab}</button>
              {/each}
            </div>

            {#if activeTab === "instances"}
              {#if selectedInstances.length === 0}
                <EmptyState title="No instances" description="Run services instances to provision a service instance." />
              {:else}
                <div class="overflow-x-auto">
                  <table class="table table-sm trellis-table">
                    <thead><tr><th>Instance ID</th><th>Status</th><th>Contract</th><th>Resources</th><th>Capabilities</th><th>Created</th></tr></thead>
                    <tbody>
                      {#each selectedInstances as instance (instance.instanceId)}
                        <tr>
                          <td><div class="trellis-identifier font-medium">{instance.instanceId}</div><div class="trellis-identifier text-base-content/60">{instance.instanceKey}</div></td>
                          <td>{#if instance.disabled}<StatusBadge label="Disabled" status="offline" />{:else}<StatusBadge label="Active" status="healthy" />{/if}</td>
                          <td><div class="trellis-identifier">{instance.currentContractId ?? "—"}</div><div class="trellis-identifier text-base-content/60">{instance.currentContractDigest ?? "—"}</div></td>
                          <td>
                            <div class="flex max-w-64 flex-wrap gap-1">
                              {#each Object.entries(instance.resourceBindings?.kv ?? {}) as [alias, binding] (alias)}
                                <span class="badge badge-outline badge-xs">kv:{alias} <span class="trellis-identifier ml-1 text-base-content/60">{binding.bucket}</span></span>
                              {/each}
                              {#each Object.entries(instance.resourceBindings?.store ?? {}) as [alias, binding] (alias)}
                                <span class="badge badge-outline badge-xs">store:{alias} <span class="trellis-identifier ml-1 text-base-content/60">{binding.name}</span></span>
                              {/each}
                              {#if !instance.resourceBindings?.kv && !instance.resourceBindings?.store}
                                <span class="text-base-content/60">—</span>
                              {/if}
                            </div>
                          </td>
                          <td><div class="flex flex-wrap gap-1">{#each instance.capabilities as capability (capability)}<span class="badge badge-outline badge-xs">{capability}</span>{:else}<span class="text-base-content/60">—</span>{/each}</div></td>
                          <td class="text-base-content/60">{formatMaybeDate(instance.createdAt)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {:else if activeTab === "jobs"}
              {#if jobsUnavailableMessage}
                <div class="alert alert-info"><span>{jobsUnavailableMessage}</span></div>
              {:else if selectedJobs.length === 0}
                <EmptyState title="No jobs" description="No jobs are currently associated with this deployment." />
              {:else}
                <div class="overflow-x-auto">
                  <table class="table table-sm trellis-table">
                    <thead><tr><th>Service</th><th>Type</th><th>State</th><th>Updated</th></tr></thead>
                    <tbody>
                      {#each selectedJobs as job (`${job.service}:${job.type}:${job.id}`)}
                        <tr><td class="trellis-identifier">{job.service}</td><td class="trellis-identifier text-base-content/60">{job.type}</td><td><StatusBadge label={job.state} status={statusForJob(job.state)} /></td><td class="text-base-content/60">{formatDate(job.updatedAt)}</td></tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {:else if activeTab === "contracts"}
              {#if selectedDeployment.appliedContracts.length === 0}
                <EmptyState title="No contracts" description="Run services contracts to manage deployment contracts." />
              {:else}
                <div class="space-y-3">
                  {#each selectedDeployment.appliedContracts as applied (applied.contractId)}
                    <div class="rounded-box border border-base-300 bg-base-100 p-3">
                      <div class="flex flex-wrap items-start justify-between gap-2"><div><div class="trellis-identifier font-medium">{applied.contractId}</div><div class="text-xs text-base-content/60">{applied.allowedDigests.length} digest(s)</div></div><a class="btn btn-ghost btn-xs" href={resolve(`/admin/services/contracts?deployment=${encodeURIComponent(selectedDeployment.deploymentId)}`)}>Manage</a></div>
                      <div class="mt-3 flex flex-wrap gap-2">{#each applied.allowedDigests as digest (digest)}<span class="trellis-identifier rounded-full border border-base-300 px-2 py-1 text-xs">{digest}</span>{:else}<span class="text-xs text-base-content/60">Lineage allowed</span>{/each}</div>
                    </div>
                  {/each}
                </div>
              {/if}
            {:else if selectedEvents.length === 0}
              <EmptyState title="No heartbeat events" description="No live heartbeat events have been received for this deployment yet." />
            {:else}
              <div class="space-y-3">
                {#each selectedEvents as event (event.id)}
                  <div class="rounded-box border border-base-300 bg-base-200/40 p-3"><div class="mb-2 flex items-start justify-between gap-2"><div><div class="font-medium text-sm">{event.heartbeat.service.name}</div><div class="trellis-identifier text-base-content/50">{event.heartbeat.service.instanceId}</div></div><StatusBadge label={event.heartbeat.status} status={event.heartbeat.status} /></div><div class="text-xs text-base-content/60">published {formatDate(event.heartbeat.header.time)} · received {formatSeenAt(event.receivedAt)}</div><pre class="mt-2 overflow-x-auto rounded bg-base-100 p-2 text-[11px] leading-5 text-base-content/80">{JSON.stringify(event.heartbeat, null, 2)}</pre></div>
                {/each}
              </div>
            {/if}
          </Panel>
        {/if}
      </div>
    </div>
  {/if}
</section>
