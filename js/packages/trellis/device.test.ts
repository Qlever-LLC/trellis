import { assertEquals, assertRejects } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";

import {
  deriveDeviceConfirmationCode,
  deriveDeviceIdentity,
  startDeviceActivationRequest,
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
  let activationNonce = "";
  let lastToken = "";

  try {
    globalThis.fetch = ((input: URL | Request | string, init?: RequestInit) => {
      const url = String(input);
      fetchCalls += 1;
      if (url.endsWith("/auth/devices/activate/requests")) {
        const request = JSON.parse(String(init?.body ?? "{}")) as {
          payload?: { nonce?: string };
        };
        activationNonce = request.payload?.nonce ?? "";
        return Promise.resolve(new Response(JSON.stringify({
          flowId: "flow_123",
          instanceId: "dev_123",
          profileId: "reader.default",
          activationUrl: "https://trellis.example.com/_trellis/portal/activate?flowId=flow_123",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
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
            transports: {
              native: {
                natsServers: ["nats://127.0.0.1:4222"],
                tlsRequired: true,
              },
              websocket: { natsServers: ["ws://localhost:8080"] },
            },
            transport: {
              sentinel: { jwt: "jwt", seed: "seed", issuer: "trellis" },
            },
            auth: {
              mode: "device_identity",
              iatSkewSeconds: 30,
              tokenVersion: 2,
            },
            rollout: "canary",
          },
          requestId: "req_123",
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
          const confirmationCode = await deriveDeviceConfirmationCode({
            activationKey: identity.activationKey,
            publicIdentityKey: identity.publicIdentityKey,
            nonce: activationNonce,
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

    assertEquals(
      activationUrl,
      "https://trellis.example.com/_trellis/portal/activate?flowId=flow_123",
    );
    assertEquals(lastToken.includes('"contractDigest":"digest-a"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("startDeviceActivationRequest returns a short server-owned activation URL", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input, init) => {
      assertEquals(String(input), "https://trellis.example.com/auth/devices/activate/requests");
      assertEquals(init?.method, "POST");
      return new Response(JSON.stringify({
        flowId: "flow_123",
        instanceId: "dev_123",
        profileId: "reader.default",
        activationUrl: "https://trellis.example.com/_trellis/portal/activate?flowId=flow_123",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const response = await startDeviceActivationRequest({
      trellisUrl: "https://trellis.example.com",
      payload: {
        v: 1,
        publicIdentityKey: "identity",
        nonce: "nonce_123",
        qrMac: "qr_mac",
      },
    });

    assertEquals(response.activationUrl, "https://trellis.example.com/_trellis/portal/activate?flowId=flow_123");
    assertEquals(response.flowId, "flow_123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
