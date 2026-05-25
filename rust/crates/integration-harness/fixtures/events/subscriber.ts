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

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
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

const controller = new AbortController();
const expected = Deno.env.get("HARNESS_EXPECTED_MESSAGE")!;
const received = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("timed out waiting for TS subscriber event")),
    10000,
  );
  void client.event.harness.rustEvent.listen(
    (event) => {
      const message = (event as { message?: string }).message;
      const header =
        (event as { header?: { id?: unknown; time?: unknown } }).header;
      if (message !== expected) {
        reject(new Error(`unexpected event ${JSON.stringify(event)}`));
      }
      if (typeof header?.id !== "string" || typeof header.time !== "string") {
        reject(new Error(`missing event header ${JSON.stringify(event)}`));
      }
      clearTimeout(timeout);
      resolve();
      return ok(undefined);
    },
    {},
    { mode: "ephemeral", replay: "new", signal: controller.signal },
  )
    .orThrow();
});
console.log("TS_EVENTS_SUBSCRIBER_READY");
await received;
controller.abort();
await client.connection.close();
console.log("TS_EVENTS_SUBSCRIBER_OK");
