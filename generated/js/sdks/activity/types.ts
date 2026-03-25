// Generated from ../../../generated/contracts/manifests/trellis.activity@v1.json
export const CONTRACT_ID = "trellis.activity@v1" as const;
export const CONTRACT_DIGEST = "8YG5wtZZEL9foGeGYDKDvQ-GB6IHVLL-M96oQJAEM2M" as const;

export type ActivityGetInput = { id: string; };
export type ActivityGetOutput = { entry: { actor?: string; id: string; kind: ("auth.connect" | "auth.disconnect" | "auth.session_revoked" | "auth.connection_kicked"); metadata?: {  }; occurredAt: string; principalId: string; principalLabel: string; principalOrigin: string; sessionKey?: string; summary: string; userNkey?: string; }; };

export type ActivityHealthInput = {  };
export type ActivityHealthOutput = { checks: Array<{ error?: string; latencyMs: number; name: string; status: ("ok" | "failed"); }>; service: string; status: ("healthy" | "unhealthy" | "degraded"); timestamp: string; };

export type ActivityListInput = { kind?: ("auth.connect" | "auth.disconnect" | "auth.session_revoked" | "auth.connection_kicked"); limit?: number; };
export type ActivityListOutput = { entries: Array<{ actor?: string; id: string; kind: ("auth.connect" | "auth.disconnect" | "auth.session_revoked" | "auth.connection_kicked"); metadata?: {  }; occurredAt: string; principalId: string; principalLabel: string; principalOrigin: string; sessionKey?: string; summary: string; userNkey?: string; }>; };

export type ActivityRecordedEvent = { actor?: string; header: { id: string; time: string; }; id: string; kind: ("auth.connect" | "auth.disconnect" | "auth.session_revoked" | "auth.connection_kicked"); metadata?: {  }; occurredAt: string; principalId: string; principalLabel: string; principalOrigin: string; sessionKey?: string; summary: string; userNkey?: string; };

export interface RpcMap {
  "Activity.Get": { input: ActivityGetInput; output: ActivityGetOutput; };
  "Activity.Health": { input: ActivityHealthInput; output: ActivityHealthOutput; };
  "Activity.List": { input: ActivityListInput; output: ActivityListOutput; };
}

export interface EventMap {
  "Activity.Recorded": { event: ActivityRecordedEvent; };
}

export interface SubjectMap {
}

