import { assert, assertEquals } from "@std/assert";
import type { Msg, NatsConnection, Subscription } from "@nats-io/nats-core";
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
    status: async function* () {},
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
  };
  return connection;
}

const contract = defineServiceContract(
  {
    schemas: {
      Changed: Type.Object({
        header: Type.Object({ id: Type.String(), time: Type.String() }),
        origin: Type.String(),
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
  assertEquals(prepared.headers["Nats-Msg-Id"], prepared.payload.header.id);
  assertEquals(
    JSON.parse(prepared.encodedPayload),
    prepared.payload,
  );
});

Deno.test("publishPrepared preserves prepared subject payload and headers", async () => {
  const published: Array<{
    subject: string;
    payload: string;
    msgId: string | undefined;
  }> = [];
  const trellis = new Trellis(
    "test",
    createMockNatsConnection(),
    createMockAuth(),
    {
      api: contract.API.owned,
    },
  );
  Object.defineProperty(trellis, "js", {
    value: {
      publish: (
        subject: string,
        payload: string,
        opts: { headers: { get(name: string): string | undefined } },
      ) => {
        published.push({
          subject,
          payload,
          msgId: opts.headers.get("Nats-Msg-Id"),
        });
      },
    },
  });

  const prepared = trellis.prepare("Thing.Changed", {
    origin: "test",
    id: "one",
    value: "first",
  }).unwrapOrElse((error) => {
    throw error;
  });
  const result = await trellis.publishPrepared(prepared);
  result.unwrapOrElse((error) => {
    throw error;
  });

  assertEquals(published, [{
    subject: prepared.subject,
    payload: prepared.encodedPayload,
    msgId: prepared.payload.header.id,
  }]);
});
