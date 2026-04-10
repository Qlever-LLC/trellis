import { assertEquals, assertRejects } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";

import {
  deriveWorkloadConfirmationCode,
  deriveWorkloadIdentity,
  parseWorkloadActivationPayload,
} from "./auth.ts";
import { connectWorkloadWithDeps, loadDefaultTransport } from "./workload.ts";
import type { TrellisAPI } from "./contracts.ts";
import type { TrellisAuth } from "./trellis.ts";

const emptyApi = {
  rpc: {},
  operations: {},
  events: {},
  subjects: {},
} satisfies TrellisAPI;

const testContract = {
  CONTRACT_ID: "example.workload@v1",
  CONTRACT_DIGEST: "digest-a",
  API: {
    trellis: emptyApi,
  },
  createClient(_nc: NatsConnection, _auth: TrellisAuth) {
    throw new Error("unreachable");
  },
};

Deno.test("connectWorkloadWithDeps requires an activation handler when activation is needed", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(new Response(JSON.stringify({ reason: "unknown_workload" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch;

    await assertRejects(
      () => connectWorkloadWithDeps({
        authUrl: "https://trellis.example.com",
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
      "Workload activation required but no activation handler was provided",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectWorkloadWithDeps supports offline confirmation before reconnect", async () => {
  const originalFetch = globalThis.fetch;
  const identity = await deriveWorkloadIdentity(new Uint8Array(32).fill(7));
  let fetchCalls = 0;
  let activationUrl = "";
  let lastToken = "";

  try {
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = String(input);
      fetchCalls += 1;
      if (url.includes("/auth/workloads/connect-info") && fetchCalls === 1) {
        return Promise.resolve(new Response(JSON.stringify({ reason: "unknown_workload" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.includes("/auth/workloads/connect-info")) {
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          connectInfo: {
            instanceId: "wrk_123",
            profileId: "reader.default",
            contractId: "example.workload@v1",
            contractDigest: "digest-a",
            transport: {
              natsServers: ["nats://127.0.0.1:4222"],
              sentinel: { jwt: "jwt", seed: "seed" },
            },
            auth: { mode: "workload_identity", iatSkewSeconds: 30 },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    await assertRejects(
      () => connectWorkloadWithDeps({
        authUrl: "https://trellis.example.com",
        contract: testContract,
        rootSecret: new Uint8Array(32).fill(7),
        onActivationRequired: async (activation) => {
          activationUrl = activation.url;
          const payload = parseWorkloadActivationPayload(
            new URL(activation.url).searchParams.get("payload") ?? "",
          );
          const confirmationCode = await deriveWorkloadConfirmationCode({
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

    assertEquals(activationUrl.includes("/auth/workloads/activate?payload="), true);
    assertEquals(lastToken.includes('"contractDigest":"digest-a"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("loadDefaultTransport uses the Deno websocket transport function", async () => {
  const globalWithOptionalDeno = globalThis as typeof globalThis & { Deno?: unknown };
  const originalDeno = globalWithOptionalDeno.Deno;
  const connectFn = async (): Promise<NatsConnection> => {
    throw new Error("connect should not be called");
  };
  const wsconnectFn = async (): Promise<NatsConnection> => {
    throw new Error("wsconnect should not be called");
  };

  try {
    Reflect.set(globalWithOptionalDeno, "Deno", true);
    const transport = await loadDefaultTransport(
      (async <TModule>() => ({
        connect: connectFn,
        wsconnect: wsconnectFn,
      } as TModule)),
    );
    assertEquals(transport.connect, wsconnectFn);
  } finally {
    if (originalDeno === undefined) {
      Reflect.deleteProperty(globalWithOptionalDeno, "Deno");
    } else {
      Reflect.set(globalWithOptionalDeno, "Deno", originalDeno);
    }
  }
});
