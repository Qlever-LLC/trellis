import { connect } from "@nats-io/transport-deno";
import { assertEquals, assertExists } from "@std/assert";
import {
  AuthMeResponseSchema,
  AuthMeSchema,
  AuthValidateRequestResponseSchema,
  AuthValidateRequestSchema,
} from "@trellis/auth";

import { Type } from "typebox";
import { isErr, ok } from "../../result/mod.ts";
import { createClient } from "../client.ts";
import { defineContract } from "../contract.ts";
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

const EmptySchema = Type.Object({}, { additionalProperties: false });

const emptyContract = defineContract({
  id: "trellis.empty.rpc-test@v1",
  displayName: "Empty RPC Test",
  description: "Provide an empty contract for RPC integration tests.",
  kind: "service",
});

const authContract = defineContract({
  id: "trellis.auth.rpc-test@v1",
  displayName: "Auth RPC Test",
  description: "Expose auth RPCs for integration tests.",
  kind: "service",
  rpc: {
    "Auth.ValidateRequest": {
      version: "v1",
      inputSchema: AuthValidateRequestSchema,
      outputSchema: AuthValidateRequestResponseSchema,
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
    "Auth.Me": {
      version: "v1",
      inputSchema: AuthMeSchema,
      outputSchema: AuthMeResponseSchema,
      errors: ["AuthError", "ValidationError", "UnexpectedError"],
    },
  },
});

const traceContract = defineContract({
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
      inputSchema: EmptySchema,
      outputSchema: Type.Object({ traceId: Type.String() }, { additionalProperties: false }),
      errors: ["UnexpectedError"],
    },
  },
});

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
    const client = createClient(authContract, nats.nc, auth, {
      name: "client",
    });

    const result = await client.request("Auth.ValidateRequest", {
      sessionKey: {} as unknown as string,
      proof: "test-proof",
      subject: "rpc.Test",
      payloadHash: "not-a-hash",
    });

    assertEquals(result.isErr(), true);
  });

  await t.step("Trellis template generates correct subjects", () => {
    const client = createClient(
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
    const client = createClient(
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
    const eventContract = defineContract({
      id: "trellis.event.rpc-test@v1",
      displayName: "Event RPC Test",
      description: "Publish events for mixed RPC and event integration tests.",
      kind: "service",
      events: {
        "Test.Event": {
          version: "v1",
          eventSchema: Type.Object({
            header: Type.Object({
              id: Type.String(),
              time: Type.String(),
            }),
            foo: Type.String(),
          }),
        },
      },
    });

    const client = createClient(
      eventContract,
      nats.nc,
      { sessionKey: "test", sign: () => new Uint8Array(64) },
      { name: "publisher" },
    );

    const result = await client.publish("Test.Event", { foo: "bar" });
    assertEquals(result.isOk(), true);
  });

  await t.step("trace context propagates across RPC", async () => {
    const traceService = createClient(
      traceContract,
      nats.nc,
      { sessionKey: "trace-service", sign: () => new Uint8Array(64) },
      { name: "trace-service" },
    );

    // The server auth path for non-auth RPCs calls Auth.ValidateRequest internally.
    // For this unit integration, mount a permissive Auth.ValidateRequest handler.
    await traceService.mount("Auth.ValidateRequest", async (input) => {
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${input.sessionKey.slice(0, 16)}`,
        user: TEST_USER,
      });
    });

    await traceService.mount("Test.Trace", async () => {
      const span = getActiveSpan();
      return ok({ traceId: span?.spanContext().traceId ?? "" });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient(traceContract, nc, auth, { name: "trace-client" });

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
    const authService = createClient(
      authContract,
      nats.nc,
      { sessionKey: "auth", sign: () => new Uint8Array(64) },
      { name: "auth-service" },
    );

    await authService.mount("Auth.ValidateRequest", async (input, _ctx) => {
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${input.sessionKey.slice(0, 16)}`,
        user: TEST_USER,
      });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient(authContract, nc, auth, { name: "client" });
    const response = await waitFor(async () => {
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
    }, { description: "AuthValidateRequest responder ready" });

    assertEquals(response.allowed, true);
    assertExists(response.user);
    assertEquals(response.user.id, TEST_USER.id);
    await nc.close();
  });

  await t.step("Full RPC with auth validation works", async () => {
    const meService = createClient(
      authContract,
      nats.nc,
      { sessionKey: "service", sign: () => new Uint8Array(64) },
      { name: "me-service" },
    );
    const authService = createClient(
      authContract,
      nats.nc,
      { sessionKey: "auth", sign: () => new Uint8Array(64) },
      { name: "auth-service-2" },
    );

    await authService.mount("Auth.ValidateRequest", async (input, _ctx) => {
      return ok({
        allowed: true,
        inboxPrefix: `_INBOX.${input.sessionKey.slice(0, 16)}`,
        user: TEST_USER,
      });
    });

    await meService.mount("Auth.Me", async (_input, ctx) => {
      return ok({ user: ctx.user });
    });

    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;
    const nc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const client = createClient(authContract, nc, auth, { name: "client" });
    const response = await waitFor(async () => {
      const r = await client.request("Auth.Me", {}, { timeout: 500 });
      const v = r.take();
      if (isErr(v)) return null;
      return v;
    }, { description: "Me responder ready" });

    assertExists(response.user);
    assertEquals(response.user.id, TEST_USER.id);
    await nc.close();
  });
  },
});
