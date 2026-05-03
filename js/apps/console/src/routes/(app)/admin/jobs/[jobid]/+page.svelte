<script lang="ts">
  import { resolve } from "$app/paths";
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import EmptyState from "../../../../../lib/components/EmptyState.svelte";
  import LoadingState from "../../../../../lib/components/LoadingState.svelte";
  import PageToolbar from "../../../../../lib/components/PageToolbar.svelte";
  import Panel from "../../../../../lib/components/Panel.svelte";
  import StatusBadge from "../../../../../lib/components/StatusBadge.svelte";
  import { errorMessage, formatDate } from "../../../../../lib/format";
  import {
    cancelJob,
    dismissDlqJob,
    loadJobDetailData,
    replayDlqJob,
    retryJob,
  } from "../../../../../lib/jobs_page.ts";
  import type { JobsGetOutput } from "@qlever-llc/trellis/sdk/jobs";
  import { getTrellis } from "../../../../../lib/trellis";

  const trellis = getTrellis();
  type Job = NonNullable<JobsGetOutput["job"]>;

  const jobId = $derived(page.params.jobid);
  const currentJobId = $derived(jobId ?? "");
  let loading = $state(true);
  let actionBusy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let unavailableMessage = $state<string | null>(null);
  let job = $state.raw<Job | undefined>(undefined);
  let loadedJobId = $state<string | null>(null);

  const canCancel = $derived(job?.state === "pending" || job?.state === "retry" || job?.state === "active");
  const canRetry = $derived(job?.state === "failed");
  const canDlq = $derived(job?.state === "dead");

  function stateStatus(state: Job["state"]): "healthy" | "degraded" | "unhealthy" | "offline" {
    switch (state) {
      case "completed":
        return "healthy";
      case "failed":
      case "dead":
      case "expired":
        return "unhealthy";
      case "active":
        return "healthy";
      case "pending":
      case "retry":
        return "degraded";
      default:
        return "offline";
    }
  }

  function jsonBlock(value: unknown): string {
    if (value === undefined) return "-";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
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

  async function load(id = currentJobId) {
    loadedJobId = id;
    loading = true;
    error = null;
    unavailableMessage = null;

    try {
      const data = await loadJobDetailData({
        getJob: (input) => trellis.request("Jobs.Get", input),
      }, id);
      unavailableMessage = data.available ? null : data.message ?? "Jobs admin runtime is unavailable.";
      job = data.job;
    } catch (e) {
      error = errorMessage(e);
      unavailableMessage = null;
      job = undefined;
    } finally {
      loading = false;
    }
  }

  function loadCurrentJobIfNeeded() {
    if (!currentJobId || currentJobId === loadedJobId) return;
    void load(currentJobId);
  }

  async function runAction(name: "cancel" | "retry" | "replay" | "dismiss") {
    const actionJobId = job?.id ?? currentJobId;
    actionBusy = name;
    error = null;
    try {
      if (name === "cancel") {
        await cancelJob({ action: (input) => trellis.request("Jobs.Cancel", input) }, actionJobId);
      } else if (name === "retry") {
        await retryJob({ action: (input) => trellis.request("Jobs.Retry", input) }, actionJobId);
      } else if (name === "replay") {
        await replayDlqJob({ action: (input) => trellis.request("Jobs.ReplayDLQ", input) }, actionJobId);
      } else {
        await dismissDlqJob({ action: (input) => trellis.request("Jobs.DismissDLQ", input) }, actionJobId);
      }
      await load(actionJobId);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      actionBusy = null;
    }
  }

  onMount(() => {
    loadCurrentJobIfNeeded();
  });

  afterNavigate(() => {
    loadCurrentJobIfNeeded();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Job detail" description="Job identity, timings, payload, result and operator actions.">
    {#snippet meta()}
      {#if job}
        <StatusBadge label={job.state} status={stateStatus(job.state)} />
      {/if}
    {/snippet}
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={resolve("/admin/jobs")}>Back</a>
      <button class="btn btn-ghost btn-sm" onclick={() => load()} disabled={loading || actionBusy !== null}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error" role="alert"><span>{error}</span></div>
  {:else if unavailableMessage}
    <div class="alert alert-info" role="status"><span>{unavailableMessage}</span></div>
  {/if}

  {#if loading}
    <LoadingState label="Loading job" />
  {:else if unavailableMessage}
    <p class="text-xs text-base-content/60">The console can still be used normally without jobs installed.</p>
  {:else if !job}
    <Panel title="Job" eyebrow="Primary">
      <EmptyState title="Job not found" description="No job exists for this id." />
    </Panel>
  {:else}
    <Panel title={job.id} eyebrow="Primary">
      {#snippet actions()}
        <button class="btn btn-outline btn-xs" onclick={() => runAction("cancel")} disabled={!canCancel || actionBusy !== null}>Cancel</button>
        <button class="btn btn-outline btn-xs" onclick={() => runAction("retry")} disabled={!canRetry || actionBusy !== null}>Retry</button>
        <button class="btn btn-outline btn-xs" onclick={() => runAction("replay")} disabled={!canDlq || actionBusy !== null}>Replay DLQ</button>
        <button class="btn btn-outline btn-xs" onclick={() => runAction("dismiss")} disabled={!canDlq || actionBusy !== null}>Dismiss DLQ</button>
      {/snippet}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div class="space-y-4 min-w-0">
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table">
              <tbody>
                <tr><th class="w-32">ID</th><td class="trellis-identifier">{job.id}</td></tr>
                <tr><th>Service</th><td class="trellis-identifier">{job.service}</td></tr>
                <tr><th>Type</th><td class="trellis-identifier">{job.type}</td></tr>
                <tr><th>State</th><td><StatusBadge label={job.state} status={stateStatus(job.state)} /></td></tr>
                <tr><th>Tries</th><td class="tabular-nums">{job.tries}/{job.maxTries}</td></tr>
                <tr><th>Last error</th><td class="text-error">{job.lastError ?? "-"}</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">Logs</h2>
            {#if job.logs && job.logs.length > 0}
              <div class="overflow-x-auto">
                <table class="table table-sm trellis-table">
                  <thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>
                  <tbody>
                    {#each job.logs as log (`${log.timestamp}:${log.message}`)}
                      <tr>
                        <td class="text-xs text-base-content/60">{formatDate(log.timestamp)}</td>
                        <td><span class="badge badge-ghost badge-xs">{log.level}</span></td>
                        <td>{log.message}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else}
              <p class="text-sm text-base-content/60">No logs recorded.</p>
            {/if}
          </div>
        </div>

        <div class="space-y-4">
          <div class="overflow-x-auto">
            <table class="table table-sm trellis-table">
              <tbody>
                <tr><th>Created</th><td>{formatDate(job.createdAt)}</td></tr>
                <tr><th>Updated</th><td>{formatDate(job.updatedAt)}</td></tr>
                <tr><th>Started</th><td>{formatDate(job.startedAt)}</td></tr>
                <tr><th>Completed</th><td>{formatDate(job.completedAt)}</td></tr>
                <tr><th>Deadline</th><td>{formatDate(job.deadline)}</td></tr>
                <tr><th>Duration</th><td>{durationLabel(job.startedAt, job.completedAt)}</td></tr>
              </tbody>
            </table>
          </div>

          <div>
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">Progress</h2>
            <pre class="max-h-48 overflow-auto rounded-box bg-base-200 p-3 text-xs">{jsonBlock(job.progress)}</pre>
          </div>
        </div>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h2 class="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">Payload</h2>
          <pre class="max-h-96 overflow-auto rounded-box bg-base-200 p-3 text-xs">{jsonBlock(job.payload)}</pre>
        </div>
        <div>
          <h2 class="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">Result</h2>
          <pre class="max-h-96 overflow-auto rounded-box bg-base-200 p-3 text-xs">{jsonBlock(job.result)}</pre>
        </div>
      </div>
    </Panel>
  {/if}
</section>
