import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  headers as natsHeaders,
  type Msg,
  type MsgHdrs,
  type NatsConnection,
  type Payload,
  PermissionViolationError,
  type Subscription,
} from "@nats-io/nats-core";
import { type BaseError, isErr, Result } from "@qlever-llc/result";
import { sdk as core } from "@qlever-llc/trellis/sdk/core";
import { Type } from "typebox";

import type { LoggerLike } from "../globals.ts";
import { TransportError } from "../errors/index.ts";
import { defineServiceContract } from "../contract.ts";
import type { NatsConnectFn } from "./runtime.ts";
import { HealthResponseSchema, HealthRpcSchema } from "./health_schemas.ts";
import { connectTrellisServiceInternal } from "./internal_connect.ts";
import {
  connectTrellisServiceWithRuntimeDeps,
  type SqlOutbox,
  StoreHandle,
  TrellisService,
  type TrellisServiceConnectArgs,
} from "./service.ts";
import type { SqlExecutor, SqlRow } from "../service/outbox_inbox.ts";

const TEST_SEED = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const handlerSurfaceTestSchemas = {
  PingInput: Type.Object({ value: Type.String() }),
  PingOutput: Type.Object({ ok: Type.Boolean() }),
  PingedEvent: Type.Object({ value: Type.String() }),
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
        authRequired: false,
        errors: [ref.error("UnexpectedError")],
      },
      "Test.BoundOne": {
        version: "v1",
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        authRequired: false,
        errors: [ref.error("UnexpectedError")],
      },
      "Test.BoundTwo": {
        version: "v1",
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        authRequired: false,
        errors: [ref.error("UnexpectedError")],
      },
      "Test.Unbound": {
        version: "v1",
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        authRequired: false,
        errors: [ref.error("UnexpectedError")],
      },
    },
    events: {
      "Test.Pinged": {
        version: "v1",
        event: ref.schema("PingedEvent"),
      },
    },
  }),
);

const jobsHandlerTestSchemas = {
  RefreshPayload: Type.Object({ siteId: Type.String() }),
  RefreshResult: Type.Object({ refreshId: Type.String() }),
  RefreshEvent: Type.Object({ siteId: Type.String(), label: Type.String() }),
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
    events: {
      "Jobs.Refreshed": {
        version: "v1",
        event: ref.schema("RefreshEvent"),
      },
    },
  }),
);

const heartbeatTestContract = defineServiceContract({}, () => ({
  id: "trellis.server.heartbeat-test@v1",
  displayName: "Heartbeat Test",
  description: "Verify heartbeat runtime lifecycle behavior.",
}));

const healthEndpointTestContract = defineServiceContract(
  {
    schemas: {
      HealthRequest: HealthRpcSchema,
      HealthResponse: HealthResponseSchema,
    },
  },
  (ref) => ({
    id: "trellis.server.health-endpoint-test@v1",
    displayName: "Health Endpoint Test",
    description: "Verify service health endpoint behavior.",
    rpc: {
      "Svc.Health": {
        version: "v1",
        input: ref.schema("HealthRequest"),
        output: ref.schema("HealthResponse"),
        authRequired: false,
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

type WaitableService = {
  wait(): Promise<void>;
  stop(): Promise<void>;
};

type PublishedNatsMessage = {
  subject: string;
  data: Uint8Array;
  headers?: MsgHdrs;
};

type TestSqlTx = {
  readonly id: string;
  readonly writes: string[];
};

type TestNatsStatus = {
  type: string;
  data?: string;
  error?: Error;
};

type TestOutboxRow = {
  id: string;
  event: string;
  subject: string;
  payload: string;
  headers: string;
  state: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  next_attempt_at: string | null;
  last_error: string | null;
};

function hasServiceWait(value: object): value is WaitableService {
  return Reflect.has(value, "wait") &&
    typeof Reflect.get(value, "wait") === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function waitForServiceStop(service: WaitableService): Promise<void> {
  return service.wait();
}

async function connectJobsHandlerTestService(opts?: {
  includeWorkStream?: boolean;
  deferClosed?: boolean;
  published?: PublishedNatsMessage[];
  jetstreamJobs?: boolean;
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
              jobs: {
                namespace: "jobs_handler_test",
                ...(includeWorkStream ? { workStream: "JOBS_WORK" } : {}),
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
    const connection = createFakeNatsConnection({
      deferClosed: opts?.deferClosed,
      published: opts?.published,
      jetstreamJobs: opts?.jetstreamJobs,
    });
    const service = await connectTrellisServiceWithRuntimeDeps({
      trellisUrl: "https://trellis.example.com",
      contract: jobsHandlerTestContract,
      name: "svc",
      sessionKeySeed: TEST_SEED,
      server: { log: false },
    }, {
      connect: async () => connection,
    }).orThrow();

    return {
      connection,
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

async function connectHandlerSurfaceTestService(opts?: {
  published?: PublishedNatsMessage[];
}) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_120,
          connectInfo: {
            sessionKey: "session-key",
            contractId: handlerSurfaceTestContract.CONTRACT_ID,
            contractDigest: handlerSurfaceTestContract.CONTRACT_DIGEST,
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
            contractId: handlerSurfaceTestContract.CONTRACT_ID,
            digest: handlerSurfaceTestContract.CONTRACT_DIGEST,
            resources: {
              kv: {},
              store: {},
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
    const connection = createFakeNatsConnection({ published: opts?.published });
    const service = await connectTrellisServiceWithRuntimeDeps({
      trellisUrl: "https://trellis.example.com",
      contract: handlerSurfaceTestContract,
      name: "svc",
      sessionKeySeed: TEST_SEED,
      server: { log: false },
    }, {
      connect: async () => connection,
    }).orThrow();

    return {
      connection,
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

async function connectHealthEndpointTestService() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_120,
          connectInfo: {
            sessionKey: "session-key",
            contractId: healthEndpointTestContract.CONTRACT_ID,
            contractDigest: healthEndpointTestContract.CONTRACT_DIGEST,
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
            contractId: healthEndpointTestContract.CONTRACT_ID,
            digest: healthEndpointTestContract.CONTRACT_DIGEST,
            resources: {
              kv: {},
              store: {},
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
    const connection = createFakeNatsConnection();
    const service = await connectTrellisServiceWithRuntimeDeps({
      trellisUrl: "https://trellis.example.com",
      contract: healthEndpointTestContract,
      name: "svc",
      sessionKeySeed: TEST_SEED,
      server: { log: false },
    }, {
      connect: async () => connection,
    }).orThrow();

    return {
      connection,
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
  statuses?: TestNatsStatus[];
  closedResult?: Error | void;
  deferClosed?: boolean;
  requestJson?: (subject: string) => unknown;
  published?: PublishedNatsMessage[];
  jetstreamJobs?: boolean;
} = {}): NatsConnection {
  type TestNatsConnection = NatsConnection & {
    options: { inboxPrefix: string };
    features: {
      get(feature: unknown): { min: string; ok: boolean };
    };
    addCloseListener(listener: unknown): void;
    removeCloseListener(listener: unknown): void;
  };

  const status = () => {
    const iterator = (async function* () {
      for (const entry of args.statuses ?? []) {
        yield entry as ReturnType<NatsConnection["status"]> extends
          AsyncIterable<infer T> ? T : never;
      }
    })();
    return Object.assign(iterator, { stop: () => {} });
  };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const queuedWork: Uint8Array[] = [];
  const lifecycleBySubject = new Map<string, Uint8Array>();

  const createMessage = (
    subject: string,
    value: unknown,
    data?: Uint8Array<ArrayBufferLike>,
    opts?: {
      headers?: MsgHdrs;
      reply?: string;
      onRespond?: (data: Uint8Array, headers?: MsgHdrs) => void;
    },
  ): Msg => {
    const messageData = data ?? new TextEncoder().encode(JSON.stringify(value));
    const message: Msg = {
      subject,
      sid: 1,
      data: messageData,
      headers: opts?.headers,
      reply: opts?.reply,
      respond: (payload?: Payload, responseOpts?: { headers?: MsgHdrs }) => {
        opts?.onRespond?.(payloadBytes(payload), responseOpts?.headers);
        return true;
      },
      json: <T>() => value as T,
      string: () => new TextDecoder().decode(messageData),
    };
    return Object.assign(message, { size: () => messageData.byteLength });
  };

  type BufferedSubscription = Subscription & {
    push(message: Msg): void;
  };

  const subscriptions: BufferedSubscription[] = [];
  const subjectMatches = (pattern: string, subject: string): boolean => {
    const patternParts = pattern.split(".");
    const subjectParts = subject.split(".");
    for (let index = 0; index < patternParts.length; index += 1) {
      const part = patternParts[index];
      if (part === ">") return true;
      if (subjectParts[index] === undefined) return false;
      if (part !== "*" && part !== subjectParts[index]) return false;
    }
    return patternParts.length === subjectParts.length;
  };
  const payloadBytes = (payload: Payload | undefined): Uint8Array => {
    if (payload === undefined) {
      return new Uint8Array();
    }
    if (typeof payload === "string") {
      return new TextEncoder().encode(payload);
    }
    return payload;
  };
  const createSubscription = (
    subject: string,
    opts?: { callback?: (err: Error | null, msg: Msg) => void },
  ): BufferedSubscription => {
    const queue: Msg[] = [];
    let closed = false;
    let received = 0;
    let pendingResolver: (() => void) | undefined;
    const notify = () => {
      pendingResolver?.();
      pendingResolver = undefined;
    };

    const subscription: BufferedSubscription = {
      closed: Promise.resolve(),
      unsubscribe: () => {
        closed = true;
        notify();
      },
      drain: async () => {
        closed = true;
        notify();
      },
      isDraining: () => false,
      isClosed: () => closed,
      callback: () => {},
      getSubject: () => subject,
      getReceived: () => received,
      getProcessed: () => received,
      getPending: () => queue.length,
      getID: () => 1,
      getMax: () => undefined,
      push: (message: Msg) => {
        if (closed) {
          return;
        }
        opts?.callback?.(null, message);
        queue.push(message);
        received += 1;
        notify();
      },
      [Symbol.asyncIterator]: async function* () {
        while (!closed) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            pendingResolver = resolve;
          });
        }
      },
    };
    subscriptions.push(subscription);
    return subscription;
  };

  let resolveClosed: ((value: Error | void) => void) | undefined;
  let closed = false;
  const closedPromise = args.deferClosed
    ? new Promise<Error | void>((resolve) => {
      resolveClosed = resolve;
    })
    : Promise.resolve(args.closedResult);

  const createJetStreamResponse = (subject: string): unknown => {
    if (subject === "$JS.API.INFO") {
      return {
        type: "io.nats.jetstream.api.v1.account_info_response",
        memory: 0,
        storage: 0,
        streams: 1,
        consumers: 1,
      };
    }
    if (subject.startsWith("$JS.API.CONSUMER.INFO.")) {
      return {
        type: "io.nats.jetstream.api.v1.consumer_info_response",
        stream_name: "JOBS_WORK",
        name: "jobs_handler_test-refreshSummaries",
        created: "2024-01-01T00:00:00.000Z",
        config: {
          durable_name: "jobs_handler_test-refreshSummaries",
          ack_policy: "explicit",
        },
      };
    }
    return {};
  };

  const publishQueuedWork = (reply: string): void => {
    const payload = queuedWork.shift();
    if (!payload) return;
    const subject =
      "trellis.jobs.jobs_handler_test.refreshSummaries.job.created";
    const replySubject =
      "$JS.ACK._.account.JOBS_WORK.jobs_handler_test-refreshSummaries.1.1.1.1700000000000000000.0.test";
    const message = createMessage(
      subject,
      JSON.parse(decoder.decode(payload)),
      payload,
      { reply: replySubject },
    );
    for (const subscription of subscriptions) {
      if (subjectMatches(subscription.getSubject(), reply)) {
        subscription.push(message);
      }
    }
  };

  const recordJobLifecycle = (subject: string, data: Uint8Array): void => {
    if (!args.jetstreamJobs) return;
    if (
      !subject.startsWith("trellis.jobs.jobs_handler_test.refreshSummaries.")
    ) {
      return;
    }
    lifecycleBySubject.set(subject, data);
    let event: { eventType?: unknown };
    try {
      event = JSON.parse(decoder.decode(data)) as { eventType?: unknown };
    } catch {
      return;
    }
    if (event.eventType === "created" || event.eventType === "retried") {
      queuedWork.push(data);
    }
  };

  const deliverToSubscriptions = (
    subject: string,
    data: Uint8Array,
    headers?: MsgHdrs,
  ): void => {
    let value: unknown = {};
    try {
      value = JSON.parse(decoder.decode(data));
    } catch {
      value = {};
    }
    for (const subscription of subscriptions) {
      if (subjectMatches(subscription.getSubject(), subject)) {
        subscription.push(createMessage(subject, value, data, { headers }));
      }
    }
  };

  const isJetStreamPublishSubject = (subject: string): boolean =>
    subject.startsWith("events.v1.") || subject.startsWith("trellis.jobs.");

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
    publish: (
      subject: string,
      data?: Payload,
      opts?: { headers?: MsgHdrs },
    ) => {
      const bytes = payloadBytes(data);
      args.published?.push({ subject, data: bytes, headers: opts?.headers });
      recordJobLifecycle(subject, bytes);
      if (
        args.jetstreamJobs && subject.startsWith("$JS.API.CONSUMER.MSG.NEXT.")
      ) {
        const reply = (opts as { reply?: string } | undefined)?.reply;
        if (reply) publishQueuedWork(reply);
      }
      deliverToSubscriptions(subject, bytes, opts?.headers);
    },
    publishMessage: () => {},
    respondMessage: () => true,
    subscribe: (
      subject: string,
      opts?: { callback?: (err: Error | null, msg: Msg) => void },
    ) => createSubscription(subject, opts),
    request: async (
      subject: string,
      payload?: Payload,
      opts?: { headers?: MsgHdrs },
    ) => {
      if (
        args.jetstreamJobs && subject.startsWith("$JS.API.DIRECT.GET.JOBS.")
      ) {
        const data = [...lifecycleBySubject]
          .reverse()
          .find(([key]) =>
            key.startsWith("trellis.jobs.jobs_handler_test.refreshSummaries.")
          )
          ?.[1] ?? encoder.encode("{}");
        return createMessage(subject, {}, data, { headers: natsHeaders(0) });
      }
      if (args.jetstreamJobs && subject.startsWith("$JS.API.")) {
        return createMessage(subject, createJetStreamResponse(subject));
      }
      if (args.requestJson) {
        return createMessage(subject, args.requestJson(subject));
      }
      const bytes = payloadBytes(payload);
      if (isJetStreamPublishSubject(subject)) {
        return createMessage(subject, { stream: "EVENTS", seq: 1 });
      }
      const subscription = subscriptions.find((candidate) =>
        subjectMatches(candidate.getSubject(), subject)
      );
      if (!subscription) {
        return createMessage(subject, {});
      }

      let value: unknown = {};
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        value = {};
      }
      return await new Promise<Msg>((resolve) => {
        subscription.push(createMessage(subject, value, bytes, {
          headers: opts?.headers,
          reply: "_INBOX.test.reply",
          onRespond: (data) => {
            let responseValue: unknown = {};
            try {
              responseValue = JSON.parse(new TextDecoder().decode(data));
            } catch {
              responseValue = {};
            }
            resolve(createMessage(subject, responseValue, data));
          },
        }));
      });
    },
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
    features: {
      get: () => ({ min: "0.0.0", ok: true }),
    },
    addCloseListener: () => {},
    removeCloseListener: () => {},
  };

  return connection;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTestSqlOutboxStore(): SqlExecutor & {
  readonly claimDueQueries: number;
  snapshot(): readonly TestOutboxRow[];
  restore(rows: readonly TestOutboxRow[]): void;
} {
  let rows: TestOutboxRow[] = [];
  let claimDueQueries = 0;
  const copyRows = () => rows.map((row) => ({ ...row }));
  return {
    get claimDueQueries() {
      return claimDueQueries;
    },
    async query(sql: string, params: readonly unknown[]): Promise<SqlRow[]> {
      if (sql.startsWith("SELECT id, event, subject, payload")) {
        claimDueQueries += 1;
        const dueAt = String(params[1]);
        const limit = Number(params[2]);
        return rows
          .filter((row) =>
            row.state !== "dispatched" &&
            (row.next_attempt_at === null || row.next_attempt_at <= dueAt)
          )
          .slice(0, limit)
          .map((row) => ({ ...row }));
      }
      return [];
    },
    async execute(sql: string, params: readonly unknown[]): Promise<void> {
      if (sql.startsWith("INSERT INTO trellis_outbox")) {
        const id = String(params[0]);
        if (rows.some((row) => row.id === id)) return;
        rows.push({
          id,
          event: String(params[1]),
          subject: String(params[2]),
          payload: String(params[3]),
          headers: String(params[4]),
          state: String(params[5]),
          attempts: Number(params[6]),
          created_at: String(params[7]),
          updated_at: String(params[8]),
          next_attempt_at: null,
          last_error: null,
        });
        return;
      }
      if (sql.startsWith("UPDATE trellis_outbox SET state =")) {
        if (params[0] === "dispatched") {
          const id = String(params[2]);
          rows = rows.map((row) =>
            row.id === id
              ? {
                ...row,
                state: "dispatched",
                updated_at: String(params[1]),
                next_attempt_at: null,
                last_error: null,
              }
              : row
          );
          return;
        }
        if (params[0] === "failed") {
          const id = String(params[4]);
          rows = rows.map((row) =>
            row.id === id
              ? {
                ...row,
                state: "failed",
                attempts: row.attempts + 1,
                updated_at: String(params[1]),
                next_attempt_at: String(params[2]),
                last_error: String(params[3]),
              }
              : row
          );
        }
      }
    },
    snapshot: copyRows,
    restore(nextRows: readonly TestOutboxRow[]): void {
      rows = nextRows.map((row) => ({ ...row }));
    },
  };
}

function createSqlOutboxTestOptions(
  store: ReturnType<typeof createTestSqlOutboxStore>,
) {
  let transactionCalls = 0;
  return {
    options: {
      dialect: "sqlite" as const,
      executor: store,
      dispatcher: { debounceMs: 0, idleRetryMs: 60_000 },
      transaction: async <TResult>(
        work: (context: {
          tx: TestSqlTx;
          executor: SqlExecutor;
        }) => Promise<TResult> | TResult,
      ): Promise<TResult> => {
        transactionCalls += 1;
        const before = store.snapshot();
        const tx: TestSqlTx = { id: `tx-${transactionCalls}`, writes: [] };
        try {
          return await work({ tx, executor: store });
        } catch (error) {
          store.restore(before);
          throw error;
        }
      },
    },
    get transactionCalls() {
      return transactionCalls;
    },
  };
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

function installCoreBootstrapFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_120,
          connectInfo: {
            sessionKey: "session-key",
            contractId: core.CONTRACT_ID,
            contractDigest: core.CONTRACT_DIGEST,
            transports: {
              native: { natsServers: ["nats://127.0.0.1:4222"] },
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
            contractId: core.CONTRACT_ID,
            digest: core.CONTRACT_DIGEST,
            resources: { kv: {}, store: {} },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    )) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
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
  let waitOnFirstConnect: unknown;

  const fakeConnect: NatsConnectFn = async (opts) => {
    connectServers = Array.isArray(opts.servers)
      ? opts.servers.join(",")
      : opts.servers;
    maxReconnectAttempts = opts.maxReconnectAttempts;
    waitOnFirstConnect = opts.waitOnFirstConnect;
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
        connectTrellisServiceWithRuntimeDeps({
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
    assertEquals(waitOnFirstConnect, true);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

Deno.test("TrellisService.connect initializes telemetry by default", async () => {
  const restoreFetch = installCoreBootstrapFetch();
  const initializedServices: string[] = [];

  try {
    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: {},
        }, {
          connect: async () => {
            throw new Error("stop-after-connect");
          },
          initTelemetry: (serviceName) => {
            initializedServices.push(serviceName);
          },
        }).orThrow(),
      TransportError,
    );

    assertEquals(initializedServices, ["svc"]);
  } finally {
    restoreFetch();
  }
});

Deno.test("TrellisService.connect skips telemetry when disabled", async () => {
  const restoreFetch = installCoreBootstrapFetch();
  const initializedServices: string[] = [];

  try {
    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          telemetry: { enabled: false },
          server: {},
        }, {
          connect: async () => {
            throw new Error("stop-after-connect");
          },
          initTelemetry: (serviceName) => {
            initializedServices.push(serviceName);
          },
        }).orThrow(),
      TransportError,
    );

    assertEquals(initializedServices, []);
  } finally {
    restoreFetch();
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
        connectTrellisServiceWithRuntimeDeps({
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

Deno.test("TrellisService.connect retries bootstrap with manifest when required", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];

  const fakeConnect: NatsConnectFn = async () => {
    throw new Error("stop-after-connect");
  };

  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ reason: "manifest_required" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
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
              native: { natsServers: ["nats://127.0.0.1:4222"] },
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
            resources: { kv: {} },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: {},
        }, { connect: fakeConnect }).orThrow(),
      TransportError,
    );

    assertEquals(requestBodies.length, 2);
    assertEquals("contract" in requestBodies[0], false);
    assertEquals(requestBodies[1].contract, core.CONTRACT);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("TrellisService.connect retries when bootstrap endpoint is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const testLogger = createTestLogger();
  const scheduledDelays: number[] = [];
  let fetchCount = 0;

  try {
    globalThis.setTimeout = ((
      handler: Parameters<typeof setTimeout>[0],
      timeout?: number,
    ) => {
      scheduledDelays.push(timeout ?? 0);
      return originalSetTimeout(handler, 0);
    }) as typeof setTimeout;
    globalThis.fetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.reject(new TypeError("Connection refused"));
      }
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
                native: { natsServers: ["nats://127.0.0.1:4222"] },
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
              resources: { kv: {} },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: { log: testLogger.logger },
        }, {
          connect: (): Promise<NatsConnection> =>
            Promise.reject(new Error("stop-after-bootstrap")),
        }).orThrow(),
      TransportError,
      "Trellis could not open the service runtime connection.",
    );

    assertEquals(fetchCount, 2);
    assertEquals(scheduledDelays, [1_000]);
    assertEquals(testLogger.warnCalls, [[{
      service: "svc",
      trellisUrl: "https://trellis.example.com",
      contractId: core.CONTRACT_ID,
      contractDigest: core.CONTRACT_DIGEST,
      attempt: 1,
      retryDelayMs: 1_000,
      causeMessage: "Connection refused",
    }, "Service bootstrap endpoint unavailable; retrying"]]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

Deno.test("internal service connect uses a reconnect-safe auth token authenticator", async () => {
  const originalNow = Date.now;
  let firstToken = "";
  let secondToken = "";
  let authenticatorCount = 0;
  let maxReconnectAttempts: unknown;
  let waitOnFirstConnect: unknown;

  try {
    let nowMs = 1_700_000_000_000;
    Date.now = () => nowMs;

    await assertRejects(
      () =>
        connectTrellisServiceInternal("svc", {
          sessionKeySeed: TEST_SEED,
          contractDigest: core.CONTRACT_DIGEST,
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
            waitOnFirstConnect = opts.waitOnFirstConnect;
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
      contractDigest: string;
      iat: number;
      sig: string;
    };
    const second = JSON.parse(secondToken) as {
      sessionKey: string;
      contractDigest: string;
      iat: number;
      sig: string;
    };

    assertEquals(authenticatorCount, 2);
    assertEquals(first.sessionKey, second.sessionKey);
    assertEquals(first.contractDigest, core.CONTRACT_DIGEST);
    assertEquals(second.contractDigest, core.CONTRACT_DIGEST);
    assertEquals(second.iat - first.iat, 31);
    assertNotEquals(first.sig, second.sig);
    assertEquals(maxReconnectAttempts, -1);
    assertEquals(waitOnFirstConnect, true);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("internal service connect preserves explicit reconnect attempt overrides", async () => {
  let maxReconnectAttempts: unknown;
  let waitOnFirstConnect: unknown;

  await assertRejects(
    () =>
      connectTrellisServiceInternal("svc", {
        sessionKeySeed: TEST_SEED,
        contractDigest: core.CONTRACT_DIGEST,
        nats: {
          servers: "nats://127.0.0.1:4222",
          authenticator: {},
          options: { maxReconnectAttempts: 3, waitOnFirstConnect: false },
        },
        server: {
          api: core.API.owned,
          trellisApi: core.API.trellis,
          log: false,
        },
      }, {
        connect: async (opts): Promise<NatsConnection> => {
          maxReconnectAttempts = opts.maxReconnectAttempts;
          waitOnFirstConnect = opts.waitOnFirstConnect;
          throw new Error("stop-after-connect-options");
        },
      }),
    Error,
    "stop-after-connect-options",
  );

  assertEquals(maxReconnectAttempts, 3);
  assertEquals(waitOnFirstConnect, false);
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
        connectTrellisServiceWithRuntimeDeps({
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

Deno.test("TrellisService.connect waits for pending authority update", async () => {
  const originalFetch = globalThis.fetch;
  const testLogger = createTestLogger();
  let fetchCount = 0;

  try {
    globalThis.fetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reason: "authority_update_required",
              message:
                "Service deployment 'demo-js' authority does not cover contract 'trellis.demo-service@v1'. A deployment authority update plan is pending.",
              planId: "plan_123",
              deploymentId: "demo-js",
            }),
            {
              status: 202,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "0",
              },
            },
          ),
        );
      }
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
                native: { natsServers: ["nats://127.0.0.1:4222"] },
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
              resources: { kv: {} },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: { log: testLogger.logger },
        }, {
          connect: (): Promise<NatsConnection> =>
            Promise.reject(new Error("stop-after-bootstrap")),
        }).orThrow(),
      TransportError,
      "Trellis could not open the service runtime connection.",
    );
    assertEquals(fetchCount, 2);
    assertEquals(testLogger.infoCalls, [[
      {
        service: "svc",
        deploymentId: "demo-js",
        planId: "plan_123",
        contractId: core.CONTRACT_ID,
        contractDigest: core.CONTRACT_DIGEST,
        retryDelayMs: 0,
      },
      "Service deployment 'demo-js' authority does not cover contract 'trellis.demo-service@v1'. A deployment authority update plan is pending.",
    ]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("TrellisService.connect treats failed authority reconciliation as terminal", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  try {
    globalThis.fetch = (() => {
      fetchCount += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            reason: "authority_reconciliation_failed",
            message:
              "Service deployment 'demo-js' authority reconciliation failed.",
            deploymentId: "demo-js",
          }),
          {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "0",
            },
          },
        ),
      );
    }) as typeof fetch;

    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
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
      "Service bootstrap failed: Service deployment 'demo-js' authority reconciliation failed.",
    );
    assertEquals(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("TrellisService.connect waits for pending contract activation", async () => {
  const originalFetch = globalThis.fetch;
  const testLogger = createTestLogger();
  let fetchCount = 0;

  try {
    globalThis.fetch = (() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reason: "contract_activation_pending",
              message:
                "Service contract 'trellis.core@v1' digest 'digest_123' is waiting for dependency 'billing' (billing.example@v1) to have an active running implementation.",
              deploymentId: "demo-js",
              dependencyAlias: "billing",
              dependencyContractId: "billing.example@v1",
              dependencySurface: "contract",
              dependencyReason: "dependency_not_active",
            }),
            {
              status: 202,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "0",
              },
            },
          ),
        );
      }
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
                native: { natsServers: ["nats://127.0.0.1:4222"] },
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
              resources: { kv: {} },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: { log: testLogger.logger },
        }, {
          connect: (): Promise<NatsConnection> =>
            Promise.reject(new Error("stop-after-bootstrap")),
        }).orThrow(),
      TransportError,
      "Trellis could not open the service runtime connection.",
    );
    assertEquals(fetchCount, 2);
    assertEquals(testLogger.infoCalls, [[
      {
        service: "svc",
        deploymentId: "demo-js",
        requestId: undefined,
        contractId: core.CONTRACT_ID,
        contractDigest: core.CONTRACT_DIGEST,
        dependencyAlias: "billing",
        dependencyContractId: "billing.example@v1",
        dependencySurface: "contract",
        dependencyReason: "dependency_not_active",
        dependencyKey: undefined,
        retryDelayMs: 0,
      },
      "Service contract activation pending; waiting for dependency 'billing' (billing.example@v1) to have an active running implementation",
    ]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("TrellisService.connect waits for pending contract catalog issue", async () => {
  const originalFetch = globalThis.fetch;
  const testLogger = createTestLogger();
  const requestBodies: Array<Record<string, unknown>> = [];
  let fetchCount = 0;

  try {
    globalThis.fetch = ((_input, init) => {
      fetchCount += 1;
      if (typeof init?.body !== "string") {
        throw new Error("bootstrap request body should be JSON");
      }
      requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
      if (fetchCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              reason: "contract_catalog_issue",
              message:
                "Service contract 'trellis.core@v1' has a pending forced update.",
              deploymentId: "demo-js",
              issueId: "issue_123",
              activeContractDigest: "digest_active",
            }),
            {
              status: 409,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "0",
              },
            },
          ),
        );
      }
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
                native: { natsServers: ["nats://127.0.0.1:4222"] },
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
              resources: { kv: {} },
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    await assertRejects(
      () =>
        connectTrellisServiceWithRuntimeDeps({
          trellisUrl: "https://trellis.example.com",
          contract: core,
          name: "svc",
          sessionKeySeed: TEST_SEED,
          server: { log: testLogger.logger },
        }, {
          connect: (): Promise<NatsConnection> =>
            Promise.reject(new Error("stop-after-bootstrap")),
        }).orThrow(),
      TransportError,
      "Trellis could not open the service runtime connection.",
    );
    assertEquals(fetchCount, 2);
    assertEquals("contract" in requestBodies[0], false);
    assertEquals(requestBodies[1].contract, core.CONTRACT);
    assertEquals(testLogger.infoCalls, [[
      {
        service: "svc",
        deploymentId: "demo-js",
        issueId: "issue_123",
        activeContractDigest: "digest_active",
        contractId: core.CONTRACT_ID,
        contractDigest: core.CONTRACT_DIGEST,
        retryDelayMs: 0,
      },
      "Service contract catalog issue pending; waiting for admin resolution",
    ]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("internal service connect accepts log false", async () => {
  const service = await connectTrellisServiceInternal("svc", {
    sessionKeySeed: TEST_SEED,
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
    connect: async () => createFakeNatsConnection({ deferClosed: true }),
  });

  try {
    assertEquals(service.name, "svc");
  } finally {
    await service.stop();
  }
});

Deno.test("internal service connect uses the provided logger", async () => {
  const testLogger = createTestLogger();

  const service = await connectTrellisServiceInternal("svc", {
    sessionKeySeed: TEST_SEED,
    contractDigest: core.CONTRACT_DIGEST,
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
    contractDigest: core.CONTRACT_DIGEST,
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
    contractDigest: core.CONTRACT_DIGEST,
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
    contractDigest: core.CONTRACT_DIGEST,
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
    contractDigest: heartbeatTestContract.CONTRACT_DIGEST,
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

    await connection.close();
    await delay(30);

    assertEquals(publishRequests, requestsBeforeClose);
  } finally {
    await service.stop();
  }
});

Deno.test("service heartbeat publishing starts from baseline health use", async () => {
  let publishRequests = 0;
  const connection = createFakeNatsConnection({
    requestJson: () => {
      publishRequests += 1;
      return { stream: "HEALTH", seq: publishRequests, duplicate: false };
    },
  });

  const service = await connectTrellisServiceInternal("svc", {
    sessionKeySeed: TEST_SEED,
    contractDigest: heartbeatTestContract.CONTRACT_DIGEST,
    nats: {
      servers: "nats://127.0.0.1:4222",
      authenticator: {},
    },
    server: {
      api: heartbeatTestContract.API.owned,
      trellisApi: heartbeatTestContract.API.trellis,
      log: false,
    },
  }, {
    connect: () => Promise.resolve(connection),
  });

  try {
    assertEquals(publishRequests > 0, true);
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

Deno.test("bound service event listeners receive object args with deps", async () => {
  const { connection, service, restore } =
    await connectHandlerSurfaceTestService();
  const deps = { prefix: "dep" };
  let observed:
    | {
      value: string;
      eventId: string;
      eventTime: string;
      subject: string;
      mode: "durable" | "ephemeral";
      prefix: string;
    }
    | undefined;

  try {
    const registered = await service.event.test.pinged.listen(
      (event, context) => {
        observed = {
          value: event.value,
          eventId: context.id,
          eventTime: context.time.toISOString(),
          subject: context.subject,
          mode: context.mode,
          prefix: deps.prefix,
        };
        return Result.ok(undefined);
      },
      {},
      { mode: "ephemeral" },
    ).orThrow();
    assertEquals(registered, undefined);

    const prepared = service.event.test.pinged.prepare({ value: "one" })
      .orThrow();
    const headers = natsHeaders();
    for (const [key, value] of Object.entries(prepared.headers)) {
      headers.set(key, value);
    }
    connection.publish(prepared.subject, prepared.encodedPayload, { headers });
    await delay(10);

    assertEquals(observed, {
      value: "one",
      eventId: prepared.header.id,
      eventTime: prepared.header.time,
      subject: prepared.subject,
      mode: "ephemeral",
      prefix: "dep",
    });
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("bound service RPC handlers receive isolated deps", async () => {
  const { connection, service, restore } =
    await connectHandlerSurfaceTestService();
  const observed: string[] = [];
  let unboundHadDeps = true;

  try {
    await service.handle.rpc.test.boundOne(
      ({ input }) => {
        observed.push(`one:${input.value}`);
        return Result.ok({ ok: true });
      },
    );
    await service.handle.rpc.test.boundTwo(
      ({ input }) => {
        observed.push(`two:${input.value}`);
        return Result.ok({ ok: true });
      },
    );
    await service.handle.rpc.test.unbound((args) => {
      unboundHadDeps = Reflect.has(args, "deps");
      return Result.ok({ ok: true });
    });

    const first = await connection.request(
      "rpc.v1.Test.BoundOne",
      JSON.stringify({ value: "a" }),
    );
    const second = await connection.request(
      "rpc.v1.Test.BoundTwo",
      JSON.stringify({ value: "b" }),
    );
    const unbound = await connection.request(
      "rpc.v1.Test.Unbound",
      JSON.stringify({ value: "c" }),
    );

    assertEquals(first.json(), { ok: true });
    assertEquals(second.json(), { ok: true });
    assertEquals(unbound.json(), { ok: true });
    assertEquals(observed, ["one:a", "two:b"]);
    assertEquals(unboundHadDeps, false);
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("SQL outbox wrapper injects RPC handler outbox and drains enqueued events", async () => {
  const published: PublishedNatsMessage[] = [];
  const { connection, service, restore } =
    await connectHandlerSurfaceTestService({ published });
  const store = createTestSqlOutboxStore();
  const outbox = createSqlOutboxTestOptions(store);
  let observedTx: TestSqlTx | undefined;
  let normalEventHasEnqueue = true;

  try {
    normalEventHasEnqueue = Reflect.has(service.event.test.pinged, "enqueue");
    const pingOutbox = service.createSqlOutbox(outbox.options);
    const prefix = "dep";
    await service.handle.rpc.test.ping(async ({ input }) => {
      const result = await pingOutbox.transaction(async ({ tx, event }) => {
        tx.writes.push(`domain:${input.value}`, `audit:${prefix}`);
        observedTx = tx;
        await event.test.pinged.enqueue({ value: input.value }).orThrow();
        await event.test.pinged.enqueue({ value: prefix }).orThrow();
        return tx.writes.length;
      }).orThrow();

      return Result.ok({ ok: result === 2 });
    });

    const response = await connection.request(
      "rpc.v1.Test.Ping",
      JSON.stringify({ value: "one" }),
    );
    await delay(20);

    assertEquals(response.json(), { ok: true });
    assertEquals(observedTx?.writes, ["domain:one", "audit:dep"]);
    assertEquals(outbox.transactionCalls, 1);
    assertEquals(store.snapshot().map((row) => row.state), [
      "dispatched",
      "dispatched",
    ]);
    assertEquals(store.snapshot().map((row) => row.event), [
      "Test.Pinged",
      "Test.Pinged",
    ]);
    assertEquals(normalEventHasEnqueue, false);
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("SQL outbox wrapper injects event listener outbox and drains enqueued events", async () => {
  const published: PublishedNatsMessage[] = [];
  const { connection, service, restore } =
    await connectHandlerSurfaceTestService({
      published,
    });
  const store = createTestSqlOutboxStore();
  const outbox = createSqlOutboxTestOptions(store);
  const observed: string[] = [];
  let wrapperEventHasEnqueue = true;

  try {
    const eventOutbox = service.createSqlOutbox(outbox.options);
    const prefix = "dep";
    wrapperEventHasEnqueue = Reflect.has(service.event.test.pinged, "enqueue");
    await service.event.test.pinged.listen(
      async (event, context) => {
        const result = await eventOutbox.transaction(
          async ({ tx, event: out }) => {
            tx.writes.push(
              `event:${event.value}`,
              `subject:${context.subject}`,
            );
            observed.push(
              prefix,
              ...tx.writes,
            );
            await out.test.pinged.enqueue({ value: prefix }).orThrow();
            return tx.writes.length;
          },
        ).orThrow();
        assertEquals(result, 2);
        return Result.ok(undefined);
      },
      {},
      { mode: "ephemeral" },
    ).orThrow();

    const prepared = service.event.test.pinged.prepare({ value: "incoming" })
      .orThrow();
    const headers = natsHeaders();
    for (const [key, value] of Object.entries(prepared.headers)) {
      headers.set(key, value);
    }
    connection.publish(prepared.subject, prepared.encodedPayload, { headers });
    await delay(20);

    assertEquals(wrapperEventHasEnqueue, false);
    assertEquals(observed, [
      "dep",
      "event:incoming",
      "subject:events.v1.Test.Pinged",
    ]);
    assertEquals(outbox.transactionCalls, 1);
    assertEquals(store.snapshot().map((row) => row.state), ["dispatched"]);
    assertEquals(store.snapshot().map((row) => row.event), ["Test.Pinged"]);
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("SQL outbox wrapper does not dispatch rolled back transaction events", async () => {
  const published: PublishedNatsMessage[] = [];
  const { connection, service, restore } =
    await connectHandlerSurfaceTestService({ published });
  const store = createTestSqlOutboxStore();
  const outbox = createSqlOutboxTestOptions(store);

  try {
    const rollbackOutbox = service.createSqlOutbox(outbox.options);
    await service.handle.rpc.test.ping(
      async () => {
        const result = await rollbackOutbox.transaction(async ({ event }) => {
          await event.test.pinged.enqueue({ value: "rolled-back" }).orThrow();
          throw new Error("rollback");
        }).take();

        assertEquals(isErr(result), true);
        return Result.ok({ ok: true });
      },
    );

    const response = await connection.request(
      "rpc.v1.Test.Ping",
      JSON.stringify({ value: "one" }),
    );
    await delay(20);

    assertEquals(response.json(), { ok: true });
    assertEquals(store.snapshot(), []);
    assertEquals(published, []);
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("SQL outbox wrapper injects job handler outbox and drains enqueued events", async () => {
  const published: PublishedNatsMessage[] = [];
  const { service, restore } = await connectJobsHandlerTestService({
    deferClosed: true,
    jetstreamJobs: true,
    published,
  });
  const store = createTestSqlOutboxStore();
  const outbox = createSqlOutboxTestOptions(store);
  const observed: string[] = [];

  try {
    const jobOutbox = service.createSqlOutbox(outbox.options);
    const label = "dep";
    service.jobs.refreshSummaries.handle(
      async ({ job, client }) => {
        await jobOutbox.transaction(async ({ tx, event }) => {
          tx.writes.push(`job:${job.payload.siteId}`);
          observed.push(
            label,
            typeof client.event.jobs.refreshed.prepare === "function"
              ? "client"
              : "missing",
            ...tx.writes,
          );
          await event.jobs.refreshed.enqueue({
            siteId: job.payload.siteId,
            label,
          }).orThrow();
        }).orThrow();
        return Result.ok({ refreshId: `refresh-${job.payload.siteId}` });
      },
    );

    await service.jobs.refreshSummaries.create({ siteId: "site-1" }).orThrow();
    const waiting = service.wait();
    await delay(50);

    assertEquals(observed, ["dep", "client", "job:site-1"]);
    assertEquals(outbox.transactionCalls, 1);
    assertEquals(store.snapshot().map((row) => row.state), ["dispatched"]);
    assertEquals(store.snapshot().map((row) => row.event), ["Jobs.Refreshed"]);

    await service.stop();
    await waiting;
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("service stop stops owned SQL outbox dispatcher", async () => {
  const published: PublishedNatsMessage[] = [];
  const { connection, service, restore } =
    await connectHandlerSurfaceTestService({
      published,
    });
  const store = createTestSqlOutboxStore();
  const outboxOptions = createSqlOutboxTestOptions(store);
  let injectedOutbox:
    | SqlOutbox<TestSqlTx, typeof handlerSurfaceTestContract.API.owned>
    | undefined;

  try {
    injectedOutbox = service.createSqlOutbox(outboxOptions.options);
    await service.handle.rpc.test.ping(
      () => {
        return Result.ok({ ok: true });
      },
    );
    await connection.request(
      "rpc.v1.Test.Ping",
      JSON.stringify({ value: "capture" }),
    );
    await service.stop();

    await injectedOutbox?.transaction(async ({ event }) => {
      await event.test.pinged.enqueue({ value: "after-stop" }).orThrow();
    }).orThrow();
    await delay(20);

    assertEquals(store.snapshot().map((row) => row.state), ["pending"]);
    assertEquals(published, []);
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("bound service health checks receive deps through standard health RPC", async () => {
  const { connection, service, restore } =
    await connectHealthEndpointTestService();

  try {
    const healthSummary = "from deps";
    service.health.add(
      "dependency",
      () => ({ status: "ok", summary: healthSummary }),
    );

    const response = await connection.request(
      "rpc.v1.Svc.Health",
      JSON.stringify({}),
    );
    const body: unknown = response.json();
    if (!isRecord(body) || !Array.isArray(body.checks)) {
      throw new Error("health response did not include checks");
    }

    const dependencyCheck = body.checks.find((check) =>
      isRecord(check) && check.name === "dependency"
    );
    if (!isRecord(dependencyCheck)) {
      throw new Error("dependency health check was not returned");
    }

    assertEquals(dependencyCheck.status, "ok");
    assertEquals(dependencyCheck.summary, "from deps");
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test({
  name: "internal service connect defaults to the server logger",
  sanitizeOps: false,
  async fn() {
    const service = await connectTrellisServiceInternal("svc", {
      sessionKeySeed: TEST_SEED,
      contractDigest: core.CONTRACT_DIGEST,
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
  const { connection, service, restore } = await connectJobsHandlerTestService({
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
    assertEquals(connection.isClosed(), true);
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("service wait resolves after service stop when no job handlers are registered", async () => {
  const { connection, service, restore } = await connectJobsHandlerTestService({
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

Deno.test("service-local JobRef wait observes scoped lifecycle events", async () => {
  const published: PublishedNatsMessage[] = [];
  const { connection, service, restore } = await connectJobsHandlerTestService({
    published,
  });

  try {
    const ref = await service.jobs.refreshSummaries.create({
      siteId: "site-1",
    }).orThrow();
    const context = (await ref.get().orThrow()).context;
    const waiting = ref.wait().orThrow();

    await delay(5);
    connection.publish(
      `trellis.jobs.jobs_handler_test.refreshSummaries.${ref.id}.completed`,
      new TextEncoder().encode(JSON.stringify({
        jobId: ref.id,
        service: "jobs_handler_test",
        jobType: "refreshSummaries",
        eventType: "completed",
        state: "completed",
        previousState: "pending",
        context,
        tries: 1,
        result: { refreshId: "refresh-1" },
        timestamp: "2024-01-01T00:00:01.000Z",
      })),
    );

    const terminal = await waiting;
    assertEquals(terminal.state, "completed");
    assertEquals(terminal.result, { refreshId: "refresh-1" });

    const latest = await ref.get().orThrow();
    assertEquals(latest.state, "completed");
    assertEquals(latest.result, { refreshId: "refresh-1" });
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("service-local JobRef wait observes terminal event before wait starts", async () => {
  const { connection, service, restore } =
    await connectJobsHandlerTestService();

  try {
    const ref = await service.jobs.refreshSummaries.create({
      siteId: "site-1",
    }).orThrow();
    const context = (await ref.get().orThrow()).context;

    connection.publish(
      `trellis.jobs.jobs_handler_test.refreshSummaries.${ref.id}.completed`,
      new TextEncoder().encode(JSON.stringify({
        jobId: ref.id,
        service: "jobs_handler_test",
        jobType: "refreshSummaries",
        eventType: "completed",
        state: "completed",
        previousState: "pending",
        context,
        tries: 1,
        result: { refreshId: "refresh-before-wait" },
        timestamp: "2024-01-01T00:00:01.000Z",
      })),
    );
    await delay(5);

    const terminal = await ref.wait().orThrow();
    assertEquals(terminal.state, "completed");
    assertEquals(terminal.result, { refreshId: "refresh-before-wait" });

    const latest = await ref.get().orThrow();
    assertEquals(latest.state, "completed");
    assertEquals(latest.result, { refreshId: "refresh-before-wait" });
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("service-local JobRef cancel publishes scoped cancelled lifecycle event", async () => {
  const published: PublishedNatsMessage[] = [];
  const { connection, service, restore } = await connectJobsHandlerTestService({
    published,
  });

  try {
    const ref = await service.jobs.refreshSummaries.create({
      siteId: "site-1",
    }).orThrow();
    const created = await ref.get().orThrow();
    const cancelled = await ref.cancel().orThrow();

    assertEquals(cancelled.state, "cancelled");
    const eventMessage = published.find((message) =>
      message.subject ===
        `trellis.jobs.jobs_handler_test.refreshSummaries.${ref.id}.cancelled`
    );
    if (!eventMessage) {
      throw new Error("expected cancelled lifecycle event to be published");
    }

    const event = JSON.parse(new TextDecoder().decode(eventMessage.data)) as {
      jobId: string;
      service: string;
      jobType: string;
      eventType: string;
      state: string;
      previousState: string;
    };
    assertEquals(event.jobId, ref.id);
    assertEquals(event.service, "jobs_handler_test");
    assertEquals(event.jobType, "refreshSummaries");
    assertEquals(event.eventType, "cancelled");
    assertEquals(event.state, "cancelled");
    assertEquals(event.previousState, "pending");
    assertEquals(
      eventMessage.headers?.get("request-id"),
      created.context.requestId,
    );
    assertEquals(
      eventMessage.headers?.get("traceparent"),
      created.context.traceparent,
    );

    const latest = await ref.get().orThrow();
    assertEquals(latest.state, "cancelled");
  } finally {
    await service.stop();
    restore();
  }
});

Deno.test("service-local JobRef cancel is a no-op after terminal completion", async () => {
  const published: PublishedNatsMessage[] = [];
  const { connection, service, restore } = await connectJobsHandlerTestService({
    published,
  });

  try {
    const ref = await service.jobs.refreshSummaries.create({
      siteId: "site-1",
    }).orThrow();
    const context = (await ref.get().orThrow()).context;
    connection.publish(
      `trellis.jobs.jobs_handler_test.refreshSummaries.${ref.id}.completed`,
      new TextEncoder().encode(JSON.stringify({
        jobId: ref.id,
        service: "jobs_handler_test",
        jobType: "refreshSummaries",
        eventType: "completed",
        state: "completed",
        previousState: "pending",
        context,
        tries: 1,
        result: { refreshId: "refresh-1" },
        timestamp: "2024-01-01T00:00:01.000Z",
      })),
    );
    await delay(5);

    const cancelled = await ref.cancel().orThrow();
    assertEquals(cancelled.state, "completed");
    assertEquals(cancelled.result, { refreshId: "refresh-1" });
    assertEquals(
      published.some((message) =>
        message.subject ===
          `trellis.jobs.jobs_handler_test.refreshSummaries.${ref.id}.cancelled`
      ),
      false,
    );
  } finally {
    await service.stop();
    restore();
  }
});
