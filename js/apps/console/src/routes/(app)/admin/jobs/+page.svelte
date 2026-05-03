<script lang="ts">
  import { resolve } from "$app/paths";
  import { onDestroy, onMount } from "svelte";
  import EmptyState from "../../../../lib/components/EmptyState.svelte";
  import LoadingState from "../../../../lib/components/LoadingState.svelte";
  import PageToolbar from "../../../../lib/components/PageToolbar.svelte";
  import Panel from "../../../../lib/components/Panel.svelte";
  import StatusBadge from "../../../../lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { loadJobsPageData } from "../../../../lib/jobs_page.ts";
  import type {
    JobsListInput,
    JobsListOutput,
    JobsListServicesOutput,
  } from "@qlever-llc/trellis/sdk/jobs";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();
  const pageLimit = 50;

  type Job = JobsListOutput["jobs"][number];
  type JobState = Job["state"];
  type ServiceInfo = JobsListServicesOutput["services"][number];
  type JobPathname = `/admin/jobs/${string}` & {};

  const stateOptions: Array<{ value: "" | JobState; label: string }> = [
    { value: "", label: "All states" },
    { value: "pending", label: "Pending" },
    { value: "active", label: "Active" },
    { value: "retry", label: "Retry" },
    { value: "completed", label: "Completed" },
    { value: "failed", label: "Failed" },
    { value: "cancelled", label: "Cancelled" },
    { value: "expired", label: "Expired" },
    { value: "dead", label: "Dead" },
    { value: "dismissed", label: "Dismissed" },
  ];

  let loading = $state(true);
  let refreshing = $state(false);
  let error = $state<string | null>(null);
  let unavailableMessage = $state<string | null>(null);
  let services = $state.raw<ServiceInfo[]>([]);
  let jobs = $state.raw<Job[]>([]);
  let selectedService = $state("");
  let selectedState = $state<"" | JobState>("");
  let typeFilter = $state("");
  let cursor = $state<string | undefined>(undefined);
  let cursorStack = $state.raw<Array<string | undefined>>([]);
  let hasMore = $state(false);
  let nextCursor = $state<string | undefined>(undefined);
  let autoRefresh = $state(false);
  let lastUpdated = $state<Date | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | undefined;
  let loadSequence = 0;

  const pageNumber = $derived(cursorStack.length + 1);
  const pageTypeFilter = $derived(typeFilter.trim());
  const filterSummary = $derived.by(() => {
    const parts = [
      selectedService || "all services",
      selectedState || "all states",
      pageTypeFilter ? `type ${pageTypeFilter}` : "all types",
    ];
    return parts.join(" · ");
  });

  function stateStatus(state: JobState): "healthy" | "degraded" | "unhealthy" | "offline" {
    switch (state) {
      case "completed":
        return "healthy";
      case "failed":
      case "dead":
      case "expired":
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

  function ageLabel(value: string | undefined): string {
    if (!value) return "-";
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return "-";
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  function durationLabel(start: string | undefined, end: string | undefined): string {
    if (!start) return "-";
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) return "-";
    const seconds = Math.floor((endTime - startTime) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  function relativeDeadline(value: string | undefined): string {
    if (!value) return "-";
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return "-";
    const seconds = Math.floor((time - Date.now()) / 1000);
    const absolute = Math.abs(seconds);
    const valueLabel = absolute < 60 ? `${absolute}s` : absolute < 3600 ? `${Math.floor(absolute / 60)}m` : absolute < 172800 ? `${Math.floor(absolute / 3600)}h` : `${Math.floor(absolute / 86400)}d`;
    return seconds >= 0 ? `in ${valueLabel}` : `${valueLabel} overdue`;
  }

  function deadlineLabel(job: Job): string {
    if (!job.deadline) return "-";
    return relativeDeadline(job.deadline);
  }

  function jobRoute(id: string): JobPathname {
    return `/admin/jobs/${encodeURIComponent(id)}` as JobPathname;
  }

  function buildFilter(): JobsListInput {
    return {
      limit: pageLimit,
      cursor,
      service: selectedService || undefined,
      state: selectedState || undefined,
      type: pageTypeFilter || undefined,
    };
  }

  async function load(showLoading = true) {
    const sequence = ++loadSequence;
    const filter = buildFilter();
    if (showLoading) {
      loading = true;
    } else {
      refreshing = true;
    }
    error = null;
    unavailableMessage = null;

    try {
      const data = await loadJobsPageData({
        listServices: () => trellis.request("Jobs.ListServices", {}),
        listJobs: (filter) => trellis.request("Jobs.List", filter),
      }, filter);

      if (sequence !== loadSequence) return;

      unavailableMessage = data.available ? null : data.message ?? "Jobs admin runtime is unavailable.";
      services = data.services;
      jobs = data.jobs;
      hasMore = data.hasMore;
      nextCursor = data.nextCursor;
      lastUpdated = new Date();
    } catch (e) {
      if (sequence !== loadSequence) return;
      error = errorMessage(e);
      unavailableMessage = null;
      jobs = [];
      services = [];
      hasMore = false;
      nextCursor = undefined;
    } finally {
      if (sequence === loadSequence) {
        loading = false;
        refreshing = false;
      }
    }
  }

  function resetPagination() {
    cursor = undefined;
    cursorStack = [];
  }

  function applyFilters() {
    resetPagination();
    void load();
  }

  function goNext() {
    if (!hasMore || !nextCursor) return;
    cursorStack = [...cursorStack, cursor];
    cursor = nextCursor;
    void load();
  }

  function goPrevious() {
    if (cursorStack.length === 0) return;
    const previous = cursorStack[cursorStack.length - 1];
    cursorStack = cursorStack.slice(0, -1);
    cursor = previous;
    void load();
  }

  function refreshNow() {
    void load(false);
  }

  function clearAutoRefresh() {
    if (!refreshInterval) return;
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }

  function handleAutoRefreshChange(event: Event) {
    const checked = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.checked : false;
    autoRefresh = checked;
    clearAutoRefresh();
    if (!checked) return;
    refreshInterval = setInterval(() => {
      void load(false);
    }, 10000);
  }

  onMount(() => {
    void load();
  });

  onDestroy(() => {
    clearAutoRefresh();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Jobs" description="Service-private work ordered for operator triage.">
    {#snippet meta()}
      <span class="badge badge-ghost badge-sm">Page {pageNumber}</span>
      {#if lastUpdated}
        <span class="text-xs text-base-content/50">Updated {lastUpdated.toLocaleTimeString()}</span>
      {/if}
    {/snippet}
    {#snippet actions()}
      <label class="flex items-center gap-2 text-xs text-base-content/70">
        <input class="toggle toggle-xs" type="checkbox" checked={autoRefresh} onchange={handleAutoRefreshChange} />
        Auto refresh
      </label>
      <button class="btn btn-ghost btn-sm" onclick={refreshNow} disabled={loading || refreshing || !!unavailableMessage}>
        {refreshing ? "Refreshing" : "Refresh"}
      </button>
    {/snippet}
  </PageToolbar>

  <Panel title="Jobs" eyebrow="Primary">
    {#snippet actions()}
      <select
        class="select select-bordered select-sm w-44"
        bind:value={selectedService}
        onchange={applyFilters}
        disabled={loading || !!unavailableMessage}
        aria-label="Filter by service"
      >
        <option value="">All services</option>
        {#each services as service (service.name)}
          <option value={service.name}>{service.name}</option>
        {/each}
      </select>
      <select
        class="select select-bordered select-sm w-40"
        bind:value={selectedState}
        onchange={applyFilters}
        disabled={loading || !!unavailableMessage}
        aria-label="Filter by state"
      >
        {#each stateOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <form class="join" onsubmit={(event) => { event.preventDefault(); applyFilters(); }}>
        <input
          class="input input-bordered input-sm join-item w-52"
          placeholder="Type exact"
          bind:value={typeFilter}
          disabled={loading || !!unavailableMessage}
          aria-label="Filter by type"
        />
        <button class="btn btn-outline btn-sm join-item" disabled={loading || !!unavailableMessage}>Apply</button>
      </form>
    {/snippet}

    {#if error}
      <div class="alert alert-error mb-3" role="alert"><span>{error}</span></div>
    {:else if unavailableMessage}
      <div class="alert alert-info mb-3" role="status"><span>{unavailableMessage}</span></div>
    {/if}

    <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-base-content/60">
      <span>{filterSummary}</span>
      <span>{jobs.length} shown, limit {pageLimit}</span>
    </div>

    {#if loading}
      <LoadingState label="Loading jobs" />
    {:else if unavailableMessage}
      <p class="text-xs text-base-content/60">The console can still be used normally without jobs installed.</p>
    {:else if jobs.length === 0}
      <EmptyState title="No jobs found" description="No jobs match the current filters." />
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm trellis-table table-fixed">
          <thead>
            <tr>
              <th class="w-28">State</th>
              <th class="w-36">Updated</th>
              <th class="w-24">Age</th>
              <th class="w-28">Duration</th>
              <th class="w-28">Deadline</th>
              <th>Service / type / id</th>
              <th class="w-20">Tries</th>
            </tr>
          </thead>
          <tbody>
            {#each jobs as job (job.id)}
              <tr class="hover">
                <td><StatusBadge label={job.state} status={stateStatus(job.state)} /></td>
                <td class="text-xs text-base-content/70">{formatDate(job.updatedAt)}</td>
                <td class="text-xs text-base-content/70">{ageLabel(job.createdAt)}</td>
                <td class="text-xs text-base-content/70">{durationLabel(job.startedAt, job.completedAt)}</td>
                <td class="text-xs text-base-content/70">{deadlineLabel(job)}</td>
                <td class="min-w-0">
                  <a
                    class="link link-hover trellis-identifier block truncate"
                    href={resolve(jobRoute(job.id))}
                  >
                    {job.service} / {job.type} / {job.id}
                  </a>
                </td>
                <td class="text-xs tabular-nums text-base-content/70">{job.tries}/{job.maxTries}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#snippet footer()}
      <div class="flex items-center justify-between gap-3">
        <span>Cursor page {pageNumber}</span>
        <div class="join">
          <button class="btn btn-outline btn-xs join-item" onclick={goPrevious} disabled={loading || cursorStack.length === 0}>Previous</button>
          <button class="btn btn-outline btn-xs join-item" onclick={goNext} disabled={loading || !hasMore || !nextCursor}>Next</button>
        </div>
      </div>
    {/snippet}
  </Panel>
</section>
