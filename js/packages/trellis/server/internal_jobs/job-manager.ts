import { headers as natsHeaders, type MsgHdrs } from "@nats-io/nats-core";
import { ulid } from "ulid";
import {
  createMapCarrier,
  injectTraceContext,
} from "../../telemetry/carrier.ts";

import {
  ActiveJob,
  ActiveJobRuntimeError,
  JobCancellationToken,
} from "./active-job.ts";
import type { JobsBinding, JobsQueueBinding } from "./bindings.ts";
import type {
  Job,
  JobContext,
  JobEvent,
  JobLogEntry,
  JobProgress,
} from "./types.ts";

type Publisher = {
  publish(
    subject: string,
    payload: Uint8Array,
    opts?: { headers?: MsgHdrs },
  ): void | Promise<void>;
};

type JobMetaSource = {
  nextJobId(): string;
  nowIso(): string;
};

type JobManagerContext = {
  nc: Publisher;
  jobs?: JobsBinding;
  meta?: JobMetaSource;
};

type ActiveJobRuntimeMetadata = {
  redeliveryCount?: number;
};

type JobProcessValidation<TPayload, TResult> = {
  validateResult?: (
    result: TResult,
    job: Job<TPayload, TResult>,
  ) => Promise<void> | void;
};

export class JobProcessError extends Error {
  readonly kind: "retryable" | "failed";

  constructor(kind: "retryable" | "failed", message: string) {
    super(message);
    this.name = "JobProcessError";
    this.kind = kind;
  }

  static retryable(message: string): JobProcessError {
    return new JobProcessError("retryable", message);
  }

  static failed(message: string): JobProcessError {
    return new JobProcessError("failed", message);
  }
}

export type JobProcessOutcome<TResult> =
  | { outcome: "completed"; tries: number; result: TResult }
  | { outcome: "retry"; tries: number; error: string }
  | { outcome: "failed"; tries: number; error: string }
  | { outcome: "cancelled"; tries: number }
  | { outcome: "interrupted"; tries: number };

export class JobManager<TPayload = unknown, TResult = unknown> {
  readonly #context: JobManagerContext;

  constructor(context: JobManagerContext) {
    this.#context = context;
  }

  #meta(): Required<JobMetaSource> {
    return {
      nextJobId: this.#context.meta?.nextJobId ?? (() => ulid()),
      nowIso: this.#context.meta?.nowIso ?? (() => new Date().toISOString()),
    };
  }

  #getQueueBinding(type: string): JobsQueueBinding {
    const binding = this.#context.jobs?.queues[type];
    if (!binding || !this.#context.jobs) {
      throw new Error(`Missing jobs binding for queue '${type}'`);
    }
    return binding;
  }

  async #publishJobEvent(
    type: string,
    jobId: string,
    event: JobEvent<TPayload, TResult>,
  ): Promise<void> {
    const binding = this.#getQueueBinding(type);
    const headers = headersFromJobContext(event.context);
    await this.#context.nc.publish(
      `${binding.publishPrefix}.${jobId}.${event.eventType}`,
      new TextEncoder().encode(JSON.stringify(event)),
      { headers },
    );
  }

  async create(
    type: string,
    payload: TPayload,
  ): Promise<Job<TPayload, TResult>> {
    const binding = this.#getQueueBinding(type);
    const meta = this.#meta();

    const now = meta.nowIso();
    const id = meta.nextJobId();
    const context = createJobContext();
    const namespace = this.#context.jobs!.namespace;
    const deadline = computeDeadline(now, binding.defaultDeadlineMs);
    const job: Job<TPayload, TResult> = {
      id,
      service: namespace,
      type,
      state: "pending",
      context,
      payload,
      createdAt: now,
      updatedAt: now,
      tries: 0,
      maxTries: binding.maxDeliver,
      ...(deadline ? { deadline } : {}),
    };
    const event: JobEvent<TPayload, TResult> = {
      jobId: id,
      service: job.service,
      jobType: type,
      eventType: "created",
      state: "pending",
      context,
      tries: 0,
      maxTries: binding.maxDeliver,
      payload,
      ...(deadline ? { deadline } : {}),
      timestamp: now,
    };

    await this.#publishJobEvent(type, id, event);

    return job;
  }

  process(
    job: Job<TPayload, TResult>,
    cancellation: JobCancellationToken,
    handler: (job: ActiveJob<TPayload, TResult>) => Promise<TResult>,
    metadata: ActiveJobRuntimeMetadata = {},
    validation: JobProcessValidation<TPayload, TResult> = {},
  ): Promise<JobProcessOutcome<TResult>> {
    return this.processWithHeartbeat(
      job,
      cancellation,
      () => {
        throw new ActiveJobRuntimeError("worker heartbeat unavailable");
      },
      handler,
      metadata,
      validation,
    );
  }

  async processWithHeartbeat(
    job: Job<TPayload, TResult>,
    cancellation: JobCancellationToken,
    heartbeat: () => Promise<void>,
    handler: (job: ActiveJob<TPayload, TResult>) => Promise<TResult>,
    metadata: ActiveJobRuntimeMetadata = {},
    validation: JobProcessValidation<TPayload, TResult> = {},
  ): Promise<JobProcessOutcome<TResult>> {
    this.#getQueueBinding(job.type);

    const tries = job.tries + 1;
    await this.#publishJobEvent(job.type, job.id, {
      jobId: job.id,
      service: job.service,
      jobType: job.type,
      eventType: "started",
      state: "active",
      previousState: job.state,
      context: job.context,
      tries,
      timestamp: this.#meta().nowIso(),
    });

    try {
      const result = await this.withActiveJobAndHeartbeat(
        { ...job, state: "active", tries },
        cancellation,
        heartbeat,
        handler,
        metadata,
      );

      if (cancellation.isHostShutdown()) {
        return { outcome: "interrupted", tries };
      }
      if (cancellation.isCancelled()) {
        return { outcome: "cancelled", tries };
      }
      try {
        await validation.validateResult?.(result, {
          ...job,
          state: "active",
          tries,
        });
      } catch (error) {
        throw JobProcessError.failed(
          error instanceof Error ? error.message : String(error),
        );
      }

      await this.#publishJobEvent(job.type, job.id, {
        jobId: job.id,
        service: job.service,
        jobType: job.type,
        eventType: "completed",
        state: "completed",
        previousState: "active",
        context: job.context,
        tries,
        result,
        timestamp: this.#meta().nowIso(),
      });
      return { outcome: "completed", tries, result };
    } catch (error) {
      if (cancellation.isHostShutdown()) {
        return { outcome: "interrupted", tries };
      }
      if (cancellation.isCancelled()) {
        return { outcome: "cancelled", tries };
      }

      if (error instanceof JobProcessError) {
        const detail = error.message;
        if (error.kind === "retryable") {
          await this.#publishJobEvent(job.type, job.id, {
            jobId: job.id,
            service: job.service,
            jobType: job.type,
            eventType: "retry",
            state: "retry",
            previousState: "active",
            context: job.context,
            tries,
            error: detail,
            timestamp: this.#meta().nowIso(),
          });
          return { outcome: "retry", tries, error: detail };
        }

        await this.#publishJobEvent(job.type, job.id, {
          jobId: job.id,
          service: job.service,
          jobType: job.type,
          eventType: "failed",
          state: "failed",
          previousState: "active",
          context: job.context,
          tries,
          error: detail,
          timestamp: this.#meta().nowIso(),
        });
        return { outcome: "failed", tries, error: detail };
      }

      throw error;
    }
  }

  async emitProgress(
    job: Job<TPayload, TResult>,
    progress: JobProgress,
  ): Promise<void> {
    const queue = this.#getQueueBinding(job.type);
    if (!queue.progress) {
      throw new Error(
        `Feature 'progress' is disabled for queue '${queue.queueType}'`,
      );
    }
    if (job.state !== "active") {
      throw new Error(
        `Cannot emit progress for job '${job.id}' in state '${job.state}'`,
      );
    }

    await this.#publishJobEvent(job.type, job.id, {
      jobId: job.id,
      service: job.service,
      jobType: job.type,
      eventType: "progress",
      state: "active",
      previousState: "active",
      context: job.context,
      tries: job.tries,
      progress,
      timestamp: this.#meta().nowIso(),
    });
  }

  async emitLog(job: Job<TPayload, TResult>, log: JobLogEntry): Promise<void> {
    const queue = this.#getQueueBinding(job.type);
    if (!queue.logs) {
      throw new Error(
        `Feature 'logs' is disabled for queue '${queue.queueType}'`,
      );
    }
    if (job.state !== "active") {
      throw new Error(
        `Cannot emit log for job '${job.id}' in state '${job.state}'`,
      );
    }

    await this.#publishJobEvent(job.type, job.id, {
      jobId: job.id,
      service: job.service,
      jobType: job.type,
      eventType: "logged",
      state: "active",
      previousState: "active",
      context: job.context,
      tries: job.tries,
      logs: [log],
      timestamp: this.#meta().nowIso(),
    });
  }

  withActiveJob<T>(
    job: Job<TPayload, TResult>,
    cancellation: JobCancellationToken,
    f: (job: ActiveJob<TPayload, TResult>) => Promise<T>,
    metadata: ActiveJobRuntimeMetadata = {},
  ): Promise<T> {
    return this.withActiveJobAndHeartbeat(
      job,
      cancellation,
      () => {
        throw new ActiveJobRuntimeError("worker heartbeat unavailable");
      },
      f,
      metadata,
    );
  }

  async withActiveJobAndHeartbeat<T>(
    job: Job<TPayload, TResult>,
    cancellation: JobCancellationToken,
    heartbeat: () => Promise<void>,
    f: (job: ActiveJob<TPayload, TResult>) => Promise<T>,
    metadata: ActiveJobRuntimeMetadata = {},
  ): Promise<T> {
    const activeJob = new ActiveJob(job, cancellation, {
      updateProgress: (progress) => this.emitProgress(job, progress),
      log: (entry) => this.emitLog(job, entry),
      heartbeat: async () => {
        try {
          await heartbeat();
        } catch (error) {
          if (error instanceof ActiveJobRuntimeError) {
            throw error;
          }
          throw new ActiveJobRuntimeError(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    }, {
      redeliveryCount: metadata.redeliveryCount ?? 0,
    });

    return await f(activeJob);
  }
}

function computeDeadline(now: string, deadlineMs?: number): string | undefined {
  if (deadlineMs === undefined) {
    return undefined;
  }

  const timestamp = new Date(now);
  timestamp.setTime(timestamp.getTime() + deadlineMs);
  return timestamp.toISOString();
}

function createJobContext(): JobContext {
  const carrier = createMapCarrier();
  injectTraceContext(carrier);
  const inheritedTraceparent = carrier.get("traceparent");
  const traceparent = isValidTraceparent(inheritedTraceparent)
    ? inheritedTraceparent
    : synthesizeTraceparent();
  const tracestate = carrier.get("tracestate");

  return {
    requestId: ulid(),
    traceId: traceparent.slice(3, 35),
    traceparent,
    ...(tracestate ? { tracestate } : {}),
  };
}

function headersFromJobContext(context: JobContext): MsgHdrs {
  const headers = natsHeaders();
  headers.set("request-id", context.requestId);
  headers.set("traceparent", context.traceparent);
  if (context.tracestate) {
    headers.set("tracestate", context.tracestate);
  }
  return headers;
}

function isValidTraceparent(value: string | undefined): value is string {
  if (
    value === undefined ||
    !/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(value)
  ) {
    return false;
  }
  return !isAllZeroHex(value.slice(3, 35)) &&
    !isAllZeroHex(value.slice(36, 52));
}

function synthesizeTraceparent(): string {
  return `00-${randomNonZeroHex(16)}-${randomNonZeroHex(8)}-01`;
}

function randomNonZeroHex(byteLength: number): string {
  let value = "";
  do {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } while (isAllZeroHex(value));
  return value;
}

function isAllZeroHex(value: string): boolean {
  return /^0+$/.test(value);
}

export type { JobsBinding, JobsQueueBinding };
export { ActiveJob, ActiveJobRuntimeError, JobCancellationToken };
