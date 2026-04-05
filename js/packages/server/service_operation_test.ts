import { connect } from "@nats-io/transport-deno";
import type { ConnectionOptions } from "@nats-io/transport-deno";
import { createClient, isErr, ok } from "@qlever-llc/trellis";
import type { InferSchemaType } from "@qlever-llc/trellis-contracts";
import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { defineContract } from "../trellis/contract.ts";
import { NatsTest } from "../trellis/testing/nats.ts";
import type { NatsConnectFn, NatsConnectOpts } from "./runtime.ts";
import { TrellisService } from "./service.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

function base64urlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const billing = defineContract({
  id: "trellis.billing.service-operation-test@v1",
  displayName: "Billing Service Operation Test",
  description: "Exercise service.operation ergonomics.",
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

    const service = await TrellisService.connect("billing-service", {
      sessionKeySeed: seed,
      nats: {
        servers: `localhost:${info.port}`,
        authenticator: (_nonce?: string) => undefined,
      },
      server: {
        api: billing.API.owned,
        trellisApi: billing.API.trellis,
      },
    }, {
      connect: natsConnect,
    });

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
  },
});
