<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getTrellis } from "$lib/trellis";

  type InspectionAssignment = { inspectionId: string; siteName: string; assetName: string };
  type ReportsGenerateProgress = { stage: string; message: string };
  type ReportsGenerateResponse = { reportId: string; inspectionId: string; status: string };

  type ReportEvent = {
    type: string;
    snapshot: { state: string };
    progress?: ReportsGenerateProgress;
  };
  type ReportTerminal = {
    state: "completed" | "failed" | "cancelled";
    output?: ReportsGenerateResponse;
  };
  type ReportOperationRef = {
    id: string;
    watch(): { orThrow(): Promise<AsyncIterable<ReportEvent>> };
    wait(): { orThrow(): Promise<ReportTerminal> };
    cancel(): { orThrow(): Promise<{ state: string }> };
  };

  const trellis = getTrellis();

  let assignments = $state<InspectionAssignment[]>([]);
  let selectedInspectionId = $state("");
  let loading = $state(true);
  let running = $state(false);
  let canCancel = $state(false);
  let error = $state<string | null>(null);
  let events = $state<Array<{ label: string; state: string }>>([]);
  let acceptedId = $state<string | null>(null);
  let terminal = $state<ReportTerminal | null>(null);
  let currentRef: ReportOperationRef | null = null;
  let mounted = false;
  let assignmentRequestId = 0;
  let operationRunId = 0;

  async function loadAssignments(): Promise<void> {
    const requestId = ++assignmentRequestId;
    loading = true;
    error = null;

    try {
      const response = await trellis.request("Assignments.List", {}).orThrow();
      if (!mounted || requestId !== assignmentRequestId) return;
      assignments = response.assignments;
      selectedInspectionId = response.assignments[0]?.inspectionId ?? "";
    } catch (cause) {
      if (!mounted || requestId !== assignmentRequestId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!mounted || requestId !== assignmentRequestId) return;
      loading = false;
    }
  }

  function describeEvent(event: ReportEvent): { label: string; state: string } {
    if (event.type === "progress" && event.progress) {
      return {
        label: `${event.progress.stage}: ${event.progress.message}`,
        state: event.snapshot.state,
      };
    }

    return { label: `${event.type} update`, state: event.snapshot.state };
  }

  async function watchOperation(ref: ReportOperationRef, runId: number): Promise<void> {
    const stream = await ref.watch().orThrow();
    for await (const event of stream) {
      if (!mounted || runId !== operationRunId) return;
      events = [describeEvent(event), ...events].slice(0, 8);
    }
  }

  async function startOperation(): Promise<void> {
    if (!selectedInspectionId) return;

    running = true;
    error = null;
    events = [];
    terminal = null;
    const runId = ++operationRunId;

    try {
      const ref = await trellis.operation("Reports.Generate").input({ inspectionId: selectedInspectionId }).start().orThrow();
      if (!mounted || runId !== operationRunId) return;
      currentRef = ref;
      canCancel = true;
      acceptedId = ref.id;
      void watchOperation(ref, runId).catch((cause) => {
        if (!mounted || runId !== operationRunId) return;
        error = cause instanceof Error ? cause.message : String(cause);
      });
      const completed = await ref.wait().orThrow();
      if (!mounted || runId !== operationRunId) return;
      terminal = completed;
    } catch (cause) {
      if (!mounted || runId !== operationRunId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!mounted || runId !== operationRunId) return;
      running = false;
      canCancel = false;
      currentRef = null;
    }
  }

  async function cancelOperation(): Promise<void> {
    if (!currentRef) return;

    try {
      const snapshot = await currentRef.cancel().orThrow();
      if (!mounted) return;
      events = [{ label: "cancel requested", state: snapshot.state }, ...events].slice(0, 8);
    } catch (cause) {
      if (!mounted) return;
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function terminalBadgeClass(state: ReportTerminal["state"]): string {
    if (state === "completed") return "badge badge-success badge-outline";
    if (state === "cancelled") return "badge badge-warning badge-outline";
    return "badge badge-error badge-outline";
  }

  onMount(() => {
    mounted = true;
    void loadAssignments();
  });

  onDestroy(() => {
    mounted = false;
    assignmentRequestId += 1;
    operationRunId += 1;
    currentRef = null;
  });
</script>

<svelte:head>
  <title>Report Run · Field Inspection Desk</title>
</svelte:head>

<section class="page-sheet rounded-box p-5 sm:p-7">
  <div class="flex flex-col gap-6">
  <header class="pb-1">
    <div class="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div class="min-w-0 space-y-3">
        <div class="trellis-kicker">Reports.Generate</div>
        <h1 class="break-words text-2xl font-black tracking-tight md:text-3xl">Report run</h1>
        <p class="max-w-3xl break-words text-sm text-base-content/70">
          Pick an inspection, launch the report operation, and monitor every progress signal before publication.
        </p>
      </div>
      <div class="badge badge-outline badge-lg max-w-full"><span class="truncate">Teaching note: operation</span></div>
    </div>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <div class="section-rule grid gap-7 pt-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
    <section class="min-w-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Run controls</h2>
          {#if acceptedId}
            <span class="badge badge-outline max-w-full font-mono"><span class="truncate">{acceptedId}</span></span>
          {/if}
        </div>

        {#if loading}
          <div class="alert"><span>Loading inspections.</span></div>
        {:else}
          <label class="form-control gap-2">
            <span class="label-text font-medium">Queued inspection</span>
            <select class="select select-bordered w-full min-w-0" bind:value={selectedInspectionId}>
              {#each assignments as assignment (assignment.inspectionId)}
                <option value={assignment.inspectionId}>{assignment.siteName} · {assignment.assetName}</option>
              {/each}
            </select>
          </label>

          <div class="flex flex-wrap gap-3">
            <button class="btn btn-accent" onclick={startOperation} disabled={running || !selectedInspectionId}>
              {running ? "Running report..." : "Start report run"}
            </button>
            <button class="btn btn-outline" onclick={cancelOperation} disabled={!running || !canCancel}>Cancel</button>
            <button class="btn btn-ghost" onclick={loadAssignments} disabled={loading || running}>Refresh queue</button>
          </div>
        {/if}
      </div>
    </section>

    <section class="min-w-0 border-t border-base-300/80 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Operation timeline</h2>
          {#if terminal}
            <span class={terminalBadgeClass(terminal.state)}><span class="truncate">{terminal.state}</span></span>
          {:else if running}
            <span class="badge badge-outline">running</span>
          {/if}
        </div>

        {#if events.length === 0}
          <div class="alert"><span>Start a report run to stream progress from Reports.Generate.</span></div>
        {:else}
          <div class="space-y-2" aria-live="polite">
            {#each events as event, index (`${event.label}-${index}`)}
              <div class="min-w-0 border-t border-base-300/80 bg-base-200/45 px-1 py-3 text-sm">
                <span class="badge badge-outline badge-sm max-w-full"><span class="truncate">{event.state}</span></span>
                <span class="ml-2 break-words">{event.label}</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if terminal?.output}
          <div class="divider my-0">Report package</div>
          <div class="overflow-x-auto">
            <table class="table table-sm executive-table min-w-[28rem]">
              <tbody>
                <tr><th scope="row">Report id</th><td class="break-words font-mono text-xs">{terminal.output.reportId}</td></tr>
                <tr><th scope="row">Inspection id</th><td class="break-words">{terminal.output.inspectionId}</td></tr>
                <tr><th scope="row">Status</th><td class="break-words">{terminal.output.status}</td></tr>
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  </div>
  </div>
</section>
