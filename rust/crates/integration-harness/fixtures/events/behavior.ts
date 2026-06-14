import { connect } from "@nats-io/transport-deno";
import { credsAuthenticator } from "@nats-io/nats-core";
import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import {
  defineAgentContract,
  defineServiceContract,
  isErr,
  ok,
  TrellisClient,
} from "@qlever-llc/trellis";
import {
  dispatchOutbox,
  MemoryInboxRepository,
  MemoryOutboxRepository,
} from "@qlever-llc/trellis/service";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  EventPayload: Type.Object({
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

async function openHarnessConsumer(name: string) {
  const nats = await connect({
    servers: Deno.env.get("HARNESS_NATS_SERVER")!,
    authenticator: credsAuthenticator(
      Deno.readFileSync(Deno.env.get("HARNESS_NATS_CREDS")!),
    ),
  });
  const jsm = await jetstreamManager(nats);
  try {
    await jsm.consumers.add("trellis", {
      durable_name: name,
      ack_policy: "explicit",
      deliver_policy: "new",
      filter_subject: "events.v1.Harness.Rust.Event",
    });
  } catch (error) {
    try {
      await jsm.consumers.info("trellis", name);
    } catch {
      await nats.close();
      throw error;
    }
  }
  const info = await jsm.consumers.info("trellis", name);
  return {
    nats,
    consumer: jetstream(nats).consumers.getConsumerFromInfo(info),
  };
}

async function nextHarnessMessage(
  consumer: Awaited<ReturnType<typeof openHarnessConsumer>>["consumer"],
) {
  const messages = await consumer.fetch({ max_messages: 1, expires: 10_000 });
  for await (const msg of messages) return msg;
  throw new Error("timed out waiting for harness durable event");
}

function decodeHarnessMessage(msg: { data: Uint8Array }) {
  return JSON.parse(new TextDecoder().decode(msg.data)) as { message?: string };
}

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
  const first = await openHarnessConsumer(durableName);
  await first.nats.close();
  const second = await openHarnessConsumer(durableName);
  await second.nats.close();
  await client.connection.close();
} else if (testCase === "handler-nak") {
  const durable = await openHarnessConsumer(
    `ts-events-nak-${Deno.env.get("HARNESS_MESSAGE")}`,
  );
  await client.event.harness.rustEvent.publish({
    message: Deno.env.get("HARNESS_MESSAGE")!,
  }).orThrow();
  const first = await nextHarnessMessage(durable.consumer);
  if (decodeHarnessMessage(first).message !== Deno.env.get("HARNESS_MESSAGE")) {
    throw new Error("unexpected first durable NAK payload");
  }
  first.nak();
  const second = await nextHarnessMessage(durable.consumer);
  if (
    decodeHarnessMessage(second).message !== Deno.env.get("HARNESS_MESSAGE")
  ) {
    throw new Error("unexpected redelivered durable NAK payload");
  }
  second.ack();
  await durable.nats.close();
  await client.connection.close();
} else if (testCase === "invalid-term") {
  const durable = await openHarnessConsumer(
    `ts-events-invalid-${Deno.env.get("HARNESS_MESSAGE")}`,
  );
  const invalidNats = await connect({
    servers: Deno.env.get("HARNESS_NATS_SERVER")!,
    authenticator: credsAuthenticator(
      Deno.readFileSync(Deno.env.get("HARNESS_NATS_CREDS")!),
    ),
  });
  try {
    await jetstream(invalidNats).publish(
      "events.v1.Harness.Rust.Event",
      JSON.stringify({}),
    );
  } finally {
    await invalidNats.close();
  }
  const invalid = await nextHarnessMessage(durable.consumer);
  if (typeof decodeHarnessMessage(invalid).message === "string") {
    throw new Error("invalid event unexpectedly decoded as valid payload");
  }
  invalid.term();
  await durable.nats.close();
  await client.connection.close();
} else if (testCase === "ephemeral-abort") {
  const controller = new AbortController();
  const received: string[] = [];
  await client.event.harness.rustEvent.listen(
    (event) => {
      received.push((event as { message: string }).message);
      return ok(undefined);
    },
    {},
    { mode: "ephemeral", replay: "new", signal: controller.signal },
  )
    .orThrow();
  await client.event.harness.rustEvent.publish({ message: "first" }).orThrow();
  await waitFor(() => received.length === 1, "TS ephemeral first event");
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await client.event.harness.rustEvent.publish({ message: "second" })
    .orThrow();
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (received.join(",") !== "first") {
    throw new Error(`unexpected TS ephemeral events ${received.join(",")}`);
  }
  await client.connection.close();
} else if (testCase === "prepared-outbox-inbox") {
  let processed = 0;
  const inbox = new MemoryInboxRepository();
  const received = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for prepared outbox event")),
      10000,
    );
    void client.event.harness.tsEvent.listen(
      async (event, context) => {
        const payload = event as {
          message?: string;
        };
        if (payload.message !== Deno.env.get("HARNESS_MESSAGE")) {
          clearTimeout(timeout);
          reject(
            new Error(`unexpected prepared event ${JSON.stringify(event)}`),
          );
          return ok(undefined);
        }
        if (context.id.length === 0 || Number.isNaN(context.time.getTime())) {
          clearTimeout(timeout);
          reject(
            new Error(
              `missing prepared event metadata ${JSON.stringify(context)}`,
            ),
          );
          return ok(undefined);
        }

        if (await inbox.record(context.id)) processed += 1;
        const duplicate = await inbox.record(context.id);
        if (duplicate || processed !== 1) {
          clearTimeout(timeout);
          reject(
            new Error(
              `TS inbox duplicate suppression failed: duplicate=${duplicate}, processed=${processed}`,
            ),
          );
          return ok(undefined);
        }

        clearTimeout(timeout);
        resolve();
        return ok(undefined);
      },
      {},
      { mode: "ephemeral", replay: "new" },
    ).orThrow();
  });

  const prepared = client.event.harness.tsEvent.prepare({
    message: Deno.env.get("HARNESS_MESSAGE")!,
  }).take();
  if (isErr(prepared)) throw prepared.error;
  const outbox = new MemoryOutboxRepository();
  await outbox.enqueue(prepared);
  const dispatched = await dispatchOutbox(outbox, client, { limit: 1 });
  if (dispatched.dispatched !== 1 || dispatched.failed !== 0) {
    throw new Error(
      `unexpected TS outbox dispatch ${JSON.stringify(dispatched)}`,
    );
  }

  await received;
  await client.connection.close();
} else {
  throw new Error(`unknown HARNESS_EVENT_CASE ${testCase}`);
}
console.log("TS_EVENTS_BEHAVIOR_OK");
