import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { Msg, Subscription } from "@nats-io/nats-core";
import { isErr, ok } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";
import { Type } from "typebox";

import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { AuthError } from "../errors/index.ts";
import { Trellis, type TrellisAuth } from "../trellis.ts";

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

const eventTestContract = defineServiceContract(
  {
    schemas: {
      EventPayload: Type.Object({
        header: Type.Object({
          id: Type.String(),
          time: Type.String(),
        }),
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

Deno.test("Trellis explains how to provide an API surface when none was configured", async () => {
  const trellis = new Trellis(
    "test-client",
    createMockNatsConnection(),
    createMockAuth(),
  );
  const result = await trellis.request("Auth.Me", {});
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
  const trellis = new Trellis(
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

  const result = await trellis.event("Test.Ping", {}, () => ok(undefined), {
    mode: "ephemeral",
    replay: "new",
  });
  const value = result.take();

  assertEquals(isErr(value), false);
  assertEquals(subscribeCalls, ["events.v1.Test.Ping"]);
  assertEquals(requestCalls, []);
});
