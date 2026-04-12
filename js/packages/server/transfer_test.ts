import { assertEquals } from "@std/assert";

import { createAuth } from "../trellis/auth.ts";
import { NatsTest } from "../trellis/testing/nats.ts";
import { TypedStore } from "../trellis/store.ts";
import { Trellis } from "../trellis/trellis.ts";
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
    const client = new Trellis("files-client", nats.nc, userAuth);

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

    const uploaded = await client.transfer(uploadGrantValue).put(encode("hello transfer"));
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

    const downloaded = await client.transfer(downloadGrantValue).getBytes();
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
