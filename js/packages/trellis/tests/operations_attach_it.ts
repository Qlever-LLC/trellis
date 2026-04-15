import { connect } from "@nats-io/transport-deno";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { ok } from "../index.ts";
import { TrellisServer } from "../server/mod.ts";
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
    id: "trellis.billing.attach-test@v1",
    displayName: "Billing Attach Test",
    description: "Exercise operations attach() over NATS.",
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

Deno.test({
  name: "Operation attach waits for job completion",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
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

    const server = TrellisServer.create(
      "billing-server",
      serverNc,
      auth,
      { api: billing.API.owned },
    );
    const client = createClient(billing, clientNc, auth, {
      name: "attach-client",
    });

    const jobDone = deferred();

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_123");

      const job = {
        id: "job_123",
        service: "billing-server",
        type: "submit-refund",
        wait: async () => {
          await jobDone.promise;
          return ok(undefined);
        },
      };

      void (async () => {
        await server.operations.started(op.id);
        await server.operations.progress(op.id, { message: "working" });
        await server.operations.complete(op.id, { refundId: "rf_123" });
        jobDone.resolve();
      })();

      return await op.attach(job);
    });

    try {
      const started = await client.operation("Billing.Refund").start({
        chargeId: "ch_123",
      });
      const ref = started.take() as {
        wait: () => Promise<
          { take: () => { state: string; output?: { refundId: string } } }
        >;
      };
      assertExists(ref);

      const terminal = (await ref.wait()).take();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output?.refundId, "rf_123");
    } finally {
      await server.stop();
      await clientNc.drain();
    }
  },
});
