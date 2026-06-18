import { assert, assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createHealthFixture } from "./_fixture.ts";

const CASE_ID = "health.heartbeat-includes-service-metadata" as const;
const fixture = createHealthFixture(CASE_ID);

liveTrellisTest({
  name:
    "health.heartbeat-includes-service-metadata includes service metadata in heartbeat",
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
            record.event.service.info?.caseId === CASE_ID
          ),
        { timeoutMs: 10_000, intervalMs: 25 },
      );

      assertEquals(heartbeat.event.status, "healthy");
      assertEquals(heartbeat.event.service.kind, "service");
      assertEquals(
        heartbeat.event.service.contractId,
        fixture.serviceContract.CONTRACT_ID,
      );
      assertEquals(
        heartbeat.event.service.contractDigest,
        fixture.serviceContract.CONTRACT_DIGEST,
      );
      assertEquals(heartbeat.event.service.publishIntervalMs, 50);
      assertEquals(heartbeat.event.service.runtime, "deno");
      assertEquals(heartbeat.event.service.info, fixture.info);
      assert(heartbeat.event.service.instanceId.length > 0);
      assert(!Number.isNaN(Date.parse(heartbeat.event.service.startedAt)));
    } finally {
      await service.stop();
      listenerController.abort();
    }
  },
});
