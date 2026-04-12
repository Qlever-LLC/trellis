import { assertEquals, assertExists } from "@std/assert";

import { NatsTest } from "./testing/nats.ts";
import {
  type StoreInfo,
  type StorePutOptions,
  type StoreStatus,
  TypedStore,
} from "./store.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value.length > 0) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

Deno.test("Store public types compile", () => {
  const _putOptions: StorePutOptions = {
    contentType: "application/pdf",
    metadata: { source: "portal" },
  };

  const _info: StoreInfo = {
    key: "incoming/test.pdf",
    size: 123,
    updatedAt: new Date().toISOString(),
    digest: "sha256:test",
    contentType: "application/pdf",
    metadata: { source: "portal" },
  };

  const _status: StoreStatus = {
    size: 123,
    sealed: false,
    ttlMs: 60_000,
    maxObjectBytes: 1024,
    maxTotalBytes: 4096,
  };

  assertEquals(true, true);
});

Deno.test({
  name: "TypedStore basic object lifecycle",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const opened = await TypedStore.open(nats.nc, "typed-store-test", {
      ttlMs: 60_000,
      maxObjectBytes: 1024,
      maxTotalBytes: 4096,
    });
    assertEquals(opened.isOk(), true);
    const store = opened.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertExists(store);

    const created = await store.create("incoming/test.txt", encode("hello"), {
      contentType: "text/plain",
      metadata: { source: "test" },
    });
    assertEquals(created.isOk(), true);

    const duplicate = await store.create("incoming/test.txt", encode("nope"));
    assertEquals(duplicate.isErr(), true);

    const entryResult = await store.get("incoming/test.txt");
    assertEquals(entryResult.isOk(), true);
    const entry = entryResult.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertEquals(entry.info.key, "incoming/test.txt");
    assertEquals(entry.info.contentType, "text/plain");
    assertEquals(entry.info.metadata.source, "test");

    const bytesResult = await entry.bytes();
    assertEquals(bytesResult.isOk(), true);
    const bodyBytes = bytesResult.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertEquals(decode(bodyBytes), "hello");

    const streamResult = await entry.stream();
    assertEquals(streamResult.isOk(), true);
    const bodyStream = streamResult.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertEquals(decode(await readAll(bodyStream)), "hello");

    const replaced = await store.put("incoming/test.txt", encode("updated"), {
      contentType: "text/plain",
      metadata: { source: "test", revision: "2" },
    });
    assertEquals(replaced.isOk(), true);

    const listedResult = await store.list("incoming/");
    assertEquals(listedResult.isOk(), true);
    const listedIterator = listedResult.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    const listed: StoreInfo[] = [];
    for await (const info of listedIterator) {
      listed.push(info);
    }
    assertEquals(listed.length, 1);
    assertEquals(listed[0]?.key, "incoming/test.txt");
    assertEquals(listed[0]?.metadata.revision, "2");

    const statusResult = await store.status();
    assertEquals(statusResult.isOk(), true);
    const status = statusResult.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertEquals(status.ttlMs, 60_000);
    assertEquals(status.maxObjectBytes, 1024);
    assertEquals(status.maxTotalBytes, 4096);

    const deleted = await store.delete("incoming/test.txt");
    assertEquals(deleted.isOk(), true);

    const missing = await store.get("incoming/test.txt");
    assertEquals(missing.isErr(), true);
  },
});
