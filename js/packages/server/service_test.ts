import { assertEquals, assertRejects } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";
import { core } from "@qlever-llc/trellis/sdk/core";

import type { NatsConnectFn } from "./runtime.ts";
import { TrellisService } from "./service.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

Deno.test("TrellisService.connect uses bootstrap response transport details", async () => {
  const originalFetch = globalThis.fetch;
  let connectServers = "";
  let connectToken = "";

  const fakeConnect: NatsConnectFn = async (opts) => {
    connectServers = Array.isArray(opts.servers) ? opts.servers.join(",") : opts.servers;
    connectToken = String(opts.token ?? "");
    throw new Error("stop-after-connect");
  };

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response(JSON.stringify({
        status: "ready",
        connectInfo: {
          sessionKey: "session-key",
          contractId: core.CONTRACT_ID,
          contractDigest: core.CONTRACT_DIGEST,
          transport: {
            natsServers: ["nats://127.0.0.1:4222"],
            sentinel: { jwt: "jwt", seed: "seed" },
          },
          auth: {
            mode: "service_identity",
            iatSkewSeconds: 30,
          },
        },
        binding: {
          contractId: core.CONTRACT_ID,
          digest: core.CONTRACT_DIGEST,
          resources: {
            kv: {},
            streams: {},
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: core,
        name: "svc",
        sessionKeySeed: TEST_SEED,
        server: {},
      }, { connect: fakeConnect }),
      Error,
      "stop-after-connect",
    );

    assertEquals(connectServers, "nats://127.0.0.1:4222");
    assertEquals(connectToken.includes('"sessionKey":"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("TrellisService.connect surfaces bootstrap failure reasons", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response(JSON.stringify({ reason: "contract_not_active" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: core,
        name: "svc",
        sessionKeySeed: TEST_SEED,
        server: {},
      }, {
        connect: async (): Promise<NatsConnection> => {
          throw new Error("connect should not be called");
        },
      }),
      Error,
      "Service bootstrap failed: contract_not_active",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
