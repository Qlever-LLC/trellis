# Transfer-Backed File Processing Workflows

Use this pattern when a caller uploads a file, the service processes it asynchronously, the UI needs live progress, and the service owns the final result.

The recommended service shape is:

1. start RPC returns `{ transfer, operation }`
2. `onStored(...)` acknowledges that bytes landed and enqueues a service-private job
3. a worker processes the staged object and drives operation progress and completion

## Shape

1. A contract-owned RPC creates an operation and an upload transfer grant.
2. The RPC returns both values.
3. The client resumes the operation ref and starts watching it.
4. The client uploads the bytes with `trellis.transfer(grant).put(...)`.
5. The service's `onStored(...)` callback updates the operation and usually enqueues or starts processing work.

## Start RPC

```ts
let op;
const grant = await service.transfer.initiateUpload({
  sessionKey: context.sessionKey,
  store: "uploads",
  key: input.key,
  expiresInMs: 60_000,
  onStored: async ({ entry, info, store }) => {
    const started = await op.started();
    if (started.isErr()) {
      return;
    }

    await op.progress({
      stage: "stored",
      message: `Stored ${info.size} bytes`,
    });

    const queued = await op.progress({
      stage: "queued",
      message: "Queueing file processing work",
    });
    if (queued.isErr()) {
      await op.fail(queued.error);
      return;
    }

    const created = await jobs.fileProcess.create({
      operationId: op.ref.id,
      key: info.key,
    });
    if (created.isErr()) {
      await op.fail(created.error);
    }
  },
});

if (grant.isErr()) {
  return err(grant.error);
}

const accepted = await service.operation("Documents.Files.Process").accept({
  sessionKey: context.sessionKey,
});
if (accepted.isErr()) {
  return err(accepted.error);
}
op = accepted.value;

return ok({
  transfer: grant.value,
  operation: {
    ref: op.ref,
    snapshot: op.snapshot,
  },
});
```

## Worker

```ts
await jobs.startWorkers();

// Inside the queue handler:
const payload = job.job().payload;
const reading = await service.operations.progress(payload.operationId, {
  stage: "reading",
  message: `Reading ${payload.key}`,
});
if (reading.isErr()) {
  throw reading.error;
}

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
```

## Client pattern

```ts
const started = await client.request("Documents.Files.Process.Start", {
  key: "incoming/report.pdf",
});
if (started.isErr()) {
  throw started.error;
}

const op = client.operation("Documents.Files.Process").resume(
  started.value.operation.ref,
);
const watch = await op.watch();
if (watch.isErr()) {
  throw watch.error;
}

void (async () => {
  for await (const event of watch.value) {
    console.log(event.snapshot.state, event.snapshot.progress);
  }
})();

await client.transfer(started.value.transfer).put(fileBytes);
```

## Guidance

- Treat transfer success as `bytes stored`, not `processing finished`.
- Treat the operation as the caller-visible workflow state.
- Use `onStored(...)` to bridge from transfer runtime to service-owned work.
- If the processing should retry or outlive the current process, `onStored(...)` should enqueue a service-private job rather than doing all work inline.
- Trellis does not yet expose a rollback helper for partially created transfer sessions or accepted operations, so keep the RPC-side setup small and fail fast before returning the start response.
