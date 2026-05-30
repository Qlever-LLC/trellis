// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
import type { RpcHandlerFn } from "../../../index.ts";
import type { API } from "./api.ts";

import { type SerializableErrorData, TrellisError } from "../../../index.ts";

import { NotFoundErrorDataSchema } from "./schemas.ts";

export const CONTRACT_ID = "trellis.jobs@v1" as const;
export const CONTRACT_DIGEST =
  "jSB8nKGOQqIxdFDdUqO-gOTt3Dijg--SOXJtJ1ChpoY" as const;

export type JobsCancelInput = { id: string };
export type JobsCancelOutput = {
  job: {
    completedAt?: string;
    context: {
      requestId: string;
      traceId: string;
      traceparent: string;
      tracestate?: string;
    };
    createdAt: string;
    deadline?: string;
    id: string;
    lastError?: string;
    logs?: Array<
      { level: "info" | "warn" | "error"; message: string; timestamp: string }
    >;
    maxTries: number;
    payload: unknown;
    progress?: {
      current?: number;
      message?: string;
      step?: string;
      total?: number;
    };
    result?: unknown;
    service: string;
    startedAt?: string;
    state:
      | "pending"
      | "active"
      | "retry"
      | "completed"
      | "failed"
      | "cancelled"
      | "expired"
      | "dead"
      | "dismissed";
    tries: number;
    type: string;
    updatedAt: string;
  };
};

export type JobsDismissDLQInput = { id: string };
export type JobsDismissDLQOutput = {
  job: {
    completedAt?: string;
    context: {
      requestId: string;
      traceId: string;
      traceparent: string;
      tracestate?: string;
    };
    createdAt: string;
    deadline?: string;
    id: string;
    lastError?: string;
    logs?: Array<
      { level: "info" | "warn" | "error"; message: string; timestamp: string }
    >;
    maxTries: number;
    payload: unknown;
    progress?: {
      current?: number;
      message?: string;
      step?: string;
      total?: number;
    };
    result?: unknown;
    service: string;
    startedAt?: string;
    state:
      | "pending"
      | "active"
      | "retry"
      | "completed"
      | "failed"
      | "cancelled"
      | "expired"
      | "dead"
      | "dismissed";
    tries: number;
    type: string;
    updatedAt: string;
  };
};

export type JobsGetInput = { id: string };
export type JobsGetOutput = {
  job: {
    completedAt?: string;
    context: {
      requestId: string;
      traceId: string;
      traceparent: string;
      tracestate?: string;
    };
    createdAt: string;
    deadline?: string;
    id: string;
    lastError?: string;
    logs?: Array<
      { level: "info" | "warn" | "error"; message: string; timestamp: string }
    >;
    maxTries: number;
    payload: unknown;
    progress?: {
      current?: number;
      message?: string;
      step?: string;
      total?: number;
    };
    result?: unknown;
    service: string;
    startedAt?: string;
    state:
      | "pending"
      | "active"
      | "retry"
      | "completed"
      | "failed"
      | "cancelled"
      | "expired"
      | "dead"
      | "dismissed";
    tries: number;
    type: string;
    updatedAt: string;
  };
};

export type JobsHealthInput = {};
export type JobsHealthOutput = {
  checks: Array<{ [k: string]: unknown }>;
  service: string;
  status: unknown;
  timestamp: string;
};

export type JobsListInput = {
  limit: number;
  offset?: number;
  service?: string;
  since?: string;
  state?: Array<
    (
      | "pending"
      | "active"
      | "retry"
      | "completed"
      | "failed"
      | "cancelled"
      | "expired"
      | "dead"
      | "dismissed"
    )
  >;
  type?: string;
};
export type JobsListOutput = {
  count: number;
  entries: Array<
    {
      completedAt?: string;
      context: {
        requestId: string;
        traceId: string;
        traceparent: string;
        tracestate?: string;
      };
      createdAt: string;
      deadline?: string;
      id: string;
      lastError?: string;
      logs?: Array<
        { level: "info" | "warn" | "error"; message: string; timestamp: string }
      >;
      maxTries: number;
      payload: unknown;
      progress?: {
        current?: number;
        message?: string;
        step?: string;
        total?: number;
      };
      result?: unknown;
      service: string;
      startedAt?: string;
      state:
        | "pending"
        | "active"
        | "retry"
        | "completed"
        | "failed"
        | "cancelled"
        | "expired"
        | "dead"
        | "dismissed";
      tries: number;
      type: string;
      updatedAt: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type JobsListDLQInput = {
  limit: number;
  offset?: number;
  service?: string;
  since?: string;
  type?: string;
};
export type JobsListDLQOutput = {
  count: number;
  entries: Array<
    {
      completedAt?: string;
      context: {
        requestId: string;
        traceId: string;
        traceparent: string;
        tracestate?: string;
      };
      createdAt: string;
      deadline?: string;
      id: string;
      lastError?: string;
      logs?: Array<
        { level: "info" | "warn" | "error"; message: string; timestamp: string }
      >;
      maxTries: number;
      payload: unknown;
      progress?: {
        current?: number;
        message?: string;
        step?: string;
        total?: number;
      };
      result?: unknown;
      service: string;
      startedAt?: string;
      state:
        | "pending"
        | "active"
        | "retry"
        | "completed"
        | "failed"
        | "cancelled"
        | "expired"
        | "dead"
        | "dismissed";
      tries: number;
      type: string;
      updatedAt: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type JobsListServicesInput = { limit: number; offset?: number };
export type JobsListServicesOutput = {
  count: number;
  entries: Array<
    {
      healthy: boolean;
      name: string;
      workers: Array<
        {
          concurrency?: number;
          instanceId: string;
          jobType: string;
          service: string;
          timestamp: string;
          version?: string;
        }
      >;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type JobsReplayDLQInput = { id: string };
export type JobsReplayDLQOutput = {
  job: {
    completedAt?: string;
    context: {
      requestId: string;
      traceId: string;
      traceparent: string;
      tracestate?: string;
    };
    createdAt: string;
    deadline?: string;
    id: string;
    lastError?: string;
    logs?: Array<
      { level: "info" | "warn" | "error"; message: string; timestamp: string }
    >;
    maxTries: number;
    payload: unknown;
    progress?: {
      current?: number;
      message?: string;
      step?: string;
      total?: number;
    };
    result?: unknown;
    service: string;
    startedAt?: string;
    state:
      | "pending"
      | "active"
      | "retry"
      | "completed"
      | "failed"
      | "cancelled"
      | "expired"
      | "dead"
      | "dismissed";
    tries: number;
    type: string;
    updatedAt: string;
  };
};

export type JobsRetryInput = { id: string };
export type JobsRetryOutput = {
  job: {
    completedAt?: string;
    context: {
      requestId: string;
      traceId: string;
      traceparent: string;
      tracestate?: string;
    };
    createdAt: string;
    deadline?: string;
    id: string;
    lastError?: string;
    logs?: Array<
      { level: "info" | "warn" | "error"; message: string; timestamp: string }
    >;
    maxTries: number;
    payload: unknown;
    progress?: {
      current?: number;
      message?: string;
      step?: string;
      total?: number;
    };
    result?: unknown;
    service: string;
    startedAt?: string;
    state:
      | "pending"
      | "active"
      | "retry"
      | "completed"
      | "failed"
      | "cancelled"
      | "expired"
      | "dead"
      | "dismissed";
    tries: number;
    type: string;
    updatedAt: string;
  };
};

export type NotFoundErrorData = {
  context?: { [k: string]: unknown };
  id: string;
  jobId?: string;
  message: string;
  resource: string;
  traceId?: string;
  type: "NotFoundError";
};
export class NotFoundError extends TrellisError<NotFoundErrorData> {
  static readonly schema = NotFoundErrorDataSchema;
  override readonly name = "NotFoundError" as const;
  readonly data: NotFoundErrorData;

  constructor(data: NotFoundErrorData) {
    super(data.message, {
      id: data.id,
      ...(data.context !== undefined ? { context: data.context } : {}),
    });
    this.data = data;
  }

  static fromSerializable(data: NotFoundErrorData): NotFoundError {
    return new NotFoundError(data);
  }

  override toSerializable(): NotFoundErrorData {
    return this.data;
  }
}

export interface RpcMap {
  "Jobs.Cancel": { input: JobsCancelInput; output: JobsCancelOutput };
  "Jobs.DismissDLQ": {
    input: JobsDismissDLQInput;
    output: JobsDismissDLQOutput;
  };
  "Jobs.Get": { input: JobsGetInput; output: JobsGetOutput };
  "Jobs.Health": { input: JobsHealthInput; output: JobsHealthOutput };
  "Jobs.List": { input: JobsListInput; output: JobsListOutput };
  "Jobs.ListDLQ": { input: JobsListDLQInput; output: JobsListDLQOutput };
  "Jobs.ListServices": {
    input: JobsListServicesInput;
    output: JobsListServicesOutput;
  };
  "Jobs.ReplayDLQ": { input: JobsReplayDLQInput; output: JobsReplayDLQOutput };
  "Jobs.Retry": { input: JobsRetryInput; output: JobsRetryOutput };
}

export type JobsCancelHandler = RpcHandlerFn<typeof API.owned, "Jobs.Cancel">;
export type JobsDismissDLQHandler = RpcHandlerFn<
  typeof API.owned,
  "Jobs.DismissDLQ"
>;
export type JobsGetHandler = RpcHandlerFn<typeof API.owned, "Jobs.Get">;
export type JobsHealthHandler = RpcHandlerFn<typeof API.owned, "Jobs.Health">;
export type JobsListHandler = RpcHandlerFn<typeof API.owned, "Jobs.List">;
export type JobsListDLQHandler = RpcHandlerFn<typeof API.owned, "Jobs.ListDLQ">;
export type JobsListServicesHandler = RpcHandlerFn<
  typeof API.owned,
  "Jobs.ListServices"
>;
export type JobsReplayDLQHandler = RpcHandlerFn<
  typeof API.owned,
  "Jobs.ReplayDLQ"
>;
export type JobsRetryHandler = RpcHandlerFn<typeof API.owned, "Jobs.Retry">;

export interface EventMap {
}

export interface FeedMap {
}

export interface SubjectMap {
}
