import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { Msg } from "@nats-io/nats-core";
import { isErr } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";
import { Type } from "typebox";

import { defineServiceContract } from "../contract.ts";
import { AuthError } from "../errors/index.ts";
import { API as CORE_API } from "../sdk/core.ts";
import { createTrellisInternal, type TrellisAuth } from "../trellis.ts";

// Retained unit coverage: these are API/facade guards that should fail before a
// network request is made. Live event-consumer and RPC recovery behavior has
// moved to TS/Rust matrix rows.

type MockNatsConnection =
  & Omit<
    NatsConnection,
    "setServers" | "getServers" | typeof Symbol.asyncDispose
  >
  & { options: { inboxPrefix: string } };

function createMockAuth(token = "test-token"): TrellisAuth {
  return {
    sessionKey: token,
    sign: () => new Uint8Array(64),
  };
}

function createMockNatsConnection(): MockNatsConnection {
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
  const connection: MockNatsConnection = {
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

function createErrorResponseConnection(error: AuthError): MockNatsConnection {
  const connection = createMockNatsConnection();
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

const emptyRpcContract = defineServiceContract({}, () => ({
  id: "trellis.empty.rpc-guard-test@v1",
  displayName: "Empty RPC Guard Test",
  description: "Covers empty RPC facade behavior.",
}));

Deno.test("generated core SDK keeps internal bindings RPC descriptor", () => {
  assertEquals(
    CORE_API.owned.rpc["Trellis.Bindings.Get"].subject,
    "rpc.v1.Trellis.Bindings.Get",
  );
});

Deno.test("Trellis explains how to provide an API surface when none was configured", async () => {
  const trellis = createTrellisInternal(
    "test-client",
    // @ts-expect-error This test mock deliberately omits unused NATS compatibility members.
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
  const nats = createErrorResponseConnection(
    new AuthError({ reason: "session_not_found" }),
  );
  const trellis = createTrellisInternal(
    "test-client",
    // @ts-expect-error This test mock deliberately omits unused NATS compatibility members.
    nats,
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

Deno.test("RPC handle facade omits unknown RPC methods", () => {
  const nats = { options: { inboxPrefix: "_INBOX" } };
  const service = createTrellisInternal(
    "unknown-rpc-service",
    // @ts-expect-error Facade construction only needs JetStream's inbox prefix read.
    nats,
    createMockAuth(),
    { api: emptyRpcContract.API.owned },
  );

  assertEquals(Reflect.get(service.handle.rpc, "does"), undefined);
});
