# Working With Staged Send Transfers

Services stage caller-sent bytes through `direction: "send"` transfer-capable operations rather than standalone initiation RPCs. Product docs can call this an upload, but platform API examples should use transfer/send language where practical.

After `transfer.completed()` resolves, the next step is normal store access, not a second transfer helper.

## Example

```ts
await service.operation("Documents.Files.Upload").handle(async ({ input, transfer }) => {
  const transferred = await transfer.completed();
  if (transferred.isErr()) {
    return err(transferred.error);
  }

  const opened = await service.store.uploads.open();
  const store = opened.take();
  if (isErr(store)) {
    return err(store.error);
  }

  const staged = await store.get(input.key);
  const entry = staged.take();
  if (isErr(entry)) {
    return err(entry.error);
  }

  const body = await entry.stream();
  const stream = body.take();
  if (isErr(stream)) {
    return err(stream.error);
  }

  await writeStoreStreamToPath("/tmp/upload.bin", stream);

  const deleted = await store.delete(input.key);
  if (deleted.isErr()) {
    console.warn("upload cleanup failed", deleted.error);
  }

  return {
    key: input.key,
    size: entry.info.size,
    tempFilePath: "/tmp/upload.bin",
  };
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

- `transfer.completed()` means the staged object is durably available in the owning service store.
- `StoreHandle.get(...)`, `waitFor(...)`, `stream()`, `bytes()`, and `delete(...)` remain the normal post-transfer primitives.
- Prefer `stream()` for larger files. Use `bytes()` only when buffering the full object is actually what you want.
- Do not hand callers a store binding for later download. If the service needs to let a caller receive stored bytes, expose a contract-owned RPC that returns a `direction: "receive"` transfer grant and have the caller use `trellis.transfer(grant).stream()` or `.bytes()`.
