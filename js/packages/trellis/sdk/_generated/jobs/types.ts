// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
import type {
  BaseError,
  HandlerTrellis,
  Result,
  RpcHandlerContext,
  TrellisErrorInstance,
} from "../../../index.ts";

import type { Api } from "./api.ts";

import { type SerializableErrorData, TrellisError } from "../../../index.ts";

import { NotFoundErrorDataSchema } from "./schemas.ts";

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };
export type HandlerClient = HandlerTrellis<Api>;

export const CONTRACT_ID = "trellis.jobs@v1" as const;
export const CONTRACT_DIGEST =
  "xDigtrlrF3n3ZNgHVdwDJFcwi0PEJBiDyBG6FnzFzM8" as const;

export type JobsCancelInput = { id: string };
export type JobsCancelOutput = {
  job: {
    completedAt?: string;
    concurrency?: {
      heartbeatAt?: string;
      key: string;
      keyHash: string;
      leaseExpiresAt?: string;
      staleTakeoverCount?: number;
    };
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
    queuePolicy?: {
      existingJobId?: string;
      outcome: string;
      reason?: string;
      replacedJobId?: string;
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
    concurrency?: {
      heartbeatAt?: string;
      key: string;
      keyHash: string;
      leaseExpiresAt?: string;
      staleTakeoverCount?: number;
    };
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
    queuePolicy?: {
      existingJobId?: string;
      outcome: string;
      reason?: string;
      replacedJobId?: string;
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
    concurrency?: {
      heartbeatAt?: string;
      key: string;
      keyHash: string;
      leaseExpiresAt?: string;
      staleTakeoverCount?: number;
    };
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
    queuePolicy?: {
      existingJobId?: string;
      outcome: string;
      reason?: string;
      replacedJobId?: string;
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

export type JobsGetKeyInput = { key: string; service: string; type: string };
export type JobsGetKeyOutput = {
  active: Array<
    {
      heartbeatAgeMs: number;
      heartbeatAt: string;
      instanceId: string;
      jobId: string;
      leaseExpiresAt: string;
      startedAt: string;
    }
  >;
  key: string;
  keyHash: string;
  latestPolicyReason?: string;
  queued: Array<{ createdAt: string; jobId: string }>;
  queuedDepth: number;
  service: string;
  staleTakeoverCount: number;
  type: string;
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
      concurrency?: {
        heartbeatAt?: string;
        key: string;
        keyHash: string;
        leaseExpiresAt?: string;
        staleTakeoverCount?: number;
      };
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
      queuePolicy?: {
        existingJobId?: string;
        outcome: string;
        reason?: string;
        replacedJobId?: string;
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
      concurrency?: {
        heartbeatAt?: string;
        key: string;
        keyHash: string;
        leaseExpiresAt?: string;
        staleTakeoverCount?: number;
      };
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
      queuePolicy?: {
        existingJobId?: string;
        outcome: string;
        reason?: string;
        replacedJobId?: string;
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
    concurrency?: {
      heartbeatAt?: string;
      key: string;
      keyHash: string;
      leaseExpiresAt?: string;
      staleTakeoverCount?: number;
    };
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
    queuePolicy?: {
      existingJobId?: string;
      outcome: string;
      reason?: string;
      replacedJobId?: string;
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
    concurrency?: {
      heartbeatAt?: string;
      key: string;
      keyHash: string;
      leaseExpiresAt?: string;
      staleTakeoverCount?: number;
    };
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
    queuePolicy?: {
      existingJobId?: string;
      outcome: string;
      reason?: string;
      replacedJobId?: string;
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
  "Jobs.GetKey": { input: JobsGetKeyInput; output: JobsGetKeyOutput };
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

export type JobsCancelHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type JobsCancelHandlerResult = Result<
  JobsCancelOutput,
  JobsCancelHandlerError
>;
export type JobsCancelHandler<TDeps = undefined> = (
  args: {
    input: JobsCancelInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsCancelHandlerResult | Promise<JobsCancelHandlerResult>;
export type JobsDismissDLQHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type JobsDismissDLQHandlerResult = Result<
  JobsDismissDLQOutput,
  JobsDismissDLQHandlerError
>;
export type JobsDismissDLQHandler<TDeps = undefined> = (
  args: {
    input: JobsDismissDLQInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsDismissDLQHandlerResult | Promise<JobsDismissDLQHandlerResult>;
export type JobsGetHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type JobsGetHandlerResult = Result<JobsGetOutput, JobsGetHandlerError>;
export type JobsGetHandler<TDeps = undefined> = (
  args: {
    input: JobsGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsGetHandlerResult | Promise<JobsGetHandlerResult>;
export type JobsGetKeyHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type JobsGetKeyHandlerResult = Result<
  JobsGetKeyOutput,
  JobsGetKeyHandlerError
>;
export type JobsGetKeyHandler<TDeps = undefined> = (
  args: {
    input: JobsGetKeyInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsGetKeyHandlerResult | Promise<JobsGetKeyHandlerResult>;
export type JobsHealthHandlerError = TrellisErrorInstance;
export type JobsHealthHandlerResult = Result<
  JobsHealthOutput,
  JobsHealthHandlerError
>;
export type JobsHealthHandler<TDeps = undefined> = (
  args: {
    input: JobsHealthInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsHealthHandlerResult | Promise<JobsHealthHandlerResult>;
export type JobsListHandlerError = TrellisErrorInstance;
export type JobsListHandlerResult = Result<
  JobsListOutput,
  JobsListHandlerError
>;
export type JobsListHandler<TDeps = undefined> = (
  args: {
    input: JobsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsListHandlerResult | Promise<JobsListHandlerResult>;
export type JobsListDLQHandlerError = TrellisErrorInstance;
export type JobsListDLQHandlerResult = Result<
  JobsListDLQOutput,
  JobsListDLQHandlerError
>;
export type JobsListDLQHandler<TDeps = undefined> = (
  args: {
    input: JobsListDLQInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsListDLQHandlerResult | Promise<JobsListDLQHandlerResult>;
export type JobsListServicesHandlerError = TrellisErrorInstance;
export type JobsListServicesHandlerResult = Result<
  JobsListServicesOutput,
  JobsListServicesHandlerError
>;
export type JobsListServicesHandler<TDeps = undefined> = (
  args: {
    input: JobsListServicesInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsListServicesHandlerResult | Promise<JobsListServicesHandlerResult>;
export type JobsReplayDLQHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type JobsReplayDLQHandlerResult = Result<
  JobsReplayDLQOutput,
  JobsReplayDLQHandlerError
>;
export type JobsReplayDLQHandler<TDeps = undefined> = (
  args: {
    input: JobsReplayDLQInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsReplayDLQHandlerResult | Promise<JobsReplayDLQHandlerResult>;
export type JobsRetryHandlerError =
  | TrellisErrorInstance
  | BaseError<NotFoundErrorData>;
export type JobsRetryHandlerResult = Result<
  JobsRetryOutput,
  JobsRetryHandlerError
>;
export type JobsRetryHandler<TDeps = undefined> = (
  args: {
    input: JobsRetryInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => JobsRetryHandlerResult | Promise<JobsRetryHandlerResult>;

export interface EventMap {
}

export interface FeedMap {
}

export interface SubjectMap {
}
