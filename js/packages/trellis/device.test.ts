import { assertEquals, assertRejects } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";

import {
  deriveDeviceConfirmationCode,
  deriveDeviceIdentity,
  startDeviceActivationRequest,
} from "./auth.ts";
import { connectDeviceWithDeps } from "./device.ts";
import type { TrellisAPI } from "./contracts.ts";
import { TransportError } from "./errors/index.ts";
import type { LoggerLike } from "./globals.ts";
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
  CONTRACT: {
    displayName: "Example Device",
  },
  API: {
    trellis: emptyApi,
  },
  createClient(_nc: NatsConnection, _auth: TrellisAuth) {
    throw new Error("unreachable");
  },
};

function authenticatorsFromValue(
  value: unknown,
): Array<(...args: unknown[]) => unknown> {
  if (typeof value === "function") {
    return [value as (...args: unknown[]) => unknown];
  }
  if (
    Array.isArray(value) && value.every((entry) => typeof entry === "function")
  ) {
    return value as Array<(...args: unknown[]) => unknown>;
  }
  return [];
}

function createTestLogger() {
  const childBindings: Array<Record<string, unknown>> = [];
  const traceCalls: Array<unknown[]> = [];
  const debugCalls: Array<unknown[]> = [];
  const infoCalls: Array<unknown[]> = [];
  const warnCalls: Array<unknown[]> = [];
  const errorCalls: Array<unknown[]> = [];
  const logger: LoggerLike = {
    child(bindings: Record<string, unknown>) {
      childBindings.push(bindings);
      return logger;
    },
    trace(...args: unknown[]) {
      traceCalls.push(args);
    },
    debug(...args: unknown[]) {
      debugCalls.push(args);
    },
    info(...args: unknown[]) {
      infoCalls.push(args);
    },
    warn(...args: unknown[]) {
      warnCalls.push(args);
    },
    error(...args: unknown[]) {
      errorCalls.push(args);
    },
  };

  return {
    childBindings,
    traceCalls,
    debugCalls,
    infoCalls,
    warnCalls,
    errorCalls,
    logger,
  };
}

function createFakeNatsConnection(args: {
  statuses?: unknown[];
  closedResult?: Error | void;
} = {}): NatsConnection {
  type TestNatsConnection = NatsConnection & {
    options: { inboxPrefix: string };
  };

  const status = (() =>
    (async function* () {
      for (const entry of args.statuses ?? []) {
        yield entry;
      }
    })()) as NatsConnection["status"];

  const connection: TestNatsConnection = {
    info: undefined,
    closed: async () => args.closedResult,
    close: async () => {},
    options: {
      inboxPrefix: "_INBOX.test",
    },
    publish: () => {},
    publishMessage: () => {},
    respondMessage: () => true,
    subscribe: () => {
      throw new Error("unreachable");
    },
    request: async () => {
      throw new Error("unreachable");
    },
    requestMany: async () =>
      (async function* () {
        return;
      })(),
    flush: async () => {},
    drain: async () => {},
    isClosed: () => false,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    status,
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
  };

  return connection;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("connectDeviceWithDeps requires an activation handler when activation is needed", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ reason: "unknown_device" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const error = await assertRejects(
      () =>
        connectDeviceWithDeps({
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

Deno.test("connectDeviceWithDeps maps invalid bootstrap responses to TransportError", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ready" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const error = await assertRejects(
      () =>
        connectDeviceWithDeps({
          trellisUrl: "https://trellis.example.com",
          contract: testContract,
          rootSecret: new Uint8Array(32).fill(7),
        }, {
          loadTransport: async () => ({
            connect: async (): Promise<NatsConnection> => {
              throw new Error("transport should not be used");
            },
          }),
          now: () => 1_700_000_000_000,
        }),
      TransportError,
    );

    assertEquals(error.code, "trellis.bootstrap.invalid_response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectDeviceWithDeps maps malformed bootstrap responses to TransportError", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    const error = await assertRejects(
      () =>
        connectDeviceWithDeps({
          trellisUrl: "https://trellis.example.com",
          contract: testContract,
          rootSecret: new Uint8Array(32).fill(7),
        }, {
          loadTransport: async () => ({
            connect: async (): Promise<NatsConnection> => {
              throw new Error("transport should not be used");
            },
          }),
          now: () => 1_700_000_000_000,
        }),
      TransportError,
    );

    assertEquals(error.code, "trellis.bootstrap.invalid_response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectDeviceWithDeps maps runtime connection failures to TransportError", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            connectInfo: {
              instanceId: "dev_123",
              profileId: "reader.default",
              contractId: "example.device@v1",
              contractDigest: "digest-a",
              transports: {
                native: {
                  natsServers: ["nats://127.0.0.1:4222"],
                },
              },
              transport: {
                sentinel: { jwt: "jwt", seed: "seed" },
              },
              auth: {
                mode: "device_identity",
                iatSkewSeconds: 30,
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    const error = await assertRejects(
      () =>
        connectDeviceWithDeps({
          trellisUrl: "https://trellis.example.com",
          contract: testContract,
          rootSecret: new Uint8Array(32).fill(7),
        }, {
          loadTransport: async () => ({
            connect: async (): Promise<NatsConnection> => {
              throw new Error("connection refused");
            },
          }),
          now: () => 1_700_000_000_000,
        }),
      TransportError,
    );

    assertEquals(error.code, "trellis.runtime.connect_failed");
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              flowId: "flow_123",
              instanceId: "dev_123",
              profileId: "reader.default",
              activationUrl:
                "https://trellis.example.com/_trellis/portal/devices/activate?flowId=flow_123",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      if (url.includes("/bootstrap/device") && fetchCalls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "activation_required" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/bootstrap/device")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
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
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as typeof fetch;

    const error = await assertRejects(
      () =>
        connectDeviceWithDeps({
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
            await activation.acceptConfirmationCode(
              confirmationCode.toLowerCase(),
            );
          },
        }, {
          loadTransport: async () => ({
            connect: async (options): Promise<NatsConnection> => {
              const auth = authenticatorsFromValue(options.authenticator)
                [0]?.();
              if (auth && typeof auth === "object") {
                const record = auth as { auth_token?: unknown };
                if (typeof record.auth_token === "string") {
                  lastToken = record.auth_token;
                }
              }
              throw new Error("stop-after-token");
            },
          }),
          now: () => 1_700_000_000_000,
        }),
      TransportError,
    );

    assertEquals(error.code, "trellis.runtime.connect_failed");
    assertEquals(
      activationUrl,
      "https://trellis.example.com/_trellis/portal/devices/activate?flowId=flow_123",
    );
    assertEquals(lastToken.includes('"contractDigest":"digest-a"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectDeviceWithDeps logs explicit device NATS lifecycle status events", async () => {
  const originalFetch = globalThis.fetch;
  const testLogger = createTestLogger();

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            connectInfo: {
              instanceId: "dev_123",
              profileId: "reader.default",
              contractId: "example.device@v1",
              contractDigest: "digest-a",
              transports: {
                native: {
                  natsServers: ["nats://127.0.0.1:4222"],
                },
              },
              transport: {
                sentinel: { jwt: "jwt", seed: "seed" },
              },
              auth: {
                mode: "device_identity",
                iatSkewSeconds: 30,
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    await connectDeviceWithDeps({
      trellisUrl: "https://trellis.example.com",
      contract: testContract,
      rootSecret: new Uint8Array(32).fill(7),
      log: testLogger.logger,
    }, {
      loadTransport: async () => ({
        connect: async (): Promise<NatsConnection> =>
          createFakeNatsConnection({
            statuses: [
              { type: "disconnect" },
              { type: "reconnecting", data: "nats://127.0.0.1:4222" },
              { type: "forceReconnect", data: "nats://127.0.0.1:4222" },
              { type: "reconnect" },
              { type: "staleConnection" },
              { type: "error", error: new Error("boom") },
            ],
          }),
      }),
      now: () => 1_700_000_000_000,
    });

    await delay(0);

    assertEquals(
      testLogger.warnCalls.map((call) => call[1]).sort(),
      [
        "Device disconnected from NATS",
        "Device attempting NATS reconnect",
        "Device forcing NATS reconnect",
        "Device NATS connection became stale",
        "Device NATS connection closed",
      ].sort(),
    );
    assertEquals(testLogger.infoCalls.length, 1);
    assertEquals(testLogger.infoCalls[0]?.[1], "Device reconnected to NATS");
    assertEquals(testLogger.errorCalls.length, 1);
    assertEquals(testLogger.errorCalls[0]?.[1], "Device NATS error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectDeviceWithDeps logs explicit device NATS closed outcomes", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            connectInfo: {
              instanceId: "dev_123",
              profileId: "reader.default",
              contractId: "example.device@v1",
              contractDigest: "digest-a",
              transports: {
                native: {
                  natsServers: ["nats://127.0.0.1:4222"],
                },
              },
              transport: {
                sentinel: { jwt: "jwt", seed: "seed" },
              },
              auth: {
                mode: "device_identity",
                iatSkewSeconds: 30,
              },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    const closedLogger = createTestLogger();
    await connectDeviceWithDeps({
      trellisUrl: "https://trellis.example.com",
      contract: testContract,
      rootSecret: new Uint8Array(32).fill(8),
      log: closedLogger.logger,
    }, {
      loadTransport: async () => ({
        connect: async (): Promise<NatsConnection> =>
          createFakeNatsConnection(),
      }),
      now: () => 1_700_000_000_000,
    });

    await delay(0);

    assertEquals(closedLogger.warnCalls.length, 1);
    assertEquals(
      closedLogger.warnCalls[0]?.[1],
      "Device NATS connection closed",
    );
    assertEquals(closedLogger.errorCalls.length, 0);

    const errorLogger = createTestLogger();
    await connectDeviceWithDeps({
      trellisUrl: "https://trellis.example.com",
      contract: testContract,
      rootSecret: new Uint8Array(32).fill(9),
      log: errorLogger.logger,
    }, {
      loadTransport: async () => ({
        connect: async (): Promise<NatsConnection> =>
          createFakeNatsConnection({
            closedResult: new Error("closed boom"),
          }),
      }),
      now: () => 1_700_000_000_000,
    });

    await delay(0);

    assertEquals(errorLogger.errorCalls.length, 1);
    assertEquals(
      errorLogger.errorCalls[0]?.[1],
      "Device NATS connection closed with error",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("startDeviceActivationRequest returns a short server-owned activation URL", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input, init) => {
      assertEquals(
        String(input),
        "https://trellis.example.com/auth/devices/activate/requests",
      );
      assertEquals(init?.method, "POST");
      return new Response(
        JSON.stringify({
          flowId: "flow_123",
          instanceId: "dev_123",
          profileId: "reader.default",
          activationUrl:
            "https://trellis.example.com/_trellis/portal/devices/activate?flowId=flow_123",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
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

    assertEquals(
      response.activationUrl,
      "https://trellis.example.com/_trellis/portal/devices/activate?flowId=flow_123",
    );
    assertEquals(response.flowId, "flow_123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
