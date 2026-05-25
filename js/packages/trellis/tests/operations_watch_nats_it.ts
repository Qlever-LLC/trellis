import type {
  Msg,
  MsgHdrs,
  NatsConnection,
  Payload,
  Subscription,
} from "@nats-io/nats-core";
import { assert, assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineServiceContract } from "../contract.ts";
import { globalCapabilityName } from "../contract_support/mod.ts";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { ok } from "../index.ts";
import { TrellisServiceRuntime } from "../server/mod.ts";
import { createClient } from "../client.ts";
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
    schemas: {
      RefundInput: Type.Object({ chargeId: Type.String() }),
      RefundProgress: Type.Object({ message: Type.String() }),
      RefundOutput: Type.Object({ refundId: Type.String() }),
      SelectWorkspaceSignal: Type.Object({ workspaceId: Type.String() }),
      ContinueSignal: Type.Object({ confirmed: Type.Boolean() }),
    },
  },
  (ref) => ({
    id: "trellis.billing.watch-test@v1",
    displayName: "Billing Watch Test",
    description: "Exercise operations watch streams over NATS.",
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
          observe: ["billing.read"],
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
          observe: ["billing.read"],
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

type BufferedSubscription = Subscription & {
  push(message: Msg): void;
};

function createRoutedNatsConnections(): () => NatsConnection {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const subscriptions: BufferedSubscription[] = [];

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

  const route = (message: Msg) => {
    for (const subscription of subscriptions) {
      if (subjectMatches(subscription.getSubject(), message.subject)) {
        subscription.push(message);
      }
    }
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
      const data = payloadBytes(payload);
      if (args.onRespond) {
        args.onRespond(data, opts?.headers);
        return true;
      }
      if (!args.reply) return false;
      route(
        createMessage({ subject: args.reply, data, headers: opts?.headers }),
      );
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

  return () => {
    let closed = false;
    const close = () => {
      closed = true;
    };
    const connection: NatsConnection & { options: { inboxPrefix: string } } = {
      options: { inboxPrefix: "_INBOX.test" },
      info: undefined,
      closed: async () => undefined,
      close: async () => close(),
      publish: (subject, payload, opts) => {
        route(createMessage({
          subject,
          data: payloadBytes(payload),
          headers: opts?.headers,
          reply: opts?.reply,
        }));
      },
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

        const sessionKey = opts?.headers?.get("session-key");
        const reply = typeof sessionKey === "string"
          ? `_INBOX.${sessionKey.slice(0, 16)}.reply`
          : "_INBOX.test.reply";

        return await new Promise<Msg>((resolve) => {
          subscription.push(createMessage({
            subject,
            data: payloadBytes(payload),
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
      drain: async () => close(),
      isClosed: () => closed,
      isDraining: () => false,
      getServer: () => "nats://in-memory",
      status: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
      stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
      rtt: async () => 0,
      reconnect: async () => {},
    };
    return connection;
  };
}

async function createOperationTestRuntime(
  name: string,
  observeAuth?: (
    input: { sessionKey: string; capabilities?: string[] },
  ) => void,
) {
  const createConnection = createRoutedNatsConnections();
  const authNc = createConnection();
  startPermissiveAuthResponder(authNc, observeAuth);
  const { auth } = await createTestAuth();
  const serverNc = createConnection();
  const clientNc = createConnection();
  const api = billing.API.trellis;
  if (!api) throw new Error("expected billing Trellis API");
  const server = TrellisServiceRuntime.create<NonNullable<typeof api>>(
    "billing-server",
    serverNc,
    auth,
    { api },
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
  const client = createClient(billing, clientNc, auth, { name });
  return { server, client, clientNc };
}

function startPermissiveAuthResponder(
  nc: NatsConnection,
  observe?: (input: { sessionKey: string; capabilities?: string[] }) => void,
): void {
  const sub = nc.subscribe("rpc.v1.Auth.Requests.Validate");
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
          userId: "test-user-123",
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

Deno.test({
  name:
    "Operation cancel rejects unsupported operations and uses cancel capabilities",
  async fn() {
    const authRequests: Array<{ capabilities?: string[] }> = [];
    const { server, client, clientNc } = await createOperationTestRuntime(
      "cancel-control-client",
      (input) => authRequests.push({ capabilities: input.capabilities }),
    );

    await server.operationHandle("Billing.Refund").handle(async ({ op }) => {
      await op.started();
      return op.defer();
    });
    await server.operationHandle("Billing.Status").handle(async ({ op }) => {
      await op.started();
      return op.defer();
    });

    try {
      const cancellable = await client.operation.billing.refund.input({
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

      const nonCancellable = await client.operation.billing.status.input({
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
  name: "Operations watch stream delivers callbacks in order",
  async fn() {
    const { server, client, clientNc } = await createOperationTestRuntime(
      "watch-client",
    );

    const gate = deferred();

    await server.operationHandle("Billing.Refund").handle(
      async ({ input, op }) => {
        assertEquals(input.chargeId, "ch_123");

        await gate.promise;
        await op.started();
        await new Promise((resolve) => setTimeout(resolve, 25));
        await op.progress({ message: "working" });
        await new Promise((resolve) => setTimeout(resolve, 25));
        await op.complete({ refundId: "rf_123" });
        return ok({ refundId: "rf_123" });
      },
    );

    try {
      const events: Array<{ type: string }> = [];
      const op = await client.operation.billing.refund.input({
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
    "Operations builder callbacks keep accepted deterministic for fast completion",
  async fn() {
    const { server, client, clientNc } = await createOperationTestRuntime(
      "watch-client-fast-complete",
    );

    await server.operationHandle("Billing.Refund").handle(
      async ({ input, op }) => {
        assertEquals(input.chargeId, "ch_fast");

        await op.started();
        await op.complete({ refundId: "rf_fast" });
        return ok({ refundId: "rf_fast" });
      },
    );

    try {
      const events: string[] = [];
      const op = await client.operation.billing.refund.input({
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
    "Operation signals are persisted, acknowledged, and consumed in acceptance order",
  async fn() {
    const { server, client, clientNc } = await createOperationTestRuntime(
      "signal-client",
    );

    await server.operationHandle("Billing.Refund").handle(
      async ({ input, op }) => {
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
      },
    );

    try {
      const ref = await client.operation.billing.refund.input({
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
  async fn() {
    const { server, client, clientNc } = await createOperationTestRuntime(
      "queued-signal-client",
    );
    const gate = deferred();

    await server.operationHandle("Billing.Refund").handle(
      async ({ input, op }) => {
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
      },
    );

    try {
      const ref = await client.operation.billing.refund.input({
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
  name: "Terminal and invalid operation signals are rejected",
  async fn() {
    const { server, client, clientNc } = await createOperationTestRuntime(
      "rejected-signal-client",
    );

    await server.operationHandle("Billing.Refund").handle(
      async ({ input, op }) => {
        await op.started();
        if (input.chargeId === "ch_terminal") {
          await op.complete({ refundId: "rf_terminal" });
          return ok({ refundId: "rf_terminal" });
        }
        return op.defer();
      },
    );

    try {
      const invalidRef = await client.operation.billing.refund.input({
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

      const terminalRef = await client.operation.billing.refund.input({
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
