import { assert, assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createHealthFixture } from "./_fixture.ts";

const CASE_ID = "health.client-subscribes-to-heartbeats" as const;
const fixture = createHealthFixture(CASE_ID);

liveTrellisTest({
  name:
    "health.client-subscribes-to-heartbeats subscribes and receives a service heartbeat",
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
            record.event.service.info?.fixture === "health" &&
            record.event.service.info?.caseId === CASE_ID
          ),
        { timeoutMs: 10_000, intervalMs: 25 },
      );

      assertEquals(heartbeat.event.status, "healthy");
      assert(heartbeat.event.service.instanceId.length > 0);
    } finally {
      await service.stop();
      listenerController.abort();
    }
  },
});
