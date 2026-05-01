import { connect } from "@nats-io/transport-deno";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { ok } from "../index.ts";
import { TrellisServiceRuntime } from "../server/mod.ts";
import { createClient } from "../client.ts";
import { NatsTest } from "../testing/nats.ts";
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

const billing = defineServiceContract(
  {
    schemas: {
      RefundInput: Type.Object({ chargeId: Type.String() }, {
        additionalProperties: false,
      }),
      RefundProgress: Type.Object({ message: Type.String() }, {
        additionalProperties: false,
      }),
      RefundOutput: Type.Object({ refundId: Type.String() }, {
        additionalProperties: false,
      }),
    },
  },
  (ref) => ({
    id: "trellis.billing.watch-test@v1",
    displayName: "Billing Watch Test",
    description: "Exercise operations watch streams over NATS.",
    uses: {
      auth: auth.use({ rpc: { call: ["Auth.ValidateRequest"] } }),
    },
    operations: {
      "Billing.Refund": {
        version: "v1",
        input: ref.schema("RefundInput"),
        progress: ref.schema("RefundProgress"),
        output: ref.schema("RefundOutput"),
        capabilities: {
          call: ["billing.refund"],
          read: ["billing.read"],
          cancel: ["billing.cancel"],
        },
        cancel: true,
      },
    },
  }),
);

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function startPermissiveAuthResponder(
  nc: Awaited<ReturnType<typeof NatsTest.start>>["nc"],
): void {
  const sub = nc.subscribe("rpc.v1.Auth.ValidateRequest");
  void (async () => {
    for await (const msg of sub) {
      const input = msg.json() as { sessionKey: string };
      msg.respond(JSON.stringify({
        allowed: true,
        inboxPrefix: `_INBOX.${input.sessionKey.slice(0, 16)}`,
        caller: {
          type: "user",
          participantKind: "app",
          id: "auth0|test-user",
          trellisId: "tid_test_user",
          origin: "test",
          active: true,
          name: "Test User",
          email: "test@example.com",
          capabilities: [
            "billing.refund",
            "billing.read",
            "billing.cancel",
            "service",
          ],
        },
      }));
    }
  })();
}

Deno.test({
  name: "Operations watch stream over NATS",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    startPermissiveAuthResponder(nats.nc);
    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;

    const serverNc = await connect({
      servers: `localhost:${info.port}`,
      inboxPrefix,
    });
    const clientNc = await connect({
      servers: `localhost:${info.port}`,
      inboxPrefix,
    });

    const server = TrellisServiceRuntime.create(
      "billing-server",
      serverNc,
      auth,
      { api: billing.API.trellis },
    );
    const client = createClient(billing, clientNc, auth, {
      name: "watch-client",
    });

    const gate = deferred();

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_123");

      await gate.promise;
      await op.started();
      await new Promise((resolve) => setTimeout(resolve, 25));
      await op.progress({ message: "working" });
      await new Promise((resolve) => setTimeout(resolve, 25));
      await op.complete({ refundId: "rf_123" });
      return ok({ refundId: "rf_123" });
    });

    try {
      const events: Array<{ type: string }> = [];
      const op = await client.operation("Billing.Refund").input({
        chargeId: "ch_123",
      })
        .onAccepted((event) => {
          events.push({ type: event.type });
        })
        .onStarted((event) => {
          events.push({ type: event.type });
        })
        .onProgress((event) => {
          events.push({ type: event.type });
        })
        .onCompleted((event) => {
          events.push({ type: event.type });
        })
        .start().match({
          ok: (value) => value,
          err: (error) => {
            throw error;
          },
        });
      assertExists(op);

      await waitFor(() => events.length >= 1, {
        description: "initial watch frame",
      });
      gate.resolve();
      await op.wait();
      await waitFor(() => events.length >= 4, {
        description: "callback delivery",
      });

      assertEquals(events.map((event) => event.type), [
        "accepted",
        "started",
        "progress",
        "completed",
      ]);
    } finally {
      await server.stop();
      await clientNc.drain();
    }
  },
});

Deno.test({
  name:
    "Operations builder callbacks keep accepted deterministic over NATS for fast completion",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    startPermissiveAuthResponder(nats.nc);
    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;

    const serverNc = await connect({
      servers: `localhost:${info.port}`,
      inboxPrefix,
    });
    const clientNc = await connect({
      servers: `localhost:${info.port}`,
      inboxPrefix,
    });

    const server = TrellisServiceRuntime.create(
      "billing-server",
      serverNc,
      auth,
      { api: billing.API.trellis },
    );
    const client = createClient(billing, clientNc, auth, {
      name: "watch-client-fast-complete",
    });

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_fast");

      await op.started();
      await op.complete({ refundId: "rf_fast" });
      return ok({ refundId: "rf_fast" });
    });

    try {
      const events: string[] = [];
      const op = await client.operation("Billing.Refund").input({
        chargeId: "ch_fast",
      })
        .onAccepted(() => {
          events.push("accepted");
        })
        .onCompleted(() => {
          events.push("completed");
        })
        .start().match({
          ok: (value) => value,
          err: (error) => {
            throw error;
          },
        });

      await op.wait().match({
        ok: () => undefined,
        err: (error) => {
          throw error;
        },
      });

      assertEquals(events[0], "accepted");
      assertEquals(events.filter((event) => event === "accepted").length, 1);
      assertEquals(events.at(-1), "completed");
    } finally {
      await server.stop();
      await clientNc.drain();
    }
  },
});

async function waitFor(
  condition: () => boolean,
  opts: { description: string; timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 25;
  const start = Date.now();

  while (true) {
    if (condition()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${opts.description}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
