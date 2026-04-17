# Working With Staged Uploaded Files

Services often use `Files.InitiateUpload` plus `trellis.transfer(grant).put(...)` to land uploaded bytes in a service-owned `resources.store` bucket.

After the upload completes, the next step is store access, not a second transfer helper.

Use `waitFor(...)` when the service wants to block until the staged object appears, then use the normal store entry APIs it already knows.

For transfer sessions started by the owning service itself, prefer `service.transfer.initiateUpload({ onStored(...) })` when you want a per-session callback as soon as the staged object is durably available. `waitFor(...)` remains the lower-level store primitive and is still useful when bytes arrive through another path or when service code only has the store handle.

Prefer `stream()` for larger files. Use `bytes()` only when buffering the full object in memory is actually what you want.

## Example

```ts
const grant = await service.transfer.initiateUpload({
  sessionKey: context.sessionKey,
  store: "uploads",
  key: input.key,
  expiresInMs: 60_000,
});

if (grant.isErr()) {
  return err(grant.error);
}

queueMicrotask(async () => {
  const opened = await service.store.uploads.open();
  const store = opened.take();
  if (isErr(store)) {
    console.error("upload store open failed", store.error);
    return;
  }

  const staged = await store.waitFor(input.key, {
    timeoutMs: 10_000,
    pollIntervalMs: 250,
  });
  if (staged.isErr()) {
    console.error("upload wait failed", staged.error);
    return;
  }

  const entry = staged.unwrapOrElse(() => {
    throw new Error("staged upload unexpectedly missing");
  });
  const body = await entry.stream();
  if (body.isErr()) {
    console.error("upload stream failed", body.error);
    return;
  }

  await writeStoreStreamToPath(
    "/tmp/upload.bin",
    body.unwrapOrElse(() => {
      throw new Error("uploaded stream unexpectedly missing");
    }),
  );

  const deleted = await store.delete(input.key);
  if (deleted.isErr()) {
    console.warn("upload cleanup failed", deleted.error);
  }
});
```

```ts
async function writeStoreStreamToPath(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
  const file = await Deno.open(path, { create: true, truncate: true, write: true });
  const reader = stream.getReader();

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return;
      }
      await file.write(next.value);
    }
  } finally {
    reader.releaseLock();
    file.close();
  }
}
```

## Notes

- `StoreHandle.waitFor(...)` is the convenience entrypoint when the service has only the bound store handle.
- `TypedStore.waitFor(...)` is the lower-level primitive when the caller already has an opened store and wants to keep using it for `delete(...)`, `list(...)`, or other operations.
- `waitFor(...)` does not read, move, or delete the uploaded bytes for the caller. It only waits until the object exists and returns a normal `TypedStoreEntry`.
