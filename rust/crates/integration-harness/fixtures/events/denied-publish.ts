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
  id: "trellis.integration-events-subscribe-agent@v1",
  displayName: "Trellis Integration Events Subscriber",
  description: "Verify event publish is denied without publish permission.",
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      harness: harness.use({
        events: { subscribe: ["Harness.Rust.Event", "Harness.Ts.Event"] },
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
let publishSucceeded = false;
try {
  await client.publish("Harness.Ts.Event", { message: "ts-denied-publish" })
    .orThrow();
  publishSucceeded = true;
} catch (_error) {
  // Expected: the contract only grants event subscribe permission.
}
await client.natsConnection.drain();
if (publishSucceeded) {
  throw new Error(
    "TS event publish unexpectedly succeeded without publish permission",
  );
}
console.log("TS_EVENTS_DENIED_PUBLISH_OK");
