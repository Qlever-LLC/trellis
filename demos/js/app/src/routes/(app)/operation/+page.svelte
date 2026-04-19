<script lang="ts">
  import { onMount } from "svelte";
  import {
    getTrellis,
    requestValue,
    type ReportOutput,
    type ReportProgress,
    type RpcAssignment,
  } from "$lib/trellis";

  type ReportEvent = {
    type: string;
    snapshot: { state: string };
    progress?: ReportProgress;
  };
  type ReportTerminal = {
    state: "completed" | "failed" | "cancelled";
    output?: ReportOutput;
  };

  let assignments = $state<RpcAssignment[]>([]);
  let selectedInspectionId = $state("");
  let loading = $state(true);
  let running = $state(false);
  let canCancel = $state(false);
  let error = $state<string | null>(null);
  let events = $state<Array<{ label: string; state: string }>>([]);
  let acceptedId = $state<string | null>(null);
  let terminal = $state<ReportTerminal | null>(null);

  async function createOperationRef(inspectionId: string) {
    const trellis = await getTrellis();
    return await trellis.operation("Inspection.Report.Generate")
      .input({ inspectionId })
      .start()
      .orThrow();
  }

  type ReportOperationRef = Awaited<ReturnType<typeof createOperationRef>>;

  let currentRef: ReportOperationRef | null = null;

  async function loadAssignments(): Promise<void> {
    loading = true;
    error = null;

    try {
      const response = await requestValue("Inspection.Assignments.List", {});
      assignments = response.assignments;
      selectedInspectionId = response.assignments[0]?.inspectionId ?? "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function describeEvent(event: ReportEvent): { label: string; state: string } {
    const state = event.snapshot.state;
    if (event.type === "progress" && event.progress) {
      return {
        label: `${event.progress.stage}: ${event.progress.message}`,
        state,
      };
    }

    return {
      label: `${event.type} update`,
      state,
    };
  }

  async function watchOperation(ref: ReportOperationRef): Promise<void> {
    const stream = await ref.watch().orThrow();
    for await (const event of stream) {
      events = [describeEvent(event), ...events].slice(0, 8);
    }
  }

  async function startOperation(): Promise<void> {
    if (!selectedInspectionId) return;

    running = true;
    error = null;
    events = [];
    terminal = null;

    try {
      const ref = await createOperationRef(selectedInspectionId);
      currentRef = ref;
      canCancel = true;
      acceptedId = ref.id;
      void watchOperation(ref);
      terminal = await ref.wait().orThrow();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      running = false;
      canCancel = false;
      currentRef = null;
    }
  }

  async function cancelOperation(): Promise<void> {
    if (!currentRef) return;

    try {
      const snapshot = await currentRef.cancel().orThrow();
      events = [{ label: "cancel requested", state: snapshot.state }, ...events].slice(0, 8);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  onMount(() => {
    void loadAssignments();
  });
</script>

<svelte:head>
  <title>Operation · Field inspection demo</title>
</svelte:head>

<section class="stack">
  <header class="page-header">
    <p class="eyebrow">Operation surface</p>
    <h1>Generate an inspection report</h1>
    <p class="page-summary">This route starts the real demo operation, watches live progress, and surfaces the terminal output for a chosen inspection.</p>
  </header>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="feature-grid" style="grid-template-columns: 0.95fr 1.05fr;">
    <section class="surface-card stack">
      <div class="split">
        <h2 class="section-title">Operation input</h2>
        {#if acceptedId}
          <span class="pill code">{acceptedId}</span>
        {/if}
      </div>

      {#if loading}
        <div class="empty-state">Loading assignment choices…</div>
      {:else}
        <div class="form-grid">
          <label>
            <span class="muted">Inspection</span>
            <select class="select" bind:value={selectedInspectionId}>
              {#each assignments as assignment (assignment.inspectionId)}
                <option value={assignment.inspectionId}>{assignment.siteName} · {assignment.assetName}</option>
              {/each}
            </select>
          </label>

          <div class="button-row">
            <button class="button" onclick={startOperation} disabled={running || !selectedInspectionId}>
              {running ? "Running…" : "Start report generation"}
            </button>
            <button class="ghost-button" onclick={cancelOperation} disabled={!running || !canCancel}>Cancel active run</button>
          </div>
        </div>
      {/if}
    </section>

    <section class="surface-card stack">
      <div class="split">
        <h2 class="section-title">Progress and output</h2>
        {#if terminal}
          <span class={`pill ${terminal.state === "completed" ? "success" : terminal.state === "cancelled" ? "warn" : "danger"}`}>
            {terminal.state}
          </span>
        {/if}
      </div>

      {#if events.length > 0}
        <ul class="log-list">
          {#each events as event, index (`${event.label}-${index}`)}
            <li>
              <strong>{event.label}</strong>
              <p class="status-line">Snapshot state: {event.state}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="empty-state">Start the operation to stream progress events here.</div>
      {/if}

      {#if terminal?.output}
        <div class="panel">
          <span class="kicker">Terminal output</span>
          <dl class="field-list">
            <li><strong class="code">{terminal.output.reportId}</strong><span class="muted">Report id</span></li>
            <li><strong>{terminal.output.inspectionId}</strong><span class="muted">Inspection id</span></li>
            <li><strong>{terminal.output.status}</strong><span class="muted">Reported status</span></li>
          </dl>
        </div>
      {/if}
    </section>
  </div>
</section>
