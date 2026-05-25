import { defineServiceContract, ok, TypedKVEntry } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  ResourceExerciseInput: Type.Object({
    key: Type.String(),
    message: Type.String(),
  }),
  ResourceExerciseOutput: Type.Object({
    provider: Type.String(),
    storeText: Type.String(),
    kvMessage: Type.String(),
  }),
  ResourceRecord: Type.Object({ message: Type.String() }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.resources@v1",
  displayName: "Trellis Integration Harness Resources",
  description:
    "Harness-owned service contract for service-bound resource lifecycle verification.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
    },
  },
  resources: {
    kv: {
      records: {
        purpose: "Store harness resource lifecycle records",
        schema: ref.schema("ResourceRecord"),
        required: true,
        history: 1,
        ttlMs: 0,
      },
      optionalRecords: {
        purpose: "Store optional harness resource lifecycle records",
        schema: ref.schema("ResourceRecord"),
        required: false,
        history: 1,
        ttlMs: 0,
      },
    },
    store: {
      blobs: {
        purpose: "Store harness resource lifecycle blobs",
        required: true,
        ttlMs: 0,
        maxObjectBytes: 1048576,
        maxTotalBytes: 4194304,
      },
      optionalBlobs: {
        purpose: "Store optional harness resource lifecycle blobs",
        required: false,
        ttlMs: 0,
        maxObjectBytes: 1048576,
        maxTotalBytes: 4194304,
      },
    },
  },
  rpc: {
    "Harness.Rust.Resources": {
      version: "v1",
      subject: "rpc.v1.Harness.Rust.Resources",
      input: ref.schema("ResourceExerciseInput"),
      output: ref.schema("ResourceExerciseOutput"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
    "Harness.Ts.Resources": {
      version: "v1",
      subject: "rpc.v1.Harness.Ts.Resources",
      input: ref.schema("ResourceExerciseInput"),
      output: ref.schema("ResourceExerciseOutput"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  name: "harness-resources-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: undefined },
}).orThrow();

if (service.kv.optionalRecords !== undefined) {
  throw new Error("optionalRecords KV binding should be absent");
}
if ("optionalBlobs" in service.store) {
  throw new Error("optionalBlobs store binding should be absent");
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    totalLength += next.value.length;
  }
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function waitForCondition(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 5000) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

await service.handle.rpc.harness.tsResources(
  async ({ input, client }) => {
    const store = await client.store.blobs.open().orThrow();
    const storeKey = `${input.key}.ts.store`;
    const typedWaitKey = `${input.key}.ts.typed-wait`;
    const delayedWaitKey = `${input.key}.ts.delayed-wait`;
    const storeText = `ts-store:${input.message}`;
    await store.create(storeKey, encoder.encode(storeText), {
      contentType: "text/plain",
    }).orThrow();
    const duplicate = await store.create(storeKey, encoder.encode("duplicate"));
    if (duplicate.isOk()) {
      throw new Error(
        `store create unexpectedly overwrote ${storeKey}`,
      );
    }
    const handleEntry = await client.store.blobs.waitFor(storeKey, {
      timeoutMs: 5000,
      pollIntervalMs: 25,
    }).orThrow();
    if (handleEntry.info.contentType !== "text/plain") {
      throw new Error(
        `store content type did not round-trip for ${storeKey}`,
      );
    }
    const readText = decoder.decode(await handleEntry.bytes().orThrow());
    const streamText = decoder.decode(
      await readAll(await handleEntry.stream().orThrow()),
    );
    if (streamText !== readText) {
      throw new Error(
        `store stream returned ${streamText} instead of ${readText}`,
      );
    }
    await store.put(typedWaitKey, encoder.encode("typed-wait"), {
      contentType: "text/plain",
    }).orThrow();
    await store.waitFor(typedWaitKey, { timeoutMs: 5000, pollIntervalMs: 25 })
      .orThrow();
    const delayedWait = store.waitFor(delayedWaitKey, {
      timeoutMs: 5000,
      pollIntervalMs: 25,
    }).orThrow();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await store.put(delayedWaitKey, encoder.encode("delayed"), {
      contentType: "text/plain",
      metadata: { source: "harness" },
    }).orThrow();
    const delayedEntry = await delayedWait;
    if (delayedEntry.info.metadata.source !== "harness") {
      throw new Error(
        `store metadata did not round-trip for ${delayedWaitKey}`,
      );
    }
    if (decoder.decode(await delayedEntry.bytes().orThrow()) !== "delayed") {
      throw new Error(
        `delayed wait returned unexpected bytes for ${delayedWaitKey}`,
      );
    }
    const typedTimeout = await store.waitFor(`${input.key}.ts.typed-timeout`, {
      timeoutMs: 25,
      pollIntervalMs: 5,
    });
    if (typedTimeout.isOk()) {
      throw new Error(
        "TypedStore.waitFor unexpectedly succeeded for missing object",
      );
    }
    if (typedTimeout.error.getContext().reason !== "timeout") {
      throw new Error(
        `TypedStore.waitFor returned unexpected timeout context: ${
          JSON.stringify(typedTimeout.error.getContext())
        }`,
      );
    }
    const typedAbortController = new AbortController();
    const typedAborted = store.waitFor(`${input.key}.ts.typed-abort`, {
      signal: typedAbortController.signal,
      pollIntervalMs: 5000,
    });
    typedAbortController.abort("cancelled");
    const typedAbortResult = await typedAborted;
    if (typedAbortResult.isOk()) {
      throw new Error(
        "TypedStore.waitFor unexpectedly succeeded after abort",
      );
    }
    if (typedAbortResult.error.getContext().reason !== "aborted") {
      throw new Error(
        `TypedStore.waitFor returned unexpected abort context: ${
          JSON.stringify(typedAbortResult.error.getContext())
        }`,
      );
    }
    const handleAbortController = new AbortController();
    const handleAborted = client.store.blobs.waitFor(
      `${input.key}.ts.handle-abort`,
      { signal: handleAbortController.signal, pollIntervalMs: 5000 },
    );
    handleAbortController.abort("cancelled");
    const handleAbortResult = await handleAborted;
    if (handleAbortResult.isOk()) {
      throw new Error(
        "StoreHandle.waitFor unexpectedly succeeded after abort",
      );
    }
    if (handleAbortResult.error.getContext().reason !== "aborted") {
      throw new Error(
        `StoreHandle.waitFor returned unexpected abort context: ${
          JSON.stringify(handleAbortResult.error.getContext())
        }`,
      );
    }
    const status = await store.status().orThrow();
    if (status.ttlMs !== 0 || status.maxTotalBytes !== 4194304) {
      throw new Error(
        `store status did not include configured limits: ${
          JSON.stringify(status)
        }`,
      );
    }
    const listed = await store.list({ prefix: input.key, limit: 10 }).orThrow();
    if (
      !listed.entries.some((entry) => entry.key === storeKey)
    ) throw new Error(`store list did not include ${storeKey}`);
    await store.delete(storeKey).orThrow();
    await store.delete(typedWaitKey).orThrow();
    await store.delete(delayedWaitKey).orThrow();
    const missing = await store.get(storeKey);
    if (missing.isOk()) {
      throw new Error(
        `store get unexpectedly found deleted object ${storeKey}`,
      );
    }
    if (missing.error.getContext().reason !== "not_found") {
      throw new Error(
        `store get returned unexpected missing context: ${
          JSON.stringify(missing.error.getContext())
        }`,
      );
    }

    const kvKey = `${input.key}.ts.kv`;
    await client.kv.records.create(kvKey, { message: input.message })
      .orThrow();
    await client.kv.records.put(kvKey, { message: `ts-kv:${input.message}` })
      .orThrow();
    const entry = await client.kv.records.get(kvKey).orThrow();
    const updateEvents: Array<{ type: string; value?: { message: string } }> =
      [];
    const unsubscribeUpdates = await entry.watch((event) => {
      updateEvents.push(event);
    }, { includeDeletes: true });
    await entry.put({ message: `ts-kv-watch:${input.message}` }).orThrow();
    await waitForCondition(
      () =>
        updateEvents.some((event) =>
          event.type === "update" &&
          event.value?.message === `ts-kv-watch:${input.message}`
        ),
      "typed KV update watch event",
    );
    await entry.delete().orThrow();
    await waitForCondition(
      () => updateEvents.some((event) => event.type === "delete"),
      "typed KV delete watch event",
    );
    const eventsBeforeUnsubscribe = updateEvents.length;
    unsubscribeUpdates();
    await client.kv.records.put(kvKey, { message: "after-unsubscribe" })
      .orThrow();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (updateEvents.length !== eventsBeforeUnsubscribe) {
      throw new Error("TypedKVEntry.watch emitted after unsubscribe");
    }

    const invalidGetKey = `${input.key}.ts.invalid-get`;
    await client.kv.records.kv.put(
      invalidGetKey,
      JSON.stringify({ missing: "message" }),
    );
    const invalidGet = await client.kv.records.get(invalidGetKey);
    if (invalidGet.isOk()) {
      throw new Error("TypedKV.get unexpectedly accepted invalid raw entry");
    }
    if (!(await client.kv.records.kv.get(invalidGetKey))) {
      throw new Error("TypedKV.get removed invalid raw entry");
    }

    const invalidCreateKey = `${input.key}.ts.invalid-create`;
    await client.kv.records.kv.put(
      invalidCreateKey,
      JSON.stringify({ missing: "message" }),
    );
    const invalidRawEntry = await client.kv.records.kv.get(invalidCreateKey);
    if (!invalidRawEntry) {
      throw new Error("raw invalid create entry was not written");
    }
    const invalidCreate = await TypedKVEntry.create(
      schemas.ResourceRecord,
      client.kv.records.kv,
      invalidRawEntry,
    );
    if (invalidCreate.isOk()) {
      throw new Error(
        "TypedKVEntry.create unexpectedly accepted invalid raw entry",
      );
    }
    if (!(await client.kv.records.kv.get(invalidCreateKey))) {
      throw new Error("TypedKVEntry.create removed invalid raw entry");
    }

    const invalidWatchKey = `${input.key}.ts.invalid-watch`;
    await client.kv.records.create(invalidWatchKey, { message: "valid" })
      .orThrow();
    const invalidWatchEntry = await client.kv.records.get(invalidWatchKey)
      .orThrow();
    const invalidEvents: Array<{ type: string }> = [];
    const unsubscribeInvalid = await invalidWatchEntry.watch((event) => {
      invalidEvents.push(event);
    }, { includeDeletes: true });
    await client.kv.records.kv.put(
      invalidWatchKey,
      JSON.stringify({ missing: "message" }),
    );
    await waitForCondition(
      () => invalidEvents.some((event) => event.type === "error"),
      "typed KV invalid watch event",
    );
    if (!(await client.kv.records.kv.get(invalidWatchKey))) {
      throw new Error("TypedKV.watch removed invalid raw entry");
    }
    unsubscribeInvalid();

    const staleCasKey = `${input.key}.ts.cas-stale`;
    await client.kv.records.create(staleCasKey, { message: "initial" })
      .orThrow();
    const staleCasEntry = await client.kv.records.get(staleCasKey).orThrow();
    await client.kv.records.put(staleCasKey, { message: "updated" }).orThrow();
    const staleDelete = await staleCasEntry.delete(true);
    if (staleDelete.isOk()) {
      throw new Error(
        "TypedKVEntry.delete(vcc) unexpectedly succeeded with stale revision",
      );
    }

    const casKey = `${input.key}.ts.cas-delete`;
    await client.kv.records.create(casKey, { message: "initial" }).orThrow();
    const casEntry = await client.kv.records.get(casKey).orThrow();
    await casEntry.delete(true).orThrow();
    const secondCasDelete = await casEntry.delete(true);
    if (secondCasDelete.isOk()) {
      throw new Error(
        "TypedKVEntry.delete(vcc) unexpectedly reused stale delete revision",
      );
    }

    let foundKey = false;
    for await (
      const key of await client.kv.records.keys(`${input.key}.>`).orThrow()
    ) {
      if (key === kvKey) foundKey = true;
    }
    if (!foundKey) throw new Error(`kv keys did not include ${kvKey}`);
    await client.kv.records.delete(kvKey).orThrow();
    await client.kv.records.delete(invalidGetKey).orThrow();
    await client.kv.records.delete(invalidCreateKey).orThrow();
    await client.kv.records.delete(invalidWatchKey).orThrow();
    await client.kv.records.delete(staleCasKey).orThrow();

    return ok({
      provider: "ts",
      storeText: readText,
      kvMessage: entry.value.message,
    });
  },
);

console.log("TS_RESOURCES_SERVICE_READY");
await new Promise<void>(() => {});
