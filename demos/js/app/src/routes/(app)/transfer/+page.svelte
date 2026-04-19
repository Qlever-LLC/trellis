<script lang="ts">
  import { getTrellis, type TransferOutput, type TransferProgress } from "$lib/trellis";

  const encoder = new TextEncoder();

  let note = $state("West Yard · Pump Station 7\nObserved minor vibration during the morning walk-through. Follow-up image attached from the browser demo upload.");
  let evidenceType = $state("field-photo");
  let running = $state(false);
  let error = $state<string | null>(null);
  let transferredBytes = $state(0);
  let acceptedId = $state<string | null>(null);
  let progressLog = $state<TransferProgress[]>([]);
  let result = $state<TransferOutput | null>(null);

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
      const trellis = await getTrellis();

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
  <title>Transfer · Field inspection demo</title>
</svelte:head>

<section class="stack">
  <header class="page-header">
    <p class="eyebrow">Transfer surface</p>
    <h1>Upload a small evidence payload</h1>
    <p class="page-summary">The transfer demo uses a transfer-capable operation so the browser can stage bytes and still receive normal operation progress.</p>
  </header>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="feature-grid" style="grid-template-columns: 0.95fr 1.05fr;">
    <section class="surface-card stack">
      <h2 class="section-title">Generated evidence</h2>

      <div class="form-grid">
        <label>
          <span class="muted">Evidence type</span>
          <select class="select" bind:value={evidenceType}>
            <option value="field-photo">Field photo</option>
            <option value="operator-note">Operator note</option>
          </select>
        </label>

        <label>
          <span class="muted">Text payload</span>
          <textarea class="textarea" bind:value={note}></textarea>
        </label>

        <div class="button-row">
          <button class="button" onclick={startUpload} disabled={running || note.trim().length === 0}>
            {running ? "Uploading…" : "Upload demo evidence"}
          </button>
        </div>
      </div>
    </section>

    <section class="surface-card stack">
      <div class="split">
        <h2 class="section-title">Transfer status</h2>
        {#if acceptedId}
          <span class="pill code">{acceptedId}</span>
        {/if}
      </div>

      <div class="meta-grid">
        <div>
          <dt>Transferred</dt>
          <dd>{transferredBytes} bytes</dd>
        </div>
        <div>
          <dt>Payload size</dt>
          <dd>{encoder.encode(note).byteLength} bytes</dd>
        </div>
      </div>

      {#if progressLog.length > 0}
        <ul class="log-list">
          {#each progressLog as progress, index (`${progress.stage}-${index}`)}
            <li>
              <strong>{progress.stage}</strong>
              <p class="status-line">{progress.message}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="empty-state">Start an upload to watch transfer and operation progress converge.</div>
      {/if}

      {#if result}
        <div class="panel">
          <span class="kicker">Stored evidence</span>
          <dl class="field-list">
            <li><strong class="code">{result.evidenceId}</strong><span class="muted">Evidence id</span></li>
            <li><strong class="code">{result.key}</strong><span class="muted">Store key</span></li>
            <li><strong>{result.size} bytes</strong><span class="muted">Recorded size</span></li>
            <li><strong>{result.disposition}</strong><span class="muted">Disposition</span></li>
          </dl>
        </div>
      {/if}
    </section>
  </div>
</section>
