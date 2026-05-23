import {
  defineAgentContract,
  defineServiceContract,
  ok,
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
const controller = new AbortController();
const message = "ts-publish-ts-subscribe";
const received = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("timed out waiting for TS self event")),
    10000,
  );
  void client.event("Harness.Ts.Event", {}, (event) => {
    const header =
      (event as { header?: { id?: unknown; time?: unknown } }).header;
    if ((event as { message?: string }).message !== message) {
      reject(new Error(`unexpected self event ${JSON.stringify(event)}`));
    }
    if (typeof header?.id !== "string" || typeof header.time !== "string") {
      reject(new Error(`missing self event header ${JSON.stringify(event)}`));
    }
    clearTimeout(timeout);
    resolve();
    return ok(undefined);
  }, { mode: "ephemeral", replay: "new", signal: controller.signal }).orThrow();
});
await new Promise((resolve) => setTimeout(resolve, 250));
await client.publish("Harness.Ts.Event", { message }).orThrow();
await received;
controller.abort();
await client.natsConnection.drain();
console.log("TS_EVENTS_SELF_OK");
