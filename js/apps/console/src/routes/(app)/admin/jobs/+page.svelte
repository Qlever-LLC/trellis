<script lang="ts">
  import { onMount } from "svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { loadJobsPageData } from "../../../../lib/jobs_page.ts";
  import type { AsyncResult, BaseError } from "@qlever-llc/result";
  import type {
    JobsListInput,
    JobsListOutput,
    JobsListServicesOutput,
  } from "@qlever-llc/trellis/sdk/jobs";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();
  type JobsRequester = {
    request(method: "Jobs.ListServices", input: Record<string, never>): AsyncResult<JobsListServicesOutput, BaseError>;
    request(method: "Jobs.List", input: JobsListInput): AsyncResult<JobsListOutput, BaseError>;
  };
  const jobsSource: object = trellis;
  const jobsRequester = jobsSource as JobsRequester;

  type Job = JobsListOutput["jobs"][number];
  type ServiceInfo = JobsListServicesOutput["services"][number];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let unavailableMessage = $state<string | null>(null);
  let services = $state<ServiceInfo[]>([]);
  let jobs = $state<Job[]>([]);
  let selectedService = $state("");

  const totalJobs = $derived(jobs.length);

  function stateBadgeClass(state: Job["state"]): string {
    switch (state) {
      case "completed":
        return "badge-success";
      case "failed":
      case "dead":
        return "badge-error";
      case "active":
        return "badge-info";
      case "retry":
      case "pending":
        return "badge-warning";
      default:
        return "badge-ghost";
    }
  }

  async function load() {
    loading = true;
    error = null;
    unavailableMessage = null;

    try {
      const data = await loadJobsPageData({
        listServices: () => jobsRequester.request("Jobs.ListServices", {}),
        listJobs: (filter) => jobsRequester.request("Jobs.List", filter),
      }, { service: selectedService || undefined });

      unavailableMessage = data.available ? null : data.message ?? "Jobs service is unavailable.";
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
  <div class="flex items-center justify-between gap-4">
    <div class="stats shadow border border-base-300">
      <div class="stat py-2 px-4">
        <div class="stat-title text-xs">Jobs</div>
        <div class="stat-value text-xl">{totalJobs}</div>
      </div>
    </div>

    <div class="flex items-center gap-2">
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
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {:else if unavailableMessage}
    <div class="space-y-2">
      <div class="alert alert-info"><span>{unavailableMessage}</span></div>
      <p class="text-xs text-base-content/60">The console can still be used normally without jobs installed.</p>
    </div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
  {:else if unavailableMessage}
    <!-- informational state shown above -->
  {:else if jobs.length === 0}
    <p class="text-sm text-base-content/60">No jobs found.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="table table-sm">
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
              <td class="font-medium">{job.service}</td>
              <td class="text-base-content/60">{job.type}</td>
              <td>
                <span class={`badge badge-sm ${stateBadgeClass(job.state)}`}>{job.state}</span>
              </td>
              <td class="text-base-content/60">{formatDate(job.updatedAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-base-content/50">{jobs.length} job{jobs.length !== 1 ? "s" : ""}</p>
  {/if}
</section>
