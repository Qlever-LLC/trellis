import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createHealthFixture, type HeartbeatCheck } from "./_fixture.ts";

const CASE_ID = "health.heartbeat-includes-custom-checks" as const;
const fixture = createHealthFixture(CASE_ID);

liveTrellisTest({
  name:
    "health.heartbeat-includes-custom-checks includes built-in and custom checks",
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
            record.event.service.version === fixture.version &&
            record.event.service.info?.caseId === CASE_ID &&
            record.event.checks.some((check: HeartbeatCheck) =>
              check.name === "fixture" && check.status === "ok"
            )
          ),
        { timeoutMs: 10_000, intervalMs: 25 },
      );

      const natsCheck = heartbeat.event.checks.find((check: HeartbeatCheck) =>
        check.name === "nats"
      );
      const fixtureCheck = heartbeat.event.checks.find((
        check: HeartbeatCheck,
      ) => check.name === "fixture");
      assertEquals(natsCheck?.status, "ok");
      assertEquals(fixtureCheck?.status, "ok");
      assertEquals(fixtureCheck?.summary, "fixture ready");
      assertEquals(fixtureCheck?.info, fixture.fixtureCheckInfo);
    } finally {
      await service.stop();
      listenerController.abort();
    }
  },
});
