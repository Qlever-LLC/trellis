import { jetstream } from "@nats-io/jetstream";
import {
  defineAgentContract,
  defineServiceContract,
  err,
  ok,
  TrellisClient,
  UnexpectedError,
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

function waitFor(condition: () => boolean, description: string): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - started > 10000) {
        clearInterval(interval);
        reject(new Error(`timed out waiting for ${description}`));
      }
    }, 25);
  });
}

const testCase = Deno.env.get("HARNESS_EVENT_CASE");
if (testCase === "durable-resubscribe") {
  const durableName = `ts-events-durable-${Deno.env.get("HARNESS_MESSAGE")}`;
  await client.event("Harness.Rust.Event", {}, () => ok(undefined), {
    durableName,
  }).orThrow();
  await client.natsConnection.flush();
  await client.natsConnection.drain();
  const second = await TrellisClient.connect({
    trellisUrl: Deno.env.get("TRELLIS_URL")!,
    contract,
    auth: {
      mode: "session_key",
      sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
      redirectTo: "/_trellis/portal/users/login",
    },
    log: undefined,
  }).orThrow();
  await second.event("Harness.Rust.Event", {}, () => ok(undefined), {
    durableName,
  }).orThrow();
  await second.natsConnection.drain();
} else if (testCase === "handler-nak") {
  let attempts = 0;
  await client.event("Harness.Rust.Event", {}, () => {
    attempts += 1;
    if (attempts === 1) {
      return err(new UnexpectedError({ cause: new Error("fail once") }));
    }
    return ok(undefined);
  }, {
    durableName: `ts-events-nak-${Deno.env.get("HARNESS_MESSAGE")}`,
    replay: "new",
  }).orThrow();
  await client.natsConnection.flush();
  await client.publish("Harness.Rust.Event", {
    message: Deno.env.get("HARNESS_MESSAGE")!,
  }).orThrow();
  await waitFor(() => attempts >= 2, "TS event redelivery after NAK");
  await client.natsConnection.drain();
} else if (testCase === "invalid-term") {
  let calls = 0;
  await client.event("Harness.Rust.Event", {}, () => {
    calls += 1;
    return ok(undefined);
  }, {
    durableName: `ts-events-invalid-${Deno.env.get("HARNESS_MESSAGE")}`,
    replay: "new",
  }).orThrow();
  await client.natsConnection.flush();
  await jetstream(client.natsConnection).publish(
    "events.v1.Harness.Rust.Event",
    JSON.stringify({
      header: { id: "invalid", time: "2026-05-13T00:00:00.000Z" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (calls !== 0) {
    throw new Error(`invalid event reached TS handler ${calls} time(s)`);
  }
  await client.natsConnection.drain();
} else if (testCase === "ephemeral-abort") {
  const controller = new AbortController();
  const received: string[] = [];
  await client.event("Harness.Rust.Event", {}, (event) => {
    received.push((event as { message: string }).message);
    return ok(undefined);
  }, { mode: "ephemeral", replay: "new", signal: controller.signal }).orThrow();
  await client.natsConnection.flush();
  await client.publish("Harness.Rust.Event", { message: "first" }).orThrow();
  await waitFor(() => received.length === 1, "TS ephemeral first event");
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await client.publish("Harness.Rust.Event", { message: "second" }).orThrow();
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (received.join(",") !== "first") {
    throw new Error(`unexpected TS ephemeral events ${received.join(",")}`);
  }
  await client.natsConnection.drain();
} else {
  throw new Error(`unknown HARNESS_EVENT_CASE ${testCase}`);
}
console.log("TS_EVENTS_BEHAVIOR_OK");
