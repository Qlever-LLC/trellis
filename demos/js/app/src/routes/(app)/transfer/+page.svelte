<script lang="ts">
  import { getTrellis } from "@qlever-llc/trellis-svelte";
  import type {
    InspectionEvidenceUploadOutput,
    InspectionEvidenceUploadProgress,
  } from "../../../../../generated/js/sdks/demo-transfer-service/types.ts";

  type TransferProgress = InspectionEvidenceUploadProgress;
  type TransferOutput = InspectionEvidenceUploadOutput;
  type TransferBuilder = {
    onTransfer(handler: (event: { transfer: { transferredBytes: number } }) => void): TransferBuilder;
    onProgress(handler: (event: { progress: TransferProgress }) => void): TransferBuilder;
    start(): {
      orThrow(): Promise<{
        operation: { id: string };
        wait(): {
          orThrow(): Promise<{ terminal: { output?: TransferOutput } }>;
        };
      }>;
    };
  };
  type TransferDemoTrellis = {
    operation(method: "Inspection.Evidence.Upload"): {
      input(input: {
        key: string;
        contentType: string;
        evidenceType: string;
      }): {
        transfer(body: Uint8Array | ArrayBuffer): TransferBuilder;
      };
    };
  };

  const encoder = new TextEncoder();

  let note = $state("West Yard · Pump Station 7\nObserved minor vibration during the morning walk-through. Follow-up image attached from the browser demo upload.");
  let evidenceType = $state("field-photo");
  let running = $state(false);
  let error = $state<string | null>(null);
  let transferredBytes = $state(0);
  let acceptedId = $state<string | null>(null);
  let progressLog = $state<TransferProgress[]>([]);
  let result = $state<TransferOutput | null>(null);
  let payloadBytes = $derived(encoder.encode(note).byteLength);
  const appTrellis = getTrellis() as unknown as Promise<TransferDemoTrellis>;

  async function startUpload(): Promise<void> {
    running = true;
    error = null;
    transferredBytes = 0;
    acceptedId = null;
    progressLog = [];
    result = null;

    try {
      const bytes = encoder.encode(note);
      const key = `evidence/${crypto.randomUUID()}.txt`;
      const trellis = await appTrellis;

      const upload = await trellis.operation("Inspection.Evidence.Upload")
        .input({
          key,
          contentType: "text/plain",
          evidenceType,
        })
        .transfer(bytes)
        .onTransfer((event) => {
          transferredBytes = event.transfer.transferredBytes;
        })
        .onProgress((event) => {
          progressLog = [event.progress, ...progressLog].slice(0, 6);
        })
        .start()
        .orThrow();

      acceptedId = upload.operation.id;
      const completed = await upload.wait().orThrow();
      result = completed.terminal.output ?? null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      running = false;
    }
  }
</script>

<svelte:head>
  <title>Transfer · Trellis demo</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold">Transfer</h1>
    <p class="text-sm text-base-content/70">Upload bytes through a transfer-capable operation.</p>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error">
      <span>{error}</span>
    </div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <h2 class="card-title text-lg">Upload input</h2>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Evidence type</span>
          <select class="select select-bordered w-full" bind:value={evidenceType}>
            <option value="field-photo">Field photo</option>
            <option value="operator-note">Operator note</option>
          </select>
        </label>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Text payload</span>
          <textarea class="textarea textarea-bordered min-h-48 w-full" bind:value={note}></textarea>
        </label>

        <div class="flex flex-wrap items-center gap-3">
          <button class="btn btn-primary" onclick={startUpload} disabled={running || note.trim().length === 0}>
            {running ? "Uploading..." : "Upload evidence"}
          </button>
          <span class="badge badge-outline">{payloadBytes} bytes</span>
        </div>
      </div>
    </section>

    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Transfer status</h2>
          {#if acceptedId}
            <span class="badge badge-outline font-mono">{acceptedId}</span>
          {/if}
        </div>

        <div class="stats stats-vertical border border-base-300 lg:stats-horizontal">
          <div class="stat px-4 py-3">
            <div class="stat-title">Transferred</div>
            <div class="stat-value text-2xl">{transferredBytes}</div>
            <div class="stat-desc">bytes sent</div>
          </div>
          <div class="stat px-4 py-3">
            <div class="stat-title">Payload size</div>
            <div class="stat-value text-2xl">{payloadBytes}</div>
            <div class="stat-desc">bytes total</div>
          </div>
        </div>

        {#if progressLog.length === 0}
          <div class="alert">
            <span>Start an upload to see transfer and operation progress.</span>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {#each progressLog as progress, index (`${progress.stage}-${index}`)}
                  <tr>
                    <td>{progress.stage}</td>
                    <td>{progress.message}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if result}
          <div class="divider my-0">Stored evidence</div>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr>
                  <th>Evidence id</th>
                  <td class="font-mono text-xs">{result.evidenceId}</td>
                </tr>
                <tr>
                  <th>Key</th>
                  <td class="font-mono text-xs">{result.key}</td>
                </tr>
                <tr>
                  <th>Recorded size</th>
                  <td>{result.size} bytes</td>
                </tr>
                <tr>
                  <th>Disposition</th>
                  <td>{result.disposition}</td>
                </tr>
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  </div>
</section>
