<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { getTrellis } from "$lib/trellis-context.ts";

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

  let selectedFile = $derived(files?.item(0) ?? null);
  let payloadBytes = $derived(selectedFile?.size ?? 0);

  onMount(() => {
    void refreshGallery(true);
  });

  onDestroy(() => {
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

    try {
      const evidenceId = crypto.randomUUID();
      const fileName = safeFileName(file.name);
      const key = `evidence/${evidenceId}-${fileName}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await trellis.operation("Evidence.Upload")
        .input({
          key,
          contentType: file.type || "application/octet-stream",
          evidenceType,
          metadata: { evidenceId, evidenceType, fileName: file.name },
        })
        .transfer(bytes)
        .onTransfer((event: TransferEvent) => {
          transferredBytes = event.transfer.transferredBytes;
        })
        .onProgress((event: ProgressEvent) => {
          progressLog = [event.progress, ...progressLog].slice(0, 6);
        })
        .start()
        .orThrow();

      acceptedId = upload.operation.id;
      const completed = await upload.wait().orThrow();
      result = completed.terminal.output ?? null;
      await refreshGallery(true);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      running = false;
    }
  }

  async function refreshGallery(downloadLatest: boolean): Promise<void> {
    refreshing = true;
    error = null;
    clearPreviewUrls();

    try {
      const list = await trellis.request("Evidence.List", { prefix: "evidence/" }).orThrow();
      gallery = list.evidence
        .slice()
        .sort((left, right) => Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt));

      if (downloadLatest) {
        const latestImage = gallery.find((item) => item.contentType?.startsWith("image/"));
        if (latestImage) {
          await downloadPreview(latestImage.key);
        }
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      refreshing = false;
    }
  }

  async function downloadPreview(key: string): Promise<void> {
    const existing = gallery.find((item) => item.key === key);
    if (!existing) {
      return;
    }

    revokePreviewUrl(existing);
    updateGalleryItem(key, { previewUrl: undefined, previewError: undefined, previewing: true });

    try {
      const download = await trellis.request("Evidence.Download", { key }).orThrow();
      const bytes = await trellis.transfer(download.transfer).bytes().orThrow();
      const latest = gallery.find((item) => item.key === key);
      const contentType = latest?.contentType ?? "application/octet-stream";
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      const previewUrl = URL.createObjectURL(new Blob([body], { type: contentType }));
      updateGalleryItem(key, { previewUrl, previewing: false });
    } catch (cause) {
      updateGalleryItem(key, {
        previewError: cause instanceof Error ? cause.message : String(cause),
        previewing: false,
      });
    }
  }
</script>

<svelte:head>
  <title>Evidence Locker · Field Inspection Desk</title>
</svelte:head>

<section class="flex w-full flex-col gap-6">
  <header class="rounded-box border border-base-300 bg-base-100/80 p-4 shadow-sm md:p-5">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div class="space-y-2">
        <div class="badge badge-primary badge-outline">Evidence → Evidence Locker</div>
        <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">Evidence Locker</h1>
        <p class="max-w-3xl text-sm text-base-content/70">
          Upload field photos with a send transfer, then use receive-grant preview downloads to verify stored image evidence.
        </p>
      </div>
      <div class="badge badge-outline badge-lg">Teaching note: transfer operation + receive grant</div>
    </div>
  </header>

  {#if error}
    <div role="alert" class="alert alert-error"><span>{error}</span></div>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <h2 class="card-title text-lg">Photo intake</h2>
        <p class="text-sm text-base-content/70">
          Choose an image captured during inspection. The upload sends the file bytes through Evidence.Upload while metadata records the field-photo evidence type.
        </p>

        <label class="form-control gap-2">
          <span class="label-text font-medium">Image evidence</span>
          <input class="file-input file-input-bordered w-full" type="file" accept="image/*" bind:files />
        </label>

        <div class="flex flex-wrap items-center gap-3">
          <button class="btn btn-primary" onclick={startUpload} disabled={running || selectedFile === null}>
            {running ? "Sending transfer..." : "Upload photo evidence"}
          </button>
          <span class="badge badge-outline">{payloadBytes} bytes</span>
          <span class="badge badge-outline">{evidenceType}</span>
        </div>
      </div>
    </section>

    <section class="card border border-base-300 bg-base-100 shadow-sm">
      <div class="card-body gap-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="card-title text-lg">Send transfer status</h2>
          {#if acceptedId}
            <span class="badge badge-outline font-mono">{acceptedId}</span>
          {/if}
        </div>

        <div class="stats stats-vertical border border-base-300 lg:stats-horizontal">
          <div class="stat px-4 py-3">
            <div class="stat-title">Transferred</div>
            <div class="stat-value text-2xl">{transferredBytes}</div>
            <div class="stat-desc">bytes sent by transfer</div>
          </div>
          <div class="stat px-4 py-3">
            <div class="stat-title">Payload size</div>
            <div class="stat-value text-2xl">{payloadBytes}</div>
            <div class="stat-desc">bytes total</div>
          </div>
        </div>

        {#if progressLog.length === 0}
          <div class="alert"><span>Start a photo upload to see transfer bytes and operation progress.</span></div>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm">
              <thead><tr><th>Stage</th><th>Message</th></tr></thead>
              <tbody>
                {#each progressLog as progress, index (`${progress.stage}-${index}`)}
                  <tr><td>{progress.stage}</td><td>{progress.message}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if result}
          <div class="divider my-0">Stored photo evidence</div>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <tbody>
                <tr><th>Evidence id</th><td class="font-mono text-xs">{result.evidenceId}</td></tr>
                <tr><th>Key</th><td class="font-mono text-xs">{result.key}</td></tr>
                <tr><th>Recorded size</th><td>{result.size} bytes</td></tr>
                <tr><th>Disposition</th><td>{result.disposition}</td></tr>
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </section>
  </div>

  <section class="card border border-base-300 bg-base-100 shadow-sm">
    <div class="card-body gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="card-title text-lg">Preview shelf</h2>
          <p class="text-sm text-base-content/70">
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
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {#each gallery as item (item.key)}
            <article class="card border border-base-300 bg-base-200/40 shadow-sm">
              <figure class="bg-base-200 p-3">
                {#if item.previewUrl}
                  <img class="h-44 w-full rounded object-cover" src={item.previewUrl} alt={item.fileName ?? item.key} />
                {:else}
                  <div class="flex h-44 w-full items-center justify-center rounded border border-dashed border-base-300 text-sm text-base-content/60">
                    Preview download not loaded
                  </div>
                {/if}
              </figure>
              <div class="card-body gap-3 p-4">
                <div>
                  <h3 class="font-medium">{item.fileName ?? item.key}</h3>
                  <p class="break-all font-mono text-xs text-base-content/60">{item.key}</p>
                </div>
                <div class="grid grid-cols-2 gap-2 text-sm">
                  <span class="text-base-content/60">Size</span><span>{item.size} bytes</span>
                  <span class="text-base-content/60">Content type</span><span>{item.contentType ?? "unknown"}</span>
                  <span class="text-base-content/60">Uploaded</span><span>{formatDate(item.uploadedAt)}</span>
                  <span class="text-base-content/60">Evidence type</span><span>{item.evidenceType}</span>
                </div>
                {#if item.previewError}
                  <div role="alert" class="alert alert-error py-2 text-sm"><span>{item.previewError}</span></div>
                {/if}
                {#if !item.previewUrl}
                  <div class="card-actions justify-end">
                    <button class="btn btn-outline btn-sm" onclick={() => downloadPreview(item.key)} disabled={item.previewing}>
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
</section>
