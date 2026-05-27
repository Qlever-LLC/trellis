import { defineServiceContract, ok } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  EventPayload: Type.Object({
    message: Type.String(),
    header: Type.Optional(
      Type.Object({ id: Type.String(), time: Type.String() }),
    ),
  }),
  EmptyRequest: Type.Object({}, { additionalProperties: false }),
  StartConsumerResponse: Type.Object({ started: Type.Boolean() }),
  StatusResponse: Type.Object({
    received: Type.Boolean(),
    message: Type.String(),
  }),
} as const;

const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.events@v1",
  displayName: "Trellis Integration Harness Events",
  description:
    "Harness-owned service contract for full-stack Rust/TypeScript event verification.",
  events: {
    "Harness.Rust.Event": {
      version: "v1",
      subject: "events.v1.Harness.Rust.Event",
      event: ref.schema("EventPayload"),
      capabilities: { publish: [], subscribe: [] },
    },
    "Harness.Ts.Event": {
      version: "v1",
      subject: "events.v1.Harness.Ts.Event",
      event: ref.schema("EventPayload"),
      capabilities: { publish: [], subscribe: [] },
    },
  },
}));

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.events-consumer@v1",
  displayName: "Trellis Integration Harness Event Consumer",
  description:
    "Harness-owned service contract for service-level durable event consumer verification.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
      harness: harness.use({
        events: { subscribe: ["Harness.Rust.Event"] },
      }),
    },
  },
  rpc: {
    "Harness.Events.StartConsumer": {
      version: "v1",
      subject: "rpc.v1.Harness.Events.StartConsumer",
      input: ref.schema("EmptyRequest"),
      output: ref.schema("StartConsumerResponse"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
    "Harness.Events.Status": {
      version: "v1",
      subject: "rpc.v1.Harness.Events.Status",
      input: ref.schema("EmptyRequest"),
      output: ref.schema("StatusResponse"),
      capabilities: { call: [] },
      errors: [ref.error("UnexpectedError")],
    },
  },
  eventConsumers: {
    serviceEvents: {
      events: [{ use: "harness", event: "Harness.Rust.Event" }],
      replay: "new",
      ordering: "strict",
      concurrency: 1,
      ackWaitMs: 30_000,
      maxDeliver: 3,
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CONSUMER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `consumer contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  name: "harness-events-consumer-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: undefined },
}).orThrow();

let receivedMessage = "";
let reportedReceived = false;

console.log("TS_EVENTS_SERVICE_CONSUMER_STARTING");
try {
  await service.event.harness.rustEvent.listen(
    (event) => {
      const payload = event as { message?: string };
      receivedMessage = payload.message ?? "";
      if (!reportedReceived) {
        reportedReceived = true;
        console.log("TS_EVENTS_SERVICE_CONSUMER_OK");
      }
      return ok(undefined);
    },
    {},
    { group: "serviceEvents" },
  ).orThrow();
} catch (error) {
  console.error("TS_EVENTS_SERVICE_CONSUMER_LISTEN_ERROR", error);
  throw error;
}

await service.handle.rpc.harness.eventsStartConsumer(({ client }) => {
  if (false) {
    // @ts-expect-error handler-injected clients cannot register listeners
    void client.event.harness.rustEvent.listen(() => ok(undefined));
  }
  return ok({ started: true });
});

await service.handle.rpc.harness.eventsStatus(() => {
  return ok({ received: receivedMessage.length > 0, message: receivedMessage });
});

console.log("TS_EVENTS_SERVICE_CONSUMER_READY");
await new Promise<void>(() => {});
