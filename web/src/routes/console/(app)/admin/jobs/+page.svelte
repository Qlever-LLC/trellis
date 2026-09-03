<script lang="ts">
  import { resolve } from "$lib/console_paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import type {
    JobsListServicesOutput,
    JobsMetricsInput,
    JobsMetricsOutput,
    JobsQueryInput,
    JobsQueryOutput,
  } from "@trellis/apis/trellis.jobs";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import BulkActionBar from "$lib/components/BulkActionBar.svelte";
  import BulkResult from "$lib/components/BulkResult.svelte";
  import ConfirmationModal from "$lib/components/ConfirmationModal.svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import JobsHealthMatrix from "$lib/components/JobsHealthMatrix.svelte";
  import JobsScopedCharts from "$lib/components/JobsScopedCharts.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import MetricsLedger from "$lib/components/MetricsLedger.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import Term from "$lib/components/Term.svelte";
  import { compactDuration, errorMessage } from "$lib/format";
  import { loadJobsMetrics } from "$lib/jobs_metrics.ts";
  import { cancelJob, loadJobsPageData } from "$lib/jobs_page.ts";
  import { bulkExpectedCount, bulkTargetDetails, runBulk, toggleAll, toggleId } from "$lib/bulk.ts";
  import { getTrellis } from "$lib/trellis";

  type Job = JobsQueryOutput["entries"][number];
  type JobState = Job["state"];
  type ServiceInfo = JobsListServicesOutput["entries"][number];
  type MetricsWindow = JobsMetricsInput["window"];
  type Focus = "running-risk" | "running" | "action" | "completed" | "failed" | "dead" | "backlog";
  type JobPathname = `/admin/jobs/${string}` & {};

  const trellis = getTrellis();
  const rpcTimeout = 10_000;
  const windows: Array<{ value: MetricsWindow; label: string; title: string }> = [
    { value: "15m", label: "15m", title: "Last 15 minutes" },
    { value: "1h", label: "1h", title: "Last hour" },
    { value: "6h", label: "6h", title: "Last 6 hours" },
    { value: "24h", label: "24h", title: "Last 24 hours" },
    { value: "7d", label: "7d", title: "Last 7 days" },
  ];

  let loading = $state(true);
  let metricsLoading = $state(true);
  let refreshing = $state(false);
  let error = $state<string | null>(null);
  let metricsError = $state<string | null>(null);
  let unavailableMessage = $state<string | null>(null);
  let services = $state.raw<ServiceInfo[]>([]);
  let jobs = $state.raw<Job[]>([]);
  let jobCount = $state(0);
  let metrics = $state.raw<JobsMetricsOutput | null>(null);
  let metricsWindow = $state<MetricsWindow>("1h");
  let selectedJobType = $state<string | null>(null);
  let focus = $state<Focus>(asFocus(page.url.searchParams.get("focus")) ?? "running-risk");
  let handledFocusParam = page.url.searchParams.get("focus");

  $effect(() => {
    const value = page.url.searchParams.get("focus");
    if (value === handledFocusParam) return;
    handledFocusParam = value;
    const next = asFocus(value);
    if (next && next !== focus) {
      focus = next;
      void loadJobs(false);
    }
  });
  let lastUpdated = $state<Date | null>(null);
  let jobsSequence = 0;
  let metricsSequence = 0;
  let selectedJobs = $state(new Set<string>());
  let bulkBusy = $state(false);
  let bulkResult = $state<{ succeeded: number; failed: string[] } | null>(null);
  let failedJobs = $state.raw<Job[]>([]);
  let confirmationModal: ConfirmationModal | undefined = $state();

  const workerCount = $derived(services.reduce((sum, service) => sum + service.workers.length, 0));
  const windowLabel = $derived(windows.find((option) => option.value === metricsWindow)?.title ?? metricsWindow);
  const focusedJobs = $derived.by(() =>
    focus === "running-risk"
      ? [...jobs].sort((left, right) => riskPriority(left) - riskPriority(right) || (right.runtimeMs ?? 0) - (left.runtimeMs ?? 0))
      : jobs,
  );
  const cancellableJobs = $derived(focusedJobs.filter((job) => job.state === "active" || job.state === "pending" || job.state === "retry"));
  const selectableJobIds = $derived(cancellableJobs.map((job) => job.id));
  const overview = $derived.by(() => {
    const byState: Record<string, number> = {};
    let backlog = 0;
    let running = 0;
    let slow = 0;
    for (const group of metrics?.summary ?? []) {
      backlog += group.queued ?? 0;
      running += group.running ?? 0;
      slow += group.slow ?? 0;
      for (const [state, count] of Object.entries(group.byState)) {
        if (typeof count === "number") byState[state] = (byState[state] ?? 0) + count;
      }
    }
    const processed = metrics?.buckets.reduce(
      (total, bucket) => total + bucket.groups.reduce((sum, group) => sum + group.completed, 0),
      0,
    ) ?? 0;
    const failed = byState.failed ?? 0;
    const dead = byState.dead ?? 0;
    const retrying = byState.retry ?? 0;
    const stale = byState.stale ?? 0;
    return {
      action: failed + dead + retrying + stale,
      backlog,
      dead,
      failed,
      failureRate: processed > 0 ? ((failed + dead) / processed) * 100 : 0,
      processed,
      retrying,
      running,
      slow,
      stale,
    };
  });

  function asFocus(value: string | null): Focus | null {
    if (value === "running-risk" || value === "running" || value === "action" || value === "completed" || value === "failed" || value === "dead" || value === "backlog") return value;
    return null;
  }

  function resolveMetricsStep(window: MetricsWindow): JobsMetricsInput["step"] {
    if (window === "15m" || window === "1h") return "1m";
    if (window === "6h") return "5m";
    if (window === "24h") return "15m";
    return "1h";
  }

  async function cancelJobs(targets: Job[]) {
    bulkBusy = true;
    bulkResult = null;
    const outcome = await runBulk(targets, async (job) => {
      await cancelJob({ action: (input) => trellis.jobsCancel(input) }, job.id);
    });
    failedJobs = outcome.failed.map((failure) => failure.target);
    for (const job of targets) selectedJobs.delete(job.id);
    bulkResult = {
      succeeded: outcome.succeeded,
      failed: outcome.failed.map((failure) => `${failure.target.id}: ${failure.reason}`),
    };
    bulkBusy = false;
    void loadJobs();
  }

  async function requestBulkCancel() {
    const targets = cancellableJobs.filter((job) => selectedJobs.has(job.id));
    if (targets.length === 0) return;
    const confirmed = await confirmationModal?.confirm({
      title: `Cancel ${targets.length} job${targets.length === 1 ? "" : "s"}?`,
      message: "Queued and running work stops. Work already committed by a job is not rolled back.",
      confirmLabel: `Cancel ${targets.length}`,
      targetLabel: "Jobs",
      targetName: `${targets.length} jobs`,
      expectedValue: bulkExpectedCount(targets.length),
      details: bulkTargetDetails(targets.map((job) => `${job.type} ${job.id}`)),
    });
    if (!confirmed) return;
    await cancelJobs(targets);
  }

  function focusStates(value: Focus): JobState[] {
    if (value === "running-risk") return ["active", "retry"];
    if (value === "running") return ["active"];
    if (value === "action") return ["retry", "failed", "dead", "stale"];
    if (value === "completed") return ["completed"];
    if (value === "failed") return ["failed"];
    if (value === "dead") return ["dead"];
    return ["pending", "retry"];
  }

  function focusTitle(): string {
    const prefix = selectedJobType ? `${selectedJobType} · ` : "";
    if (focus === "running-risk") return `${prefix}Running and at risk`;
    if (focus === "running") return `${prefix}Running jobs`;
    if (focus === "action") return `${prefix}Jobs needing action`;
    if (focus === "completed") return `${prefix}Completed jobs`;
    if (focus === "failed") return `${prefix}Failed jobs`;
    if (focus === "dead") return `${prefix}Dead-lettered jobs`;
    return `${prefix}Backlog`;
  }

  function focusDescription(): string {
    if (focus === "running-risk") return "Waiting, slow, and retrying work first";
    if (focus === "running") return "Current active execution";
    if (focus === "action") return "Retrying, failed, dead, and stale work";
    if (focus === "completed") return "Most recently completed retained work";
    if (focus === "failed") return "Non-retryable failures available for inspection";
    if (focus === "dead") return "Exhausted deliveries awaiting replay or dismissal";
    return "Pending and retrying work, oldest first";
  }

  function buildQuery(): JobsQueryInput {
    return {
      limit: 40,
      state: focusStates(focus),
      type: selectedJobType ?? undefined,
      sort: {
        direction: "desc",
        field: focus === "backlog" ? "queueAge" : focus === "running" || focus === "running-risk" ? "runtime" : "updatedAt",
      },
    };
  }

  async function loadJobs(showLoading = true) {
    const sequence = ++jobsSequence;
    if (showLoading) loading = true;
    error = null;
    unavailableMessage = null;
    try {
      const data = await loadJobsPageData({
        listServices: (input) => trellis.jobsListServices(input, { timeout: rpcTimeout }),
        queryJobs: (input) => trellis.jobsQuery(input, { timeout: rpcTimeout }),
      }, buildQuery());
      if (sequence !== jobsSequence) return;
      unavailableMessage = data.available ? null : data.message ?? "Jobs admin runtime is unavailable.";
      services = data.services;
      jobs = data.jobs;
      jobCount = data.count;
    } catch (cause) {
      if (sequence !== jobsSequence) return;
      error = errorMessage(cause);
      jobs = [];
      jobCount = 0;
      services = [];
    } finally {
      if (sequence === jobsSequence) loading = false;
    }
  }

  async function loadMetrics() {
    const sequence = ++metricsSequence;
    metricsLoading = true;
    metricsError = null;
    try {
      const payload = await loadJobsMetrics(
        { metrics: (input) => trellis.jobsMetrics(input, { timeout: rpcTimeout }) },
        { groupBy: "type", step: resolveMetricsStep(metricsWindow), window: metricsWindow },
      );
      if (sequence !== metricsSequence) return;
      if (!payload.available) {
        metrics = null;
        metricsError = payload.message ?? "Jobs metrics are unavailable.";
        return;
      }
      metrics = payload.metrics ?? null;
      if (selectedJobType && metrics && !metrics.summary.some((group) => group.key === selectedJobType)) {
        selectedJobType = null;
        void loadJobs(false);
      }
    } catch (cause) {
      if (sequence !== metricsSequence) return;
      metrics = null;
      metricsError = errorMessage(cause);
    } finally {
      if (sequence === metricsSequence) metricsLoading = false;
    }
  }

  async function refresh(showLoading = false) {
    if (!showLoading) refreshing = true;
    await Promise.all([loadJobs(showLoading), loadMetrics()]);
    lastUpdated = new Date();
    refreshing = false;
  }

  function selectFocus(value: Focus) {
    focus = value;
    void loadJobs(false);
  }

  function selectJobType(value: string | null) {
    selectedJobType = value;
    void loadJobs(false);
  }

  function selectWindow(value: MetricsWindow) {
    metricsWindow = value;
    void loadMetrics();
  }

  function jobRoute(id: string): JobPathname {
    return `/admin/jobs/${encodeURIComponent(id)}` as JobPathname;
  }

  function jobStateLabel(job: Job): string {
    if (job.state === "active" && (job.waitingOn?.length ?? 0) > 0) return "waiting";
    if (job.state === "active" && job.runtimeBand === "slow") return "slow";
    return job.state;
  }

  function riskPriority(job: Job): number {
    if ((job.waitingOn?.length ?? 0) > 0) return 0;
    if (job.state === "retry") return 1;
    if (job.runtimeBand === "slow") return 2;
    return 3;
  }

  function jobNarrative(job: Job): string {
    const wait = job.waitingOn?.[0];
    if (wait) return wait.label ?? wait.target.label ?? `Waiting on ${wait.target.kind}`;
    return job.progress?.message ?? job.progress?.step ?? job.lastError ?? "Execution in progress";
  }

  function jobDuration(job: Job): string {
    const value = job.state === "pending" || job.state === "retry" ? job.queueAgeMs : job.runtimeMs;
    return compactDuration(value ?? 0);
  }

  function jobProgress(job: Job): number {
    const current = job.progress?.current;
    const total = job.progress?.total;
    if (current === undefined || total === undefined || total <= 0) return 0;
    return Math.min(100, Math.max(0, (current / total) * 100));
  }

  function jobStateVariant(job: Job): "healthy" | "degraded" | "unhealthy" | "offline" {
    const label = jobStateLabel(job);
    if (label === "completed") return "healthy";
    if (label === "waiting" || label === "slow" || label === "pending" || label === "retry") return "degraded";
    if (label === "failed" || label === "dead" || label === "stale") return "unhealthy";
    return "offline";
  }

  const ledgerItems = $derived([
    { id: "action", label: "Action needed", value: overview.action, detail: `${overview.failed} failed · ${overview.dead} dead · ${overview.retrying} retrying`, tone: "error" as const, active: focus === "action", attention: true },
    { id: "running", label: "Running", value: overview.running, detail: `${overview.slow} slow · ${workerCount} workers`, tone: "success" as const, active: focus === "running" || focus === "running-risk" },
    { id: "completed", label: "Processed", value: overview.processed.toLocaleString(), detail: `completed · ${windowLabel.toLowerCase()}`, tone: "success" as const, active: focus === "completed" },
    { id: "failed", label: "Failed", value: overview.failed, detail: `${overview.failureRate.toFixed(2)}% of completed`, tone: "error" as const, active: focus === "failed" },
    { id: "dead", label: "Dead", value: overview.dead, detail: "requires replay or dismissal", tone: "error" as const, active: focus === "dead" },
    { id: "backlog", label: "Backlog", value: overview.backlog, detail: "pending + retrying", tone: "warning" as const, active: focus === "backlog" },
  ]);

  function handleLedgerSelect(id: string) {
    if (id === "running") selectFocus("running");
    else if (id === "action" || id === "completed" || id === "failed" || id === "dead" || id === "backlog") selectFocus(id);
  }

  onMount(() => {
    void refresh(true);
  });
</script>

<svelte:head><title>Jobs · Trellis Console</title></svelte:head>

<section class="jobs-page">
  <PageToolbar title="Jobs" description="Execution health across services and job types.">
    {#snippet actions()}
      <div class="trellis-segment" role="group" aria-label="Metrics window">
        {#each windows as option (option.value)}
          <button
            type="button"
            class:active={metricsWindow === option.value}
            aria-pressed={metricsWindow === option.value}
            title={option.title}
            onclick={() => selectWindow(option.value)}
          >{option.label}</button>
        {/each}
      </div>
      <button class="btn btn-outline btn-sm" onclick={() => void refresh()} disabled={loading || refreshing}>
        {refreshing ? "Refreshing" : "Refresh"}
      </button>
    {/snippet}
  </PageToolbar>

  {#if lastUpdated}
    <p class="jobs-updated">Updated {lastUpdated.toLocaleTimeString()}</p>
  {/if}

  {#if error}
    <Notice variant="error" role="alert">Jobs could not be loaded. {error}</Notice>
  {:else if unavailableMessage}
    <Notice variant="info" role="status">{unavailableMessage} Job processing can continue while visibility is unavailable.</Notice>
  {/if}

  {#if metricsError}
    <Notice variant="info" role="status">{metricsError}</Notice>
  {/if}

  {#if metricsLoading && !metrics}
    <LoadingState label="Loading job health" />
  {:else if metrics}
    <MetricsLedger ariaLabel="Jobs status summary" items={ledgerItems} onSelect={handleLedgerSelect} />

    <div class="jobs-overview">
      <Panel eyebrow="Secondary" title="Job-type health">
        {#snippet actions()}<span class="text-sm text-base-content/70">{metrics?.summary.length ?? 0} types reporting</span>{/snippet}
        <p class="text-sm text-base-content/70">Pressure and latency by execution contract. Select a type to scope live work.</p>
        <JobsHealthMatrix summary={metrics.summary} buckets={metrics.buckets} selectedKey={selectedJobType} onSelect={selectJobType} />
      </Panel>
      <JobsScopedCharts buckets={metrics.buckets} selectedKey={selectedJobType} {windowLabel} />
    </div>
  {/if}

  {#if !unavailableMessage}
    <Panel eyebrow="Primary" title={focusTitle()}>
      {#snippet actions()}
        <div class="flex items-center gap-3">
          <span class="text-sm text-base-content/70">{jobCount} matching</span>
          {#if selectedJobType}
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => selectJobType(null)}>Clear type</button>
          {/if}
        </div>
      {/snippet}
      <p class="text-sm text-base-content/70">{focusDescription()}</p>
      {#if focus === "dead"}
        <p class="text-sm text-base-content/70">The <Term term="DLQ" /> holds jobs awaiting a replay or dismissal decision.</p>
      {/if}
      {#if bulkResult}
        <BulkResult
          succeeded={bulkResult.succeeded}
          failed={bulkResult.failed}
          pastTense="jobs cancelled"
          onRetry={failedJobs.length > 0 ? () => void cancelJobs(failedJobs) : undefined}
          onDismiss={() => { bulkResult = null; }}
        />
      {:else if selectedJobs.size > 0}
        <BulkActionBar count={selectedJobs.size} noun="job" onClear={() => selectedJobs.clear()}>
          {#snippet actions()}
            <button class="btn btn-error btn-outline btn-sm" disabled={bulkBusy} onclick={() => void requestBulkCancel()}>
              {bulkBusy ? "Cancelling…" : "Cancel selected"}
            </button>
          {/snippet}
        </BulkActionBar>
      {/if}
      {#if loading}
        <LoadingState label="Loading focused jobs" class="min-h-32" />
      {:else if jobs.length === 0}
        <EmptyState title="No matching jobs" description="No retained jobs match this operational view." />
      {:else}
        <DataTable>
          <thead><tr>
            <th>
              <span class="sr-only">Select all cancellable jobs</span>
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                aria-label="Select all cancellable jobs"
                disabled={bulkBusy || selectableJobIds.length === 0}
                checked={selectableJobIds.length > 0 && selectableJobIds.every((id) => selectedJobs.has(id))}
                indeterminate={selectableJobIds.some((id) => selectedJobs.has(id)) && !selectableJobIds.every((id) => selectedJobs.has(id))}
                onchange={() => toggleAll(selectedJobs, selectableJobIds)}
              />
            </th>
            <th>Job type / id</th><th>Queue key</th><th>State</th><th>Status</th><th>Duration</th><th>Attempt</th></tr></thead>
          <tbody>
            {#each focusedJobs as job (job.id)}
              {@const progress = jobProgress(job)}
              <tr>
                <td>
                  {#if job.state === "active" || job.state === "pending" || job.state === "retry"}
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      aria-label={`Select job {job.id}`}
                      disabled={bulkBusy}
                      checked={selectedJobs.has(job.id)}
                      onchange={() => toggleId(selectedJobs, job.id)}
                    />
                  {:else}
                    <span class="text-xs text-base-content/50">—</span>
                  {/if}
                </td>
                <td class="min-w-0">
                  <a class="link link-hover block max-w-md truncate text-left trellis-identifier font-medium" href={resolve(jobRoute(job.id))}>{job.type}</a>
                  <span class="trellis-metadata trellis-identifier block max-w-md truncate">{job.id} · {job.service}</span>
                </td>
                <td class="trellis-metadata trellis-identifier block max-w-xs truncate">{job.queueKey ?? "Unkeyed"}</td>
                <td><StatusBadge label={jobStateLabel(job)} status={jobStateVariant(job)} /></td>
                <td class="max-w-md">
                  <span class="block truncate text-sm" title={jobNarrative(job)}>{jobNarrative(job)}</span>
                  {#if job.progress?.step}<span class="trellis-metadata block truncate">{job.progress.step}</span>{/if}
                  {#if progress > 0}<span class="jobs-progress"><i style:--job-progress={`${progress}%`}></i></span>{/if}
                </td>
                <td class="whitespace-nowrap tabular-nums text-sm">{job.state === "pending" || job.state === "retry" ? "Queue " : "Run "}{jobDuration(job)}</td>
                <td class="tabular-nums text-sm">{job.tries}/{job.maxTries}</td>
              </tr>
            {/each}
          </tbody>
        </DataTable>
      {/if}
    </Panel>
  {/if}
</section>

<ConfirmationModal bind:this={confirmationModal} />

<style>
  .jobs-page {
    display: grid;
    gap: 1.5rem;
  }

  .jobs-page :global(.mb-5) {
    margin-bottom: 0;
  }

  .jobs-updated {
    color: color-mix(in oklab, var(--color-base-content) 64%, transparent);
    font-size: 0.72rem;
    margin: -1.15rem 0 -0.75rem;
    text-align: right;
  }

  .jobs-overview {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: minmax(0, 1.6fr) minmax(14rem, 0.52fr);
    align-items: start;
  }

  .jobs-overview > * {
    min-width: 0;
  }

  .jobs-progress {
    background: color-mix(in oklab, var(--color-base-300) 70%, transparent);
    border-radius: 999px;
    display: block;
    height: 0.22rem;
    margin-top: 0.35rem;
    overflow: hidden;
  }

  .jobs-progress i {
    background: color-mix(in oklab, var(--color-primary) 75%, var(--color-base-content));
    display: block;
    height: 100%;
    width: var(--job-progress);
  }

  @media (max-width: 1100px) {
    .jobs-overview {
      grid-template-columns: 1fr;
    }
  }
</style>
