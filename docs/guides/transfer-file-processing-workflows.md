# Transfer-Backed File Processing Workflows

Use this pattern when a caller transfers a file into a service-owned store, the service processes it asynchronously, and both sides need live chunk progress.

## Shape

1. A contract-owned operation declares transfer support.
2. The caller starts the operation with JSON input.
3. The caller watches the operation and sends bytes with `op.transfer(body | stream)`.
4. The runtime emits per-chunk transfer updates to both caller and provider.
5. The provider awaits `transfer.completed()` and then performs normal service-owned processing.

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
  const providerUpdates = (async () => {
    for await (const update of transfer.updates()) {
      console.log("provider transfer", update.transferredBytes);
    }
  })();

  const transferred = await transfer.completed();
  if (transferred.isErr()) {
    return err(transferred.error);
  }

  await providerUpdates;

  const stored = await op.progress({
    stage: "stored",
    message: `Stored ${transferred.value.size} bytes`,
  });
  if (stored.isErr()) {
    return err(stored.error);
  }

  const store = (await service.store.uploads.open()).take();
  const entry = (await store.get(input.key)).take();
  const stream = (await entry.stream()).take();

  await writeStoreStreamToPath("/tmp/output.bin", stream);
  await store.delete(input.key);

  return {
    key: input.key,
    size: entry.info.size,
    tempFilePath: "/tmp/output.bin",
  };
});
```

## Client

```ts
const started = await client.operation("Documents.Files.Upload").start({
  key: "incoming/report.pdf",
  contentType: "application/pdf",
});
if (started.isErr()) {
  throw started.error;
}

const op = started.value;
const watch = await op.watch();
if (watch.isErr()) {
  throw watch.error;
}

void (async () => {
  for await (const event of watch.value) {
    if (event.type === "transfer") {
      console.log("caller transfer", event.transfer.transferredBytes);
    }
  }
})();

const transferred = await op.transfer(fileBytes);
if (transferred.isErr()) {
  throw transferred.error;
}

const terminal = await op.wait();
if (terminal.isErr()) {
  throw terminal.error;
}
```

## Guidance

- Treat transfer success as `bytes stored`, not `workflow completed`.
- Use runtime-owned transfer events for progress bars; use business `progress(...)` for domain milestones.
- Use `transfer.completed()` as the bridge from transport to service-owned store processing.
- If follow-up work should retry or outlive the current process, enqueue a service-private job after `transfer.completed()`.
