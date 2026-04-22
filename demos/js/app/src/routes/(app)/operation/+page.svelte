<script lang="ts">
  import { onMount } from "svelte";
  import { getTrellis } from "@qlever-llc/trellis-svelte";
  import type {
    InspectionReportGenerateOutput,
    InspectionReportGenerateProgress,
  } from "../../../../../generated/js/sdks/demo-operation-service/types.ts";
  import type { InspectionAssignmentsListOutput } from "../../../../../generated/js/sdks/demo-rpc-service/types.ts";

  type ReportOutput = InspectionReportGenerateOutput;
  type ReportProgress = InspectionReportGenerateProgress;
  type RpcAssignment = InspectionAssignmentsListOutput["assignments"][number];
  type OperationDemoTrellis = {
    request(method: "Inspection.Assignments.List", input: {}): {
      orThrow(): Promise<InspectionAssignmentsListOutput>;
    };
    operation(method: "Inspection.Report.Generate"): {
      input(input: { inspectionId: string }): {
        start(): {
          orThrow(): Promise<{
            id: string;
            watch(): { orThrow(): Promise<AsyncIterable<ReportEvent>> };
            wait(): { orThrow(): Promise<ReportTerminal> };
            cancel(): { orThrow(): Promise<{ state: string }> };
          }>;
        };
      };
    };
  };

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
  const appTrellis = getTrellis() as unknown as Promise<OperationDemoTrellis>;

  async function createOperationRef(inspectionId: string) {
    const trellis = await appTrellis;
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
      const response = await (await appTrellis)
        .request("Inspection.Assignments.List", {})
        .orThrow();
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

  function terminalBadgeClass(state: ReportTerminal["state"]): string {
    if (state === "completed") return "badge badge-success badge-outline";
    if (state === "cancelled") return "badge badge-warning badge-outline";
    return "badge badge-error badge-outline";
  }

  onMount(() => {
    void loadAssignments();
  });
</script>

<svelte:head>
  <title>Operation · Trellis demo</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Operation</h1>
    <p class="text-sm text-base-content/70">Start, watch, and cancel a long-running operation.</p>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Start operation</h2>
          {#if acceptedId}
            <span class="badge badge-outline font-mono">{acceptedId}</span>
          {/if}
        </div>

        {#if loading}
          <div class="alert">
            <span>Loading inspections.</span>
          </div>
        {:else}
          <label class="form-control gap-2">
            <span class="label-text font-medium">Inspection</span>
            <select class="select select-bordered w-full" bind:value={selectedInspectionId}>
              {#each assignments as assignment (assignment.inspectionId)}
                <option value={assignment.inspectionId}>
                  {assignment.siteName} · {assignment.assetName}
                </option>
              {/each}
            </select>
          </label>

          <div class="flex flex-wrap gap-3">
            <button class="btn btn-primary" onclick={startOperation} disabled={running || !selectedInspectionId}>
              {running ? "Running..." : "Start report generation"}
            </button>
            <button class="btn btn-outline" onclick={cancelOperation} disabled={!running || !canCancel}>
              Cancel
            </button>
            <button class="btn btn-ghost" onclick={loadAssignments} disabled={loading || running}>
              Reload inspections
            </button>
          </div>
        {/if}
      </div>
    </section>

    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Progress</h2>
          {#if terminal}
            <span class={terminalBadgeClass(terminal.state)}>{terminal.state}</span>
          {:else if running}
            <span class="badge badge-outline">running</span>
          {/if}
        </div>

        {#if events.length === 0}
          <div class="alert">
            <span>Start the operation to stream watch events.</span>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Snapshot state</th>
                </tr>
              </thead>
              <tbody>
                {#each events as event, index (`${event.label}-${index}`)}
                  <tr>
                    <td>{event.label}</td>
                    <td>{event.state}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if terminal?.output}
          <div class="divider my-0">Output</div>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr>
                  <th>Report id</th>
                  <td class="font-mono text-xs">{terminal.output.reportId}</td>
                </tr>
                <tr>
                  <th>Inspection id</th>
                  <td>{terminal.output.inspectionId}</td>
                </tr>
                <tr>
                  <th>Status</th>
                  <td>{terminal.output.status}</td>
                </tr>
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  </div>
</section>
