import { connect } from "@nats-io/transport-deno";
import {
  AuthMeResponseSchema,
  AuthMeSchema,
  AuthValidateRequestResponseSchema,
  AuthValidateRequestSchema,
} from "@qlever-llc/trellis/auth";
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";

import { Type, type Static } from "typebox";
import { err, isErr, ok } from "../../result/mod.ts";
import { createClient } from "../client.ts";
import { defineContract } from "../contract.ts";
import { defineError } from "../../contracts/mod.ts";
import { AuthError } from "../errors/index.ts";
import { TrellisError } from "../errors/TrellisError.ts";
import { NatsTest } from "../testing/nats.ts";
import { getActiveSpan, getTracer, initTracing, withSpanAsync } from "../tracing.ts";
import type { TrellisAuth } from "../trellis.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

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

async function createTestAuth(): Promise<{ auth: TrellisAuth; inboxPrefix: string }> {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const sessionKey = base64urlEncode(raw);
  const auth: TrellisAuth = {
    sessionKey,
    sign: async (data: Uint8Array) => {
      const sig = await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, toArrayBuffer(data));
      return new Uint8Array(sig);
    },
  };
  return { auth, inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}` };
}

const TEST_USER = {
  id: "test-user-123",
  origin: "test",
  active: true,
  name: "Test User",
  email: "test@example.com",
  capabilities: ["service"],
};
const TEST_CALLER = {
  type: "user" as const,
  ...TEST_USER,
};

const EmptySchema = Type.Object({});
const NotFoundErrorDataSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal("NotFoundError"),
  message: Type.String(),
  resource: Type.String(),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String()),
});

type NotFoundErrorData = Static<typeof NotFoundErrorDataSchema>;

class NotFoundError extends TrellisError<NotFoundErrorData> {
  static readonly schema = NotFoundErrorDataSchema;
  override readonly name = "NotFoundError" as const;
  readonly resource: string;

  constructor(options: ErrorOptions & {
    resource: string;
    context?: Record<string, unknown>;
    id?: string;
  }) {
    const { resource, ...baseOptions } = options;
    super(`${resource} not found`, baseOptions);
    this.resource = resource;
  }

  static fromSerializable(data: NotFoundErrorData): NotFoundError {
    return new NotFoundError({
      resource: data.resource,
      id: data.id,
      context: data.context,
    });
  }

  override toSerializable(): NotFoundErrorData {
    return {
      ...this.baseSerializable(),
      type: this.name,
      resource: this.resource,
    };
  }
}

const authSchemas = {
  AuthValidateRequestInput: AuthValidateRequestSchema,
  AuthValidateRequestOutput: AuthValidateRequestResponseSchema,
  AuthMeInput: AuthMeSchema,
  AuthMeOutput: AuthMeResponseSchema,
  EmptySchema,
  TraceOutput: Type.Object({ traceId: Type.String() }),
  EventPayload: Type.Object({
    header: Type.Object({
      id: Type.String(),
      time: Type.String(),
    }),
    foo: Type.String(),
  }),
} as const;

function schemaRef<const TName extends keyof typeof authSchemas & string>(schema: TName) {
  return { schema } as const;
}

const emptyContract = defineContract({}, () => ({
  id: "trellis.empty.rpc-test@v1",
  displayName: "Empty RPC Test",
  description: "Provide an empty contract for RPC integration tests.",
  kind: "service",
}));

const authContract = defineContract(
  {
    schemas: {
      AuthValidateRequestInput: authSchemas.AuthValidateRequestInput,
      AuthValidateRequestOutput: authSchemas.AuthValidateRequestOutput,
      AuthMeInput: authSchemas.AuthMeInput,
      AuthMeOutput: authSchemas.AuthMeOutput,
    },
  },
  () => ({
    id: "trellis.auth.rpc-test@v1",
    displayName: "Auth RPC Test",
    description: "Expose auth RPCs for integration tests.",
    kind: "service",
    rpc: {
      "Auth.ValidateRequest": {
        version: "v1",
        input: schemaRef("AuthValidateRequestInput"),
        output: schemaRef("AuthValidateRequestOutput"),
        authRequired: false,
        errors: ["AuthError", "ValidationError", "UnexpectedError"],
      },
      "Auth.Me": {
        version: "v1",
        input: schemaRef("AuthMeInput"),
        output: schemaRef("AuthMeOutput"),
        errors: ["AuthError", "ValidationError", "UnexpectedError"],
      },
    },
  }),
);

const traceContract = defineContract(
  {
    schemas: {
      EmptySchema,
      TraceOutput: authSchemas.TraceOutput,
    },
  },
  () => ({
    id: "trellis.trace.rpc-test@v1",
    displayName: "Trace RPC Test",
    description: "Exercise traced RPC calls against a dependent auth contract.",
    kind: "service",
    uses: {
      auth: authContract.use({ rpc: { call: ["Auth.ValidateRequest"] } }),
    },
    rpc: {
      "Test.Trace": {
        version: "v1",
        input: schemaRef("EmptySchema"),
        output: schemaRef("TraceOutput"),
        errors: ["UnexpectedError"],
      },
    },
  }),
);

const traceRuntimeContract = {
  API: {
    owned: traceContract.API.trellis,
  },
};

const localErrorContract = defineContract(
  {
    schemas: {
      EmptySchema,
      NotFoundErrorData: NotFoundErrorDataSchema,
    },
    errors: {
      WorkspaceMissing: defineError(NotFoundError),
    },
  },
  (ref) => ({
    id: "trellis.local-error.rpc-test@v1",
    displayName: "Local Error RPC Test",
    description: "Round-trip a contract-local error as a real runtime class.",
    kind: "service",
    rpc: {
      "Test.LocalError": {
        version: "v1",
        input: schemaRef("EmptySchema"),
        output: schemaRef("EmptySchema"),
        authRequired: false,
        errors: [ref.error("WorkspaceMissing"), ref.error("UnexpectedError")],
      },
    },
  }),
);

async function waitFor<T>(
  fn: () => Promise<T | null>,
  opts: { description: string; timeoutMs?: number; intervalMs?: number },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 50;
  const start = Date.now();

  while (true) {
    const result = await fn();
    if (result !== null) return result;

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${opts.description}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

Deno.test({
  name: "NATS RPC Integration",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
  initTracing("trellis-tests");

  await using nats = await NatsTest.start();

  await t.step("NatsTest container starts and connects", () => {
    assertEquals(nats.nc.isClosed(), false);
  });

  await t.step("Trellis client validates input schema before sending", async () => {
    const { auth } = await createTestAuth();
    const client = createClient<typeof authContract.API.owned>(authContract, nats.nc, auth, {
      name: "client",
    });

    const result = await client.request(
      "Auth.ValidateRequest",
      JSON.parse('{"proof":"test-proof","subject":"rpc.Test","payloadHash":"not-a-hash"}'),
    );

    assertEquals(result.isErr(), true);
  });

  await t.step("Trellis template generates correct subjects", () => {
    const client = createClient<typeof emptyContract.API.owned>(
      emptyContract,
      nats.nc,
      { sessionKey: "test", sign: () => new Uint8Array(64) },
      { name: "client" },
    );

    const result = client.template("rpc.{/id}", { id: "test-123" });
    assertEquals(result.isOk(), true);
    assertEquals(result.take(), "rpc.test-123");
  });

  await t.step("Trellis template escapes special characters", () => {
    const client = createClient<typeof emptyContract.API.owned>(
      emptyContract,
      nats.nc,
      { sessionKey: "test", sign: () => new Uint8Array(64) },
      { name: "client" },
    );

    const result = client.template("rpc.{/id}", { id: "test.with.dots" });
    assertEquals(result.isOk(), true);
    assertEquals(result.take(), "rpc.test~2E~with~2E~dots");
  });

  await t.step("publish() encodes event header time as string", async () => {
    const eventContract = defineContract(
      {},
      () => ({
        id: "trellis.event.rpc-test@v1",
        displayName: "Event RPC Test",
        description: "Publish events for mixed RPC and event integration tests.",
        kind: "service",
        events: {
          "Test.Event": {
            version: "v1",
            event: schemaRef("EventPayload"),
          },
        },
      }),
    );

    const client = createClient<typeof eventContract.API.owned>(
      eventContract,
      nats.nc,
      { sessionKey: "test", sign: () => new Uint8Array(64) },
      { name: "publisher" },
    );

    const result = await client.publish("Test.Event", { foo: "bar" });
    assertEquals(result.isOk(), true);
  });

  await t.step("declared local RPC errors reconstruct to real runtime classes", async () => {
    const service = createClient<typeof localErrorContract.API.owned>(
      localErrorContract,
      nats.nc,
      { sessionKey: "local-error-service", sign: () => new Uint8Array(64) },
      { name: "local-error-service" },
    );

    await service.mount("Test.LocalError", async () => {
      return err(new NotFoundError({ resource: "Workspace" }));
    });

    const client = createClient<typeof localErrorContract.API.owned>(
      localErrorContract,
      nats.nc,
      { sessionKey: "local-error-client", sign: () => new Uint8Array(64) },
      { name: "local-error-client" },
    );

    const response = await client.request("Test.LocalError", {});
    const value = response.take();
    assert(isErr(value));
    const error = isErr(value) ? value.error : null;
    assertEquals(error instanceof NotFoundError, true);
    if (error instanceof NotFoundError) {
      assertEquals(error.resource, "Workspace");
      assertEquals(error.message, "Workspace not found");
    }
  });

      await t.step("trace context propagates across RPC", async () => {
    const authService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "auth-service", sign: () => new Uint8Array(64) },
      { name: "auth-service" },
    );
    const traceService = createClient<typeof traceContract.API.trellis>(
      traceRuntimeContract,
      nats.nc,
      { sessionKey: "trace-service", sign: () => new Uint8Array(64) },
      { name: "trace-service" },
    );

    // The server auth path for non-auth RPCs calls Auth.ValidateRequest internally.
    // For this unit integration, mount a permissive Auth.ValidateRequest handler.
    await authService.mount("Auth.ValidateRequest", async (input: unknown) => {
      const authInput = input as { sessionKey: string };
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${authInput.sessionKey.slice(0, 16)}`,
        caller: TEST_CALLER,
      });
    });

    await traceService.mount("Test.Trace", async () => {
      const span = getActiveSpan();
      return ok({ traceId: span?.spanContext().traceId ?? "" });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient<typeof traceContract.API.owned>(traceContract, nc, auth, { name: "trace-client" });

    const parent = getTracer().startSpan("test.parent");
    const parentTraceId = parent.spanContext().traceId;

    const result = await withSpanAsync(parent, () => client.request("Test.Trace", {}));
    parent.end();

    if (result.isErr()) throw result.error;
    const value = result.take() as { traceId: string };
    assertEquals(value.traceId, parentTraceId);

    await nc.close();
  });

  await t.step("AuthValidateRequest RPC round-trip works", async () => {
    const authService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "auth", sign: () => new Uint8Array(64) },
      { name: "auth-service" },
    );

    await authService.mount("Auth.ValidateRequest", async (input: unknown) => {
      const authInput = input as { sessionKey: string };
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${authInput.sessionKey.slice(0, 16)}`,
        caller: TEST_CALLER,
      });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient<typeof authContract.API.owned>(authContract, nc, auth, { name: "client" });
    const response = await waitFor<{ caller: { id?: string; deviceId?: string } }>(async () => {
      const r = await client.request(
        "Auth.ValidateRequest",
        {
          sessionKey: "valid-session",
          proof: "proof",
          subject: "rpc.Test",
          payloadHash: base64urlEncode(new Uint8Array(32)),
          capabilities: [],
        },
        { timeout: 500 },
      );
      const v = r.take();
      if (isErr(v)) return null;
      return v;
    }, { description: "AuthValidateRequest responder ready" }) as {
      allowed: boolean;
      caller: { type: string; id?: string; deviceId?: string; origin?: string; email?: string };
    };

    assertEquals(response.allowed, true);
    assertExists(response.caller);
    assertEquals(response.caller.type, "user");
    assertExists(response.caller.id);
    assertEquals(response.caller.id, TEST_USER.id);
    assertEquals(response.caller.origin, TEST_USER.origin);
    assertEquals(response.caller.email, TEST_USER.email);
    await nc.close();
  });

  await t.step("Full RPC with auth validation works", async () => {
    const meService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "service", sign: () => new Uint8Array(64) },
      { name: "me-service" },
    );
    const authService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "auth", sign: () => new Uint8Array(64) },
      { name: "auth-service-2" },
    );

    await authService.mount("Auth.ValidateRequest", async (input: unknown) => {
      const authInput = input as { sessionKey: string };
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${authInput.sessionKey.slice(0, 16)}`,
        caller: TEST_CALLER,
      });
    });

    await meService.mount("Auth.Me", async (_input, ctx) => {
      if (ctx.caller.type !== "user") {
        throw new Error("expected user caller");
      }
      return ok({
        user: {
          id: ctx.caller.id,
          origin: ctx.caller.origin ?? "",
          active: ctx.caller.active ?? true,
          name: ctx.caller.name ?? "",
          email: ctx.caller.email ?? "",
          ...(ctx.caller.image ? { image: ctx.caller.image } : {}),
          capabilities: ctx.caller.capabilities ?? [],
        },
      });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient<typeof authContract.API.owned>(authContract, nc, auth, { name: "client" });
    const response = await waitFor<{ user: { id: string } | null }>(async () => {
      const r = await client.request("Auth.Me", {}, { timeout: 500 });
      const v = r.take();
      if (isErr(v)) return null;
      return v;
    }, { description: "Me responder ready" });

    assertExists(response.user);
    assertEquals(response.user?.id, TEST_USER.id);
    await nc.close();
  });

  await t.step("Full RPC retries transient session_not_found during auth validation", async () => {
    const meService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "service-retry", sign: () => new Uint8Array(64) },
      { name: "me-service-retry" },
    );
    const authService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "auth-retry", sign: () => new Uint8Array(64) },
      { name: "auth-service-retry" },
    );

    let validateCalls = 0;
    await authService.mount("Auth.ValidateRequest", async (input: unknown) => {
      const authInput = input as { sessionKey: string };
      validateCalls += 1;
      if (validateCalls === 1) {
        return err(new AuthError({ reason: "session_not_found" }));
      }
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${authInput.sessionKey.slice(0, 16)}`,
        caller: TEST_CALLER,
      });
    });

    await meService.mount("Auth.Me", async (_input, ctx) => {
      if (ctx.caller.type !== "user") {
        throw new Error("expected user caller");
      }
      return ok({
        user: {
          id: ctx.caller.id,
          origin: ctx.caller.origin ?? "",
          active: ctx.caller.active ?? true,
          name: ctx.caller.name ?? "",
          email: ctx.caller.email ?? "",
          ...(ctx.caller.image ? { image: ctx.caller.image } : {}),
          capabilities: ctx.caller.capabilities ?? [],
        },
      });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient<typeof authContract.API.owned>(
      authContract,
      nc,
      auth,
      { name: "client-retry" },
    );

    const response = await waitFor<{ user: { id: string } | null }>(async () => {
      const r = await client.request("Auth.Me", {}, { timeout: 500 });
      const v = r.take();
      if (isErr(v)) return null;
      return v;
    }, { description: "Me responder ready after transient auth validation miss" });

    assertEquals(response.user?.id, TEST_USER.id);
    assertEquals(validateCalls, 2);
    await nc.close();
  });

  await t.step("requestOrThrow unwraps successful RPC responses", async () => {
    const meService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "service-throw", sign: () => new Uint8Array(64) },
      { name: "me-service-throw" },
    );
    const authService = createClient<typeof authContract.API.owned>(
      authContract,
      nats.nc,
      { sessionKey: "auth-throw", sign: () => new Uint8Array(64) },
      { name: "auth-service-throw" },
    );

    await authService.mount("Auth.ValidateRequest", async (input: unknown) => {
      const authInput = input as { sessionKey: string };
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${authInput.sessionKey.slice(0, 16)}`,
        caller: TEST_CALLER,
      });
    });

    await meService.mount("Auth.Me", async (_input, ctx) => {
      if (ctx.caller.type !== "user") {
        throw new Error("expected user caller");
      }
      return ok({
        user: {
          id: ctx.caller.id,
          origin: ctx.caller.origin ?? "",
          active: ctx.caller.active ?? true,
          name: ctx.caller.name ?? "",
          email: ctx.caller.email ?? "",
          ...(ctx.caller.image ? { image: ctx.caller.image } : {}),
          capabilities: ctx.caller.capabilities ?? [],
        },
      });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient<typeof authContract.API.owned>(authContract, nc, auth, { name: "client-throw" });
    const response = await waitFor<{ user: { id: string } | null }>(
      () => client.requestOrThrow("Auth.Me", {}, { timeout: 500 }).catch(() => null),
      { description: "Me responder ready for requestOrThrow" },
    );

    assertExists(response?.user);
    assertEquals(response?.user?.id, TEST_USER.id);
    await nc.close();
  });
  },
});

Deno.test("mount rejects unknown RPC methods with an explicit error", async () => {
  const service = createClient<typeof emptyContract.API.owned>(
    emptyContract,
    { options: { inboxPrefix: "_INBOX.test" } } as never,
    { sessionKey: "test", sign: () => new Uint8Array(64) },
    { name: "unknown-rpc-service" },
  );

  await assertRejects(
    () => service.mount("Does.Not.Exist" as never, async () => ok({} as never)),
    Error,
    "Unknown RPC method",
  );
});
