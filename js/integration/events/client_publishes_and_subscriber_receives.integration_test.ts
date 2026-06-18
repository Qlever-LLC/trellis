import { assert, assertEquals } from "@std/assert";
import { assertEventCaptured } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createEventsFixture } from "./_fixture.ts";

const CASE_ID = "events.client-publishes-and-subscriber-receives" as const;
const fixture = createEventsFixture(CASE_ID);

liveTrellisTest({
  name:
    "events.client-publishes-and-subscriber-receives publishes and captures a generated event",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const capture = await runtime.captureEvents({
      name: fixture.captureName,
      contract: fixture.serviceContract,
      events: ["Entity.Changed"],
    });

    try {
      const client = await runtime.connectClient({
        name: fixture.publisherName,
        contract: fixture.pubSubClientContract,
      });
      const payload = { id: fixture.publishedEntityId, value: "published" };

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
    } finally {
      await capture.stop();
    }
  },
});
