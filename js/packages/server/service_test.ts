import { assertEquals, assertRejects } from "@std/assert";
import type { Msg, NatsConnection, Subscription } from "@nats-io/nats-core";
import { core } from "@qlever-llc/trellis/sdk/core";

import type { LoggerLike } from "../trellis/globals.ts";
import type { NatsConnectFn } from "./runtime.ts";
import { type TrellisServiceConnectArgs, TrellisService } from "./service.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function createTestLogger() {
  const childBindings: Array<Record<string, unknown>> = [];
  const logger: LoggerLike = {
    child(bindings: Record<string, unknown>) {
      childBindings.push(bindings);
      return logger;
    },
    trace(..._args: unknown[]) {},
    debug(..._args: unknown[]) {},
    info(..._args: unknown[]) {},
    warn(..._args: unknown[]) {},
    error(..._args: unknown[]) {},
  };

  return { childBindings, logger };
}

function createFakeNatsConnection(): NatsConnection {
  type TestNatsConnection = NatsConnection & {
    options: { inboxPrefix: string };
  };

  const message: Msg = {
    subject: "test.subject",
    sid: 1,
    data: new Uint8Array(),
    respond: () => true,
    json: <T>() => ({}) as T,
    string: () => "",
  };

  const subscription: Subscription = {
    closed: Promise.resolve(),
    unsubscribe: () => {},
    drain: async () => {},
    isDraining: () => false,
    isClosed: () => false,
    callback: () => {},
    getSubject: () => "test.subject",
    getReceived: () => 0,
    getProcessed: () => 0,
    getPending: () => 0,
    getID: () => 1,
    getMax: () => undefined,
    [Symbol.asyncIterator]: async function* () {
      return;
    },
  };

  const connection: TestNatsConnection = {
    info: undefined,
    closed: async () => undefined,
    close: async () => {},
    options: {
      inboxPrefix: "_INBOX.test",
    },
    publish: () => {},
    publishMessage: () => {},
    respondMessage: () => true,
    subscribe: () => subscription,
    request: async () => message,
    requestMany: async () => (async function* () {
      return;
    })(),
    flush: async () => {},
    drain: async () => {},
    isClosed: () => false,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    status: () => (async function* () {
      return;
    })(),
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
  };

  return connection;
}

const logDisabledOk: NonNullable<TrellisServiceConnectArgs<typeof core>["server"]> = {
  log: false,
};
void logDisabledOk;

const customLogOk: NonNullable<TrellisServiceConnectArgs<typeof core>["server"]> = {
  log: createTestLogger().logger,
};
void customLogOk;

const versionRemoved: NonNullable<TrellisServiceConnectArgs<typeof core>["server"]> = {
  // @ts-expect-error public TrellisService.connect server opts no longer expose version
  version: "1.2.3",
};
void versionRemoved;

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
          transports: {
            native: { natsServers: ["nats://127.0.0.1:4222"] },
            websocket: { natsServers: ["ws://localhost:8080"] },
          },
          transport: {
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

Deno.test("TrellisService.connectInternal accepts log false", async () => {
  const service = await TrellisService.connectInternal("svc", {
    sessionKeySeed: TEST_SEED,
    nats: {
      servers: "nats://127.0.0.1:4222",
      authenticator: {},
    },
    server: {
      api: core.API.owned,
      trellisApi: core.API.trellis,
      log: false,
    },
  }, {
    connect: async () => createFakeNatsConnection(),
  });

  assertEquals(service.name, "svc");
});

Deno.test("TrellisService.connectInternal uses the provided logger", async () => {
  const testLogger = createTestLogger();

  const service = await TrellisService.connectInternal("svc", {
    sessionKeySeed: TEST_SEED,
    nats: {
      servers: "nats://127.0.0.1:4222",
      authenticator: {},
    },
    server: {
      api: core.API.owned,
      trellisApi: core.API.trellis,
      log: testLogger.logger,
    },
  }, {
    connect: async () => createFakeNatsConnection(),
  });

  assertEquals(service.name, "svc");
  assertEquals(testLogger.childBindings.length >= 3, true);
});

Deno.test("TrellisService.connectInternal defaults to the server logger", async () => {
  const service = await TrellisService.connectInternal("svc", {
    sessionKeySeed: TEST_SEED,
    nats: {
      servers: "nats://127.0.0.1:4222",
      authenticator: {},
    },
    server: {
      api: core.API.owned,
      trellisApi: core.API.trellis,
    },
  }, {
    connect: async () => createFakeNatsConnection(),
  });

  assertEquals(service.name, "svc");
});
