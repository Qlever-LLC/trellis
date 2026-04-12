import { assertEquals, assertRejects } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";

import {
  deriveDeviceConfirmationCode,
  deriveDeviceIdentity,
  parseDeviceActivationPayload,
} from "./auth.ts";
import { connectDeviceWithDeps } from "./device.ts";
import type { TrellisAPI } from "./contracts.ts";
import type { TrellisAuth } from "./trellis.ts";

const emptyApi = {
  rpc: {},
  operations: {},
  events: {},
  subjects: {},
} satisfies TrellisAPI;

const testContract = {
  CONTRACT_ID: "example.device@v1",
  CONTRACT_DIGEST: "digest-a",
  API: {
    trellis: emptyApi,
  },
  createClient(_nc: NatsConnection, _auth: TrellisAuth) {
    throw new Error("unreachable");
  },
};

Deno.test("connectDeviceWithDeps requires an activation handler when activation is needed", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response(JSON.stringify({ reason: "unknown_device" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => connectDeviceWithDeps({
        trellisUrl: "https://trellis.example.com",
        contract: testContract,
        rootSecret: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      }, {
        loadTransport: async () => ({
          connect: async (): Promise<NatsConnection> => {
            throw new Error("transport should not be used");
          },
        }),
        now: () => Date.UTC(2026, 0, 1),
      }),
      Error,
      "Device activation required but no activation handler was provided",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectDeviceWithDeps supports offline confirmation before reconnect", async () => {
  const originalFetch = globalThis.fetch;
  const identity = await deriveDeviceIdentity(new Uint8Array(32).fill(7));
  let fetchCalls = 0;
  let activationUrl = "";
  let lastToken = "";

  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      fetchCalls += 1;
      if (url.includes("/bootstrap/device") && fetchCalls === 1) {
        return Promise.resolve(new Response(JSON.stringify({ status: "activation_required" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/bootstrap/device")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          connectInfo: {
            instanceId: "dev_123",
            profileId: "reader.default",
            contractId: "example.device@v1",
            contractDigest: "digest-a",
            transport: {
              natsServers: ["nats://127.0.0.1:4222"],
              sentinel: { jwt: "jwt", seed: "seed" },
            },
            auth: { mode: "device_identity", iatSkewSeconds: 30 },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await assertRejects(
      () => connectDeviceWithDeps({
        trellisUrl: "https://trellis.example.com",
        contract: testContract,
        rootSecret: new Uint8Array(32).fill(7),
        onActivationRequired: async (activation) => {
          activationUrl = activation.url;
          const payload = parseDeviceActivationPayload(
            new URL(activation.url).searchParams.get("payload") ?? "",
          );
          const confirmationCode = await deriveDeviceConfirmationCode({
            activationKey: identity.activationKey,
            publicIdentityKey: identity.publicIdentityKey,
            nonce: payload.nonce,
          });
          await activation.acceptConfirmationCode(confirmationCode.toLowerCase());
        },
      }, {
        loadTransport: async () => ({
          connect: async (options): Promise<NatsConnection> => {
            lastToken = String(options.token ?? "");
            throw new Error("stop-after-token");
          },
        }),
        now: () => 1_700_000_000_000,
      }),
      Error,
      "stop-after-token",
    );

    assertEquals(activationUrl.includes("/auth/devices/activate?payload="), true);
    assertEquals(lastToken.includes('"contractDigest":"digest-a"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
