import { type BaseError, Result, UnexpectedError } from "@qlever-llc/result";
import { type StaticDecode } from "typebox";
import type { JobLogEntrySchema, JobProgressSchema } from "./types.ts";

export { JobLogEntrySchema, JobProgressSchema } from "./types.ts";

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
  progress?: JobProgress;
  logs?: JobLogEntry[];
};

export type TerminalJob<TPayload, TResult> = JobSnapshot<TPayload, TResult> & {
  state: "completed" | "failed" | "cancelled" | "expired" | "dead" | "dismissed";
};

export type JobIdentity = {
  service: string;
  jobType: string;
  id: string;
};

export type JobFilter = {
  service?: string;
  jobType?: string;
  state?: JobState;
};

function toUnexpectedError(cause: unknown): UnexpectedError {
  return new UnexpectedError({ cause });
}

export class JobRef<TPayload, TResult> {
  readonly id: string;
  readonly service: string;
  readonly type: string;

  readonly #get: () => Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>>;
  readonly #wait: () => Promise<Result<TerminalJob<TPayload, TResult>, BaseError>>;
  readonly #cancel: () => Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>>;

  constructor(
    ref: JobIdentity,
    impl: {
      get: () => Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>>;
      wait: () => Promise<Result<TerminalJob<TPayload, TResult>, BaseError>>;
      cancel: () => Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>>;
    },
  ) {
    this.id = ref.id;
    this.service = ref.service;
    this.type = ref.jobType;
    this.#get = impl.get;
    this.#wait = impl.wait;
    this.#cancel = impl.cancel;
  }

  async get(): Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>> {
    try {
      return await this.#get();
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }

  async wait(): Promise<Result<TerminalJob<TPayload, TResult>, BaseError>> {
    try {
      return await this.#wait();
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }

  async cancel(): Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>> {
    try {
      return await this.#cancel();
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }
}

export class ActiveJob<TPayload, TResult> {
  readonly ref: JobRef<TPayload, TResult>;
  readonly payload: TPayload;
  readonly cancelled: boolean;

  readonly #heartbeat: () => Promise<Result<void, BaseError>>;
  readonly #progress: (value: JobProgress) => Promise<Result<void, BaseError>>;
  readonly #log: (entry: JobLogEntry) => Promise<Result<void, BaseError>>;
  readonly #redeliveryCount: number;

  constructor(
    ref: JobRef<TPayload, TResult>,
    payload: TPayload,
    cancelled: boolean,
    impl: {
      heartbeat: () => Promise<Result<void, BaseError>>;
      progress: (value: JobProgress) => Promise<Result<void, BaseError>>;
      log: (entry: JobLogEntry) => Promise<Result<void, BaseError>>;
      redeliveryCount?: number;
    },
  ) {
    this.ref = ref;
    this.payload = payload;
    this.cancelled = cancelled;
    this.#heartbeat = impl.heartbeat;
    this.#progress = impl.progress;
    this.#log = impl.log;
    this.#redeliveryCount = impl.redeliveryCount ?? 0;
  }

  async heartbeat(): Promise<Result<void, BaseError>> {
    try {
      return await this.#heartbeat();
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }

  async progress(value: JobProgress): Promise<Result<void, BaseError>> {
    try {
      return await this.#progress(value);
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }

  async log(entry: JobLogEntry): Promise<Result<void, BaseError>> {
    try {
      return await this.#log(entry);
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
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
  readonly #create: (payload: TPayload) => Promise<Result<JobRef<TPayload, TResult>, BaseError>>;
  readonly #handle: (
    handler: (job: ActiveJob<TPayload, TResult>) => Promise<Result<TResult, BaseError>>,
  ) => Promise<void>;

  constructor(impl: {
    create: (payload: TPayload) => Promise<Result<JobRef<TPayload, TResult>, BaseError>>;
    handle: (
      handler: (job: ActiveJob<TPayload, TResult>) => Promise<Result<TResult, BaseError>>,
    ) => Promise<void>;
  }) {
    this.#create = impl.create;
    this.#handle = impl.handle;
  }

  async create(payload: TPayload): Promise<Result<JobRef<TPayload, TResult>, BaseError>> {
    try {
      return await this.#create(payload);
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }

  async handle(
    handler: (job: ActiveJob<TPayload, TResult>) => Promise<Result<TResult, BaseError>>,
  ): Promise<void> {
    return await this.#handle(handler);
  }
}

export interface JobWorkerHost {
  stop(): Promise<Result<void, BaseError>>;
  join(): Promise<Result<void, BaseError>>;
}

export class JobWorkerHostAdapter implements JobWorkerHost {
  readonly #stop: () => Promise<Result<void, BaseError>>;
  readonly #join: () => Promise<Result<void, BaseError>>;

  constructor(impl: {
    stop: () => Promise<Result<void, BaseError>>;
    join: () => Promise<Result<void, BaseError>>;
  }) {
    this.#stop = impl.stop;
    this.#join = impl.join;
  }

  async stop(): Promise<Result<void, BaseError>> {
    try {
      return await this.#stop();
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }

  async join(): Promise<Result<void, BaseError>> {
    try {
      return await this.#join();
    } catch (cause) {
      return Result.err(toUnexpectedError(cause));
    }
  }
}

export interface JobsFacade {
  startWorkers(): Promise<Result<JobWorkerHost, BaseError>>;
}

export type JobsFacadeOf<TQueues extends Record<string, JobQueue<unknown, unknown>>> =
  TQueues & JobsFacade;
