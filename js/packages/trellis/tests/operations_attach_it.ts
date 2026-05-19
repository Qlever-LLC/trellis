import type { NatsConnection } from "@nats-io/nats-core";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { AsyncResult, ok } from "../index.ts";
import { TrellisServiceRuntime } from "../server/mod.ts";
import { createClient } from "../client.ts";
import { createRoutedNatsConnections } from "../testing/routed_nats.ts";
import type {
  DurableOperationRecord,
  RuntimeOperationRecord,
  TrellisAuth,
} from "../trellis.ts";

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

const billingCapabilities = {
  "billing.refund": {
    displayName: "Refund billing",
    description: "Start billing refund operations.",
  },
  "billing.read": {
    displayName: "Read billing",
    description: "Read billing refund operations.",
  },
  "billing.cancel": {
    displayName: "Cancel billing",
    description: "Cancel billing refund operations.",
  },
} as const;

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
      RefundInput: Type.Object({ chargeId: Type.String() }),
      RefundProgress: Type.Object({ message: Type.String() }),
      RefundOutput: Type.Object({ refundId: Type.String() }),
    },
  },
  (ref) => ({
    id: "trellis.billing.attach-test@v1",
    displayName: "Billing Attach Test",
    description: "Exercise operations attach() over NATS.",
    capabilities: billingCapabilities,
    uses: {
      required: {
        auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      },
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not met");
}

function startPermissiveAuthResponder(
  nc: NatsConnection,
): void {
  const sub = nc.subscribe("rpc.v1.Auth.Requests.Validate");
  void (async () => {
    for await (const msg of sub) {
      const input = msg.json() as { sessionKey: string };
      msg.respond(JSON.stringify({
        allowed: true,
        inboxPrefix: `_INBOX.${input.sessionKey.slice(0, 16)}`,
        caller: {
          type: "user",
          participantKind: "app",
          userId: "test-user-123",
          active: true,
          name: "Test User",
          email: "test@example.com",
          capabilities: [
            "billing.refund",
            "billing.read",
            "billing.cancel",
            "service",
          ],
          identity: {
            identityId: "test-identity-123",
            provider: "test",
            subject: "test-subject-123",
          },
        },
      }));
    }
  })();
}

async function createAttachTestRuntime() {
  const createConnection = createRoutedNatsConnections();
  const authNc = createConnection();
  startPermissiveAuthResponder(authNc);
  const { auth } = await createTestAuth();
  const serverNc = createConnection();
  const clientNc = createConnection();
  const server = TrellisServiceRuntime.create(
    "billing-server",
    serverNc,
    auth,
    { api: billing.API.trellis },
  );
  const operationRecords = new Map<string, DurableOperationRecord>();
  server.saveOperationRecord = async (runtime: RuntimeOperationRecord) => {
    operationRecords.set(runtime.id, {
      ownerSessionKey: runtime.ownerSessionKey,
      sequence: runtime.sequence,
      signalSequence: runtime.signalSequence,
      signals: structuredClone(runtime.signals),
      snapshot: structuredClone(runtime.snapshot),
    });
  };
  server.loadOperationRecord = async (operationId: string) => {
    return operationRecords.get(operationId) ?? null;
  };
  const client = createClient(billing, clientNc, auth, {
    name: "attach-client",
  });
  return { server, client, clientNc, authNc };
}

Deno.test({
  name: "Operation attach waits for job completion",
  async fn() {
    const { server, client, clientNc, authNc } =
      await createAttachTestRuntime();

    const jobDone = deferred();
    let jobWaitStarted = false;

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_123");

      const job = {
        id: "job_123",
        service: "billing-server",
        type: "submit-refund",
        wait: () =>
          AsyncResult.from((async () => {
            await server.operations.started(op.id);
            await server.operations.progress(op.id, { message: "working" });
            jobWaitStarted = true;
            await jobDone.promise;
            await server.operations.complete(op.id, { refundId: "rf_123" });
            return ok(undefined);
          })()),
      };

      return await op.attach(job);
    });

    try {
      const ref = await client.operation("Billing.Refund").input({
        chargeId: "ch_123",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertExists(ref);

      await waitUntil(() => jobWaitStarted);
      const running = await ref.get().orThrow();
      assertEquals(running.state, "running");
      assertEquals(running.progress, { message: "working" });

      jobDone.resolve();

      const terminal = await ref.wait().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(terminal.state, "completed");
      assertExists(terminal.output);
      if (
        typeof terminal.output !== "object" ||
        terminal.output === null ||
        !("refundId" in terminal.output)
      ) {
        throw new Error("expected refundId output");
      }
      assertEquals(terminal.output.refundId, "rf_123");
    } finally {
      await server.stop();
      await clientNc.drain();
      await authNc.drain();
    }
  },
});
