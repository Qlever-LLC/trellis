// Generated from ./generated/contracts/manifests/trellis.health@v1.json
import type { TrellisEventMessage } from "../../../index.ts";

export const CONTRACT_ID = "trellis.health@v1" as const;
export const CONTRACT_DIGEST =
  "z9RdJVXAI4q-hSkpvUX_xMYEJaKslMsayevlW4UlSeQ" as const;

export type HealthHeartbeatEvent = {
  checks: Array<
    {
      error?: string;
      info?: { [k: string]: unknown };
      latencyMs: number;
      name: string;
      status: "ok" | "failed";
      summary?: string;
    }
  >;
  service: {
    contractDigest: string;
    contractId: string;
    info?: { [k: string]: unknown };
    instanceId: string;
    kind: "service" | "device";
    name: string;
    publishIntervalMs: number;
    runtime: "deno" | "node" | "rust" | "unknown";
    runtimeVersion?: string;
    startedAt: string;
    version?: string;
  };
  status: "healthy" | "unhealthy" | "degraded";
  summary?: string;
};
export type HealthHeartbeatEventMessage = TrellisEventMessage<
  HealthHeartbeatEvent
>;

export interface RpcMap {
}

export interface EventMap {
  "Health.Heartbeat": { event: HealthHeartbeatEvent };
}

export interface FeedMap {
}

export interface SubjectMap {
}
