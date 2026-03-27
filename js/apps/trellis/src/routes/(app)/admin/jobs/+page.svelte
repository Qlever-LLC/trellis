<script lang="ts">
  import type { Job, ServiceInfo } from "@qlever-llc/trellis-jobs";
  import { getTrellisFor } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { trellisApp } from "../../../../contracts/trellis_app.ts";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { loadJobsPageData } from "../../../../lib/jobs_page.ts";

  const trellisPromise = getTrellisFor(trellisApp);

  let loading = $state(true);
  let error = $state<string | null>(null);
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

    try {
      const trellis = await trellisPromise;
      const data = await loadJobsPageData(trellis, {
        service: selectedService || undefined,
      });

      services = data.services;
      jobs = data.jobs;
    } catch (e) {
      error = errorMessage(e);
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
      <select class="select select-bordered select-sm w-52" bind:value={selectedService} onchange={handleServiceChange}>
        <option value="">All services</option>
        {#each services as service (service.name)}
          <option value={service.name}>{service.name}</option>
        {/each}
      </select>
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    </div>
  </div>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <div class="flex justify-center py-8"><span class="loading loading-spinner loading-md"></span></div>
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
