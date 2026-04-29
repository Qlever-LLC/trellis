<script lang="ts">
  import { onMount } from "svelte";
  import EmptyState from "../../../../lib/components/EmptyState.svelte";
  import InlineMetricsStrip from "../../../../lib/components/InlineMetricsStrip.svelte";
  import LoadingState from "../../../../lib/components/LoadingState.svelte";
  import PageToolbar from "../../../../lib/components/PageToolbar.svelte";
  import Panel from "../../../../lib/components/Panel.svelte";
  import StatusBadge from "../../../../lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { loadJobsPageData } from "../../../../lib/jobs_page.ts";
  import type {
    JobsListOutput,
    JobsListServicesOutput,
  } from "@qlever-llc/trellis/sdk/jobs";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();
  type Job = JobsListOutput["jobs"][number];
  type ServiceInfo = JobsListServicesOutput["services"][number];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let unavailableMessage = $state<string | null>(null);
  let services = $state<ServiceInfo[]>([]);
  let jobs = $state<Job[]>([]);
  let selectedService = $state("");

  const totalJobs = $derived(jobs.length);
  const activeJobs = $derived(jobs.filter((job) => job.state === "active").length);
  const waitingJobs = $derived(jobs.filter((job) => job.state === "pending" || job.state === "retry").length);
  const failedJobs = $derived(jobs.filter((job) => job.state === "failed" || job.state === "dead").length);
  const metrics = $derived([
    { label: "Jobs", value: totalJobs, detail: selectedService || "All services" },
    { label: "Active", value: activeJobs, detail: "Currently executing" },
    { label: "Waiting", value: waitingJobs, detail: "Pending or retry" },
    { label: "Failed", value: failedJobs, detail: "Failed or dead" },
  ]);

  function stateStatus(state: Job["state"]): "healthy" | "degraded" | "unhealthy" | "offline" {
    switch (state) {
      case "completed":
        return "healthy";
      case "failed":
      case "dead":
        return "unhealthy";
      case "active":
        return "healthy";
      case "retry":
      case "pending":
        return "degraded";
      default:
        return "offline";
    }
  }

  async function load() {
    loading = true;
    error = null;
    unavailableMessage = null;

    try {
      const data = await loadJobsPageData({
        listServices: () => trellis.request("Jobs.ListServices", {}),
        listJobs: (filter) => trellis.request("Jobs.List", filter),
      }, { service: selectedService || undefined });

      unavailableMessage = data.available ? null : data.message ?? "Jobs admin runtime is unavailable.";
      services = data.services;
      jobs = data.jobs;
    } catch (e) {
      error = errorMessage(e);
      unavailableMessage = null;
      jobs = [];
      services = [];
    } finally {
      loading = false;
    }
  }

  function handleServiceChange() {
    void load();
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Jobs" description="Service-private execution work filtered by service.">
    {#snippet actions()}
      <select
        class="select select-bordered select-sm w-52"
        bind:value={selectedService}
        onchange={handleServiceChange}
        disabled={loading || !!unavailableMessage}
      >
        <option value="">All services</option>
        {#each services as service (service.name)}
          <option value={service.name}>{service.name}</option>
        {/each}
      </select>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading || !!unavailableMessage}>Refresh</button>
    {/snippet}
  </PageToolbar>

  <InlineMetricsStrip {metrics} />

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {:else if unavailableMessage}
    <div class="space-y-2">
      <div class="alert alert-info"><span>{unavailableMessage}</span></div>
      <p class="text-xs text-base-content/60">The console can still be used normally without jobs installed.</p>
    </div>
  {/if}

  {#if loading}
    <LoadingState label="Loading jobs" />
  {:else if unavailableMessage}
    <!-- informational state shown above -->
  {:else if jobs.length === 0}
    <Panel title="Jobs" eyebrow="Primary">
      <EmptyState title="No jobs found" description="No jobs match the current service filter." />
    </Panel>
  {:else}
    <Panel title="Jobs" eyebrow="Primary">
      <div class="overflow-x-auto">
        <table class="table table-sm trellis-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Type</th>
              <th>State</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {#each jobs as job (`${job.service}:${job.type}:${job.id}`)}
              <tr>
                <td class="trellis-identifier">{job.service}</td>
                <td class="trellis-identifier text-base-content/60">{job.type}</td>
                <td>
                  <StatusBadge label={job.state} status={stateStatus(job.state)} />
                </td>
                <td class="text-base-content/60">{formatDate(job.updatedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#snippet footer()}
        {jobs.length} job{jobs.length !== 1 ? "s" : ""}
      {/snippet}
    </Panel>
  {/if}
</section>
