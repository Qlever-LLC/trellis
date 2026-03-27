// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
export const CONTRACT_ID = "trellis.jobs@v1" as const;
export const CONTRACT_DIGEST = "eYJoMll77pnGz-HKWZsZliUzTfF60y-MDRRxp388vaQ" as const;

export type JobsCancelInput = { id: string; jobType: string; service: string; };
export type JobsCancelOutput = { job: { completedAt?: string; createdAt: string; deadline?: string; id: string; lastError?: string; logs?: Array<{ level: ("info" | "warn" | "error"); message: string; timestamp: string; }>; maxTries: number; payload: unknown; progress?: { current: number; message?: string; total: number; }; result?: unknown; service: string; startedAt?: string; state: ("pending" | "active" | "retry" | "completed" | "failed" | "cancelled" | "expired" | "dead"); tries: number; type: string; updatedAt: string; }; };

export type JobsGetInput = { id: string; jobType: string; service: string; };
export type JobsGetOutput = { job?: { completedAt?: string; createdAt: string; deadline?: string; id: string; lastError?: string; logs?: Array<{ level: ("info" | "warn" | "error"); message: string; timestamp: string; }>; maxTries: number; payload: unknown; progress?: { current: number; message?: string; total: number; }; result?: unknown; service: string; startedAt?: string; state: ("pending" | "active" | "retry" | "completed" | "failed" | "cancelled" | "expired" | "dead"); tries: number; type: string; updatedAt: string; }; };

export type JobsHealthInput = {  };
export type JobsHealthOutput = { checks: Array<{ error?: string; latencyMs: number; name: string; status: ("ok" | "failed"); }>; service: string; status: ("healthy" | "unhealthy" | "degraded"); timestamp: string; };

export type JobsListInput = { limit?: number; service?: string; since?: string; state?: (("pending" | "active" | "retry" | "completed" | "failed" | "cancelled" | "expired" | "dead") | Array<("pending" | "active" | "retry" | "completed" | "failed" | "cancelled" | "expired" | "dead")>); type?: string; };
export type JobsListOutput = { jobs: Array<{ completedAt?: string; createdAt: string; deadline?: string; id: string; lastError?: string; logs?: Array<{ level: ("info" | "warn" | "error"); message: string; timestamp: string; }>; maxTries: number; payload: unknown; progress?: { current: number; message?: string; total: number; }; result?: unknown; service: string; startedAt?: string; state: ("pending" | "active" | "retry" | "completed" | "failed" | "cancelled" | "expired" | "dead"); tries: number; type: string; updatedAt: string; }>; };

export type JobsListServicesInput = {  };
export type JobsListServicesOutput = { services: Array<{ healthy: boolean; instances: Array<{ heartbeatAt: string; instanceId: string; jobTypes: Array<string>; registeredAt: string; service: string; }>; name: string; }>; };

export type JobsRetryInput = { id: string; jobType: string; service: string; };
export type JobsRetryOutput = { job: { completedAt?: string; createdAt: string; deadline?: string; id: string; lastError?: string; logs?: Array<{ level: ("info" | "warn" | "error"); message: string; timestamp: string; }>; maxTries: number; payload: unknown; progress?: { current: number; message?: string; total: number; }; result?: unknown; service: string; startedAt?: string; state: ("pending" | "active" | "retry" | "completed" | "failed" | "cancelled" | "expired" | "dead"); tries: number; type: string; updatedAt: string; }; };

export interface RpcMap {
  "Jobs.Cancel": { input: JobsCancelInput; output: JobsCancelOutput; };
  "Jobs.Get": { input: JobsGetInput; output: JobsGetOutput; };
  "Jobs.Health": { input: JobsHealthInput; output: JobsHealthOutput; };
  "Jobs.List": { input: JobsListInput; output: JobsListOutput; };
  "Jobs.ListServices": { input: JobsListServicesInput; output: JobsListServicesOutput; };
  "Jobs.Retry": { input: JobsRetryInput; output: JobsRetryOutput; };
}

export interface EventMap {
}

export interface SubjectMap {
  "Jobs.Stream": { message: unknown; };
}

