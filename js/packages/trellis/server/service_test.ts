import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  type Msg,
  type NatsConnection,
  PermissionViolationError,
  type Subscription,
} from "@nats-io/nats-core";
import { type BaseError, Result } from "@qlever-llc/result";
import { core } from "@qlever-llc/trellis-sdk/core";
import { health } from "@qlever-llc/trellis-sdk/health";
import { Type } from "typebox";

import type { LoggerLike } from "../globals.ts";
import { TransportError } from "../errors/index.ts";
import { TypedStore } from "../store.ts";
import { NatsTest } from "../testing/nats.ts";
import { defineServiceContract } from "../contract.ts";
import type { NatsConnectFn } from "./runtime.ts";
import { connectTrellisServiceInternal } from "./internal_connect.ts";
import {
  StoreHandle,
  TrellisService,
  type TrellisServiceConnectArgs,
} from "./service.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

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

const jobsHandlerTestSchemas = {
  RefreshPayload: Type.Object({ siteId: Type.String() }),
  RefreshResult: Type.Object({ refreshId: Type.String() }),
} as const;

const jobsHandlerTestContract = defineServiceContract(
  { schemas: jobsHandlerTestSchemas },
  (ref) => ({
    id: "trellis.server.jobs-handler-test@v1",
    displayName: "Jobs Handler Test",
    description: "Verify jobs handler registration and lifecycle ownership.",
    jobs: {
      refreshSummaries: {
        payload: ref.schema("RefreshPayload"),
        result: ref.schema("RefreshResult"),
      },
    },
  }),
);

const heartbeatTestContract = defineServiceContract({}, () => ({
  id: "trellis.server.heartbeat-test@v1",
  displayName: "Heartbeat Test",
  description: "Verify heartbeat runtime lifecycle behavior.",
  uses: { health: health.useDefaults() },
}));

type WaitableService = {
  wait(): Promise<void>;
  stop(): Promise<void>;
};

function hasServiceWait(value: object): value is WaitableService {
  return Reflect.has(value, "wait") &&
    typeof Reflect.get(value, "wait") === "function";
}

function waitForServiceStop(service: WaitableService): Promise<void> {
  return service.wait();
}

async function connectJobsHandlerTestService(opts?: {
  includeWorkStream?: boolean;
  deferClosed?: boolean;
}) {
  const originalFetch = globalThis.fetch;
  const includeWorkStream = opts?.includeWorkStream ?? true;

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_120,
          connectInfo: {
            sessionKey: "session-key",
            contractId: jobsHandlerTestContract.CONTRACT_ID,
            contractDigest: jobsHandlerTestContract.CONTRACT_DIGEST,
            transports: {
              native: {
                natsServers: ["nats://127.0.0.1:4222"],
              },
            },
            transport: {
              sentinel: { jwt: "jwt", seed: "seed", issuer: "trellis" },
            },
            auth: {
              mode: "service_identity",
              iatSkewSeconds: 30,
            },
          },
          binding: {
            contractId: jobsHandlerTestContract.CONTRACT_ID,
            digest: jobsHandlerTestContract.CONTRACT_DIGEST,
            resources: {
              kv: {},
              store: {},
              streams: includeWorkStream
                ? {
                  jobsWork: {
                    name: "JOBS_WORK",
                    retention: "workqueue",
                    storage: "file",
                    subjects: [
                      "trellis.work.jobs_handler_test.refreshSummaries",
                    ],
                  },
                }
                : {},
              jobs: {
                namespace: "jobs_handler_test",
                jobsStateBucket: "trellis_jobs",
                queues: {
                  refreshSummaries: {
                    queueType: "refreshSummaries",
                    publishPrefix:
                      "trellis.jobs.jobs_handler_test.refreshSummaries",
                    workSubject:
                      "trellis.work.jobs_handler_test.refreshSummaries",
                    consumerName: "jobs_handler_test-refreshSummaries",
                    payload: { schema: "RefreshPayload" },
                    result: { schema: "RefreshResult" },
                    maxDeliver: 5,
                    backoffMs: [5_000, 30_000],
                    ackWaitMs: 300_000,
                    progress: true,
                    logs: true,
                    dlq: true,
                    concurrency: 1,
                  },
                },
              },
            },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    )) as typeof fetch;

  try {
    const service = await TrellisService.connect({
      trellisUrl: "https://trellis.example.com",
      contract: jobsHandlerTestContract,
      name: "svc",
      sessionKeySeed: TEST_SEED,
      server: { log: false },
    }, {
      connect: async () =>
        createFakeNatsConnection({ deferClosed: opts?.deferClosed }),
    }).orThrow();

    return {
      service,
      restore() {
        globalThis.fetch = originalFetch;
      },
    };
  } catch (error) {
    globalThis.fetch = originalFetch;
    throw error;
  }
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
  deferClosed?: boolean;
  requestJson?: (subject: string) => unknown;
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

  const createMessage = (subject: string, value: unknown): Msg => ({
    subject,
    sid: 1,
    data: new Uint8Array(),
    respond: () => true,
    json: <T>() => value as T,
    string: () => "",
  });

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

  let resolveClosed: ((value: Error | void) => void) | undefined;
  let closed = false;
  const closedPromise = args.deferClosed
    ? new Promise<Error | void>((resolve) => {
      resolveClosed = resolve;
    })
    : Promise.resolve(args.closedResult);

  const connection: TestNatsConnection = {
    info: undefined,
    closed: async () => await closedPromise,
    close: async () => {
      closed = true;
      resolveClosed?.(args.closedResult);
    },
    options: {
      inboxPrefix: "_INBOX.test",
    },
    publish: () => {},
    publishMessage: () => {},
    respondMessage: () => true,
    subscribe: () => subscription,
    request: async (subject) =>
      createMessage(subject, args.requestJson?.(subject) ?? {}),
    requestMany: async () =>
      (async function* () {
        return;
      })(),
    flush: async () => {},
    drain: async () => {
      closed = true;
      resolveClosed?.(args.closedResult);
    },
    isClosed: () => closed,
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

function authTokenFromAuthenticatorResult(value: unknown): string {
  if (!value || typeof value !== "object") {
    throw new Error(
      "Expected NATS authenticator to return an auth token payload",
    );
  }

  const record = value as { auth_token?: unknown };
  if (typeof record.auth_token !== "string") {
    throw new Error("Expected NATS authenticator to return auth_token");
  }

  return record.auth_token;
}

const logDisabledOk: NonNullable<
  TrellisServiceConnectArgs<typeof core>["server"]
> = {
  log: false,
};
void logDisabledOk;

const customLogOk: NonNullable<
  TrellisServiceConnectArgs<typeof core>["server"]
> = {
  log: createTestLogger().logger,
};
void customLogOk;

const versionRemoved: NonNullable<
  TrellisServiceConnectArgs<typeof core>["server"]
> = {
  // @ts-expect-error public TrellisService.connect server opts no longer expose version
  version: "1.2.3",
};
void versionRemoved;

Deno.test("TrellisService.connect uses bootstrap response transport details", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let connectServers = "";
  let connectToken = "";
  let authenticatorCount = 0;
  let maxReconnectAttempts: unknown;

  const fakeConnect: NatsConnectFn = async (opts) => {
    connectServers = Array.isArray(opts.servers)
      ? opts.servers.join(",")
      : opts.servers;
    maxReconnectAttempts = opts.maxReconnectAttempts;
    const authenticators = authenticatorsFromValue(opts.authenticator);
    authenticatorCount = authenticators.length;
    const auth = authenticators[0]?.();
    if (auth && typeof auth === "object") {
      const record = auth as { auth_token?: unknown };
      if (typeof record.auth_token === "string") {
        connectToken = record.auth_token;
      }
    }
    throw new Error("stop-after-connect");
  };

  try {
    Date.now = () => 1_700_000_000_000;
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            serverNow: 1_700_000_120,
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
        TrellisService.connect({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: {},
        }, { connect: fakeConnect }).orThrow(),
      TransportError,
    );

    assertEquals(error.code, "trellis.runtime.connect_failed");

    assertEquals(connectServers, "nats://127.0.0.1:4222");
    assertEquals(connectToken.includes('"sessionKey":"'), true);
    assertEquals(connectToken.includes('"iat":1700000120'), true);
    assertEquals(authenticatorCount, 2);
    assertEquals(maxReconnectAttempts, -1);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

Deno.test("TrellisService.connect retries once on iat_out_of_range using server time", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const requestBodies: Array<{ iat: number }> = [];
  let connectToken = "";

  const fakeConnect: NatsConnectFn = async (opts) => {
    const authenticators = authenticatorsFromValue(opts.authenticator);
    const auth = authenticators[0]?.();
    if (auth && typeof auth === "object") {
      const record = auth as { auth_token?: unknown };
      if (typeof record.auth_token === "string") {
        connectToken = record.auth_token;
      }
    }
    throw new Error("stop-after-connect");
  };

  try {
    Date.now = () => 1_700_000_000_000;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { iat: number };
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            reason: "iat_out_of_range",
            serverNow: 1_700_000_120,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_120,
          connectInfo: {
            sessionKey: "session-key",
            contractId: core.CONTRACT_ID,
            contractDigest: core.CONTRACT_DIGEST,
            transports: {
              native: {
                natsServers: ["nats://127.0.0.1:4222"],
              },
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
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    const error = await assertRejects(
      () =>
        TrellisService.connect({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: {},
        }, { connect: fakeConnect }).orThrow(),
      TransportError,
    );

    assertEquals(error.code, "trellis.runtime.connect_failed");

    assertEquals(requestBodies.map((entry) => entry.iat), [
      1_700_000_000,
      1_700_000_120,
    ]);
    assertEquals(connectToken.includes('"iat":1700000120'), true);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

Deno.test("internal service connect uses a reconnect-safe auth token authenticator", async () => {
  const originalNow = Date.now;
  let firstToken = "";
  let secondToken = "";
  let authenticatorCount = 0;
  let maxReconnectAttempts: unknown;

  try {
    let nowMs = 1_700_000_000_000;
    Date.now = () => nowMs;

    await assertRejects(
      () =>
        connectTrellisServiceInternal("svc", {
          sessionKeySeed: TEST_SEED,
          nats: {
            servers: "nats://127.0.0.1:4222",
            authenticator: () => ({ jwt: "sentinel-jwt" }),
          },
          server: {
            api: core.API.owned,
            trellisApi: core.API.trellis,
            log: false,
          },
        }, {
          connect: async (opts): Promise<NatsConnection> => {
            maxReconnectAttempts = opts.maxReconnectAttempts;
            const authenticators = authenticatorsFromValue(opts.authenticator);
            authenticatorCount = authenticators.length;

            firstToken = authTokenFromAuthenticatorResult(
              authenticators[0]?.(),
            );
            nowMs += 31_000;
            secondToken = authTokenFromAuthenticatorResult(
              authenticators[0]?.(),
            );

            throw new Error("stop-after-authenticator");
          },
        }),
      Error,
      "stop-after-authenticator",
    );

    const first = JSON.parse(firstToken) as {
      sessionKey: string;
      iat: number;
      sig: string;
    };
    const second = JSON.parse(secondToken) as {
      sessionKey: string;
      iat: number;
      sig: string;
    };

    assertEquals(authenticatorCount, 2);
    assertEquals(first.sessionKey, second.sessionKey);
    assertEquals(second.iat - first.iat, 31);
    assertNotEquals(first.sig, second.sig);
    assertEquals(maxReconnectAttempts, -1);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("internal service connect preserves explicit reconnect attempt overrides", async () => {
  let maxReconnectAttempts: unknown;

  await assertRejects(
    () =>
      connectTrellisServiceInternal("svc", {
        sessionKeySeed: TEST_SEED,
        nats: {
          servers: "nats://127.0.0.1:4222",
          authenticator: {},
          options: { maxReconnectAttempts: 3 },
        },
        server: {
          api: core.API.owned,
          trellisApi: core.API.trellis,
          log: false,
        },
      }, {
        connect: async (opts): Promise<NatsConnection> => {
          maxReconnectAttempts = opts.maxReconnectAttempts;
          throw new Error("stop-after-connect-options");
        },
      }),
    Error,
    "stop-after-connect-options",
  );

  assertEquals(maxReconnectAttempts, 3);
});

Deno.test("TrellisService.connect surfaces bootstrap failure reasons", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            reason: "contract_not_active",
            message:
              "Contract 'trellis.core@v1' digest 'digest_123' is not active in Trellis.",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    await assertRejects(
      () =>
        TrellisService.connect({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: {},
        }, {
          connect: async (): Promise<NatsConnection> => {
            throw new Error("connect should not be called");
          },
        }).orThrow(),
      Error,
      "Service bootstrap failed: Contract 'trellis.core@v1' digest 'digest_123' is not active in Trellis.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("internal service connect accepts log false", async () => {
  const service = await connectTrellisServiceInternal("svc", {
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
    connect: async () => createFakeNatsConnection({ deferClosed: true }),
  });

  assertEquals(service.name, "svc");
});

Deno.test("internal service connect uses the provided logger", async () => {
  const testLogger = createTestLogger();

  const service = await connectTrellisServiceInternal("svc", {
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

Deno.test("internal service connect logs explicit service NATS lifecycle events", async () => {
  const testLogger = createTestLogger();

  const service = await connectTrellisServiceInternal("svc", {
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
      createFakeNatsConnection({
        statuses: [
          { type: "disconnect", data: "nats://127.0.0.1:4222" },
          { type: "reconnecting", data: "nats://127.0.0.1:4223" },
          { type: "forceReconnect", data: "nats://127.0.0.1:4224" },
          { type: "reconnect", data: "nats://127.0.0.1:4222" },
          { type: "staleConnection" },
        ],
      }),
  });

  try {
    assertEquals(service.connection.status.kind, "service");
    await delay(20);
  } finally {
    await service.stop();
  }

  const lifecycleWarnCalls = testLogger.warnCalls.filter((args) =>
    args[1] !== "Service NATS connection closed"
  );

  assertEquals(lifecycleWarnCalls, [
    [
      {
        service: "svc",
        connection: { type: "disconnect", data: "nats://127.0.0.1:4222" },
      },
      "Service disconnected from NATS",
    ],
    [
      {
        service: "svc",
        connection: { type: "reconnecting", data: "nats://127.0.0.1:4223" },
      },
      "Service attempting NATS reconnect",
    ],
    [
      {
        service: "svc",
        connection: { type: "forceReconnect", data: "nats://127.0.0.1:4224" },
      },
      "Service forcing NATS reconnect",
    ],
    [
      {
        service: "svc",
        connection: { type: "staleConnection" },
      },
      "Service NATS connection became stale",
    ],
  ]);
  assertEquals(testLogger.infoCalls, [
    [
      {
        service: "svc",
        connection: { type: "reconnect", data: "nats://127.0.0.1:4222" },
      },
      "Service reconnected to NATS",
    ],
  ]);
  assertEquals(testLogger.debugCalls.length, 0);
});

Deno.test("internal service connect logs service NATS errors at error severity", async () => {
  const testLogger = createTestLogger();

  const service = await connectTrellisServiceInternal("svc", {
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
      createFakeNatsConnection({
        statuses: [
          {
            type: "error",
            error: new PermissionViolationError(
              'Permissions Violation for Publish to "_INBOX.session.123"',
              "publish",
              "_INBOX.session.123",
            ),
          },
        ],
      }),
  });

  try {
    await delay(20);
  } finally {
    await service.stop();
  }

  assertEquals(testLogger.errorCalls, [
    [
      {
        service: "svc",
        connection: {
          type: "error",
          error: {
            name: "PermissionViolationError",
            message:
              'Permissions Violation for Publish to "_INBOX.session.123"',
            operation: "publish",
            subject: "_INBOX.session.123",
          },
        },
      },
      "Service NATS error",
    ],
  ]);
});

Deno.test("internal service connect keeps final closed logging explicit", async () => {
  const testLogger = createTestLogger();

  const service = await connectTrellisServiceInternal("svc", {
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
      createFakeNatsConnection({
        closedResult: new Error("socket closed"),
      }),
  });

  try {
    await delay(20);
  } finally {
    await service.stop();
  }

  assertEquals(testLogger.errorCalls.length, 1);
  assertEquals(
    testLogger.errorCalls[0]?.[1],
    "Service NATS connection closed with error",
  );
  assertEquals(
    (testLogger.errorCalls[0]?.[0] as { service?: unknown }).service,
    "svc",
  );
  assertEquals(
    (testLogger.errorCalls[0]?.[0] as { error?: unknown }).error instanceof
      Error,
    true,
  );
  assertEquals(
    (testLogger.errorCalls[0]?.[0] as { error?: Error }).error?.message,
    "socket closed",
  );
});

Deno.test("service heartbeat publishing stops after terminal NATS close", async () => {
  let publishRequests = 0;
  const connection = createFakeNatsConnection({
    deferClosed: true,
    requestJson: () => {
      publishRequests += 1;
      return { stream: "HEALTH", seq: publishRequests, duplicate: false };
    },
  });

  const service = await connectTrellisServiceInternal("svc", {
    sessionKeySeed: TEST_SEED,
    nats: {
      servers: "nats://127.0.0.1:4222",
      authenticator: {},
    },
    server: {
      api: heartbeatTestContract.API.owned,
      trellisApi: heartbeatTestContract.API.trellis,
      log: false,
      health: { publishIntervalMs: 10 },
    },
  }, {
    connect: () => Promise.resolve(connection),
  });

  try {
    const requestsBeforeClose = publishRequests;
    assertEquals(requestsBeforeClose > 0, true);

    await service.nc.close();
    await delay(30);

    assertEquals(publishRequests, requestsBeforeClose);
  } finally {
    await service.stop();
  }
});

Deno.test("internal service connect cleans up the connection when bootstrap probing fails", async () => {
  let closed = false;
  let resolveClosed: ((value: Error | void) => void) | undefined;
  const closedPromise = new Promise<Error | void>((resolve) => {
    resolveClosed = resolve;
  });

  const baseConnection = createFakeNatsConnection({ deferClosed: true });
  const failingConnection = {
    ...baseConnection,
    closed: async () => await closedPromise,
    close: async () => {
      closed = true;
      resolveClosed?.();
    },
    drain: async () => {
      closed = true;
      resolveClosed?.();
    },
    isClosed: () => closed,
  } satisfies NatsConnection;

  await assertRejects(
    () =>
      connectTrellisServiceInternal("svc", {
        sessionKeySeed: TEST_SEED,
        contractId: core.CONTRACT_ID,
        contractDigest: core.CONTRACT_DIGEST,
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
        connect: async () => failingConnection,
      }),
    Error,
  );

  assertEquals(closed, true);
});

Deno.test({
  name: "internal service connect defaults to the server logger",
  sanitizeOps: false,
  async fn() {
    const service = await connectTrellisServiceInternal("svc", {
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

    try {
      assertEquals(service.name, "svc");
    } finally {
      await service.stop();
    }
  },
});

Deno.test("TrellisService mount passes kv and store to handlers", async () => {
  const service = await connectTrellisServiceInternal("svc", {
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
    await service.trellis.mount("Test.Ping", ({ trellis }) => {
      assertEquals(trellis.kv, service.kv);
      assertEquals(trellis.store, service.store);
      assertEquals(trellis.jobs, service.jobs);
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

Deno.test("service jobs reject duplicate handler registration immediately", async () => {
  const { service, restore } = await connectJobsHandlerTestService();

  try {
    const firstHandler: Parameters<
      typeof service.jobs.refreshSummaries.handle
    >[0] = async ({
      job,
    }) => {
      return Result.ok({ refreshId: job.payload.siteId });
    };
    const duplicateHandler: Parameters<
      typeof service.jobs.refreshSummaries.handle
    >[0] = async ({ job }) => {
      return Result.ok({ refreshId: job.payload.siteId });
    };

    const first = service.jobs.refreshSummaries.handle(firstHandler);

    assertEquals(first, undefined);
    assertThrows(
      () => {
        service.jobs.refreshSummaries.handle(duplicateHandler);
      },
      Error,
      "Job handler for queue 'refreshSummaries' is already registered",
    );
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("service wait starts managed job workers before waiting", async () => {
  const { service, restore } = await connectJobsHandlerTestService({
    includeWorkStream: false,
    deferClosed: true,
  });

  try {
    const handler: Parameters<typeof service.jobs.refreshSummaries.handle>[0] =
      async ({
        job,
      }) => {
        return Result.ok({ refreshId: job.payload.siteId });
      };
    const registered = service.jobs.refreshSummaries.handle(handler);
    assertEquals(registered, undefined);

    if (!hasServiceWait(service)) {
      return;
    }

    await assertRejects(
      () => waitForServiceStop(service),
      Error,
      "An unexpected error has occurred",
    );
    assertEquals(service.nc.isClosed(), true);
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("service wait resolves after service stop when no job handlers are registered", async () => {
  const { service, restore } = await connectJobsHandlerTestService({
    deferClosed: true,
  });

  try {
    if (!hasServiceWait(service)) {
      return;
    }

    const waiting = waitForServiceStop(service);
    await delay(5);
    await service.stop();
    await waiting;
  } finally {
    restore();
  }
});

Deno.test({
  name: "StoreHandle.waitFor resolves once the staged object appears",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const opened = await TypedStore.open(
      nats.nc,
      "store-handle-wait-for-test",
      {
        ttlMs: 60_000,
        maxObjectBytes: 1024,
        maxTotalBytes: 4096,
      },
    );
    const store = opened.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    const handle = new StoreHandle(nats.nc, {
      name: "store-handle-wait-for-test",
      ttlMs: 60_000,
      maxObjectBytes: 1024,
      maxTotalBytes: 4096,
    });

    const writer = (async () => {
      await delay(25);
      const written = await store.put(
        "incoming/ready.txt",
        new TextEncoder().encode("hello"),
      );
      assertEquals(written.isOk(), true);
    })();

    const waited = await handle.waitFor("incoming/ready.txt", {
      timeoutMs: 1_000,
      pollIntervalMs: 10,
    });
    assertEquals(waited.isOk(), true);
    const entry = waited.match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });
    const body = await entry.bytes();
    assertEquals(body.isOk(), true);
    assertEquals(
      body.match({
        ok: (value) => new TextDecoder().decode(value),
        err: (error) => {
          throw error;
        },
      }),
      "hello",
    );

    await writer;
  },
});

Deno.test({
  name:
    "StoreHandle.waitFor returns an aborted error when the signal is cancelled",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();

    const opened = await TypedStore.open(
      nats.nc,
      "store-handle-wait-abort-test",
      {
        ttlMs: 60_000,
        maxObjectBytes: 1024,
        maxTotalBytes: 4096,
      },
    );
    opened.match({
      ok: () => undefined,
      err: (error) => {
        throw error;
      },
    });

    const handle = new StoreHandle(nats.nc, {
      name: "store-handle-wait-abort-test",
      ttlMs: 60_000,
      maxObjectBytes: 1024,
      maxTotalBytes: 4096,
    });
    const controller = new AbortController();

    const waiting = handle.waitFor("incoming/missing.txt", {
      signal: controller.signal,
      pollIntervalMs: 1_000,
    });

    await delay(20);
    controller.abort("cancelled");

    const waited = await waiting;
    assertEquals(waited.isErr(), true);
    const error = waited.match({
      ok: () => {
        throw new Error("waitFor unexpectedly succeeded");
      },
      err: (value) => value,
    });
    assertEquals(error.operation, "waitFor");
    assertEquals(error.getContext().reason, "aborted");
    assertEquals(error.getContext().key, "incoming/missing.txt");
  },
});
