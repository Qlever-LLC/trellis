import { AsyncResult, BaseError, Result } from "@qlever-llc/result";
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

export const JobContextSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  traceId: Type.String({ pattern: "^[0-9a-f]{32}$" }),
  traceparent: Type.String({
    pattern: "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
  }),
  tracestate: Type.Optional(Type.String({ minLength: 1 })),
});

export type JobContext = StaticDecode<typeof JobContextSchema>;

export type JobState =
  | "pending"
  | "active"
  | "retry"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "skipped"
  | "stale"
  | "dead"
  | "dismissed";

export type JobIdentity = {
  service: string;
  jobType: string;
  id: string;
};

export type JobNotEnqueuedReason =
  | "active-limit"
  | "queue-depth"
  | "stale-blocked"
  | "coalesced";

export type JobNotEnqueuedErrorData = {
  id: string;
  type: "JobNotEnqueuedError";
  message: string;
  reason: JobNotEnqueuedReason;
  key: string;
  active: number;
  queued: number;
  limit: number;
  existingJobId?: string;
  context?: Record<string, unknown>;
  traceId?: string;
};

/** Error returned when keyed job admission does not create a new job. */
export class JobNotEnqueuedError extends BaseError<JobNotEnqueuedErrorData> {
  override readonly name = "JobNotEnqueuedError" as const;
  readonly reason: JobNotEnqueuedReason;
  readonly key: string;
  readonly active: number;
  readonly queued: number;
  readonly limit: number;
  readonly existingJobId?: string;

  constructor(
    options: ErrorOptions & {
      reason: JobNotEnqueuedReason;
      key: string;
      active: number;
      queued: number;
      limit: number;
      existingJobId?: string;
      message?: string;
      context?: Record<string, unknown>;
      id?: string;
      traceId?: string;
    },
  ) {
    const {
      reason,
      key,
      active,
      queued,
      limit,
      existingJobId,
      message,
      ...baseOptions
    } = options;
    super(
      message ?? `Job was not enqueued for key '${key}': ${reason}`,
      baseOptions,
    );
    this.reason = reason;
    this.key = key;
    this.active = active;
    this.queued = queued;
    this.limit = limit;
    this.existingJobId = existingJobId;
  }

  /** Serializes the admission error for transport or logging. */
  override toSerializable(): JobNotEnqueuedErrorData {
    const base = this.baseSerializable();
    return {
      id: base.id,
      type: this.name,
      message: base.message,
      reason: this.reason,
      key: this.key,
      active: this.active,
      queued: this.queued,
      limit: this.limit,
      ...(this.existingJobId !== undefined
        ? { existingJobId: this.existingJobId }
        : {}),
      ...(base.context !== undefined ? { context: base.context } : {}),
      ...(base.traceId !== undefined ? { traceId: base.traceId } : {}),
    };
  }
}

export type JobSubmitOutcome<TPayload, TResult> =
  | { kind: "accepted"; ref: JobRef<TPayload, TResult>; key?: string }
  | {
    kind: "rejected";
    key: string;
    reason: "active-limit" | "queue-depth" | "stale-blocked";
    active: number;
    queued: number;
    limit: number;
  }
  | {
    kind: "coalesced";
    key: string;
    existing: JobIdentity;
    reason: string;
  }
  | {
    kind: "replaced";
    key: string;
    replaced: JobIdentity;
    ref: JobRef<TPayload, TResult>;
  };

export type JobSnapshot<TPayload, TResult> = {
  id: string;
  service: string;
  type: string;
  state: JobState;
  context: JobContext;
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

export type Job<TPayload = unknown, TResult = unknown> = JobSnapshot<
  TPayload,
  TResult
>;

export type TerminalJob<TPayload, TResult> = JobSnapshot<TPayload, TResult> & {
  state:
    | "completed"
    | "failed"
    | "cancelled"
    | "expired"
    | "skipped"
    | "stale"
    | "dead"
    | "dismissed";
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
  readonly #cancel: () => AsyncResult<
    JobSnapshot<TPayload, TResult>,
    BaseError
  >;

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
  readonly context: Readonly<JobContext>;

  readonly #cancelled: () => boolean;
  readonly #heartbeat: () => AsyncResult<void, BaseError>;
  readonly #progress: (value: JobProgress) => AsyncResult<void, BaseError>;
  readonly #log: (entry: JobLogEntry) => AsyncResult<void, BaseError>;
  readonly #redeliveryCount: number;

  constructor(
    ref: JobRef<TPayload, TResult>,
    payload: TPayload,
    context: JobContext,
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
    this.context = Object.freeze({ ...context });
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
  readonly #create: (
    payload: TPayload,
  ) => AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  readonly #handle: (
    handler: (
      job: ActiveJob<TPayload, TResult>,
    ) => Promise<Result<TResult, BaseError>>,
  ) => void;
  readonly #submit: (
    payload: TPayload,
  ) => AsyncResult<JobSubmitOutcome<TPayload, TResult>, BaseError>;

  constructor(impl: {
    create: (
      payload: TPayload,
    ) => AsyncResult<JobRef<TPayload, TResult>, BaseError>;
    handle: (
      handler: (
        job: ActiveJob<TPayload, TResult>,
      ) => Promise<Result<TResult, BaseError>>,
    ) => void;
    submit?: (
      payload: TPayload,
    ) => AsyncResult<JobSubmitOutcome<TPayload, TResult>, BaseError>;
  }) {
    this.#create = impl.create;
    this.#handle = impl.handle;
    this.#submit = impl.submit ??
      ((payload) =>
        impl.create(payload).map((ref) => ({ kind: "accepted", ref })));
  }

  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError> {
    try {
      return this.#create(payload);
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  /**
   * Submits a job using queue policy outcomes for keyed queues.
   * Unkeyed queues accept and return a new job reference.
   */
  submit(
    payload: TPayload,
  ): AsyncResult<JobSubmitOutcome<TPayload, TResult>, BaseError> {
    try {
      return this.#submit(payload);
    } catch (cause) {
      return AsyncResult.err(toUnexpectedError(cause));
    }
  }

  handle(
    handler: (
      job: ActiveJob<TPayload, TResult>,
    ) => Promise<Result<TResult, BaseError>>,
  ): void {
    this.#handle(handler);
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

export type JobsFacade = {};

export type JobsFacadeOf<TJobs extends Record<string, JobTypeMetadata>> =
  & {
    [K in keyof TJobs]: JobQueue<TJobs[K]["payload"], TJobs[K]["result"]>;
  }
  & JobsFacade;
