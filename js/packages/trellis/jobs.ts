import { type BaseError, AsyncResult, Result } from "@qlever-llc/result";
import { UnexpectedError } from "./errors/index.ts";
import { type StaticDecode, Type } from "typebox";

export const JobLogEntrySchema = Type.Object({
  timestamp: Type.String({ format: "date-time" }),
  level: Type.Union([
    Type.Literal("info"),
    Type.Literal("warn"),
    Type.Literal("error"),
  ]),
  message: Type.String(),
});

export const JobProgressSchema = Type.Object({
  step: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  current: Type.Optional(Type.Integer({ minimum: 0 })),
  total: Type.Optional(Type.Integer({ minimum: 0 })),
});

export type JobProgress = StaticDecode<typeof JobProgressSchema>;
export type JobLogEntry = StaticDecode<typeof JobLogEntrySchema>;

export type JobState =
  | "pending"
  | "active"
  | "retry"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "dead"
  | "dismissed";

export type JobIdentity = {
  service: string;
  jobType: string;
  id: string;
};

export type JobSnapshot<TPayload, TResult> = {
  id: string;
  service: string;
  type: string;
  state: JobState;
  payload: TPayload;
  result?: TResult;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  tries: number;
  maxTries: number;
  lastError?: string;
  deadline?: string;
  progress?: JobProgress;
  logs?: JobLogEntry[];
};

export type Job<TPayload = unknown, TResult = unknown> = JobSnapshot<TPayload, TResult>;

export type TerminalJob<TPayload, TResult> = JobSnapshot<TPayload, TResult> & {
  state: "completed" | "failed" | "cancelled" | "expired" | "dead" | "dismissed";
};

export type JobFilter = {
  service?: string;
  jobType?: string;
  state?: JobState | JobState[];
  since?: string;
  limit?: number;
};

export type WorkerInfo = {
  service: string;
  jobType: string;
  instanceId: string;
  concurrency?: number;
  version?: string;
  timestamp: string;
};

export type ServiceInfo = {
  name: string;
  workers: WorkerInfo[];
  healthy: boolean;
};

export type JobsHealth = {
  status: "healthy" | "unhealthy" | "degraded";
  service: string;
  timestamp: string;
  checks: Array<{
    name: string;
    status: "ok" | "failed";
    latencyMs: number;
    error?: string;
  }>;
};

export type JobTypeMetadata = {
  payload: unknown;
  result: unknown;
};

function toUnexpectedError(cause: unknown): UnexpectedError {
  return cause instanceof UnexpectedError
    ? cause
    : new UnexpectedError({ cause });
}

export class JobRef<TPayload, TResult> {
  readonly id: string;
  readonly service: string;
  readonly type: string;

  readonly #get: () => AsyncResult<JobSnapshot<TPayload, TResult>, BaseError>;
  readonly #wait: () => AsyncResult<TerminalJob<TPayload, TResult>, BaseError>;
  readonly #cancel: () => AsyncResult<JobSnapshot<TPayload, TResult>, BaseError>;

  constructor(
    ref: JobIdentity,
    impl: {
      get: () => AsyncResult<JobSnapshot<TPayload, TResult>, BaseError>;
      wait: () => AsyncResult<TerminalJob<TPayload, TResult>, BaseError>;
      cancel: () => AsyncResult<JobSnapshot<TPayload, TResult>, BaseError>;
    },
  ) {
    this.id = ref.id;
    this.service = ref.service;
    this.type = ref.jobType;
    this.#get = impl.get;
    this.#wait = impl.wait;
    this.#cancel = impl.cancel;
  }

  get(): AsyncResult<JobSnapshot<TPayload, TResult>, BaseError> {
    try {
      return this.#get();
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  wait(): AsyncResult<TerminalJob<TPayload, TResult>, BaseError> {
    try {
      return this.#wait();
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  cancel(): AsyncResult<JobSnapshot<TPayload, TResult>, BaseError> {
    try {
      return this.#cancel();
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }
}

export class ActiveJob<TPayload, TResult> {
  readonly ref: JobRef<TPayload, TResult>;
  readonly payload: TPayload;

  readonly #cancelled: () => boolean;
  readonly #heartbeat: () => AsyncResult<void, BaseError>;
  readonly #progress: (value: JobProgress) => AsyncResult<void, BaseError>;
  readonly #log: (entry: JobLogEntry) => AsyncResult<void, BaseError>;
  readonly #redeliveryCount: number;

  constructor(
    ref: JobRef<TPayload, TResult>,
    payload: TPayload,
    cancelled: boolean | (() => boolean),
    impl: {
      heartbeat: () => AsyncResult<void, BaseError>;
      progress: (value: JobProgress) => AsyncResult<void, BaseError>;
      log: (entry: JobLogEntry) => AsyncResult<void, BaseError>;
      redeliveryCount?: number;
    },
  ) {
    this.ref = ref;
    this.payload = payload;
    this.#cancelled = typeof cancelled === "function"
      ? cancelled
      : () => cancelled;
    this.#heartbeat = impl.heartbeat;
    this.#progress = impl.progress;
    this.#log = impl.log;
    this.#redeliveryCount = impl.redeliveryCount ?? 0;
  }

  get cancelled(): boolean {
    try {
      return this.#cancelled();
    } catch {
      return false;
    }
  }

  heartbeat(): AsyncResult<void, BaseError> {
    try {
      return this.#heartbeat();
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  progress(value: JobProgress): AsyncResult<void, BaseError> {
    try {
      return this.#progress(value);
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  log(entry: JobLogEntry): AsyncResult<void, BaseError> {
    try {
      return this.#log(entry);
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  redeliveryCount(): number {
    return this.#redeliveryCount;
  }

  isRedelivery(): boolean {
    return this.#redeliveryCount > 0;
  }
}

export class JobQueue<TPayload, TResult> {
  readonly #create: (payload: TPayload) => AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  readonly #handle: (
    handler: (job: ActiveJob<TPayload, TResult>) => Promise<Result<TResult, BaseError>>,
  ) => AsyncResult<void, BaseError>;

  constructor(impl: {
    create: (payload: TPayload) => AsyncResult<JobRef<TPayload, TResult>, BaseError>;
    handle: (
      handler: (job: ActiveJob<TPayload, TResult>) => Promise<Result<TResult, BaseError>>,
    ) => AsyncResult<void, BaseError>;
  }) {
    this.#create = impl.create;
    this.#handle = impl.handle;
  }

  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError> {
    try {
      return this.#create(payload);
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  handle(
    handler: (job: ActiveJob<TPayload, TResult>) => Promise<Result<TResult, BaseError>>,
  ): AsyncResult<void, BaseError> {
    try {
      return this.#handle(handler);
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }
}

export interface JobWorkerHost {
  stop(): AsyncResult<void, BaseError>;
  join(): AsyncResult<void, BaseError>;
}

export class JobWorkerHostAdapter implements JobWorkerHost {
  readonly #stop: () => AsyncResult<void, BaseError>;
  readonly #join: () => AsyncResult<void, BaseError>;

  constructor(impl: {
    stop: () => AsyncResult<void, BaseError>;
    join: () => AsyncResult<void, BaseError>;
  }) {
    this.#stop = impl.stop;
    this.#join = impl.join;
  }

  stop(): AsyncResult<void, BaseError> {
    try {
      return this.#stop();
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  join(): AsyncResult<void, BaseError> {
    try {
      return this.#join();
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }
}

export type JobsFacade = {
  startWorkers(opts?: {
    queues?: readonly string[];
    instanceId?: string;
    version?: string;
  }): AsyncResult<JobWorkerHost, BaseError>;
};

export type JobsFacadeOf<TJobs extends Record<string, JobTypeMetadata>> = {
  [K in keyof TJobs]: JobQueue<TJobs[K]["payload"], TJobs[K]["result"]>;
} & JobsFacade;

type JobsClientLike = {
  request<T>(method: string, input: unknown): AsyncResult<T, BaseError>;
};

export class JobsAdminClient {
  readonly #trellis: JobsClientLike;

  constructor(trellis: JobsClientLike) {
    this.#trellis = trellis;
  }

  health(): AsyncResult<JobsHealth, BaseError> {
    return this.#trellis.request<JobsHealth>("Jobs.Health", {});
  }

  listServices(): AsyncResult<ServiceInfo[], BaseError> {
    return this.#trellis.request<{ services?: ServiceInfo[] }>("Jobs.ListServices", {})
      .map((response) => response.services ?? []);
  }

  list(filter: JobFilter = {}): AsyncResult<JobSnapshot<unknown, unknown>[], BaseError> {
    return this.#trellis.request<{ jobs?: JobSnapshot<unknown, unknown>[] }>("Jobs.List", {
      ...filter,
      ...(filter.jobType ? { type: filter.jobType } : {}),
    }).map((response) => response.jobs ?? []);
  }

  get(ref: JobIdentity): AsyncResult<JobSnapshot<unknown, unknown> | null, BaseError> {
    return this.#trellis.request<{ job?: JobSnapshot<unknown, unknown> | null }>("Jobs.Get", {
      service: ref.service,
      jobType: ref.jobType,
      id: ref.id,
    }).map((response) => response.job ?? null);
  }

  cancel(ref: JobIdentity): AsyncResult<JobSnapshot<unknown, unknown>, BaseError> {
    return this.#trellis.request<{ job: JobSnapshot<unknown, unknown> }>("Jobs.Cancel", {
      service: ref.service,
      jobType: ref.jobType,
      id: ref.id,
    }).map((response) => response.job);
  }

  retry(ref: JobIdentity): AsyncResult<JobSnapshot<unknown, unknown>, BaseError> {
    return this.#trellis.request<{ job: JobSnapshot<unknown, unknown> }>("Jobs.Retry", {
      service: ref.service,
      jobType: ref.jobType,
      id: ref.id,
    }).map((response) => response.job);
  }

  listDLQ(filter: JobFilter = {}): AsyncResult<JobSnapshot<unknown, unknown>[], BaseError> {
    return this.#trellis.request<{ jobs?: JobSnapshot<unknown, unknown>[] }>("Jobs.ListDLQ", {
      ...filter,
      ...(filter.jobType ? { type: filter.jobType } : {}),
    }).map((response) => response.jobs ?? []);
  }

  replayDLQ(ref: JobIdentity): AsyncResult<JobSnapshot<unknown, unknown>, BaseError> {
    return this.#trellis.request<{ job: JobSnapshot<unknown, unknown> }>("Jobs.ReplayDLQ", {
      service: ref.service,
      jobType: ref.jobType,
      id: ref.id,
    }).map((response) => response.job);
  }

  dismissDLQ(ref: JobIdentity): AsyncResult<JobSnapshot<unknown, unknown>, BaseError> {
    return this.#trellis.request<{ job: JobSnapshot<unknown, unknown> }>("Jobs.DismissDLQ", {
      service: ref.service,
      jobType: ref.jobType,
      id: ref.id,
    }).map((response) => response.job);
  }
}
