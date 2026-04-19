import { connect } from "@nats-io/transport-deno";
import type { ConnectionOptions } from "@nats-io/transport-deno";
import { isErr, ok } from "@qlever-llc/trellis";
import type { InferSchemaType } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { TypedStore } from "../store.ts";
import { NatsTest } from "../testing/nats.ts";
import type { NatsConnectFn, NatsConnectOpts } from "./runtime.ts";
import { TrellisService } from "./service.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

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

const demoFiles = defineServiceContract(
  {
    schemas: {
      UploadInput: Type.Object({
        key: Type.String(),
        contentType: Type.Optional(Type.String()),
      }),
      UploadProgress: Type.Object({
        stage: Type.String(),
        message: Type.String(),
      }),
      UploadOutput: Type.Object({
        key: Type.String(),
        size: Type.Integer(),
      }),
    },
  },
  (ref) => ({
    id: "trellis.demo.files.service-operation-test@v1",
    displayName: "Demo Files Service Operation Test",
    description: "Exercise transfer-capable operations.",
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploads",
          ttlMs: 60_000,
          maxObjectBytes: 1024 * 1024,
          maxTotalBytes: 4 * 1024 * 1024,
        },
      },
    },
    operations: {
      "Demo.Files.Upload": {
        version: "v1",
        input: ref.schema("UploadInput"),
        progress: ref.schema("UploadProgress"),
        output: ref.schema("UploadOutput"),
        transfer: {
          store: "uploads",
          key: "/key",
          contentType: "/contentType",
          expiresInMs: 60_000,
        },
        capabilities: {
          call: ["uploader"],
          read: ["uploader"],
        },
      },
    },
  }),
);

type RefundInput = InferSchemaType<
  typeof billing.API.owned.operations["Billing.Refund"]["input"]
>;
type UploadInput = InferSchemaType<
  typeof demoFiles.API.owned.operations["Demo.Files.Upload"]["input"]
>;
const natsConnect: NatsConnectFn = async (opts) => {
  const connectOpts: ConnectionOptions = {
    servers: opts.servers,
    ...(typeof opts.inboxPrefix === "string"
      ? { inboxPrefix: opts.inboxPrefix }
      : {}),
  };
  return await connect(connectOpts);
};

function startPermissiveAuthResponder(nc: Awaited<ReturnType<typeof NatsTest.start>>["nc"]): void {
  const sub = nc.subscribe("rpc.v1.Auth.ValidateRequest");
  void (async () => {
    for await (const msg of sub) {
      const input = msg.json() as { sessionKey: string };
      msg.respond(JSON.stringify({
        allowed: true,
        inboxPrefix: `_INBOX.${input.sessionKey.slice(0, 16)}`,
        caller: {
          type: "user",
          id: "auth0|test-user",
          trellisId: "tid_test_user",
          origin: "test",
          active: true,
          name: "Test User",
          email: "test@example.com",
          capabilities: ["billing.refund", "billing.read", "billing.cancel", "uploader", "service"],
        },
      }));
    }
  })();
}

type RefundOperationHandle = {
  started(): Promise<unknown>;
  progress(value: { message: string }): Promise<unknown>;
  complete(value: { refundId: string }): Promise<unknown>;
  fail(error: Error): Promise<unknown>;
  cancel(): Promise<unknown>;
  attach(job: { wait(): Promise<unknown> }): Promise<unknown>;
};

type RefundOperationContext = {
  input: RefundInput;
  op: RefundOperationHandle;
  caller: unknown;
};

Deno.test({
  name: "TrellisService.operation handles owned workflows",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    startPermissiveAuthResponder(nats.nc);
    const info = nats.nc.info!;
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
                    natsServers: [`localhost:${info.port}`],
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
                  streams: {},
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
      }, { connect: natsConnect });

      assertEquals(typeof service.operation, "function");

      const clientNc = await connect({
        servers: `localhost:${info.port}`,
        inboxPrefix: `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      });
      const clientAuth = {
        sessionKey: service.auth.sessionKey,
        sign: service.auth.sign,
      };
      const client = createClient(billing, clientNc, clientAuth, {
        name: "billing-client",
      });

      await service.operation("Billing.Refund").handle(async (
        { input, op }: RefundOperationContext,
      ) => {
        assertEquals(input.chargeId, "ch_123");
        await op.started();
        await op.progress({ message: "working" });
        return ok({ refundId: "rf_123" });
      });

      const ref = (await client.operation("Billing.Refund").input({
        chargeId: "ch_123",
      }).start()).match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertExists(ref);

      const terminal = (await ref.wait()).match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output?.refundId, "rf_123");

      await clientNc.drain();
      await service.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "TrellisService.operation.accept creates a durable operation that a client can resume",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    startPermissiveAuthResponder(nats.nc);
    const info = nats.nc.info!;
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
                    natsServers: [`localhost:${info.port}`],
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
                  streams: {},
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
      }, { connect: natsConnect });

      const clientNc = await connect({
        servers: `localhost:${info.port}`,
        inboxPrefix: `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      });
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

      const resumed = client.operation("Billing.Refund").resume(acceptedValue.ref);
      void (async () => {
        await acceptedValue.started();
        await acceptedValue.progress({ message: "working" });
        await acceptedValue.complete({ refundId: "rf_456" });
      })();

      const terminal = (await resumed.wait()).match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output?.refundId, "rf_456");

      await clientNc.drain();
      await service.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "TrellisService.operation handles transfer-capable workflows with caller and provider updates",
  ignore: !RUN_NATS_TESTS,
  async fn() {
    await using nats = await NatsTest.start();
    startPermissiveAuthResponder(nats.nc);
    const info = nats.nc.info!;
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
                contractId: demoFiles.CONTRACT_ID,
                contractDigest: demoFiles.CONTRACT_DIGEST,
                transports: {
                  native: {
                    natsServers: [`localhost:${info.port}`],
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
                contractId: demoFiles.CONTRACT_ID,
                digest: demoFiles.CONTRACT_DIGEST,
                resources: {
                  kv: {},
                  store: {
                    uploads: {
                      name: "demo-files-upload-store",
                      ttlMs: 60_000,
                      maxObjectBytes: 1024 * 1024,
                      maxTotalBytes: 4 * 1024 * 1024,
                    },
                  },
                  streams: {},
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

      const createdStore = await TypedStore.open(nats.nc, "demo-files-upload-store", {
        ttlMs: 60_000,
        maxObjectBytes: 1024 * 1024,
        maxTotalBytes: 4 * 1024 * 1024,
      });
      if (createdStore.isErr()) {
        throw createdStore.error;
      }

      const service = await TrellisService.connect({
        trellisUrl: "https://trellis.example.com",
        contract: demoFiles,
        name: "demo-files-service",
        sessionKeySeed: seed,
        server: {},
      }, { connect: natsConnect });

      const clientNc = await connect({
        servers: `localhost:${info.port}`,
        inboxPrefix: `_INBOX.${service.auth.sessionKey.slice(0, 16)}`,
      });
      const clientAuth = {
        sessionKey: service.auth.sessionKey,
        sign: service.auth.sign,
      };
      const client = createClient(demoFiles, clientNc, clientAuth, {
        name: "demo-files-client",
      });

      const providerUpdates: Array<number> = [];
      const callerUpdates: Array<number> = [];
      const callerEvents: Array<string> = [];
      await service.operation("Demo.Files.Upload").handle(async ({ input, op, transfer }) => {
        assertEquals(input satisfies UploadInput, input);
        const watchProviderUpdates = (async () => {
          for await (const update of transfer.updates()) {
            providerUpdates.push(update.transferredBytes);
          }
        })();

        const transferred = await transfer.completed();
        const storedInfo = transferred.match({
          ok: (value) => value,
          err: (error) => {
            throw error;
          },
        });

        await watchProviderUpdates;
        await new Promise((resolve) => setTimeout(resolve, 25));
        const started = await op.started();
        if (started.isErr()) {
          throw started.error;
        }
        return ok({ key: input.key, size: storedInfo.size });
      });

      const upload = (await client.operation("Demo.Files.Upload").input({
        key: "incoming/test.txt",
        contentType: "text/plain",
      })
        .onAccepted(() => {
          callerEvents.push("accepted");
        })
        .transfer(new TextEncoder().encode("hello transfer"))
        .onTransfer((event) => {
          callerEvents.push("transfer");
          callerUpdates.push(event.transfer.transferredBytes);
        })
        .onStarted(() => {
          callerEvents.push("started");
        })
        .onCompleted(() => {
          callerEvents.push("completed");
        })
        .start()).match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });

      const terminal = await upload.wait();
      const terminalValue = terminal.match({
        ok: (value) => value,
        err: (error) => {
          throw error;
        },
      });
      await waitFor(
        () => providerUpdates.at(-1) === 14 && callerEvents.at(-1) === "completed",
        { description: "transfer completion callbacks" },
      );

      assertEquals(terminalValue.terminal.state, "completed");
      assertEquals(terminalValue.terminal.output, {
        key: "incoming/test.txt",
        size: 14,
      });
      assertEquals(terminalValue.transferred.size, 14);
      assertEquals(providerUpdates.at(-1), 14);
      assertEquals(callerEvents[0], "accepted");
      assertEquals(callerEvents.includes("started"), true);
      assertEquals(callerEvents.at(-1), "completed");

      await clientNc.drain();
      await service.stop();
    } finally {
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
