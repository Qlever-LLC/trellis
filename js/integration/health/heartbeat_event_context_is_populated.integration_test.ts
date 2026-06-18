import { assert, assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createHealthFixture } from "./_fixture.ts";

const CASE_ID = "health.heartbeat-event-context-is-populated" as const;
const fixture = createHealthFixture(CASE_ID);

liveTrellisTest({
  name:
    "health.heartbeat-event-context-is-populated has populated event context",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { observed, listenerController } = await fixture.setupObserver(
      runtime,
    );
    const service = await fixture.setupService(runtime);

    try {
      const heartbeat = await runtime.waitFor(
        () =>
          observed.find((record) =>
            record.event.service.name === fixture.serviceName &&
            record.event.service.info?.caseId === CASE_ID
          ),
        { timeoutMs: 10_000, intervalMs: 25 },
      );

      assertEquals(heartbeat.context.subject, "events.v1.Health.Heartbeat");
      assertEquals(heartbeat.context.mode, "ephemeral");
      assert(heartbeat.context.id.length > 0);
      assert(heartbeat.context.time instanceof Date);
    } finally {
      await service.stop();
      listenerController.abort();
    }
  },
});
