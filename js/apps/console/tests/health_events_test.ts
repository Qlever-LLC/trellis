import { assertEquals } from "@std/assert";
import type { HealthHeartbeat } from "@qlever-llc/trellis/health";
import {
  appendHealthEvent,
  HEALTH_STALE_MULTIPLIER,
  summarizeHealthServices,
  upsertHealthInstance,
} from "../src/lib/health_events.ts";

function heartbeat(overrides?: Partial<HealthHeartbeat>): HealthHeartbeat {
  return {
    header: {
      id: overrides?.header?.id ?? "01TEST",
      time: overrides?.header?.time ?? "2026-01-01T00:00:00.000Z",
    },
    service: {
      name: overrides?.service?.name ?? "activity",
      kind: overrides?.service?.kind ?? "service",
      instanceId: overrides?.service?.instanceId ?? "instance-1",
      contractId: overrides?.service?.contractId ?? "trellis.activity@v1",
      contractDigest: overrides?.service?.contractDigest ?? "digest",
      startedAt: overrides?.service?.startedAt ?? "2026-01-01T00:00:00.000Z",
      publishIntervalMs: overrides?.service?.publishIntervalMs ?? 30_000,
      runtime: overrides?.service?.runtime ?? "deno",
      ...(overrides?.service?.runtimeVersion
        ? { runtimeVersion: overrides.service.runtimeVersion }
        : {}),
      ...(overrides?.service?.version ? { version: overrides.service.version } : {}),
      ...(overrides?.service?.info ? { info: overrides.service.info } : {}),
    },
    status: overrides?.status ?? "healthy",
    ...(overrides?.summary ? { summary: overrides.summary } : {}),
    checks: overrides?.checks ?? [],
  };
}

Deno.test("appendHealthEvent keeps newest events first within the fixed window", () => {
  const events = appendHealthEvent([], heartbeat({ header: { id: "a", time: "2026-01-01T00:00:00.000Z" } }), 10, 2);
  const next = appendHealthEvent(events, heartbeat({ header: { id: "b", time: "2026-01-01T00:00:01.000Z" } }), 20, 2);
  const finalEvents = appendHealthEvent(next, heartbeat({ header: { id: "c", time: "2026-01-01T00:00:02.000Z" } }), 30, 2);

  assertEquals(finalEvents.length, 2);
  assertEquals(finalEvents[0].heartbeat.header.id, "c");
  assertEquals(finalEvents[1].heartbeat.header.id, "b");
});

Deno.test("summarizeHealthServices marks services offline when all instances are stale", () => {
  const instances = upsertHealthInstance({}, heartbeat(), 1_000);
  const services = summarizeHealthServices(
    instances,
    1_000 + 30_000 * HEALTH_STALE_MULTIPLIER + 1,
  );

  assertEquals(services[0]?.status, "offline");
  assertEquals(services[0]?.staleInstances, 1);
});

Deno.test("summarizeHealthServices keeps live unhealthy instances unhealthy", () => {
  let instances = upsertHealthInstance({}, heartbeat({ status: "healthy" }), 10_000);
  instances = upsertHealthInstance(
    instances,
    heartbeat({
      service: {
        name: "activity",
        kind: "service",
        instanceId: "instance-2",
        contractId: "trellis.activity@v1",
        contractDigest: "digest",
        startedAt: "2026-01-01T00:00:00.000Z",
        publishIntervalMs: 30_000,
        runtime: "deno",
      },
      status: "unhealthy",
    }),
    20_000,
  );

  const services = summarizeHealthServices(instances, 25_000);
  assertEquals(services[0]?.status, "unhealthy");
  assertEquals(services[0]?.liveInstances, 2);
});
