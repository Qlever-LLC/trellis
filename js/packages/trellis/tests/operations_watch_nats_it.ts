import { connect } from "@nats-io/transport-deno";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineContract } from "../contract.ts";
import { ok, TrellisServer } from "../index.ts";
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

const billing = defineContract({
  id: "trellis.billing.watch-test@v1",
  displayName: "Billing Watch Test",
  description: "Exercise operations watch streams over NATS.",
  kind: "service",
  schemas: {
    RefundInput: Type.Object({ chargeId: Type.String() }, { additionalProperties: false }),
    RefundProgress: Type.Object({ message: Type.String() }, { additionalProperties: false }),
    RefundOutput: Type.Object({ refundId: Type.String() }, { additionalProperties: false }),
  },
  operations: {
    "Billing.Refund": {
      version: "v1",
      input: { schema: "RefundInput" },
      progress: { schema: "RefundProgress" },
      output: { schema: "RefundOutput" },
      capabilities: {
        call: ["billing.refund"],
        read: ["billing.read"],
        cancel: ["billing.cancel"],
      },
      cancel: true,
    },
  },
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

Deno.test({
  name: "Operations watch stream over NATS",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    const { auth, inboxPrefix } = await createTestAuth();
    const info = nats.nc.info!;

    const serverNc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });
    const clientNc = await connect({ servers: `localhost:${info.port}`, inboxPrefix });

    const server = TrellisServer.create(
      "billing-server",
      serverNc,
      auth,
      { api: billing.API.owned },
    );
    const client = createClient(billing, clientNc, auth, { name: "watch-client" });

    const gate = deferred();

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_123");

      await gate.promise;
      await op.started();
      await op.progress({ message: "working" });
      await op.complete({ refundId: "rf_123" });
      return ok({ refundId: "rf_123" });
    });

    try {
      const started = await client.operation("Billing.Refund").start({
        chargeId: "ch_123",
      });
      const op = started.take() as {
        watch: () => Promise<{ take: () => AsyncIterable<{ type: string }> }>;
      };
      assertExists(op);

      const watch = (await op.watch()).take();
      const events: Array<{ type: string }> = [];
      const collect = (async () => {
        for await (const event of watch) {
          events.push(event);
        }
      })();

      await waitFor(() => events.length >= 1, { description: "initial watch frame" });
      gate.resolve();
      await collect;

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
