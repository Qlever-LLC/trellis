import { assert, assertEquals } from "@std/assert";
import {
  type Msg,
  type NatsConnection,
  type Subscription,
} from "@nats-io/nats-core";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { Trellis, type TrellisAuth } from "../trellis.ts";

function createMockAuth(): TrellisAuth {
  return { sessionKey: "test", sign: () => new Uint8Array(64) };
}

function createMockNatsConnection(): NatsConnection {
  const subscription: Subscription = {
    closed: Promise.resolve(),
    unsubscribe: () => {},
    drain: async () => {},
    isDraining: () => false,
    isClosed: () => false,
    callback: () => {},
    getSubject: () => "",
    getReceived: () => 0,
    getProcessed: () => 0,
    getPending: () => 0,
    getID: () => 1,
    getMax: () => undefined,
    [Symbol.asyncIterator]: async function* () {},
    [Symbol.asyncDispose]: async () => {},
  };
  const requestMessage: Msg = {
    subject: "",
    sid: 1,
    data: new Uint8Array(),
    respond: () => true,
    json: <T>() => ({}) as T,
    string: () => "",
  };
  const connection: NatsConnection & { options: { inboxPrefix: string } } = {
    options: { inboxPrefix: "_INBOX" },
    closed: async () => undefined,
    close: async () => {},
    publish: () => {},
    publishMessage: () => {},
    respondMessage: () => false,
    subscribe: () => subscription,
    request: async () => requestMessage,
    requestMany: async () => ({
      async *[Symbol.asyncIterator]() {},
    }),
    flush: async () => {},
    drain: async () => {},
    isClosed: () => false,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    getServers: () => [],
    setServers: () => {},
    status: async function* () {},
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
    [Symbol.asyncDispose]: async () => {},
  };
  return connection;
}

const contract = defineServiceContract(
  {
    schemas: {
      Changed: Type.Object({
        origin: Type.String(),
        id: Type.String(),
        value: Type.String(),
      }),
      HeaderNamed: Type.Object({
        header: Type.String(),
        id: Type.String(),
        value: Type.String(),
      }),
    },
  },
  (ref) => ({
    id: "trellis.prepared-events-test@v1",
    displayName: "Prepared Events Test",
    description: "Covers prepared event behavior.",
    events: {
      "Thing.Changed": {
        version: "v1",
        params: ["/origin", "/id"],
        event: ref.schema("Changed"),
      },
      "Thing.HeaderNamed": {
        version: "v1",
        params: ["/header", "/id"],
        event: ref.schema("HeaderNamed"),
      },
    },
  }),
);

Deno.test("prepare creates stable frozen event without contract metadata", () => {
  const trellis = new Trellis(
    "test",
    createMockNatsConnection(),
    createMockAuth(),
    {
      api: contract.API.owned,
    },
  );
  const prepared = trellis.event.thing.changed.prepare({
    origin: "test",
    id: "one",
    value: "first",
  }).unwrapOrElse((error) => {
    throw error;
  });

  assert(Object.isFrozen(prepared));
  assert(Object.isFrozen(prepared.payload));
  assertEquals(prepared.subject, "events.v1.Thing.Changed.test.one");
  assertEquals("contractId" in prepared, false);
  assertEquals("contractDigest" in prepared, false);
  assertEquals(prepared.headers["Nats-Msg-Id"], prepared.header.id);
  assertEquals(prepared.headers["Trellis-Event-Time"], prepared.header.time);
  assertEquals(
    JSON.parse(prepared.encodedPayload),
    {
      origin: "test",
      id: "one",
      value: "first",
    },
  );
});

Deno.test("prepare preserves user body field named header when it is not runtime metadata", () => {
  const trellis = new Trellis(
    "test",
    createMockNatsConnection(),
    createMockAuth(),
    {
      api: contract.API.owned,
    },
  );
  const prepared = trellis.event.thing.headerNamed.prepare({
    header: "user-header-value",
    id: "one",
    value: "first",
  }).unwrapOrElse((error) => {
    throw error;
  });

  assertEquals(
    prepared.subject,
    "events.v1.Thing.HeaderNamed.user-header-value.one",
  );
  assertEquals(prepared.payload.header, "user-header-value");
  assertEquals(prepared.header.id, prepared.headers["Nats-Msg-Id"]);
  assertEquals(prepared.header.time, prepared.headers["Trellis-Event-Time"]);
  assertEquals(JSON.parse(prepared.encodedPayload), {
    header: "user-header-value",
    id: "one",
    value: "first",
  });
});
