import type { NatsConnection } from "@nats-io/nats-core";
import { isErr, ok } from "@qlever-llc/trellis";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { createRoutedNatsConnections } from "../testing/routed_nats.ts";
import type {
  DurableOperationRecord,
  RuntimeOperationRecord,
} from "../trellis.ts";
import type { NatsConnectFn } from "./runtime.ts";
import { TrellisService } from "./service.ts";

const billingCapabilities = {
  "billing.refund": {
    displayName: "Refund billing",
    description: "Start billing refunds.",
  },
  "billing.read": {
    displayName: "Read billing",
    description: "Read billing operation status.",
  },
  "billing.cancel": {
    displayName: "Cancel billing",
    description: "Cancel billing operations.",
  },
} as const;

function base64urlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
    id: "trellis.billing.service-operation-test@v1",
    displayName: "Billing Service Operation Test",
    description: "Exercise service.operation ergonomics.",
    capabilities: billingCapabilities,
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

const billingV2 = defineServiceContract(
  {
    schemas: {
      RefundInput: Type.Object({ chargeId: Type.String() }),
      RefundProgress: Type.Object({ message: Type.String() }),
      RefundOutput: Type.Object({ refundId: Type.String() }),
    },
  },
  (ref) => ({
    id: "trellis.billing.other-service-operation-test@v1",
    displayName: "Other Billing Service Operation Test",
    description: "Exercise service.operation control validation.",
    capabilities: billingCapabilities,
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

const billingWithStatus = defineServiceContract(
  {
    schemas: {
      RefundInput: Type.Object({ chargeId: Type.String() }),
      RefundProgress: Type.Object({ message: Type.String() }),
      RefundOutput: Type.Object({ refundId: Type.String() }),
      StatusInput: Type.Object({ chargeId: Type.String() }),
      StatusProgress: Type.Object({ stage: Type.String() }),
      StatusOutput: Type.Object({ statusId: Type.String() }),
    },
  },
  (ref) => ({
    id: "trellis.billing.status-service-operation-test@v1",
    displayName: "Billing Status Service Operation Test",
    description:
      "Exercise service.operation control operation-name validation.",
    capabilities: billingCapabilities,
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
      "Billing.Status": {
        version: "v1",
        input: ref.schema("StatusInput"),
        progress: ref.schema("StatusProgress"),
        output: ref.schema("StatusOutput"),
        capabilities: {
          call: ["billing.refund"],
          read: ["billing.read"],
        },
      },
    },
  }),
);

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
            "uploader",
            "service",
          ],
          lastAuth: "2026-04-10T00:00:00.000Z",
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

function createOperationTestNats(): {
  port: number;
  connect: NatsConnectFn;
  clientConnection(inboxPrefix: string): NatsConnection;
  installOperationRecords(service: object): void;
  close(): Promise<void>;
} {
  const createConnection = createRoutedNatsConnections({
    ackEventsWithoutSubscriber: true,
  });
  const operationRecords = new Map<string, DurableOperationRecord>();
  const authConnection = createConnection();
  startPermissiveAuthResponder(authConnection);
  return {
    port: 0,
    connect: async (opts) =>
      createConnection({
        inboxPrefix: typeof opts.inboxPrefix === "string"
          ? opts.inboxPrefix
          : undefined,
      }),
    clientConnection: (inboxPrefix) => createConnection({ inboxPrefix }),
    installOperationRecords: (service) => {
      const descriptor = Object.getOwnPropertyDescriptor(service, "server");
      if (!descriptor || !("value" in descriptor)) {
        throw new Error("service runtime handle is unavailable");
      }
      const runtime: OperationRecordRuntime = descriptor.value;
      runtime.saveOperationRecord = async (record) => {
        operationRecords.set(record.id, {
          ownerSessionKey: record.ownerSessionKey,
          sequence: record.sequence,
          signalSequence: record.signalSequence,
          signals: structuredClone(record.signals),
          snapshot: structuredClone(record.snapshot),
        });
      };
      runtime.loadOperationRecord = async (operationId) =>
        operationRecords.get(operationId) ?? null;
    },
    close: async () => {
      await authConnection.drain();
    },
  };
}

type OperationRecordRuntime = {
  saveOperationRecord(record: RuntimeOperationRecord): Promise<void>;
  loadOperationRecord(
    operationId: string,
  ): Promise<DurableOperationRecord | null>;
};

type RefundOperationHandle = {
  started(): Promise<unknown>;
  progress(value: { message: string }): Promise<unknown>;
  complete(value: { refundId: string }): Promise<unknown>;
  fail(error: Error): Promise<unknown>;
  cancel(): Promise<unknown>;
  attach(job: { wait(): Promise<unknown> }): Promise<unknown>;
};

function installBootstrapMock(args: {
  port: number;
  contractId: string;
  contractDigest: string;
  resources?: Record<string, unknown>;
}): void {
  globalThis.fetch = (() => {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          status: "ready",
          serverNow: 1_700_000_000,
          connectInfo: {
            sessionKey: "session-key",
            contractId: args.contractId,
            contractDigest: args.contractDigest,
            transports: {
              native: {
                natsServers: [`localhost:${args.port}`],
                tlsRequired: false,
              },
            },
            transport: {
              sentinel: { jwt: "jwt", seed: "seed" },
            },
            auth: {
              mode: "service_identity",
              iatSkewSeconds: 30,
            },
          },
          binding: {
            contractId: args.contractId,
            digest: args.contractDigest,
            resources: args.resources ?? { kv: {} },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
  }) as typeof fetch;
}

Deno.test({
  name: "TrellisService.operation handles owned workflows",
  async fn() {
    const nats = createOperationTestNats();
    const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (() => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ready",
              serverNow: 1_700_000_000,
              connectInfo: {
                sessionKey: "session-key",
                contractId: billing.CONTRACT_ID,
                contractDigest: billing.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: [`localhost:${nats.port}`],
                    tlsRequired: false,
                  },
                },
                transport: {
                  sentinel: { jwt: "jwt", seed: "seed" },
                },
                auth: {
                  mode: "service_identity",
                  iatSkewSeconds: 30,
                },
              },
              binding: {
                contractId: billing.CONTRACT_ID,
                digest: billing.CONTRACT_DIGEST,
                resources: {
                  kv: {},
                },
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

      const service = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billing,
        name: "billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(service);

      assertEquals(typeof service.operation, "function");

      const clientNc = nats.clientConnection(
        `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      );
      const clientAuth = {
        sessionKey: service.auth.sessionKey,
        sign: service.auth.sign,
      };
      const client = createClient(billing, clientNc, clientAuth, {
        name: "billing-client",
      });

      await service.operation("Billing.Refund").handle(
        async ({ input, op, trellis }) => {
          assertEquals(input.chargeId, "ch_123");
          assertExists(trellis);
          await op.started();
          await op.progress({ message: "working" });
          return ok({ refundId: "rf_123" });
        },
      );

      const ref = await client.operation("Billing.Refund").input({
        chargeId: "ch_123",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertExists(ref);

      const terminal = await ref.wait().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, { refundId: "rf_123" });

      await clientNc.drain();
      await service.stop();
    } finally {
      await nats.close();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "TrellisService.operation can defer external completion without auto-completing",
  async fn() {
    const nats = createOperationTestNats();
    const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (() => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ready",
              serverNow: 1_700_000_000,
              connectInfo: {
                sessionKey: "session-key",
                contractId: billing.CONTRACT_ID,
                contractDigest: billing.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: [`localhost:${nats.port}`],
                    tlsRequired: false,
                  },
                },
                transport: {
                  sentinel: { jwt: "jwt", seed: "seed" },
                },
                auth: {
                  mode: "service_identity",
                  iatSkewSeconds: 30,
                },
              },
              binding: {
                contractId: billing.CONTRACT_ID,
                digest: billing.CONTRACT_DIGEST,
                resources: {
                  kv: {},
                },
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

      const service = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billing,
        name: "billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(service);

      const clientNc = nats.clientConnection(
        `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      );
      const clientAuth = {
        sessionKey: service.auth.sessionKey,
        sign: service.auth.sign,
      };
      const client = createClient(billing, clientNc, clientAuth, {
        name: "billing-client",
      });

      let handlerSettled = false;
      await service.operation("Billing.Refund").handle(
        async ({ op }) => {
          await op.started();
          await op.progress({ message: "waiting for external approval" });
          handlerSettled = true;
          return op.defer();
        },
      );

      const ref = await client.operation("Billing.Refund").input({
        chargeId: "ch_123",
      }).start().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });

      await waitFor(() => handlerSettled, {
        description: "deferred operation handler to settle",
      });
      await new Promise((resolve) => setTimeout(resolve, 25));

      const snapshot = await ref.get().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(snapshot.state, "running");
      assertEquals(snapshot.progress, {
        message: "waiting for external approval",
      });
      assertEquals(snapshot.output, undefined);

      await clientNc.drain();
      await service.stop();
    } finally {
      await nats.close();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "TrellisService.operation.control resumes a deferred operation by id without rerunning the handler",
  async fn() {
    const nats = createOperationTestNats();
    const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const originalFetch = globalThis.fetch;

    try {
      installBootstrapMock({
        port: nats.port,
        contractId: billing.CONTRACT_ID,
        contractDigest: billing.CONTRACT_DIGEST,
      });

      const service = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billing,
        name: "billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(service);

      const clientNc = nats.clientConnection(
        `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      );
      const client = createClient(billing, clientNc, {
        sessionKey: service.auth.sessionKey,
        sign: service.auth.sign,
      }, { name: "billing-client" });

      let handlerRuns = 0;
      await service.operation("Billing.Refund").handle(async ({ op }) => {
        handlerRuns += 1;
        await op.started();
        return op.defer();
      });

      const ref = await client.operation("Billing.Refund").input({
        chargeId: "ch_123",
      }).start().orThrow();
      await waitFor(() => handlerRuns === 1, {
        description: "deferred handler to run once",
      });

      const controlled = await service.operation("Billing.Refund")
        .control(ref.id).orThrow();
      await controlled.progress({ message: "approved" }).orThrow();
      await controlled.complete({ refundId: "rf_controlled" }).orThrow();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, { refundId: "rf_controlled" });
      assertEquals(handlerRuns, 1);

      await clientNc.drain();
      await service.stop();
    } finally {
      await nats.close();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "TrellisService.operation.control loads durable deferred records after restart",
  async fn() {
    const nats = createOperationTestNats();
    const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const originalFetch = globalThis.fetch;

    try {
      installBootstrapMock({
        port: nats.port,
        contractId: billing.CONTRACT_ID,
        contractDigest: billing.CONTRACT_DIGEST,
      });

      const service1 = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billing,
        name: "billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(service1);
      const accepted = await service1.operation("Billing.Refund").accept({
        sessionKey: service1.auth.sessionKey,
      }).orThrow();
      const acceptedForRemoteCancel = await service1.operation("Billing.Refund")
        .accept({
          sessionKey: service1.auth.sessionKey,
        }).orThrow();
      await accepted.started().orThrow();
      await service1.stop();

      const service2 = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billing,
        name: "billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(service2);

      const controlled = await service2.operation("Billing.Refund")
        .control(accepted.id).orThrow();

      const clientNc = nats.clientConnection(
        `_INBOX.${service2.auth.sessionKey.slice(0, 16)}`,
      );
      const client = createClient(billing, clientNc, {
        sessionKey: service2.auth.sessionKey,
        sign: service2.auth.sign,
      }, { name: "billing-restarted-client" });
      const resumed = client.operation("Billing.Refund").resume(accepted.ref);
      const running = await resumed.get().orThrow();
      assertEquals(running.state, "running");

      const resumedForCancel = client.operation("Billing.Refund").resume(
        acceptedForRemoteCancel.ref,
      );
      const remoteCancelled = await resumedForCancel.cancel().orThrow();
      assertEquals(remoteCancelled.state, "cancelled");

      const terminal = await controlled.complete({ refundId: "rf_restart" })
        .orThrow();

      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, { refundId: "rf_restart" });
      assertEquals((await resumed.wait().orThrow()).state, "completed");

      await clientNc.drain();
      await service2.stop();
    } finally {
      await nats.close();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "TrellisService.operation.control rejects invalid id, operation, service, payloads, and terminal updates",
  async fn() {
    const nats = createOperationTestNats();
    const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const originalFetch = globalThis.fetch;

    try {
      installBootstrapMock({
        port: nats.port,
        contractId: billingWithStatus.CONTRACT_ID,
        contractDigest: billingWithStatus.CONTRACT_DIGEST,
      });

      const service = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billingWithStatus,
        name: "billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(service);
      const accepted = await service.operation("Billing.Refund").accept({
        sessionKey: service.auth.sessionKey,
      }).orThrow();

      const missing = await service.operation("Billing.Refund")
        .control("missing-operation-id").take();
      assertEquals(isErr(missing), true);

      const wrongOperation = await service.operation("Billing.Status")
        .control(accepted.id).take();
      assertEquals(isErr(wrongOperation), true);

      const statusAccepted = await service.operation("Billing.Status").accept({
        sessionKey: service.auth.sessionKey,
      }).orThrow();
      const statusAcceptedCancel = await statusAccepted.cancel().take();
      assertEquals(isErr(statusAcceptedCancel), true);
      const statusControlled = await service.operation("Billing.Status")
        .control(statusAccepted.id).orThrow();
      const statusControlledCancel = await statusControlled.cancel().take();
      assertEquals(isErr(statusControlledCancel), true);

      const controlled = await service.operation("Billing.Refund")
        .control(accepted.id).orThrow();

      const clientNc = nats.clientConnection(
        `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      );
      const client = createClient(billingWithStatus, clientNc, {
        sessionKey: service.auth.sessionKey,
        sign: service.auth.sign,
      }, { name: "billing-terminal-client" });
      const resumed = client.operation("Billing.Refund").resume(accepted.ref);
      const wrongRemoteOperation = await client.operation("Billing.Status")
        .resume(accepted.ref).get().take();
      assertEquals(isErr(wrongRemoteOperation), true);

      const invalidProgress = await controlled.progress({ stage: "wrong" })
        .take();
      assertEquals(isErr(invalidProgress), true);
      const invalidOutput = await controlled.complete({ statusId: "wrong" })
        .take();
      assertEquals(isErr(invalidOutput), true);
      await controlled.complete({ refundId: "rf_done" }).orThrow();
      const terminalProgress = await controlled.progress({ message: "late" })
        .take();
      assertEquals(isErr(terminalProgress), true);
      const terminalCancel = await resumed.cancel().take();
      assertEquals(isErr(terminalCancel), true);
      const completed = await resumed.get().orThrow();
      assertEquals(completed.state, "completed");
      assertEquals(completed.output, { refundId: "rf_done" });

      installBootstrapMock({
        port: nats.port,
        contractId: billingV2.CONTRACT_ID,
        contractDigest: billingV2.CONTRACT_DIGEST,
      });
      const otherService = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billingV2,
        name: "other-billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(otherService);
      const wrongService = await otherService.operation("Billing.Refund")
        .control(accepted.id).take();
      assertEquals(isErr(wrongService), true);

      await otherService.stop();
      await clientNc.drain();
      await service.stop();
    } finally {
      await nats.close();
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "TrellisService.operation.accept creates a durable operation that a client can resume",
  async fn() {
    const nats = createOperationTestNats();
    const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (() => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "ready",
              serverNow: 1_700_000_000,
              connectInfo: {
                sessionKey: "session-key",
                contractId: billing.CONTRACT_ID,
                contractDigest: billing.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: [`localhost:${nats.port}`],
                    tlsRequired: false,
                  },
                },
                transport: {
                  sentinel: { jwt: "jwt", seed: "seed" },
                },
                auth: {
                  mode: "service_identity",
                  iatSkewSeconds: 30,
                },
              },
              binding: {
                contractId: billing.CONTRACT_ID,
                digest: billing.CONTRACT_DIGEST,
                resources: {
                  kv: {},
                },
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

      const service = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: billing,
        name: "billing-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: nats.connect }).orThrow();
      nats.installOperationRecords(service);

      const clientNc = nats.clientConnection(
        `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      );
      const clientAuth = {
        sessionKey: service.auth.sessionKey,
        sign: service.auth.sign,
      };
      const client = createClient(billing, clientNc, clientAuth, {
        name: "billing-client",
      });

      const accepted = await service.operation("Billing.Refund").accept({
        sessionKey: service.auth.sessionKey,
      });
      const acceptedValue = accepted.take();
      if (isErr(acceptedValue)) {
        throw acceptedValue.error;
      }

      const resumed = client.operation("Billing.Refund").resume(
        acceptedValue.ref,
      );
      void (async () => {
        await acceptedValue.started();
        await acceptedValue.progress({ message: "working" });
        await acceptedValue.complete({ refundId: "rf_456" });
      })();

      const terminal = await resumed.wait().match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, { refundId: "rf_456" });

      await clientNc.drain();
      await service.stop();
    } finally {
      await nats.close();
      globalThis.fetch = originalFetch;
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
