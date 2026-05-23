import {
  defineAgentContract,
  defineServiceContract,
  TrellisClient,
} from "@qlever-llc/trellis";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { trace } from "@qlever-llc/trellis/tracing";
import { Type } from "typebox";

new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
}).register();

const schemas = {
  EventPayload: Type.Object({
    message: Type.String(),
    header: Type.Optional(
      Type.Object({ id: Type.String(), time: Type.String() }),
    ),
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
const contract = defineAgentContract(() => ({
  id: "trellis.integration-events-agent@v1",
  displayName: "Trellis Integration Agent",
  description:
    "Verify delegated Rust agent login and harness event publish/subscribe.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({
        events: {
          publish: ["Harness.Rust.Event", "Harness.Ts.Event"],
          subscribe: ["Harness.Rust.Event", "Harness.Ts.Event"],
        },
      }),
    },
  },
}));
if (
  contract.CONTRACT_DIGEST !== Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST")
) throw new Error("caller contract digest mismatch");
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
let traceId = "";
await trace.getTracer("trellis-integration-events").startActiveSpan(
  "publish traced event",
  async (span) => {
    traceId = span.spanContext().traceId;
    try {
      await client.publish("Harness.Ts.Event", {
        message: Deno.env.get("HARNESS_MESSAGE")!,
      }).orThrow();
    } finally {
      span.end();
    }
  },
);
await client.natsConnection.drain();
console.log(`TS_EVENTS_TRACE_ID ${traceId}`);
console.log("TS_EVENTS_TRACE_PUBLISHER_OK");
