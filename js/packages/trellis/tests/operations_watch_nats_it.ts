import { connect } from "@nats-io/transport-deno";
import { assert, assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { globalCapabilityName } from "../contract_support/mod.ts";
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
  "billing.control": {
    displayName: "Control billing",
    description: "Control billing refund operations.",
  },
} as const;

const billing = defineServiceContract(
  {
    capabilities: billingCapabilities,
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
      SelectWorkspaceSignal: Type.Object({ workspaceId: Type.String() }, {
        additionalProperties: false,
      }),
      ContinueSignal: Type.Object({ confirmed: Type.Boolean() }, {
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
          control: ["billing.control"],
        },
        signals: {
          selectWorkspace: { input: ref.schema("SelectWorkspaceSignal") },
          continue: { input: ref.schema("ContinueSignal") },
        },
        cancel: true,
      },
      "Billing.Status": {
        version: "v1",
        input: ref.schema("RefundInput"),
        progress: ref.schema("RefundProgress"),
        output: ref.schema("RefundOutput"),
        capabilities: {
          call: ["billing.refund"],
          read: ["billing.read"],
        },
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
  observe?: (input: { sessionKey: string; capabilities?: string[] }) => void,
): void {
  const sub = nc.subscribe("rpc.v1.Auth.ValidateRequest");
  void (async () => {
    for await (const msg of sub) {
      const input = msg.json() as {
        sessionKey: string;
        capabilities?: string[];
      };
      observe?.(input);
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
            "billing.control",
            "service",
          ],
        },
      }));
    }
  })();
}

Deno.test({
  name:
    "Operation cancel rejects unsupported operations and uses cancel capabilities over NATS",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    const authRequests: Array<{ capabilities?: string[] }> = [];
    startPermissiveAuthResponder(nats.nc, (input) => {
      authRequests.push({ capabilities: input.capabilities });
    });
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
      name: "cancel-control-client",
    });

    await server.operation("Billing.Refund").handle(async ({ op }) => {
      await op.started();
      return op.defer();
    });
    await server.operation("Billing.Status").handle(async ({ op }) => {
      await op.started();
      return op.defer();
    });

    try {
      const cancellable = await client.operation("Billing.Refund").input({
        chargeId: "ch_cancel",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      const cancelled = await cancellable.cancel().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(cancelled.state, "cancelled");
      const billingCancel = globalCapabilityName(
        "trellis.billing.watch-test@v1",
        "billing.cancel",
      );
      const billingControl = globalCapabilityName(
        "trellis.billing.watch-test@v1",
        "billing.control",
      );

      assert(
        authRequests.some((request) =>
          request.capabilities?.length === 1 &&
          request.capabilities[0] === billingCancel
        ),
      );
      assert(
        !authRequests.some((request) =>
          request.capabilities?.length === 1 &&
          request.capabilities[0] === billingControl
        ),
      );

      const nonCancellable = await client.operation("Billing.Status").input({
        chargeId: "ch_status",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      const unsupported = await nonCancellable.cancel();
      assert(unsupported.isErr());
      assertEquals(
        Reflect.get(unsupported.error, "code"),
        "trellis.operation.control_error",
      );
    } finally {
      await server.stop();
      await clientNc.drain();
    }
  },
});

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

Deno.test({
  name:
    "Operation signals are persisted, acknowledged, and consumed in acceptance order over NATS",
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
      name: "signal-client",
    });

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_signal");
      await op.started();

      const seen: string[] = [];
      for await (const signal of op.signals()) {
        seen.push(signal.signal);
        if (signal.signal === "selectWorkspace") {
          assertEquals(signal.input, { workspaceId: "ws_123" });
          await op.progress({ message: "workspace selected" });
        }
        if (signal.signal === "continue") {
          assertEquals(signal.input, { confirmed: true });
          assertEquals(seen, ["selectWorkspace", "continue"]);
          await op.complete({ refundId: "rf_signal" });
          return ok({ refundId: "rf_signal" });
        }
      }

      throw new Error("signal stream ended before continue");
    });

    try {
      const ref = await client.operation("Billing.Refund").input({
        chargeId: "ch_signal",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });

      await waitFor(async () => {
        const snapshot = await ref.get().match({
          ok: (value) => value,
          err: () => undefined,
        });
        return snapshot?.state === "running";
      }, { description: "operation running" });

      const beforeSignal = await ref.get().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      const selectAck = await ref.signal("selectWorkspace", {
        workspaceId: "ws_123",
      }).match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(selectAck.kind, "signal-accepted");
      assertEquals(selectAck.signalSequence, 1);
      assertEquals(selectAck.snapshot.revision, beforeSignal.revision);

      const continueAck = await ref.signal("continue", { confirmed: true })
        .match({
          ok: (value) => value,
          err: (error) => {
            throw error;
          },
        });
      assertEquals(continueAck.signalSequence, 2);

      const terminal = await ref.wait().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, { refundId: "rf_signal" });
    } finally {
      await server.stop();
      await clientNc.drain();
    }
  },
});

Deno.test({
  name: "Queued operation signal is delivered before live signals",
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
      name: "queued-signal-client",
    });
    const gate = deferred();

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      assertEquals(input.chargeId, "ch_queued");
      await op.started();
      await gate.promise;
      const first = await op.nextSignal().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(first.signal, "selectWorkspace");
      const second = await op.nextSignal("continue").match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(second.signal, "continue");
      await op.complete({ refundId: "rf_queued" });
      return ok({ refundId: "rf_queued" });
    });

    try {
      const ref = await client.operation("Billing.Refund").input({
        chargeId: "ch_queued",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });

      await ref.signal("selectWorkspace", { workspaceId: "ws_queued" }).match({
        ok: () => undefined,
        err: (error) => {
          throw error;
        },
      });
      gate.resolve();
      await ref.signal("continue", { confirmed: true }).match({
        ok: () => undefined,
        err: (error) => {
          throw error;
        },
      });

      const terminal = await ref.wait().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(terminal.output, { refundId: "rf_queued" });
    } finally {
      await server.stop();
      await clientNc.drain();
    }
  },
});

Deno.test({
  name: "Terminal and invalid operation signals are rejected over NATS",
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
      name: "rejected-signal-client",
    });

    await server.operation("Billing.Refund").handle(async ({ input, op }) => {
      await op.started();
      if (input.chargeId === "ch_terminal") {
        await op.complete({ refundId: "rf_terminal" });
        return ok({ refundId: "rf_terminal" });
      }
      return op.defer();
    });

    try {
      const invalidRef = await client.operation("Billing.Refund").input({
        chargeId: "ch_invalid",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      const invalid = await invalidRef.signal("selectWorkspace", {
        workspaceId: 123,
      });
      assert(invalid.isErr());
      assertEquals(
        Reflect.get(invalid.error, "code"),
        "trellis.operation.control_error",
      );

      const terminalRef = await client.operation("Billing.Refund").input({
        chargeId: "ch_terminal",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      await terminalRef.wait().match({
        ok: () => undefined,
        err: (error) => {
          throw error;
        },
      });
      const terminalSignal = await terminalRef.signal("continue", {
        confirmed: true,
      });
      assert(terminalSignal.isErr());
      assertEquals(
        Reflect.get(terminalSignal.error, "code"),
        "trellis.operation.control_error",
      );
    } finally {
      await server.stop();
      await clientNc.drain();
    }
  },
});

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  opts: { description: string; timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 25;
  const start = Date.now();

  while (true) {
    if (await condition()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${opts.description}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
