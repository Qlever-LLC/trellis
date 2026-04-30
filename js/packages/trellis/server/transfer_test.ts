import { assertEquals } from "@std/assert";
import {
  type Msg,
  type NatsConnection,
  type Payload,
  type Subscription,
} from "@nats-io/nats-core";
import { AsyncResult, Result } from "@qlever-llc/result";

import { createAuth } from "../auth.ts";
import { NatsTest } from "../testing/nats.ts";
import {
  type StoreBody,
  type StorePutOptions,
  type StoreStatus,
  TypedStore,
  TypedStoreEntry,
} from "../store.ts";
import type { StoreError } from "../errors/StoreError.ts";
import { createTransferHandle } from "../transfer.ts";
import { ServiceTransfer } from "./transfer.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

const SERVICE_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const USER_SEED = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createFakeNatsConnection(
  flush: () => Promise<void>,
  events: string[] = [],
): NatsConnection {
  const status = (() =>
    (async function* () {
      return;
    })()) as NatsConnection["status"];

  let closed = false;
  let pendingResolve: (() => void) | undefined;
  const closeSubscription = () => {
    closed = true;
    pendingResolve?.();
    pendingResolve = undefined;
  };
  const subscription: Subscription = {
    closed: Promise.resolve(),
    unsubscribe: closeSubscription,
    drain: async () => closeSubscription(),
    isDraining: () => false,
    isClosed: () => closed,
    callback: () => {},
    getSubject: () => "transfer.test",
    getReceived: () => 0,
    getProcessed: () => 0,
    getPending: () => 0,
    getID: () => 1,
    getMax: () => undefined,
    [Symbol.asyncIterator]: async function* () {
      while (!closed) {
        await new Promise<void>((resolve) => {
          pendingResolve = resolve;
        });
      }
    },
  };

  const createMessage = (subject: string): Msg => ({
    subject,
    sid: 1,
    data: new Uint8Array(),
    respond: () => true,
    json: <T>() => ({}) as T,
    string: () => "",
  });

  return {
    info: undefined,
    closed: async () => {},
    close: async () => {},
    publish: (_subject: string, _data?: Payload) => {},
    publishMessage: () => {},
    respondMessage: () => true,
    subscribe: () => {
      events.push("subscribe");
      return subscription;
    },
    request: async (subject: string) => createMessage(subject),
    requestMany: async () =>
      (async function* () {
        return;
      })(),
    flush: async () => {
      events.push("flush");
      await flush();
    },
    drain: async () => {},
    isClosed: () => false,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    status,
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
  };
}

function createFakeStore(): TypedStore {
  const info = {
    key: "incoming/test.txt",
    size: 14,
    updatedAt: new Date(0).toISOString(),
    metadata: {},
  };
  const entry: TypedStoreEntry = Object.assign(
    Object.create(TypedStoreEntry.prototype),
    { key: info.key, info },
  );
  const status: StoreStatus = {
    size: 0,
    sealed: false,
    ttlMs: 0,
    maxObjectBytes: 1024,
  };

  return Object.assign(Object.create(TypedStore.prototype), {
    get: (_key: string) => AsyncResult.from(Promise.resolve(Result.ok(entry))),
    put: (_key: string, _body: StoreBody, _options?: StorePutOptions) =>
      AsyncResult.from(Promise.resolve(Result.ok(undefined))),
    status: () => AsyncResult.from(Promise.resolve(Result.ok(status))),
  });
}

function createFakeStoreHandle() {
  const store = createFakeStore();
  return {
    open: (): AsyncResult<TypedStore, StoreError> =>
      AsyncResult.from(Promise.resolve(Result.ok(store))),
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not met");
}

Deno.test("ServiceTransfer initiateDownload waits for subscription readiness", async () => {
  const serviceAuth = await createAuth({ sessionKeySeed: SERVICE_SEED });
  const userAuth = await createAuth({ sessionKeySeed: USER_SEED });
  const flushed = deferred<void>();
  let flushCalls = 0;
  let settled = false;
  const events: string[] = [];
  const transfer = new ServiceTransfer({
    name: "files-service",
    nc: createFakeNatsConnection(async () => {
      flushCalls += 1;
      await flushed.promise;
    }, events),
    auth: serviceAuth,
    stores: { uploads: createFakeStoreHandle() },
  });

  const resultPromise = transfer.initiateDownload({
    sessionKey: userAuth.sessionKey,
    store: "uploads",
    key: "incoming/test.txt",
    expiresInMs: 60_000,
  }).then((result) => {
    settled = true;
    return result;
  });

  await waitUntil(() => flushCalls === 1);
  assertEquals(events, ["subscribe", "flush"]);
  assertEquals(settled, false);
  flushed.resolve();
  const result = await resultPromise;
  assertEquals(result.isOk(), true);

  await transfer.stop();
});

Deno.test("ServiceTransfer initiateUpload waits for subscription readiness", async () => {
  const serviceAuth = await createAuth({ sessionKeySeed: SERVICE_SEED });
  const userAuth = await createAuth({ sessionKeySeed: USER_SEED });
  const flushed = deferred<void>();
  let flushCalls = 0;
  let settled = false;
  const events: string[] = [];
  const transfer = new ServiceTransfer({
    name: "files-service",
    nc: createFakeNatsConnection(async () => {
      flushCalls += 1;
      await flushed.promise;
    }, events),
    auth: serviceAuth,
    stores: { uploads: createFakeStoreHandle() },
  });

  const resultPromise = transfer.initiateUpload({
    sessionKey: userAuth.sessionKey,
    store: "uploads",
    key: "incoming/test.txt",
    expiresInMs: 60_000,
  }).then((result) => {
    settled = true;
    return result;
  });

  await waitUntil(() => flushCalls === 1);
  assertEquals(events, ["subscribe", "flush"]);
  assertEquals(settled, false);
  flushed.resolve();
  const result = await resultPromise;
  assertEquals(result.isOk(), true);

  await transfer.stop();
});

Deno.test({
  name:
    "ServiceTransfer issues grants and round-trips bytes through store-backed sessions",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const storeResult = await TypedStore.open(
      nats.nc,
      "service-transfer-test",
      {
        ttlMs: 60_000,
        maxObjectBytes: 1024 * 1024,
        maxTotalBytes: 4 * 1024 * 1024,
      },
    );
    assertEquals(storeResult.isOk(), true);

    const serviceAuth = await createAuth({ sessionKeySeed: SERVICE_SEED });
    const userAuth = await createAuth({ sessionKeySeed: USER_SEED });

    const transfer = new ServiceTransfer({
      name: "files-service",
      nc: nats.nc,
      auth: serviceAuth,
      stores: {
        uploads: {
          open: () =>
            TypedStore.open(nats.nc, "service-transfer-test", {
              ttlMs: 60_000,
              maxObjectBytes: 1024 * 1024,
              maxTotalBytes: 4 * 1024 * 1024,
              bindOnly: true,
            }),
        },
      },
    });

    const uploadGrant = await transfer.initiateUpload({
      sessionKey: userAuth.sessionKey,
      store: "uploads",
      key: "incoming/test.txt",
      expiresInMs: 60_000,
      maxBytes: 1024,
      contentType: "text/plain",
      metadata: { source: "test" },
    });
    assertEquals(uploadGrant.isOk(), true);
    const uploadGrantValue = uploadGrant.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    assertEquals(uploadGrantValue.direction, "send");
    const uploaded = await createTransferHandle(
      nats.nc,
      userAuth,
      3000,
      uploadGrantValue,
    ).send(encode("hello transfer"));
    assertEquals(uploaded.isOk(), true);

    const downloadGrant = await transfer.initiateDownload({
      sessionKey: userAuth.sessionKey,
      store: "uploads",
      key: "incoming/test.txt",
      expiresInMs: 60_000,
    });
    assertEquals(downloadGrant.isOk(), true);
    const downloadGrantValue = downloadGrant.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    assertEquals(downloadGrantValue.direction, "receive");
    const downloaded = await createTransferHandle(
      nats.nc,
      userAuth,
      3000,
      downloadGrantValue,
    ).bytes();
    assertEquals(downloaded.isOk(), true);
    const downloadedValue = downloaded.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertEquals(decode(downloadedValue), "hello transfer");

    await transfer.stop();
  },
});

Deno.test({
  name: "ServiceTransfer derives upload maxBytes from the backing store limit",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const storeResult = await TypedStore.open(
      nats.nc,
      "service-transfer-max-bytes-test",
      {
        ttlMs: 60_000,
        maxObjectBytes: 1024,
        maxTotalBytes: 4 * 1024 * 1024,
      },
    );
    assertEquals(storeResult.isOk(), true);

    const serviceAuth = await createAuth({ sessionKeySeed: SERVICE_SEED });
    const userAuth = await createAuth({ sessionKeySeed: USER_SEED });

    const transfer = new ServiceTransfer({
      name: "files-service",
      nc: nats.nc,
      auth: serviceAuth,
      stores: {
        uploads: {
          open: () =>
            TypedStore.open(nats.nc, "service-transfer-max-bytes-test", {
              ttlMs: 60_000,
              maxObjectBytes: 1024,
              maxTotalBytes: 4 * 1024 * 1024,
              bindOnly: true,
            }),
        },
      },
    });

    const uploadGrant = await transfer.initiateUpload({
      sessionKey: userAuth.sessionKey,
      store: "uploads",
      key: "incoming/too-large.bin",
      expiresInMs: 60_000,
      contentType: "application/octet-stream",
    });
    assertEquals(uploadGrant.isOk(), true);
    const uploadGrantValue = uploadGrant.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    assertEquals(uploadGrantValue.maxBytes, 1024);

    const oversized = new Uint8Array(2048);
    const uploaded = await createTransferHandle(
      nats.nc,
      userAuth,
      3000,
      uploadGrantValue,
    ).send(oversized);
    assertEquals(uploaded.isErr(), true);
    const uploadError = uploaded.match({
      ok: () => {
        throw new Error("oversized upload unexpectedly succeeded");
      },
      err: (error) => error,
    });
    assertEquals(uploadError.getContext().reason, "max_bytes_exceeded");
    assertEquals(uploadError.getContext().maxBytes, 1024);
    assertEquals(uploadError.getContext().attemptedBytes, 2048);

    await transfer.stop();
  },
});

Deno.test({
  name:
    "ServiceTransfer runs the onStored callback after the object lands in store",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const storeResult = await TypedStore.open(
      nats.nc,
      "service-transfer-on-stored-test",
      {
        ttlMs: 60_000,
        maxObjectBytes: 1024 * 1024,
        maxTotalBytes: 4 * 1024 * 1024,
      },
    );
    assertEquals(storeResult.isOk(), true);

    const serviceAuth = await createAuth({ sessionKeySeed: SERVICE_SEED });
    const userAuth = await createAuth({ sessionKeySeed: USER_SEED });
    const stored = deferred<{ key: string; body: string; size: number }>();

    const transfer = new ServiceTransfer({
      name: "files-service",
      nc: nats.nc,
      auth: serviceAuth,
      stores: {
        uploads: {
          open: () =>
            TypedStore.open(nats.nc, "service-transfer-on-stored-test", {
              ttlMs: 60_000,
              maxObjectBytes: 1024 * 1024,
              maxTotalBytes: 4 * 1024 * 1024,
              bindOnly: true,
            }),
        },
      },
    });

    const uploadGrant = await transfer.initiateUpload({
      sessionKey: userAuth.sessionKey,
      store: "uploads",
      key: "incoming/stored.txt",
      expiresInMs: 60_000,
      onStored: async ({ entry, info }) => {
        const bytes = await entry.bytes();
        const body = bytes.match({
          ok: (value) => value,
          err: (error) => {
            throw error;
          },
        });
        stored.resolve({
          key: info.key,
          body: decode(body),
          size: info.size,
        });
      },
    });
    const uploadGrantValue = uploadGrant.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    const uploaded = await createTransferHandle(
      nats.nc,
      userAuth,
      3000,
      uploadGrantValue,
    ).send(encode("stored callback"));
    assertEquals(uploaded.isOk(), true);
    assertEquals(await stored.promise, {
      key: "incoming/stored.txt",
      body: "stored callback",
      size: 15,
    });

    await transfer.stop();
  },
});
