import { assert, assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  type EventListenerContext,
  Result,
} from "@qlever-llc/trellis";
import {
  type HealthHeartbeatEvent,
  sdk as health,
} from "@qlever-llc/trellis/sdk/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { withTrellisRuntime } from "../_support/runtime.ts";

const healthServiceContract = defineServiceContract({}, () => ({
  id: "trellis.integration.health-service@v1",
  displayName: "Trellis Integration Health Service",
  description: "Service participant that emits baseline Trellis health events.",
}));

const healthObserverContract = defineAppContract(() => ({
  id: "trellis.integration.health-observer@v1",
  displayName: "Trellis Integration Health Observer",
  description: "App/client participant that observes service heartbeats.",
  uses: {
    required: {
      health: health.use({
        events: { subscribe: ["Health.Heartbeat"] },
      }),
    },
  },
}));

type ObservedHeartbeat = {
  readonly event: HealthHeartbeatEvent;
  readonly context: EventListenerContext;
};

type HeartbeatCheck = HealthHeartbeatEvent["checks"][number];

async function setupObserver(runtime: TrellisTestRuntime) {
  const observed: ObservedHeartbeat[] = [];
  const listenerController = new AbortController();
  const client = await runtime.connectClient({
    name: "health-fixture-observer",
    contract: healthObserverContract,
  });

  await client.event.health.heartbeat.listen(
    (event: HealthHeartbeatEvent, context: EventListenerContext) => {
      observed.push({ event, context });
      return Result.ok(undefined);
    },
    {},
    { mode: "ephemeral", signal: listenerController.signal },
  ).orThrow();

  return { observed, listenerController, client };
}

async function setupService(runtime: TrellisTestRuntime) {
  const serviceKey = await runtime.registerService({
    name: "health-fixture-service",
    contract: healthServiceContract,
  });
  const service = await TrellisService.connect({
    trellisUrl: runtime.trellisUrl,
    contract: healthServiceContract,
    name: "health-fixture-service",
    sessionKeySeed: serviceKey.seed,
    telemetry: false,
    server: { health: { publishIntervalMs: 50 } },
  }).orThrow();

  service.health.setInfo({
    version: "0.0.0-health-fixture",
    info: { fixture: "health" },
  });
  service.health.add("fixture", () => ({
    status: "ok",
    summary: "fixture ready",
    info: { source: "health-integration" },
  }));

  return service;
}

import type { TrellisTestRuntime } from "@qlever-llc/trellis-test";

Deno.test("health.client-subscribes-to-heartbeats subscribes and receives a service heartbeat", async () => {
  await withTrellisRuntime(async (runtime) => {
    const { observed, listenerController } = await setupObserver(runtime);
    const service = await setupService(runtime);

    try {
      const heartbeat = await runtime.waitFor(
        () =>
          observed.find((record) =>
            record.event.service.name === "health-fixture-service"
          ),
        { timeoutMs: 10_000, intervalMs: 25 },
      );

      assertEquals(heartbeat.event.status, "healthy");
      assert(heartbeat.event.service.instanceId.length > 0);
    } finally {
      await service.stop();
      listenerController.abort();
    }
  });
});

Deno.test("health.heartbeat-includes-service-metadata includes service metadata in heartbeat", async () => {
  await withTrellisRuntime(async (runtime) => {
    const { observed, listenerController } = await setupObserver(runtime);
    const service = await setupService(runtime);

    try {
      const heartbeat = await runtime.waitFor(
        () =>
          observed.find((record) =>
            record.event.service.name === "health-fixture-service" &&
            record.event.service.version === "0.0.0-health-fixture"
          ),
        { timeoutMs: 10_000, intervalMs: 25 },
      );

      assertEquals(heartbeat.event.status, "healthy");
      assertEquals(heartbeat.event.service.kind, "service");
      assertEquals(
        heartbeat.event.service.contractId,
        healthServiceContract.CONTRACT_ID,
      );
      assertEquals(
        heartbeat.event.service.contractDigest,
        healthServiceContract.CONTRACT_DIGEST,
      );
      assertEquals(heartbeat.event.service.publishIntervalMs, 50);
      assertEquals(heartbeat.event.service.runtime, "deno");
      assertEquals(heartbeat.event.service.info, { fixture: "health" });
      assert(heartbeat.event.service.instanceId.length > 0);
      assert(!Number.isNaN(Date.parse(heartbeat.event.service.startedAt)));
    } finally {
      await service.stop();
      listenerController.abort();
    }
  });
});

Deno.test("health.heartbeat-includes-custom-checks includes built-in and custom checks", async () => {
  await withTrellisRuntime(async (runtime) => {
    const { observed, listenerController } = await setupObserver(runtime);
    const service = await setupService(runtime);

    try {
      const heartbeat = await runtime.waitFor(
        () =>
          observed.find((record) =>
            record.event.service.name === "health-fixture-service" &&
            record.event.service.version === "0.0.0-health-fixture" &&
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
      assertEquals(fixtureCheck?.info, { source: "health-integration" });
    } finally {
      await service.stop();
      listenerController.abort();
    }
  });
});

Deno.test("health.heartbeat-event-context-is-populated has populated event context", async () => {
  await withTrellisRuntime(async (runtime) => {
    const { observed, listenerController } = await setupObserver(runtime);
    const service = await setupService(runtime);

    try {
      const heartbeat = await runtime.waitFor(
        () =>
          observed.find((record) =>
            record.event.service.name === "health-fixture-service"
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
  });
});
