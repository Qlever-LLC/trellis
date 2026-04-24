import { assertEquals, assertRejects } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";

import { deriveDeviceIdentity, startDeviceActivationRequest } from "./auth.ts";
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

Deno.test("connectDeviceWithDeps returns TransportError when activation is required", async () => {
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
      TransportError,
    );

    assertEquals(error.code, "trellis.bootstrap.activation_required");
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

Deno.test("connectDeviceWithDeps rejects bootstrap contract mismatches", async () => {
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
              contractId: "different.device@v1",
              contractDigest: "digest-b",
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
        connectDeviceWithDeps(
          {
            trellisUrl: "https://trellis.example.com",
            contract: testContract,
            rootSecret: new Uint8Array(32).fill(7),
          },
          {
            loadTransport: async () => ({
              connect: async (): Promise<NatsConnection> => {
                throw new Error("transport should not be used");
              },
            }),
            now: () => 1_700_000_000_000,
          },
        ),
      TransportError,
    );

    assertEquals(error.code, "trellis.bootstrap.contract_mismatch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("connectDeviceWithDeps retries bootstrap once on iat_out_of_range using server time", async () => {
  const originalFetch = globalThis.fetch;
  let bootstrapCalls = 0;

  try {
    globalThis.fetch = (() => {
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reason: "iat_out_of_range",
              serverNow: 1_700_000_120,
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

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
        connectDeviceWithDeps(
          {
            trellisUrl: "https://trellis.example.com",
            contract: testContract,
            rootSecret: new Uint8Array(32).fill(7),
          },
          {
            loadTransport: async () => ({
              connect: async (): Promise<NatsConnection> => {
                throw new Error("stop-after-retry");
              },
            }),
            now: () => 1_700_000_000_000,
          },
        ),
      TransportError,
    );

    assertEquals(error.code, "trellis.runtime.connect_failed");
    assertEquals(bootstrapCalls, 2);
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

    const connected = await connectDeviceWithDeps({
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

    assertEquals(connected.connection.status.kind, "device");
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
