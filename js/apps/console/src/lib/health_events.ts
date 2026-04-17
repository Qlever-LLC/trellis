import type { HealthHeartbeat } from "@qlever-llc/trellis/health";

export const HEALTH_EVENT_WINDOW = 200;
export const HEALTH_STALE_MULTIPLIER = 2;
export const HEALTH_EXPIRED_MULTIPLIER = 6;

export type HealthFeedEvent = {
  id: string;
  receivedAt: number;
  heartbeat: HealthHeartbeat;
};

export type HealthInstanceView = {
  key: string;
  kind: HealthHeartbeat["service"]["kind"];
  contractId: string;
  contractDigest: string;
  serviceName: string;
  instanceId: string;
  status: HealthHeartbeat["status"];
  summary?: string;
  lastSeenAt: number;
  startedAt: string;
  publishIntervalMs: number;
  version?: string;
  runtime: string;
  runtimeVersion?: string;
  info?: HealthHeartbeat["service"]["info"];
  checks: HealthHeartbeat["checks"];
};

export type HealthServiceStatus = "healthy" | "degraded" | "unhealthy" | "offline";

export type HealthServiceView = {
  key: string;
  kind: HealthHeartbeat["service"]["kind"];
  contractId: string;
  serviceName: string;
  status: HealthServiceStatus;
  liveInstances: number;
  staleInstances: number;
  lastSeenAt: number;
  version?: string;
  runtime: string;
  instances: HealthInstanceView[];
};

export function heartbeatInstanceKey(heartbeat: HealthHeartbeat): string {
  return `${heartbeat.service.kind}:${heartbeat.service.contractId}:${heartbeat.service.instanceId}`;
}

export function appendHealthEvent(
  events: readonly HealthFeedEvent[],
  heartbeat: HealthHeartbeat,
  receivedAt = Date.now(),
  windowSize = HEALTH_EVENT_WINDOW,
): HealthFeedEvent[] {
  return [
    {
      id: `${heartbeat.header.id}:${receivedAt}`,
      receivedAt,
      heartbeat,
    },
    ...events,
  ].slice(0, windowSize);
}

export function upsertHealthInstance(
  instances: Record<string, HealthInstanceView>,
  heartbeat: HealthHeartbeat,
  receivedAt = Date.now(),
): Record<string, HealthInstanceView> {
  const key = heartbeatInstanceKey(heartbeat);
  return {
    ...instances,
    [key]: {
      key,
      kind: heartbeat.service.kind,
      contractId: heartbeat.service.contractId,
      contractDigest: heartbeat.service.contractDigest,
      serviceName: heartbeat.service.name,
      instanceId: heartbeat.service.instanceId,
      status: heartbeat.status,
      summary: heartbeat.summary,
      lastSeenAt: receivedAt,
      startedAt: heartbeat.service.startedAt,
      publishIntervalMs: heartbeat.service.publishIntervalMs,
      version: heartbeat.service.version,
      runtime: heartbeat.service.runtime,
      runtimeVersion: heartbeat.service.runtimeVersion,
      info: heartbeat.service.info,
      checks: heartbeat.checks,
    },
  };
}

export function isHealthInstanceStale(
  instance: Pick<HealthInstanceView, "lastSeenAt" | "publishIntervalMs">,
  now = Date.now(),
): boolean {
  return now - instance.lastSeenAt > instance.publishIntervalMs * HEALTH_STALE_MULTIPLIER;
}

export function isHealthInstanceExpired(
  instance: Pick<HealthInstanceView, "lastSeenAt" | "publishIntervalMs">,
  now = Date.now(),
): boolean {
  return now - instance.lastSeenAt >
    instance.publishIntervalMs * HEALTH_EXPIRED_MULTIPLIER;
}

export function pruneExpiredHealthInstances(
  instances: Record<string, HealthInstanceView>,
  now = Date.now(),
): Record<string, HealthInstanceView> {
  let nextInstances: Record<string, HealthInstanceView> | undefined;

  for (const [key, instance] of Object.entries(instances)) {
    if (!isHealthInstanceExpired(instance, now)) {
      continue;
    }

    if (!nextInstances) {
      nextInstances = { ...instances };
    }
    delete nextInstances[key];
  }

  return nextInstances ?? instances;
}

export function summarizeHealthServices(
  instances: Record<string, HealthInstanceView>,
  now = Date.now(),
): HealthServiceView[] {
  const grouped = new Map<string, HealthInstanceView[]>();

  for (const instance of Object.values(instances)) {
    const groupKey = `${instance.kind}:${instance.contractId}`;
    const nextInstances = grouped.get(groupKey) ?? [];
    nextInstances.push(instance);
    grouped.set(groupKey, nextInstances);
  }

  return Array.from(grouped.entries()).map(([groupKey, serviceInstances]) => {
    const staleInstances = serviceInstances.filter((instance) =>
      isHealthInstanceStale(instance, now)
    );
    const liveInstances = serviceInstances.filter((instance) =>
      !isHealthInstanceStale(instance, now)
    );

    let status: HealthServiceStatus;
    if (liveInstances.length === 0) {
      status = "offline";
    } else if (liveInstances.some((instance) => instance.status === "unhealthy")) {
      status = "unhealthy";
    } else if (
      liveInstances.some((instance) => instance.status === "degraded") ||
      staleInstances.length > 0
    ) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    const latestInstance = serviceInstances.reduce((latest, instance) =>
      instance.lastSeenAt > latest.lastSeenAt ? instance : latest
    );

    return {
      key: groupKey,
      kind: latestInstance.kind,
      contractId: latestInstance.contractId,
      serviceName: latestInstance.serviceName,
      status,
      liveInstances: liveInstances.length,
      staleInstances: staleInstances.length,
      lastSeenAt: latestInstance.lastSeenAt,
      version: latestInstance.version,
      runtime: latestInstance.runtime,
      instances: [...serviceInstances].sort((left, right) =>
        right.lastSeenAt - left.lastSeenAt
      ),
    };
  }).sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}
