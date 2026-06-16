import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  type EventListenerContext,
  Result,
} from "@qlever-llc/trellis";
import { assertEventCaptured } from "@qlever-llc/trellis-test";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const eventSchemas = {
  EntityChanged: Type.Object({ id: Type.String(), value: Type.String() }),
} as const;

const eventServiceContract = defineServiceContract(
  { schemas: eventSchemas },
  (ref) => ({
    id: "trellis.integration.events-service@v1",
    displayName: "Trellis Integration Events Service",
    description: "Exercises generated event publish and subscribe surfaces.",
    capabilities: {
      publishRecords: {
        displayName: "Publish records",
        description: "Publish entity change records in the events fixture.",
      },
      readRecords: {
        displayName: "Read records",
        description:
          "Subscribe to entity change records in the events fixture.",
      },
    },
    events: {
      "Entity.Changed": {
        version: "v1",
        event: ref.schema("EntityChanged"),
        capabilities: {
          publish: ["publishRecords"],
          subscribe: ["readRecords"],
        },
      },
    },
  }),
);

const eventPubSubClientContract = defineAppContract(() => ({
  id: "trellis.integration.events-pubsub-client@v1",
  displayName: "Trellis Integration Events PubSub Client",
  description:
    "App/client participant with event publish and subscribe authority.",
  uses: {
    required: {
      eventsService: eventServiceContract.use({
        events: {
          publish: ["Entity.Changed"],
          subscribe: ["Entity.Changed"],
        },
      }),
    },
  },
}));

const eventSubscribeOnlyClientContract = defineAppContract(() => ({
  id: "trellis.integration.events-subscribe-only-client@v1",
  displayName: "Trellis Integration Events Subscribe-Only Client",
  description: "App/client participant without event publish authority.",
  uses: {
    required: {
      eventsService: eventServiceContract.use({
        events: { subscribe: ["Entity.Changed"] },
      }),
    },
  },
}));

const eventPublishOnlyClientContract = defineAppContract(() => ({
  id: "trellis.integration.events-publish-only-client@v1",
  displayName: "Trellis Integration Events Publish-Only Client",
  description: "App/client participant without event subscribe authority.",
  uses: {
    required: {
      eventsService: eventServiceContract.use({
        events: { publish: ["Entity.Changed"] },
      }),
    },
  },
}));

Deno.test("events.client-publishes-and-subscriber-receives publishes and captures a generated event", async () => {
  await withTrellisRuntime(async (runtime) => {
    const capture = await runtime.captureEvents({
      name: "events-fixture-capture",
      contract: eventServiceContract,
      events: ["Entity.Changed"],
    });

    const client = await runtime.connectClient({
      name: "events-fixture-publisher",
      contract: eventPubSubClientContract,
    });
    const payload = { id: "entity-events-1", value: "published" };

    await client.event.entity.changed.publish(payload).orThrow();

    const captured = await assertEventCaptured(
      capture,
      "Entity.Changed",
      (record) => record.payload.id === payload.id,
    );
    assertEquals(captured.payload, payload);
    assert(captured.context.id.length > 0);
    assert(captured.context.time instanceof Date);
    assert(captured.receivedAt instanceof Date);
  });
});

Deno.test("events.denies-publish-without-authority rejects a subscribe-only client publish", async () => {
  await withTrellisRuntime(async (runtime) => {
    await runtime.contracts.approve({ contract: eventServiceContract });
    const client = await runtime.connectClient({
      name: "events-fixture-subscribe-only",
      contract: eventSubscribeOnlyClientContract,
    });

    await assertRejects(() =>
      client.event.entity.changed.publish({
        id: "entity-denied-1",
        value: "should-not-publish",
      }).orThrow()
    );
  });
});

Deno.test("events.denies-subscribe-without-authority does not deliver events to a publish-only client", async () => {
  await withTrellisRuntime(async (runtime) => {
    await runtime.contracts.approve({ contract: eventServiceContract });
    const listenerController = new AbortController();
    const publishOnlyClient = await runtime.connectClient({
      name: "events-fixture-publish-only",
      contract: eventPublishOnlyClientContract,
    });
    const publisher = await runtime.connectClient({
      name: "events-fixture-authorized-publisher",
      contract: eventPubSubClientContract,
    });
    let received = false;

    try {
      await publishOnlyClient.event.entity.changed.listen(
        (
          _event: { id: string; value: string },
          _context: EventListenerContext,
        ) => {
          received = true;
          return Result.ok(undefined);
        },
        {},
        { mode: "ephemeral", signal: listenerController.signal },
      ).orThrow();

      await publisher.event.entity.changed.publish({
        id: "entity-no-subscribe-1",
        value: "should-not-deliver",
      }).orThrow();

      await new Promise((resolve) => setTimeout(resolve, 250));
      assertEquals(received, false);
    } finally {
      listenerController.abort();
    }
  });
});
