import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { Msg, Subscription } from "@nats-io/nats-core";
import { isErr, ok } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";
import { Type } from "typebox";

import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { AuthError } from "../errors/index.ts";
import { API as CORE_API } from "../sdk/core.ts";
import {
  createTrellisInternal,
  Trellis,
  type TrellisAuth,
} from "../trellis.ts";

function createMockAuth(token = "test-token"): TrellisAuth {
  return {
    sessionKey: token,
    sign: () => new Uint8Array(64),
  };
}

function createMockNatsConnection(): NatsConnection {
  const closed: NatsConnection["closed"] = async () => undefined;
  const close: NatsConnection["close"] = async () => {};
  const publish: NatsConnection["publish"] = () => {};
  const publishMessage: NatsConnection["publishMessage"] = () => {};
  const respondMessage: NatsConnection["respondMessage"] = () => false;
  const subscribe: NatsConnection["subscribe"] = () => {
    throw new Error("subscribe should not be called in this test");
  };
  const request: NatsConnection["request"] = async () => {
    throw new Error("request should not be called in this test");
  };
  const requestMany: NatsConnection["requestMany"] = async () => {
    throw new Error("requestMany should not be called in this test");
  };
  const flush: NatsConnection["flush"] = async () => {};
  const drain: NatsConnection["drain"] = async () => {};
  const isClosed: NatsConnection["isClosed"] = () => false;
  const isDraining: NatsConnection["isDraining"] = () => false;
  const getServer: NatsConnection["getServer"] = () => "nats://127.0.0.1:4222";
  const status: NatsConnection["status"] = () => ({
    async *[Symbol.asyncIterator]() {},
  });
  const stats: NatsConnection["stats"] = () => ({
    inBytes: 0,
    outBytes: 0,
    inMsgs: 0,
    outMsgs: 0,
  });
  const rtt: NatsConnection["rtt"] = async () => 0;
  const reconnect: NatsConnection["reconnect"] = async () => {};

  const connection: NatsConnection & { options: { inboxPrefix: string } } = {
    options: {
      inboxPrefix: "_INBOX",
    },
    closed,
    close,
    publish,
    publishMessage,
    respondMessage,
    subscribe,
    request,
    requestMany,
    flush,
    drain,
    isClosed,
    isDraining,
    getServer,
    status,
    stats,
    rtt,
    reconnect,
  };

  return connection;
}

function createErrorResponseConnection(error: AuthError): NatsConnection {
  const connection = createMockNatsConnection() as NatsConnection & {
    request: NatsConnection["request"];
  };
  const headers = {
    get: (name: string) => name === "status" ? "error" : undefined,
  } as Msg["headers"];

  connection.request = async () => ({
    subject: "rpc.v1.Test.Probe",
    sid: 1,
    data: new TextEncoder().encode(JSON.stringify(error.toSerializable())),
    headers,
    respond: () => true,
    json: <T>() => error.toSerializable() as T,
    string: () => JSON.stringify(error.toSerializable()),
  });

  return connection;
}

function createEphemeralSubscriptionTestConnection(): {
  connection: NatsConnection;
  subscribeCalls: string[];
  requestCalls: string[];
} {
  const subscribeCalls: string[] = [];
  const requestCalls: string[] = [];

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
    getSubject: () => "events.v1.Test.Ping",
    getReceived: () => 0,
    getProcessed: () => 0,
    getPending: () => 0,
    getID: () => 1,
    getMax: () => undefined,
    [Symbol.asyncIterator]: async function* () {
      return;
    },
  };

  const connection: NatsConnection & { options: { inboxPrefix: string } } = {
    options: {
      inboxPrefix: "_INBOX",
    },
    closed: async () => undefined,
    close: async () => {},
    publish: () => {},
    publishMessage: () => {},
    respondMessage: () => false,
    subscribe: (subject) => {
      subscribeCalls.push(subject);
      return subscription;
    },
    request: async (subject) => {
      requestCalls.push(subject);
      return message;
    },
    requestMany: async () => {
      throw new Error("requestMany should not be called in this test");
    },
    flush: async () => {},
    drain: async () => {},
    isClosed: () => false,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    status: () => ({
      async *[Symbol.asyncIterator]() {},
    }),
    stats: () => ({
      inBytes: 0,
      outBytes: 0,
      inMsgs: 0,
      outMsgs: 0,
    }),
    rtt: async () => 0,
    reconnect: async () => {},
  };

  return { connection, subscribeCalls, requestCalls };
}

function createDurableSubscriptionTestConnection(): {
  connection: NatsConnection;
  subscribeCalls: string[];
  requestCalls: string[];
} {
  const base = createEphemeralSubscriptionTestConnection();
  const connection = base.connection as NatsConnection & {
    addCloseListener(listener: () => void): void;
    removeCloseListener(listener: () => void): void;
    request: NatsConnection["request"];
  };

  connection.addCloseListener = () => {};
  connection.removeCloseListener = () => {};
  connection.status = () =>
    ({
      stop: () => {},
      async *[Symbol.asyncIterator]() {},
    }) as ReturnType<NatsConnection["status"]>;

  connection.request = async (subject) => {
    base.requestCalls.push(subject);
    const response = {
      type: "io.nats.jetstream.api.v1.consumer_info_response",
      stream_name: "EVENTS",
      name: "bound-consumer",
      created: new Date(0).toISOString(),
      config: {
        durable_name: "bound-consumer",
        ack_policy: "explicit",
        deliver_policy: "new",
      },
      delivered: { consumer_seq: 0, stream_seq: 0 },
      ack_floor: { consumer_seq: 0, stream_seq: 0 },
      num_ack_pending: 0,
      num_redelivered: 0,
      num_waiting: 0,
      num_pending: 0,
    };
    const body = JSON.stringify(response);
    return {
      subject,
      sid: 1,
      data: new TextEncoder().encode(body),
      respond: () => true,
      json: <T>() => response as T,
      string: () => body,
    };
  };

  return base;
}

function createDurablePullTestConnection(): {
  connection: NatsConnection;
  pullRequests: string[];
  requestCalls: string[];
  responses: string[];
  deliver(subject: string): void;
} {
  const base = createDurableSubscriptionTestConnection();
  const connection = base.connection as NatsConnection & {
    publish: NatsConnection["publish"];
    subscribe: NatsConnection["subscribe"];
  };
  const pullRequests: string[] = [];
  const responses: string[] = [];
  const callbacks: Array<
    (err: Error | null, msg: Msg) => void | Promise<never>
  > = [];
  let subscriptionId = 0;

  connection.publish = (subject) => {
    if (subject.includes("CONSUMER.MSG.NEXT")) pullRequests.push(subject);
  };
  connection.subscribe = (subject, opts) => {
    if (opts?.callback) callbacks.push(opts.callback);
    const subscription: Subscription = {
      closed: Promise.resolve(),
      unsubscribe: () => {},
      drain: async () => {},
      isDraining: () => false,
      isClosed: () => false,
      callback: opts?.callback ?? (() => {}),
      getSubject: () => subject,
      getReceived: () => 0,
      getProcessed: () => 0,
      getPending: () => 0,
      getID: () => ++subscriptionId,
      getMax: () => undefined,
      [Symbol.asyncIterator]: async function* () {
        return;
      },
    };
    return subscription;
  };

  return {
    connection,
    pullRequests,
    requestCalls: base.requestCalls,
    responses,
    deliver: (subject) => {
      const data = new TextEncoder().encode(JSON.stringify({
        value: "value",
      }));
      const message: Msg & { size(): number } = {
        subject,
        sid: 1,
        reply: "$JS.ACK._._.EVENTS.bound-consumer.1.1.1.1.0",
        data,
        respond: (payload = new Uint8Array()) => {
          responses.push(
            typeof payload === "string"
              ? payload
              : new TextDecoder().decode(payload),
          );
          return true;
        },
        json: <T>() => JSON.parse(new TextDecoder().decode(data)) as T,
        string: () => new TextDecoder().decode(data),
        size: () => data.byteLength,
      };
      callbacks.at(-1)?.(null, message);
    },
  };
}

async function waitFor(assertion: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!assertion()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for test state");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const eventTestContract = defineServiceContract(
  {
    schemas: {
      EventPayload: Type.Object({
        value: Type.String(),
      }),
    },
  },
  (ref) => ({
    id: "trellis.client.event-guard-test@v1",
    displayName: "Event Guard Test",
    description: "Covers ephemeral event subscription behavior.",
    events: {
      "Test.Ping": {
        version: "v1",
        event: ref.schema("EventPayload"),
      },
    },
  }),
);

const eventConsumerSourceContract = defineServiceContract(
  {
    schemas: {
      EventPayload: Type.Object({
        value: Type.String(),
      }),
    },
  },
  (ref) => ({
    id: "trellis.client.event-source-test@v1",
    displayName: "Event Source Test",
    description: "Exposes events for durable event consumer tests.",
    events: {
      "Test.Ping": {
        version: "v1",
        event: ref.schema("EventPayload"),
      },
      "Test.Pong": {
        version: "v1",
        event: ref.schema("EventPayload"),
      },
    },
  }),
);

const eventConsumerMetadata = {
  primary: {
    uses: { source: ["Test.Ping"] },
    replay: "new",
    ordering: "strict",
    concurrency: 1,
  },
  secondary: {
    uses: { source: ["Test.Ping"] },
    replay: "new",
    ordering: "strict",
    concurrency: 1,
  },
  pong: {
    uses: { source: ["Test.Pong"] },
    replay: "new",
    ordering: "strict",
    concurrency: 1,
  },
} as const;

const groupedEventConsumerMetadata = {
  paired: {
    uses: { source: ["Test.Ping", "Test.Pong"] },
    replay: "new",
    ordering: "strict",
    concurrency: 1,
  },
} as const;

const selfGroupedEventConsumerTestContract = defineServiceContract(
  {
    schemas: {
      EventPayload: Type.Object({
        value: Type.String(),
      }),
    },
  },
  (ref) => ({
    id: "trellis.client.self-grouped-event-consumer-test@v1",
    displayName: "Self Grouped Event Consumer Test",
    description: "Covers durable grouped self-event consumer behavior.",
    events: {
      "Test.Ping": {
        version: "v1",
        event: ref.schema("EventPayload"),
      },
      "Test.Pong": {
        version: "v1",
        event: ref.schema("EventPayload"),
      },
    },
  }),
);

const selfGroupedEventConsumerMetadata = {
  paired: {
    self: ["Test.Ping", "Test.Pong"],
    replay: "new",
    ordering: "strict",
    concurrency: 1,
  },
} as const;

const eventConsumerBinding = {
  stream: "EVENTS",
  consumerName: "bound-consumer",
  filterSubjects: ["events.v1.Test.Ping"],
  replay: "new" as const,
  ordering: "strict" as const,
  concurrency: 1,
  ackWaitMs: 30_000,
  maxDeliver: 5,
  backoffMs: [],
};

const rpcTestContract = defineServiceContract(
  {
    schemas: {
      Empty: Type.Object({}),
    },
  },
  (ref) => ({
    id: "trellis.client.rpc-guard-test@v1",
    displayName: "RPC Guard Test",
    description: "Covers RPC client guard behavior.",
    rpc: {
      "Test.Probe": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("Empty"),
        errors: ["AuthError"],
      },
    },
  }),
);

Deno.test("generated core SDK keeps internal bindings RPC descriptor", () => {
  assertEquals(
    CORE_API.owned.rpc["Trellis.Bindings.Get"].subject,
    "rpc.v1.Trellis.Bindings.Get",
  );
});

Deno.test("Trellis explains how to provide an API surface when none was configured", async () => {
  const trellis = createTrellisInternal(
    "test-client",
    createMockNatsConnection(),
    createMockAuth(),
  );
  const result = await trellis.request("Auth.Sessions.Me", {});
  const value = result.take();

  assert(isErr(value));
  assert(value.error.cause instanceof Error);
  assertStringIncludes(
    value.error.cause.message,
    "No API surface was provided",
  );
  assertStringIncludes(value.error.cause.message, "createCoreClient(...)");
});

Deno.test("Trellis invokes session recovery for session_not_found RPC errors", async () => {
  let recoveries = 0;
  const trellis = createTrellisInternal(
    "test-client",
    createErrorResponseConnection(
      new AuthError({ reason: "session_not_found" }),
    ),
    createMockAuth(),
    {
      api: rpcTestContract.API.owned,
      onSessionNotFound: () => {
        recoveries += 1;
      },
    },
  );

  const result = await trellis.request("Test.Probe", {});
  const value = result.take();

  assert(isErr(value));
  assert(value.error instanceof AuthError);
  assertEquals(value.error.reason, "session_not_found");
  assertEquals(recoveries, 1);
});

Deno.test("Trellis ephemeral event subscriptions avoid JetStream manager requests", async () => {
  const { connection, subscribeCalls, requestCalls } =
    createEphemeralSubscriptionTestConnection();
  const trellis = createClient(
    eventTestContract,
    connection,
    createMockAuth(),
    { name: "ephemeral-subscriber" },
  );

  const result = await trellis.listenEvent(
    "Test.Ping",
    {},
    () => ok(undefined),
    {
      mode: "ephemeral",
      replay: "new",
    },
  );
  const value = result.take();

  assertEquals(isErr(value), false);
  assertEquals(subscribeCalls, ["events.v1.Test.Ping"]);
  assertEquals(requestCalls, []);
});

Deno.test("Trellis durable event listen fails without declared event consumer group", async () => {
  const trellis = createTrellisInternal(
    "durable-missing-group",
    createMockNatsConnection(),
    createMockAuth(),
    { api: eventTestContract.API.owned },
  );

  const result = await trellis.listenEvent(
    "Test.Ping",
    {},
    () => ok(undefined),
  );
  const value = result.take();

  assert(isErr(value));
  assertStringIncludes(
    value.error.cause instanceof Error ? value.error.cause.message : "",
    "is not declared in any event consumer group",
  );
});

Deno.test("Trellis durable event listen requires group for ambiguous event consumer groups", async () => {
  const trellis = createTrellisInternal(
    "durable-ambiguous-group",
    createMockNatsConnection(),
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: eventConsumerMetadata,
        bindings: {
          primary: eventConsumerBinding,
          secondary: eventConsumerBinding,
        },
      },
    },
  );

  const result = await trellis.listenEvent(
    "Test.Ping",
    {},
    () => ok(undefined),
  );
  const value = result.take();

  assert(isErr(value));
  assertStringIncludes(
    value.error.cause instanceof Error ? value.error.cause.message : "",
    "is declared in multiple event consumer groups",
  );
});

Deno.test("Trellis durable event listen rejects caller-provided durableName", async () => {
  const trellis = createTrellisInternal(
    "durable-name-rejected",
    createMockNatsConnection(),
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: eventConsumerMetadata,
        bindings: { pong: eventConsumerBinding },
      },
    },
  );

  const result = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    {
      durableName: "caller-name",
    },
  );
  const value = result.take();

  assert(isErr(value));
  assertStringIncludes(
    value.error.cause instanceof Error ? value.error.cause.message : "",
    "provisioned by Trellis event consumer bindings",
  );
});

Deno.test("Trellis durable event listen uses bound consumer without creating consumers", async () => {
  const { connection, requestCalls } =
    createDurableSubscriptionTestConnection();
  const trellis = createTrellisInternal(
    "durable-bound-consumer",
    connection,
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: eventConsumerMetadata,
        bindings: { pong: eventConsumerBinding },
      },
    },
  );
  const controller = new AbortController();

  const result = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    {
      signal: controller.signal,
    },
  );
  const value = result.take();

  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  assertEquals(isErr(value), false);
  assertEquals(
    requestCalls.some((subject) => subject.includes("CONSUMER.DURABLE.CREATE")),
    false,
  );
  assertEquals(
    requestCalls.some((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ),
    true,
  );
});

Deno.test("Trellis durable event listen accepts self-owned event metadata", async () => {
  const { connection, requestCalls } =
    createDurableSubscriptionTestConnection();
  const trellis = createTrellisInternal(
    "durable-self-owned-consumer",
    connection,
    createMockAuth(),
    {
      api: selfGroupedEventConsumerTestContract.API.owned,
      eventConsumers: {
        metadata: selfGroupedEventConsumerMetadata,
        bindings: { paired: eventConsumerBinding },
      },
    },
  );
  const controller = new AbortController();

  const result = await trellis.listenEvent(
    "Test.Ping",
    {},
    () => ok(undefined),
    { group: "paired", signal: controller.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  assertEquals(isErr(result.take()), false);
  assertEquals(
    requestCalls.some((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ),
    false,
  );
});

Deno.test("Trellis durable event listen starts one pull loop for a shared group", async () => {
  const { connection, requestCalls } =
    createDurableSubscriptionTestConnection();
  const trellis = createTrellisInternal(
    "durable-shared-group",
    connection,
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: eventConsumerMetadata,
        bindings: { pong: eventConsumerBinding },
      },
    },
  );
  const controller = new AbortController();

  const first = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    {
      signal: controller.signal,
    },
  );
  const second = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    {
      signal: controller.signal,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  assertEquals(isErr(first.take()), false);
  assertEquals(isErr(second.take()), false);
  assertEquals(
    requestCalls.filter((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ).length,
    1,
  );
});

Deno.test("Trellis durable event loop restarts after handlers are removed", async () => {
  const { connection, requestCalls } =
    createDurableSubscriptionTestConnection();
  const trellis = createTrellisInternal(
    "durable-restart-group",
    connection,
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: eventConsumerMetadata,
        bindings: { pong: eventConsumerBinding },
      },
    },
  );
  const firstController = new AbortController();
  const secondController = new AbortController();

  const first = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    { signal: firstController.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  firstController.abort();
  await trellis.wait().orThrow();
  const second = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    { signal: secondController.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  secondController.abort();

  assertEquals(isErr(first.take()), false);
  assertEquals(isErr(second.take()), false);
  assertEquals(
    requestCalls.filter((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ).length,
    2,
  );
});

Deno.test("Trellis durable grouped event listener waits for all group handlers", async () => {
  const { connection, requestCalls } =
    createDurableSubscriptionTestConnection();
  const trellis = createTrellisInternal(
    "durable-group-waits",
    connection,
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: groupedEventConsumerMetadata,
        bindings: { paired: eventConsumerBinding },
      },
    },
  );
  const controller = new AbortController();

  const first = await trellis.listenEvent(
    "Test.Ping",
    {},
    () => ok(undefined),
    { group: "paired", signal: controller.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(isErr(first.take()), false);
  assertEquals(
    requestCalls.some((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ),
    false,
  );

  const second = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    { group: "paired", signal: controller.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  assertEquals(isErr(second.take()), false);
  assertEquals(
    requestCalls.some((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ),
    true,
  );
});

Deno.test("Trellis durable grouped self-event listener waits for all group handlers", async () => {
  const { connection, requestCalls } =
    createDurableSubscriptionTestConnection();
  const trellis = createTrellisInternal(
    "durable-self-group-waits",
    connection,
    createMockAuth(),
    {
      api: selfGroupedEventConsumerTestContract.API.owned,
      eventConsumers: {
        metadata: selfGroupedEventConsumerMetadata,
        bindings: { paired: eventConsumerBinding },
      },
    },
  );
  const controller = new AbortController();

  const first = await trellis.listenEvent(
    "Test.Ping",
    {},
    () => ok(undefined),
    { group: "paired", signal: controller.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(isErr(first.take()), false);
  assertEquals(
    requestCalls.some((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ),
    false,
  );

  const second = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    { group: "paired", signal: controller.signal },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();

  assertEquals(isErr(second.take()), false);
  assertEquals(
    requestCalls.some((subject) =>
      subject.includes("CONSUMER.INFO.EVENTS.bound-consumer")
    ),
    true,
  );
});

Deno.test("Trellis durable grouped event listener pauses when readiness is lost", async () => {
  const { connection, pullRequests, responses, deliver } =
    createDurablePullTestConnection();
  const trellis = createTrellisInternal(
    "durable-group-pauses",
    connection,
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: groupedEventConsumerMetadata,
        bindings: { paired: eventConsumerBinding },
      },
    },
  );
  const pingController = new AbortController();
  const pongController = new AbortController();

  const ping = await trellis.listenEvent(
    "Test.Ping",
    {},
    () => ok(undefined),
    { group: "paired", signal: pingController.signal },
  );
  const pong = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    { group: "paired", signal: pongController.signal },
  );
  await waitFor(() => pullRequests.length === 1);

  pongController.abort();
  await trellis.wait().orThrow();
  deliver("events.v1.Test.Pong");
  await new Promise((resolve) => setTimeout(resolve, 0));
  pingController.abort();

  assertEquals(isErr(ping.take()), false);
  assertEquals(isErr(pong.take()), false);
  assertEquals(pullRequests.length, 1);
  assertEquals(responses.includes("-NAK"), false);
});

Deno.test("Trellis durable event loop restarts after immediate re-register", async () => {
  const { connection, pullRequests } = createDurablePullTestConnection();
  const trellis = createTrellisInternal(
    "durable-immediate-restart",
    connection,
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: eventConsumerMetadata,
        bindings: { pong: eventConsumerBinding },
      },
    },
  );
  const firstController = new AbortController();
  const secondController = new AbortController();

  const first = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    { signal: firstController.signal },
  );
  await waitFor(() => pullRequests.length === 1);
  firstController.abort();
  const second = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
    { signal: secondController.signal },
  );
  await waitFor(() => pullRequests.length === 2);
  secondController.abort();
  await trellis.wait().orThrow();

  assertEquals(isErr(first.take()), false);
  assertEquals(isErr(second.take()), false);
});

Deno.test("Trellis durable event listeners stop without restarting during teardown", async () => {
  const { connection, pullRequests } = createDurablePullTestConnection();
  const trellis = createTrellisInternal(
    "durable-stop-no-restart",
    connection,
    createMockAuth(),
    {
      api: eventConsumerSourceContract.API.owned,
      eventConsumers: {
        metadata: eventConsumerMetadata,
        bindings: { pong: eventConsumerBinding },
      },
    },
  );

  const registered = await trellis.listenEvent(
    "Test.Pong",
    {},
    () => ok(undefined),
  );
  await waitFor(() => pullRequests.length === 1);

  trellis.stopEventListeners();
  await trellis.wait().orThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(isErr(registered.take()), false);
  assertEquals(pullRequests.length, 1);
});
