import { assertEquals } from "@std/assert";

import { createAuth } from "../auth.ts";
import { NatsTest } from "../testing/nats.ts";
import { TypedStore } from "../store.ts";
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

Deno.test({
  name: "ServiceTransfer issues grants and round-trips bytes through store-backed sessions",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const storeResult = await TypedStore.open(nats.nc, "service-transfer-test", {
      ttlMs: 60_000,
      maxObjectBytes: 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
    });
    assertEquals(storeResult.isOk(), true);

    const serviceAuth = await createAuth({ sessionKeySeed: SERVICE_SEED });
    const userAuth = await createAuth({ sessionKeySeed: USER_SEED });

    const transfer = new ServiceTransfer({
      name: "files-service",
      nc: nats.nc,
      auth: serviceAuth,
      stores: {
        uploads: {
          open: () => TypedStore.open(nats.nc, "service-transfer-test", {
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

    const uploaded = await createTransferHandle(nats.nc, userAuth, 3000, uploadGrantValue).put(encode("hello transfer"));
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

    const downloaded = await createTransferHandle(nats.nc, userAuth, 3000, downloadGrantValue).getBytes();
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

    const storeResult = await TypedStore.open(nats.nc, "service-transfer-max-bytes-test", {
      ttlMs: 60_000,
      maxObjectBytes: 1024,
      maxTotalBytes: 4 * 1024 * 1024,
    });
    assertEquals(storeResult.isOk(), true);

    const serviceAuth = await createAuth({ sessionKeySeed: SERVICE_SEED });
    const userAuth = await createAuth({ sessionKeySeed: USER_SEED });

    const transfer = new ServiceTransfer({
      name: "files-service",
      nc: nats.nc,
      auth: serviceAuth,
      stores: {
        uploads: {
          open: () => TypedStore.open(nats.nc, "service-transfer-max-bytes-test", {
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
    const uploaded = await createTransferHandle(nats.nc, userAuth, 3000, uploadGrantValue).put(oversized);
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
  name: "ServiceTransfer runs the onStored callback after the object lands in store",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const storeResult = await TypedStore.open(nats.nc, "service-transfer-on-stored-test", {
      ttlMs: 60_000,
      maxObjectBytes: 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
    });
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
          open: () => TypedStore.open(nats.nc, "service-transfer-on-stored-test", {
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

    const uploaded = await createTransferHandle(nats.nc, userAuth, 3000, uploadGrantValue).put(encode("stored callback"));
    assertEquals(uploaded.isOk(), true);
    assertEquals(await stored.promise, {
      key: "incoming/stored.txt",
      body: "stored callback",
      size: 15,
    });

    await transfer.stop();
  },
});
