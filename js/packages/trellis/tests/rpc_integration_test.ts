import type {
  Msg,
  MsgHdrs,
  NatsConnection,
  Payload,
  Subscription,
} from "@nats-io/nats-core";
import {
  AuthRequestsValidateResponseSchema,
  AuthRequestsValidateSchema,
  AuthSessionsMeResponseSchema,
  AuthSessionsMeSchema,
} from "@qlever-llc/trellis/auth";
import { assertEquals } from "@std/assert";

import { Type } from "typebox";
import { err, isErr, ok } from "../../result/mod.ts";
import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { AuthError } from "../errors/index.ts";
import type { TrellisAuth } from "../trellis.ts";

function base64urlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buf = data.buffer;
  if (buf instanceof ArrayBuffer) {
    return buf.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function createTestAuth(): Promise<
  { auth: TrellisAuth; inboxPrefix: string }
> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", kp.publicKey),
  );
  const sessionKey = base64urlEncode(raw);
  const auth: TrellisAuth = {
    sessionKey,
    sign: async (data: Uint8Array) => {
      const sig = await crypto.subtle.sign(
        { name: "Ed25519" },
        kp.privateKey,
        toArrayBuffer(data),
      );
      return new Uint8Array(sig);
    },
  };
  return { auth, inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}` };
}

const TEST_USER = {
  userId: "test-user-123",
  active: true,
  name: "Test User",
  email: "test@example.com",
  capabilities: ["service"],
  lastAuth: "2026-04-10T00:00:00.000Z",
  identity: {
    identityId: "test-identity-123",
    provider: "test",
    subject: "test-subject-123",
  },
};
const TEST_CALLER = {
  type: "user" as const,
  participantKind: "app" as const,
  ...TEST_USER,
};

type TestAuthUserCaller = {
  type: "user";
  participantKind: "app" | "agent";
  userId: string;
  active: boolean;
  name: string;
  email: string;
  image?: string;
  capabilities: string[];
  lastAuth: string;
  identity: {
    identityId: string;
    provider: string;
    subject: string;
  };
};

function authSessionsMeUserResponse(caller: TestAuthUserCaller) {
  return {
    participantKind: caller.participantKind,
    user: {
      userId: caller.userId,
      active: caller.active,
      name: caller.name,
      email: caller.email,
      ...(caller.image ? { image: caller.image } : {}),
      capabilities: caller.capabilities,
      identity: caller.identity,
    },
    device: null,
    service: null,
  };
}

const EmptySchema = Type.Object({});

const authSchemas = {
  AuthRequestsValidateInput: AuthRequestsValidateSchema,
  AuthRequestsValidateOutput: AuthRequestsValidateResponseSchema,
  AuthSessionsMeInput: AuthSessionsMeSchema,
  AuthSessionsMeOutput: AuthSessionsMeResponseSchema,
  EmptySchema,
} as const;

function schemaRef<const TName extends keyof typeof authSchemas & string>(
  schema: TName,
) {
  return { schema } as const;
}

const emptyContract = defineServiceContract({}, () => ({
  id: "trellis.empty.rpc-test@v1",
  displayName: "Empty RPC Test",
  description: "Provide an empty contract for RPC integration tests.",
}));

const authContract = defineServiceContract(
  {
    schemas: {
      AuthRequestsValidateInput: authSchemas.AuthRequestsValidateInput,
      AuthRequestsValidateOutput: authSchemas.AuthRequestsValidateOutput,
      AuthSessionsMeInput: authSchemas.AuthSessionsMeInput,
      AuthSessionsMeOutput: authSchemas.AuthSessionsMeOutput,
    },
  },
  () => ({
    id: "trellis.auth.rpc-test@v1",
    displayName: "Auth RPC Test",
    description: "Expose auth RPCs for integration tests.",
    rpc: {
      "Auth.Requests.Validate": {
        version: "v1",
        input: schemaRef("AuthRequestsValidateInput"),
        output: schemaRef("AuthRequestsValidateOutput"),
        authRequired: false,
        errors: ["AuthError", "ValidationError", "UnexpectedError"],
      },
      "Auth.Sessions.Me": {
        version: "v1",
        input: schemaRef("AuthSessionsMeInput"),
        output: schemaRef("AuthSessionsMeOutput"),
        errors: ["AuthError", "ValidationError", "UnexpectedError"],
      },
    },
  }),
);

type BufferedSubscription = Subscription & {
  push(message: Msg): void;
};

function createRoutedNatsConnection(): NatsConnection {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const subscriptions: BufferedSubscription[] = [];
  let closed = false;

  const payloadBytes = (payload: Payload | undefined): Uint8Array => {
    if (payload === undefined) return new Uint8Array();
    if (typeof payload === "string") return encoder.encode(payload);
    return payload;
  };

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

  const createMessage = (args: {
    subject: string;
    data: Uint8Array;
    headers?: MsgHdrs;
    reply?: string;
    onRespond?: (data: Uint8Array, headers?: MsgHdrs) => void;
  }): Msg => ({
    subject: args.subject,
    sid: 1,
    data: args.data,
    headers: args.headers,
    reply: args.reply,
    respond: (payload?: Payload, opts?: { headers?: MsgHdrs }) => {
      args.onRespond?.(payloadBytes(payload), opts?.headers);
      return true;
    },
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
    info: undefined,
    closed: async () => undefined,
    close: async () => closeSubscriptions(),
    publish: () => {},
    publishMessage: () => {},
    respondMessage: () => true,
    subscribe: (subject) => createSubscription(subject),
    request: async (subject, payload, opts) => {
      const subscription = subscriptions.find((candidate) =>
        subjectMatches(candidate.getSubject(), subject)
      );
      if (!subscription) {
        throw new Error(`no responders for ${subject}`);
      }

      const requestData = payloadBytes(payload);
      const sessionKey = opts?.headers?.get("session-key");
      const reply = typeof sessionKey === "string"
        ? `_INBOX.${sessionKey.slice(0, 16)}.reply`
        : "_INBOX.test.reply";

      return await new Promise<Msg>((resolve) => {
        subscription.push(createMessage({
          subject,
          data: requestData,
          headers: opts?.headers,
          reply,
          onRespond: (data, headers) => {
            resolve(createMessage({ subject, data, headers }));
          },
        }));
      });
    },
    requestMany: async () =>
      (async function* () {
        return;
      })(),
    flush: async () => {},
    drain: async () => closeSubscriptions(),
    isClosed: () => closed,
    isDraining: () => false,
    getServer: () => "nats://127.0.0.1:4222",
    status: () => ({
      async *[Symbol.asyncIterator]() {},
    }),
    stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
    rtt: async () => 0,
    reconnect: async () => {},
  };

  return connection;
}

Deno.test({
  name: "Full RPC retries transient session_not_found during auth validation",
  async fn() {
    const nc = createRoutedNatsConnection();

    const meService = createClient(
      authContract,
      nc,
      { sessionKey: "service-retry", sign: () => new Uint8Array(64) },
      { name: "me-service-retry" },
    );
    const authService = createClient(
      authContract,
      nc,
      { sessionKey: "auth-retry", sign: () => new Uint8Array(64) },
      { name: "auth-service-retry" },
    );

    let validateCalls = 0;
    await authService.handle.rpc.auth.requestsValidate(
      async ({ input }: { input: unknown }) => {
        const sessionKey = typeof input === "object" && input !== null
          ? Reflect.get(input, "sessionKey")
          : undefined;
        if (typeof sessionKey !== "string") {
          throw new Error("expected Auth.Requests.Validate session key");
        }
        validateCalls += 1;
        if (validateCalls === 1) {
          return err(new AuthError({ reason: "session_not_found" }));
        }
        return ok({
          allowed: true,
          inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
          caller: TEST_CALLER,
        });
      },
    );

    await meService.handle.rpc.auth.sessionsMe(async ({ context: ctx }) => {
      if (ctx.caller.type !== "user") {
        throw new Error("expected user caller");
      }
      return ok(authSessionsMeUserResponse(ctx.caller));
    });

    const { auth } = await createTestAuth();
    const client = createClient(
      authContract,
      nc,
      auth,
      { name: "client-retry" },
    );

    const result = await client.rpc.auth.sessionsMe({}, {
      timeout: 500,
    });
    const response = result.take();
    if (isErr(response)) throw response.error;

    assertEquals(response.user?.userId, TEST_USER.userId);
    assertEquals(validateCalls, 2);
    await nc.close();
  },
});

Deno.test("RPC handle facade omits unknown RPC methods", async () => {
  const service = createClient(
    emptyContract,
    { options: { inboxPrefix: "_INBOX.test" } } as never,
    { sessionKey: "test", sign: () => new Uint8Array(64) },
    { name: "unknown-rpc-service" },
  );

  assertEquals(Reflect.get(service.handle.rpc, "does"), undefined);
});
