import { connect } from "@nats-io/transport-deno";
import type { ConnectionOptions } from "@nats-io/transport-deno";
import { isErr, ok } from "@qlever-llc/trellis";
import type { InferSchemaType } from "@qlever-llc/trellis/contracts";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { createClient } from "../trellis/client.ts";
import { defineContract } from "../trellis/contract.ts";
import { NatsTest } from "../trellis/testing/nats.ts";
import type { NatsConnectFn, NatsConnectOpts } from "./runtime.ts";
import { TrellisService } from "./service.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

function base64urlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const billing = defineContract(
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
    kind: "service",
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

type RefundInput = InferSchemaType<typeof billing.API.owned.operations["Billing.Refund"]["input"]>;
const natsConnect: NatsConnectFn = async (opts) => {
  const connectOpts: ConnectionOptions = {
    servers: opts.servers,
    ...(typeof opts.token === "string" ? { token: opts.token } : {}),
    ...(typeof opts.inboxPrefix === "string" ? { inboxPrefix: opts.inboxPrefix } : {}),
  };
  return await connect(connectOpts);
};

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
    const info = nats.nc.info!;
    const seed = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (() => {
        return Promise.resolve(new Response(JSON.stringify({
          status: "ready",
          connectInfo: {
            sessionKey: "session-key",
            contractId: billing.CONTRACT_ID,
            contractDigest: billing.CONTRACT_DIGEST,
            transport: {
              natsServers: [`localhost:${info.port}`],
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
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
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
      const client = createClient(billing, clientNc, clientAuth, { name: "billing-client" });

      await service.operation("Billing.Refund").handle(async (
        { input, op }: RefundOperationContext,
      ) => {
        assertEquals(input.chargeId, "ch_123");
        await op.started();
        await op.progress({ message: "working" });
        return ok({ refundId: "rf_123" });
      });

      const started = await client.operation("Billing.Refund").start({
        chargeId: "ch_123",
      });
      const startedValue = started.take();
      if (isErr(startedValue)) {
        throw startedValue.error;
      }
      const ref = startedValue as {
        wait: () => Promise<{ take: () => { state: string; output?: { refundId: string } } }>;
      };
      assertExists(ref);

      const terminal = (await ref.wait()).take();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output?.refundId, "rf_123");

      await clientNc.drain();
      await service.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});
