import { assert, assertEquals } from "@std/assert";
import {
  headers as natsHeaders,
  type Msg,
  type MsgHdrs,
  type NatsConnection,
  type Payload,
  type Subscription,
} from "@nats-io/nats-core";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { AuthError } from "../errors/index.ts";
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

type BufferedSubscription = Subscription & {
  push(message: Msg): void;
};

function subjectMatches(pattern: string, subject: string): boolean {
  const patternParts = pattern.split(".");
  const subjectParts = subject.split(".");
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index];
    if (part === ">") return true;
    if (subjectParts[index] === undefined) return false;
    if (part !== "*" && part !== subjectParts[index]) return false;
  }
  return patternParts.length === subjectParts.length;
}

function createRoutedEventNatsConnection(): NatsConnection {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const subscriptions: BufferedSubscription[] = [];
  let closed = false;

  const payloadBytes = (payload: Payload | undefined): Uint8Array => {
    if (payload === undefined) return new Uint8Array();
    if (typeof payload === "string") return encoder.encode(payload);
    return payload;
  };

  const createMessage = (args: {
    subject: string;
    data: Uint8Array;
    headers?: MsgHdrs;
  }): Msg => ({
    subject: args.subject,
    sid: 1,
    data: args.data,
    headers: args.headers,
    respond: () => true,
    json: <T>() => JSON.parse(decoder.decode(args.data)) as T,
    string: () => decoder.decode(args.data),
  });

  const createSubscription = (subject: string): BufferedSubscription => {
    const queue: Msg[] = [];
    let subscriptionClosed = false;
    let received = 0;
    let pendingResolver: (() => void) | undefined;
    const notify = () => {
      pendingResolver?.();
      pendingResolver = undefined;
    };

    const subscription: BufferedSubscription = {
      closed: Promise.resolve(),
      unsubscribe: () => {
        subscriptionClosed = true;
        notify();
      },
      drain: async () => {
        subscriptionClosed = true;
        notify();
      },
      isDraining: () => false,
      isClosed: () => subscriptionClosed,
      callback: () => {},
      getSubject: () => subject,
      getReceived: () => received,
      getProcessed: () => received,
      getPending: () => queue.length,
      getID: () => 1,
      getMax: () => undefined,
      push: (message: Msg) => {
        if (subscriptionClosed) return;
        queue.push(message);
        received += 1;
        notify();
      },
      [Symbol.asyncIterator]: async function* () {
        while (!subscriptionClosed) {
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

  const closeSubscriptions = () => {
    closed = true;
    for (const subscription of subscriptions) {
      subscription.unsubscribe();
    }
  };

  const connection: NatsConnection & { options: { inboxPrefix: string } } = {
    options: { inboxPrefix: "_INBOX.test" },
    closed: async () => undefined,
    close: async () => closeSubscriptions(),
    publish: (subject, payload, opts) => {
      const data = payloadBytes(payload);
      for (const subscription of subscriptions) {
        if (subjectMatches(subscription.getSubject(), subject)) {
          subscription.push(createMessage({
            subject,
            data,
            headers: opts?.headers,
          }));
        }
      }
    },
    publishMessage: () => {},
    respondMessage: () => true,
    subscribe: (subject) => createSubscription(subject),
    request: async () => createMessage({ subject: "", data: new Uint8Array() }),
    requestMany: async () => ({
      async *[Symbol.asyncIterator]() {},
    }),
    flush: async () => {},
    drain: async () => closeSubscriptions(),
    isClosed: () => closed,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    status: async function* () {},
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
  };

  return connection;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert(predicate(), "condition was not met");
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

Deno.test("ephemeral event rejected handler error is annotated", async () => {
  const nc = createRoutedEventNatsConnection();
  const trellis = new Trellis("event-service", nc, createMockAuth(), {
    api: contract.API.owned,
    contractId: contract.CONTRACT_ID,
    contractDigest: contract.CONTRACT_DIGEST,
  });
  const thrown = new AuthError({
    reason: "forbidden",
    context: { subject: "events.v1.Thing.Changed.test.one" },
  });
  const mounted = await trellis.event.thing.changed.listen(
    async () => {
      throw thrown;
    },
    { origin: "test", id: "one" },
    { mode: "ephemeral" },
  );
  mounted.unwrapOrElse((error) => {
    throw error;
  });

  const prepared = trellis.prepare("Thing.Changed", {
    origin: "test",
    id: "one",
    value: "first",
  }).unwrapOrElse((error) => {
    throw error;
  });
  const headers = natsHeaders();
  headers.set(
    "traceparent",
    "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
  );
  nc.publish(prepared.subject, prepared.encodedPayload, { headers });

  await waitFor(() =>
    thrown.toSerializable().context?.event ===
      "Thing.Changed"
  );
  const serialized = thrown.toSerializable();
  assertEquals(serialized.type, "AuthError");
  assertEquals(serialized.context?.event, "Thing.Changed");
  assertEquals(serialized.context?.service, "event-service");
  assertEquals(serialized.context?.contractId, contract.CONTRACT_ID);
  assertEquals(serialized.context?.contractDigest, contract.CONTRACT_DIGEST);
  assertEquals(serialized.traceId, "0123456789abcdef0123456789abcdef");
  assert(!Object.hasOwn(serialized.context ?? {}, "subject"));

  await nc.close();
});
