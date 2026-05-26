import {
  defineAgentContract,
  defineServiceContract,
  TrellisClient,
} from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
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

const consumer = defineServiceContract({ schemas }, (ref) => ({
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

const contract = defineAgentContract(() => ({
  id: "trellis.integration-events-service-consumer-agent@v1",
  displayName: "Trellis Integration Events Service Consumer Agent",
  description:
    "Verify service-level durable event consumer bootstrap and delivery.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({
        events: { publish: ["Harness.Rust.Event"] },
      }),
      consumer: consumer.use({
        rpc: {
          call: ["Harness.Events.StartConsumer", "Harness.Events.Status"],
        },
      }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `service consumer caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: undefined,
}).orThrow();

const message = Deno.env.get("HARNESS_MESSAGE")!;
await client.request("Harness.Events.StartConsumer", {}).orThrow();
await client.event.harness.rustEvent.publish({
  message,
}).orThrow();

const started = Date.now();
while (Date.now() - started < 10_000) {
  const status = await client.request("Harness.Events.Status", {})
    .orThrow() as {
      received?: boolean;
      message?: string;
    };
  if (status.received && status.message === message) {
    await client.connection.close();
    console.log("TS_EVENTS_SERVICE_CONSUMER_CLIENT_OK");
    Deno.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

await client.connection.close();
throw new Error("timed out waiting for service event consumer delivery");
