<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { getTrellis } from "$lib/trellis";

  type EvidenceUploadProgress = { stage: string; message: string };
  type EvidenceUploadResponse = { evidenceId: string; key: string; size: number; disposition: string };
  type EvidenceRecord = {
    evidenceId: string;
    key: string;
    size: number;
    contentType?: string;
    evidenceType: string;
    fileName?: string;
    uploadedAt: string;
  };
  type GalleryItem = EvidenceRecord & {
    previewUrl?: string;
    previewing?: boolean;
    previewError?: string;
  };
  type TransferEvent = { transfer: { transferredBytes: number } };
  type ProgressEvent = { progress: EvidenceUploadProgress };

  const trellis = getTrellis();
  const evidenceType = "field-photo";

  let files = $state<FileList>();
  let running = $state(false);
  let refreshing = $state(false);
  let error = $state<string | null>(null);
  let transferredBytes = $state(0);
  let acceptedId = $state<string | null>(null);
  let progressLog = $state<EvidenceUploadProgress[]>([]);
  let result = $state<EvidenceUploadResponse | null>(null);
  let gallery = $state.raw<GalleryItem[]>([]);
  let inFlightFile = $state<{ name: string; size: number } | null>(null);
  let mounted = false;
  let galleryRequestId = 0;
  let uploadRunId = 0;
  let nextDownloadRunId = 0;
  const downloadRunIds = new SvelteMap<string, number>();

  let selectedFile = $derived(files?.item(0) ?? null);
  let payloadBytes = $derived(inFlightFile?.size ?? selectedFile?.size ?? 0);
  let payloadName = $derived(inFlightFile?.name ?? selectedFile?.name ?? "No file selected");

  onMount(() => {
    mounted = true;
    void refreshGallery(true);
  });

  onDestroy(() => {
    mounted = false;
    galleryRequestId += 1;
    uploadRunId += 1;
    downloadRunIds.clear();
    clearPreviewUrls();
  });

  function formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  function safeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
  }

  function revokePreviewUrl(item: GalleryItem): void {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }

  function clearPreviewUrls(): void {
    for (const item of gallery) {
      revokePreviewUrl(item);
    }
    gallery = gallery.map(({ previewUrl: _previewUrl, previewing: _previewing, previewError: _previewError, ...item }) => item);
  }

  function updateGalleryItem(key: string, patch: Partial<GalleryItem>): void {
    gallery = gallery.map((item) => item.key === key ? { ...item, ...patch } : item);
  }

  async function startUpload(): Promise<void> {
    const file = selectedFile;
    if (!file) {
      error = "Choose an image before uploading.";
      return;
    }

    running = true;
    error = null;
    transferredBytes = 0;
    acceptedId = null;
    progressLog = [];
    result = null;
    inFlightFile = { name: file.name, size: file.size };
    const runId = ++uploadRunId;

    try {
      const evidenceId = crypto.randomUUID();
      const fileName = safeFileName(file.name);
      const key = `evidence/${evidenceId}-${fileName}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!mounted || runId !== uploadRunId) return;
      const upload = await trellis.operation("Evidence.Upload")
        .input({
          key,
          contentType: file.type || "application/octet-stream",
          evidenceType,
          metadata: { evidenceId, evidenceType, fileName: file.name },
        })
        .transfer(bytes)
        .onTransfer((event: TransferEvent) => {
          if (!mounted || runId !== uploadRunId) return;
          transferredBytes = event.transfer.transferredBytes;
        })
        .onProgress((event: ProgressEvent) => {
          if (!mounted || runId !== uploadRunId) return;
          progressLog = [event.progress, ...progressLog].slice(0, 6);
        })
        .start()
        .orThrow();

      if (!mounted || runId !== uploadRunId) return;
      acceptedId = upload.operation.id;
      const completed = await upload.wait().orThrow();
      if (!mounted || runId !== uploadRunId) return;
      result = completed.terminal.output ?? null;
      await refreshGallery(true);
    } catch (cause) {
      if (!mounted || runId !== uploadRunId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!mounted || runId !== uploadRunId) return;
      running = false;
      inFlightFile = null;
    }
  }

  async function refreshGallery(downloadLatest: boolean): Promise<void> {
    const requestId = ++galleryRequestId;
    downloadRunIds.clear();
    refreshing = true;
    error = null;
    clearPreviewUrls();

    try {
      const list = await trellis.request("Evidence.List", { prefix: "evidence/" }).orThrow();
      if (!mounted || requestId !== galleryRequestId) return;
      gallery = list.evidence
        .slice()
        .sort((left: EvidenceRecord, right: EvidenceRecord) => Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt));

      if (downloadLatest) {
        const latestImage = gallery.find((item) => item.contentType?.startsWith("image/"));
        if (latestImage) {
          await downloadPreview(latestImage.key);
        }
      }
    } catch (cause) {
      if (!mounted || requestId !== galleryRequestId) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!mounted || requestId !== galleryRequestId) return;
      refreshing = false;
    }
  }

  async function downloadPreview(key: string): Promise<void> {
    const runId = ++nextDownloadRunId;
    downloadRunIds.set(key, runId);
    const existing = gallery.find((item) => item.key === key);
    if (!existing) {
      return;
    }

    revokePreviewUrl(existing);
    updateGalleryItem(key, { previewUrl: undefined, previewError: undefined, previewing: true });

    try {
      const download = await trellis.request("Evidence.Download", { key }).orThrow();
      const bytes = await trellis.transfer(download.transfer).bytes().orThrow();
      if (!mounted || downloadRunIds.get(key) !== runId) return;
      const latest = gallery.find((item) => item.key === key);
      const contentType = latest?.contentType ?? "application/octet-stream";
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      const previewUrl = URL.createObjectURL(new Blob([body], { type: contentType }));
      updateGalleryItem(key, { previewUrl, previewing: false });
    } catch (cause) {
      if (!mounted || downloadRunIds.get(key) !== runId) return;
      updateGalleryItem(key, {
        previewError: cause instanceof Error ? cause.message : String(cause),
        previewing: false,
      });
    } finally {
      if (downloadRunIds.get(key) === runId) {
        downloadRunIds.delete(key);
      }
    }
  }
</script>

<svelte:head>
  <title>Evidence Locker · Field Inspection Desk</title>
</svelte:head>

<section class="page-sheet rounded-box p-5 sm:p-7">
  <div class="flex flex-col gap-6">
  <header class="pb-1">
    <div class="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div class="min-w-0 space-y-3">
        <div class="trellis-kicker">Evidence.Upload</div>
        <h1 class="break-words text-2xl font-black tracking-tight md:text-3xl">Evidence locker</h1>
        <p class="max-w-3xl break-words text-sm text-base-content/70">
          Upload field photos with a send transfer, then use receive-grant preview downloads to verify stored image evidence.
        </p>
      </div>
      <div class="badge badge-outline badge-lg max-w-full"><span class="truncate">Teaching note: transfer operation + receive grant</span></div>
    </div>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <div class="section-rule grid gap-7 pt-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
    <section class="min-w-0">
      <div class="flex flex-col gap-5">
        <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Photo intake</h2>
        <p class="break-words text-sm text-base-content/70">
          Choose an image captured during inspection. The upload sends the file bytes through Evidence.Upload while metadata records the field-photo evidence type.
        </p>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Image evidence</span>
          <input class="file-input file-input-bordered w-full" type="file" accept="image/*" bind:files disabled={running} />
        </label>

        <div class="flex min-w-0 flex-wrap items-center gap-3">
          <button class="btn btn-accent" onclick={startUpload} disabled={running || selectedFile === null}>
            {running ? "Sending transfer..." : "Upload photo evidence"}
          </button>
          <span class="badge badge-outline max-w-full" title={payloadName}><span class="truncate">{payloadBytes} bytes</span></span>
          <span class="badge badge-outline max-w-full"><span class="truncate">{evidenceType}</span></span>
        </div>
      </div>
    </section>

    <section class="min-w-0 border-t border-base-300/80 pt-6 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <div class="flex flex-col gap-5">
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Send transfer status</h2>
          {#if acceptedId}
            <span class="badge badge-outline max-w-full font-mono"><span class="truncate">{acceptedId}</span></span>
          {/if}
        </div>

        <div class="stats stats-vertical overflow-hidden border-y border-base-300/80 bg-base-200/35 lg:stats-horizontal">
          <div class="stat px-4 py-3">
            <div class="stat-title">Transferred</div>
            <div class="stat-value text-2xl">{transferredBytes}</div>
            <div class="stat-desc">bytes sent by transfer</div>
          </div>
          <div class="stat px-4 py-3">
            <div class="stat-title">Payload size</div>
            <div class="stat-value text-2xl">{payloadBytes}</div>
            <div class="stat-desc min-w-0 break-words">{running ? `uploading ${payloadName}` : "selected file bytes"}</div>
          </div>
        </div>

        {#if progressLog.length === 0}
          <div class="alert"><span>Start a photo upload to see transfer bytes and operation progress.</span></div>
        {:else}
          <div class="overflow-x-auto">
              <table class="table table-zebra table-sm executive-table min-w-[32rem]">
              <thead><tr><th>Stage</th><th>Message</th></tr></thead>
              <tbody>
                {#each progressLog as progress, index (`${progress.stage}-${index}`)}
                  <tr><th scope="row" class="break-words">{progress.stage}</th><td class="break-words">{progress.message}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if result}
          <div class="divider my-0">Stored photo evidence</div>
          <div class="overflow-x-auto">
              <table class="table table-sm executive-table min-w-[30rem]">
              <tbody>
                <tr><th scope="row">Evidence id</th><td class="break-words font-mono text-xs">{result.evidenceId}</td></tr>
                <tr><th scope="row">Key</th><td class="break-words font-mono text-xs">{result.key}</td></tr>
                <tr><th scope="row">Recorded size</th><td>{result.size} bytes</td></tr>
                <tr><th scope="row">Disposition</th><td>{result.disposition}</td></tr>
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  </div>

  <section class="section-rule pt-6">
    <div class="flex flex-col gap-5">
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="min-w-0 break-words text-lg font-black tracking-tight">Preview shelf</h2>
          <p class="break-words text-sm text-base-content/70">
            Reload lists stored evidence records; each preview download receives bytes through the transfer grant returned by Evidence.Download.
          </p>
        </div>
        <button class="btn btn-outline btn-sm" onclick={() => refreshGallery(true)} disabled={refreshing}>
          {refreshing ? "Refreshing locker..." : "Refresh locker"}
        </button>
      </div>

      {#if gallery.length === 0}
        <div class="alert"><span>No image evidence is stored in the locker yet.</span></div>
      {:else}
        <div class="grid min-w-0 gap-x-6 gap-y-0 border-y border-base-300/80 md:grid-cols-2 xl:grid-cols-3">
          {#each gallery as item (item.key)}
            <article class="min-w-0 border-b border-base-300/70 py-5 md:pr-4 xl:[&:nth-last-child(-n+3)]:border-b-0">
              <figure class="bg-base-200/45 p-3">
                {#if item.previewUrl}
                  <img class="h-44 w-full rounded object-cover" src={item.previewUrl} alt={item.fileName ?? item.key} />
                {:else}
                  <div class="flex h-44 w-full items-center justify-center rounded border border-dashed border-base-300 text-sm text-base-content/60">
                    Preview download not loaded
                  </div>
                {/if}
              </figure>
              <div class="flex min-w-0 flex-col gap-3 pt-4">
                <div class="min-w-0">
                  <h3 class="break-words font-medium">{item.fileName ?? item.key}</h3>
                  <p class="break-all font-mono text-xs text-base-content/60">{item.key}</p>
                </div>
                <div class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2 text-sm">
                  <span class="text-base-content/60">Size</span><span>{item.size} bytes</span>
                  <span class="text-base-content/60">Content type</span><span class="min-w-0 break-words">{item.contentType ?? "unknown"}</span>
                  <span class="text-base-content/60">Uploaded</span><span class="min-w-0 break-words">{formatDate(item.uploadedAt)}</span>
                  <span class="text-base-content/60">Evidence type</span><span class="min-w-0 break-words">{item.evidenceType}</span>
                </div>
                {#if item.previewError}
                  <div role="alert" class="alert alert-error py-2 text-sm"><span>{item.previewError}</span></div>
                {/if}
                {#if !item.previewUrl}
                  <div class="flex justify-end">
                    <button class="btn btn-outline btn-sm" onclick={() => downloadPreview(item.key)} disabled={item.previewing} aria-label={`Receive preview for ${item.fileName ?? item.key}`}>
                      {item.previewing ? "Receiving..." : "Receive preview"}
                    </button>
                  </div>
                {/if}
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </section>
  </div>
</section>
