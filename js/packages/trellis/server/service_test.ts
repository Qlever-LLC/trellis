import { assertEquals, assertRejects } from "@std/assert";
import type { Msg, NatsConnection, Subscription } from "@nats-io/nats-core";
import { Result, type BaseError } from "@qlever-llc/result";
import { core } from "@qlever-llc/trellis-sdk/core";
import { Type } from "typebox";

import type { LoggerLike } from "../globals.ts";
import { defineServiceContract } from "../contract.ts";
import type { NatsConnectFn } from "./runtime.ts";
import { type TrellisServiceConnectArgs, TrellisService } from "./service.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const handlerSurfaceTestSchemas = {
  PingInput: Type.Object({ value: Type.String() }),
  PingOutput: Type.Object({ ok: Type.Boolean() }),
} as const;

const handlerSurfaceTestContract = defineServiceContract(
  { schemas: handlerSurfaceTestSchemas },
  (ref) => ({
    id: "trellis.server.handler-surface-test@v1",
    displayName: "Handler Surface Test",
    description: "Verify mounted handlers receive service-owned resources.",
    rpc: {
      "Test.Ping": {
        version: "v1",
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

function createTestLogger() {
  const childBindings: Array<Record<string, unknown>> = [];
  const debugCalls: Array<unknown[]> = [];
  const infoCalls: Array<unknown[]> = [];
  const logger: LoggerLike = {
    child(bindings: Record<string, unknown>) {
      childBindings.push(bindings);
      return logger;
    },
    trace(..._args: unknown[]) {},
    debug(...args: unknown[]) {
      debugCalls.push(args);
    },
    info(...args: unknown[]) {
      infoCalls.push(args);
    },
    warn(..._args: unknown[]) {},
    error(..._args: unknown[]) {},
  };

  return { childBindings, debugCalls, infoCalls, logger };
}

function createFakeNatsConnection(statuses: unknown[] = []): NatsConnection {
  type TestNatsConnection = NatsConnection & {
    options: { inboxPrefix: string };
  };

  const status = (() =>
    (async function* () {
      for (const entry of statuses) {
        yield entry;
      }
    })()) as NatsConnection["status"];

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
            mode: "service_identity",
            iatSkewSeconds: 30,
            tokenVersion: 2,
          },
          rollout: "canary",
        },
        binding: {
          contractId: core.CONTRACT_ID,
          digest: core.CONTRACT_DIGEST,
          resources: {
            kv: {},
            streams: {},
            jobs: {
              namespace: "jobs",
              queues: {},
              rollout: "canary",
            },
          },
          requestId: "req_123",
        },
        requestId: "req_123",
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

Deno.test("TrellisService.connectInternal logs routine NATS status at debug and reconnects at info", async () => {
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
    connect: async () =>
      createFakeNatsConnection([
        { type: "update", data: "cluster change" },
        { type: "reconnect", data: "nats://127.0.0.1:4222" },
      ]),
  });

  try {
    await delay(20);
  } finally {
    await service.stop();
  }

  const debugStatusCalls = testLogger.debugCalls.filter((args) =>
    args[1] === "Service NATS connection status"
  );
  const infoStatusCalls = testLogger.infoCalls.filter((args) =>
    args[1] === "Service NATS connection status"
  );

  assertEquals(debugStatusCalls.length, 1);
  assertEquals(infoStatusCalls.length, 1);
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

Deno.test("TrellisService mount passes kv and store to handlers", async () => {
  const service = await TrellisService.connectInternal("svc", {
    sessionKeySeed: TEST_SEED,
    nats: {
      servers: "nats://127.0.0.1:4222",
      authenticator: {},
    },
    server: {
      api: handlerSurfaceTestContract.API.owned,
      trellisApi: handlerSurfaceTestContract.API.trellis,
      log: false,
    },
  }, {
    connect: async () => createFakeNatsConnection(),
  });

  let mounted:
    | ((
      input: unknown,
      context: { caller: unknown; sessionKey: string },
    ) => Promise<Result<unknown, BaseError>>)
    | undefined;

  Reflect.set(
    service.server as object,
    "mount",
    async (
      _method: string,
      fn: (
        input: unknown,
        context: { caller: unknown; sessionKey: string },
      ) => Promise<Result<unknown, BaseError>>,
    ) => {
      mounted = fn;
    },
  );

  try {
    await service.trellis.mount("Test.Ping", (_input, _context, runtime) => {
      assertEquals(runtime.kv, service.kv);
      assertEquals(runtime.store, service.store);
      return Result.ok({ ok: true });
    });

    if (!mounted) {
      throw new Error("expected wrapped mount handler to be captured");
    }

    const result = await mounted(
      { value: "ping" },
      { caller: { kind: "test" }, sessionKey: "session-key" },
    );

    assertEquals(result.isErr(), false);
  } finally {
    await service.stop();
  }
});
