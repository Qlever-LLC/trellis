# Transfer-Backed File Processing Workflows

Use this pattern when a caller transfers a file into a service-owned store, the service processes it asynchronously, and both sides need live chunk progress.

## Shape

1. A contract-owned operation declares transfer support.
2. The caller configures the operation with `input(...)`, adds `transfer(body)`, and starts it.
3. The runtime sends bytes, emits typed transfer and progress callbacks, and exposes `wait()` for terminal completion.
4. The runtime emits per-chunk transfer updates to both caller and provider.
5. The provider awaits `transfer.completed()` and then performs normal service-owned processing or enqueues a job.

## Contract

```ts
operations: {
  "Documents.Files.Upload": {
    version: "v1",
    input: ref.schema("FilesUploadRequest"),
    progress: ref.schema("FilesUploadProgress"),
    output: ref.schema("FilesUploadResult"),
    transfer: {
      store: "uploads",
      key: "/key",
      contentType: "/contentType",
      expiresInMs: 60_000,
    },
    capabilities: {
      call: ["uploader"],
      read: ["uploader"],
    },
  },
}
```

## Service

```ts
await service.operation("Documents.Files.Upload").handle(async ({ input, op, transfer }) => {
  const transferred = await transfer.completed();
  if (transferred.isErr()) {
    return err(transferred.error);
  }

  const stored = await op.progress({
    stage: "stored",
    message: `Stored ${transferred.value.size} bytes`,
  });
  if (stored.isErr()) {
    return err(stored.error);
  }

  const job = await uploadJobs.create("processUpload", {
    operationId: op.id,
    key: input.key,
  });
  return await op.attach(job);
});

await workerHost("processUpload", async (job) => {
  const payload = job.payload;
  const store = (await service.store.uploads.open()).take();
  const entry = (await store.get(payload.key)).take();
  const stream = (await entry.stream()).take();

  await writeStoreStreamToPath("/tmp/output.bin", stream);
  await store.delete(payload.key);

  await service.operations.complete(payload.operationId, {
    key: payload.key,
    size: entry.info.size,
    tempFilePath: "/tmp/output.bin",
  });
});
```

## Client

```ts
const upload = await client.operation("Documents.Files.Upload")
  .input({
    key: "incoming/report.pdf",
    contentType: "application/pdf",
  })
  .transfer(fileBytes)
  .onTransfer((event) => {
    console.log("caller transfer", event.transfer.transferredBytes);
  })
  .onProgress((event) => {
    console.log(event.progress.stage, event.progress.message);
  })
  .start()
  .orThrow();

const completed = await upload.wait().orThrow();
```

## Guidance

- Treat transfer success as `bytes stored`, not `workflow completed`.
- Use fluent transfer builder callbacks or runtime-owned transfer events for progress bars; use business `progress(...)` for domain milestones.
- Use `transfer.completed()` as the bridge from transport to service-owned store processing.
- If follow-up work should retry or outlive the current process, enqueue a service-private job after `transfer.completed()`.
