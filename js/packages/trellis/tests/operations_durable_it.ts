import { connect } from "@nats-io/transport-deno";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
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
    id: "trellis.billing.durable-test@v1",
    displayName: "Billing Durable Test",
    description: "Exercise durable operations state over restart.",
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

Deno.test({
  name: "Operations snapshots survive restart",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    startPermissiveAuthResponder(nats.nc);
    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;

    const serverNc1 = await connect({
      servers: `localhost:${info.port}`,
      inboxPrefix,
    });
    const clientNc = await connect({
      servers: `localhost:${info.port}`,
      inboxPrefix,
    });

    const server1 = TrellisServiceRuntime.create(
      "billing-server",
      serverNc1,
      auth,
      { api: billing.API.trellis },
    );
    await server1.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_123");
      await op.started();
      await op.progress({ message: "working" });
      await op.complete({ refundId: "rf_123" });
      return ok({ refundId: "rf_123" });
    });

    const client = createClient(billing, clientNc, auth, {
      name: "durability-client",
    });
    const ref = await client.operation("Billing.Refund").input({
      chargeId: "ch_123",
    }).start().match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    });

    const firstSnapshot = await ref.wait().match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    }) as {
      revision: number;
      state: string;
      id: string;
      service: string;
      operation: string;
      createdAt: string;
      updatedAt: string;
      completedAt?: string;
      output: { refundId: string };
    };

    assertEquals(firstSnapshot.state, "completed");
    assertEquals(firstSnapshot.revision, 4);
    assertExists(firstSnapshot.createdAt);
    assertExists(firstSnapshot.updatedAt);
    assertExists(firstSnapshot.completedAt);
    assertEquals(firstSnapshot.output.refundId, "rf_123");

    await server1.stop();

    const serverNc2 = await connect({
      servers: `localhost:${info.port}`,
      inboxPrefix,
    });
    const server2 = TrellisServiceRuntime.create(
      "billing-server",
      serverNc2,
      auth,
      { api: billing.API.trellis },
    );
    await server2.operation("Billing.Refund").handle(async () =>
      ok({ refundId: "unused" })
    );

    const afterRestart = await ref.get().match({
      ok: (value) => value,
      err: (error) => {
        throw error;
      },
    }) as {
      revision: number;
      state: string;
      id: string;
      service: string;
      operation: string;
      createdAt: string;
      updatedAt: string;
      completedAt?: string;
      output: { refundId: string };
    };

    assertEquals(afterRestart, firstSnapshot);

    await server2.stop();
    await clientNc.drain();
  },
});
