import { jetstream, jetstreamManager } from "@nats-io/jetstream";
import type { NatsConnection } from "@nats-io/nats-core";
import type { JobsQueueBinding, JobsRuntimeBinding } from "./bindings.ts";
import { ActiveJobCancellationRegistry } from "./cancellation-registry.ts";
import { startWorkerHeartbeatLoop } from "./heartbeat.ts";
import type { ActiveJob, JobProcessOutcome } from "./job-manager.ts";
import { JobCancellationToken, type JobManager, JobProcessError } from "./job-manager.ts";
import { isTerminal, jobFromWorkEvent } from "./projection.ts";
import type { Job, JobEvent } from "./types.ts";

export type WorkerAckAction = "ack" | "nak";
export type ProjectedWorkDecision = "process" | "skip-ack";
export type SchemaRef = { schema: string };
export type PayloadValidationArgs<TResult> = {
  schema?: SchemaRef;
  job: Job<unknown, TResult>;
};

export type ResultValidationArgs<TResult> = {
  schema?: SchemaRef;
  job: Job<unknown, TResult>;
  result: TResult;
};

export class WorkerLoopStopError extends AggregateError {
  constructor(errors: unknown[]) {
    super(errors, "queue worker loop failed");
    this.name = "WorkerLoopStopError";
  }
}

export class WorkerHostStopError extends AggregateError {
  constructor(errors: unknown[]) {
    super(errors, "worker host stop failed");
    this.name = "WorkerHostStopError";
  }
}

type WorkMessageLike = {
  data: Uint8Array;
  subject: string;
  info?: { redeliveryCount?: number };
  ack(): void | Promise<void>;
  nak(delay?: number): void | Promise<void>;
  inProgress(): void | Promise<void>;
};

type ConsumerMessagesLike = AsyncIterable<WorkMessageLike> & {
  stop?: () => void;
  close?: () => Promise<void> | void;
};

type WorkerConsumerLike = {
  consume(): Promise<ConsumerMessagesLike>;
};

type CancelMessageLike = {
  subject: string;
  data: Uint8Array;
};

type CancelSubscriptionLike = AsyncIterable<CancelMessageLike> & {
  unsubscribe(): void;
};

type WorkerStopHandle = { stop(): Promise<void> } | void;

type StartWorkerArgs = {
  queueType: string;
  workerIndex: number;
  cancellation: JobCancellationToken;
};

type StartWorkerHostOptions = {
  instanceId: string;
  queueTypes?: string[];
  heartbeatPublisher?: { publish(subject: string, payload: Uint8Array): void | Promise<void> };
  heartbeatIntervalMs?: number;
  version?: string;
  nowIso?: () => string;
  startWorker: (args: StartWorkerArgs) => Promise<WorkerStopHandle>;
};

type StartNatsWorkerHostOptions<TResult> = Omit<StartWorkerHostOptions, "startWorker"> & {
  nats: NatsConnection;
  manager: JobManager<unknown, TResult>;
  validatePayload?: (args: PayloadValidationArgs<TResult>) => Promise<void> | void;
  validateResult?: (args: ResultValidationArgs<TResult>) => Promise<void> | void;
  handler: (job: ActiveJob<unknown, TResult>) => Promise<TResult>;
  jsm?: {
    consumers: {
      add(stream: string, config: Record<string, unknown>): Promise<unknown>;
      info(stream: string, consumer: string): Promise<unknown>;
    };
  };
  js?: {
    consumers: {
      getConsumerFromInfo(info: unknown): WorkerConsumerLike;
    };
  };
};

type StartQueueWorkerLoopOptions<TResult> = {
  manager: JobManager<unknown, TResult>;
  consumer: WorkerConsumerLike;
  cancelSubscription: CancelSubscriptionLike;
  hostCancellation?: JobCancellationToken;
  getProjectedJob?: (job: Job<unknown, TResult>) => Promise<Job<unknown, TResult> | undefined>;
  payloadSchema?: SchemaRef;
  validatePayload?: (args: PayloadValidationArgs<TResult>) => Promise<void> | void;
  resultSchema?: SchemaRef;
  validateResult?: (args: ResultValidationArgs<TResult>) => Promise<void> | void;
  handler: (job: ActiveJob<unknown, TResult>) => Promise<TResult>;
};

type StartNatsQueueWorkerOptions<TResult> = {
  nats: NatsConnection;
  manager: JobManager<unknown, TResult>;
  binding: JobsRuntimeBinding;
  queueType: string;
  hostCancellation?: JobCancellationToken;
  validatePayload?: (args: PayloadValidationArgs<TResult>) => Promise<void> | void;
  validateResult?: (args: ResultValidationArgs<TResult>) => Promise<void> | void;
  handler: (job: ActiveJob<unknown, TResult>) => Promise<TResult>;
  jsm?: {
    consumers: {
      add(stream: string, config: Record<string, unknown>): Promise<unknown>;
      info(stream: string, consumer: string): Promise<unknown>;
    };
  };
  js?: {
    consumers: {
      getConsumerFromInfo(info: unknown): WorkerConsumerLike;
    };
  };
};

export async function processWorkPayload<TResult>(
  manager: JobManager<unknown, TResult>,
  payload: Uint8Array,
  handler: (job: ActiveJob<unknown, TResult>) => Promise<TResult>,
  validation?: {
    payloadSchema?: SchemaRef;
    validatePayload?: (args: PayloadValidationArgs<TResult>) => Promise<void> | void;
    resultSchema?: SchemaRef;
    validateResult?: (args: ResultValidationArgs<TResult>) => Promise<void> | void;
  },
  runtime?: { redeliveryCount?: number },
): Promise<JobProcessOutcome<TResult> | undefined> {
  return processWorkPayloadWithContext(manager, payload, new JobCancellationToken(), handler, validation, runtime);
}

export async function processWorkPayloadWithContext<TResult>(
  manager: JobManager<unknown, TResult>,
  payload: Uint8Array,
  cancellation: JobCancellationToken,
  handler: (job: ActiveJob<unknown, TResult>) => Promise<TResult>,
  validation?: {
    payloadSchema?: SchemaRef;
    validatePayload?: (args: PayloadValidationArgs<TResult>) => Promise<void> | void;
    resultSchema?: SchemaRef;
    validateResult?: (args: ResultValidationArgs<TResult>) => Promise<void> | void;
  },
  runtime?: { redeliveryCount?: number },
): Promise<JobProcessOutcome<TResult> | undefined> {
  return processWorkPayloadWithContextAndHeartbeat(
    manager,
    payload,
    cancellation,
    async () => {
      throw new Error("worker heartbeat unavailable");
    },
    handler,
    validation,
    runtime,
  );
}

export async function processWorkPayloadWithContextAndHeartbeat<TResult>(
  manager: JobManager<unknown, TResult>,
  payload: Uint8Array,
  cancellation: JobCancellationToken,
  heartbeat: () => Promise<void>,
  handler: (job: ActiveJob<unknown, TResult>) => Promise<TResult>,
  validation?: {
    payloadSchema?: SchemaRef;
    validatePayload?: (args: PayloadValidationArgs<TResult>) => Promise<void> | void;
    resultSchema?: SchemaRef;
    validateResult?: (args: ResultValidationArgs<TResult>) => Promise<void> | void;
  },
  runtime?: { redeliveryCount?: number },
): Promise<JobProcessOutcome<TResult> | undefined> {
  const event = parseWorkPayloadEvent(payload);
  if (!event) {
    return undefined;
  }
  const job = jobFromWorkEvent(event) as Job<unknown, TResult> | undefined;
  if (!job) {
    return undefined;
  }
  return await manager.processWithHeartbeat(job, cancellation, heartbeat, async (activeJob) => {
    try {
      await validation?.validatePayload?.({ schema: validation.payloadSchema, job: activeJob.job() });
    } catch (error) {
      throw JobProcessError.failed(error instanceof Error ? error.message : String(error));
    }
    return await handler(activeJob);
  }, {
    redeliveryCount: runtime?.redeliveryCount,
  }, {
    validateResult: validation?.validateResult
      ? (result: TResult, resultJob: Job<unknown, TResult>) => validation.validateResult!({
        schema: validation.resultSchema,
        result,
        job: resultJob,
      })
      : undefined,
  });
}

export function projectedWorkDecision(
  projected: Job | undefined,
  _work: Job,
): ProjectedWorkDecision {
  if (!projected) {
    return "process";
  }
  return isTerminal(projected.state) ? "skip-ack" : "process";
}

export function ackActionForOutcome(
  outcome: JobProcessOutcome<unknown> | undefined,
): WorkerAckAction {
  if (!outcome) {
    return "ack";
  }
  switch (outcome.outcome) {
    case "retry":
    case "interrupted":
      return "nak";
    default:
      return "ack";
  }
}

export async function startQueueWorkerLoop<TResult>(
  options: StartQueueWorkerLoopOptions<TResult>,
): Promise<{ stop(): Promise<void> }> {
  const registry = new ActiveJobCancellationRegistry();
  const activeTokens = new Set<JobCancellationToken>();
  const messages = await options.consumer.consume();
  const hostCancellation = options.hostCancellation;
  const stopConsuming = () => {
    if (typeof messages.stop === "function") {
      messages.stop();
    }
    if (typeof messages.close === "function") {
      void messages.close();
    }
  };
  const cancelActiveForShutdown = () => {
    for (const token of activeTokens) {
      token.cancelForShutdown();
    }
  };
  const hostAbortHandler = () => {
    cancelActiveForShutdown();
    stopConsuming();
  };
  hostCancellation?.signal.addEventListener("abort", hostAbortHandler);
  if (hostCancellation?.signal.aborted) {
    hostAbortHandler();
  }

  const workTask = (async () => {
    for await (const msg of messages) {
      const event = parseWorkPayloadEvent(msg.data);
      const job = event ? jobFromWorkEvent(event) as Job<unknown, TResult> | undefined : undefined;
      if (!job) {
        await msg.ack();
        continue;
      }
      const key = `${job.service}.${job.type}.${job.id}`;
      if (hostCancellation?.isHostShutdown()) {
        await msg.nak();
        continue;
      }
      const projected = options.getProjectedJob ? await options.getProjectedJob(job) : undefined;
      if (hostCancellation?.isHostShutdown()) {
        await msg.nak();
        continue;
      }
      if (projectedWorkDecision(projected, job) === "skip-ack") {
        registry.clearPending(key);
        await msg.ack();
        continue;
      }

      const token = new JobCancellationToken();
      if (hostCancellation?.isHostShutdown()) {
        token.cancelForShutdown();
      }
      activeTokens.add(token);
      const guard = registry.register(key, token);
      try {
        const outcome = await processWorkPayloadWithContextAndHeartbeat(
          options.manager,
          msg.data,
          token,
          async () => {
            await msg.inProgress();
          },
          options.handler,
          {
            payloadSchema: options.payloadSchema,
            validatePayload: options.validatePayload,
            resultSchema: options.resultSchema,
            validateResult: options.validateResult,
          },
          {
            redeliveryCount: msg.info?.redeliveryCount,
          },
        );
        if (ackActionForOutcome(outcome) === "ack") {
          await msg.ack();
        } else {
          await msg.nak();
        }
      } finally {
        guard.dispose();
        activeTokens.delete(token);
      }
    }
  })();
  let workFailure: unknown;
  const observedWorkTask = workTask.catch((error) => {
    workFailure = error;
  });

  const cancelTask = (async () => {
    for await (const msg of options.cancelSubscription) {
      const event = parseWorkPayloadEvent(msg.data);
      if (!event || event.eventType !== "cancelled") {
        continue;
      }
      registry.cancel(`${event.service}.${event.jobType}.${event.jobId}`);
    }
  })();
  let cancelFailure: unknown;
  const observedCancelTask = cancelTask.catch((error) => {
    cancelFailure = error;
  });

  return {
    async stop(): Promise<void> {
      options.cancelSubscription.unsubscribe();
      cancelActiveForShutdown();
      stopConsuming();
      await Promise.all([observedWorkTask, observedCancelTask]);
      hostCancellation?.signal.removeEventListener("abort", hostAbortHandler);
      const failures = [workFailure, cancelFailure].filter((error) => error !== undefined);
      if (failures.length > 0) {
        throw new WorkerLoopStopError(failures);
      }
    },
  };
}

export async function startNatsQueueWorker<TResult>(
  options: StartNatsQueueWorkerOptions<TResult>,
): Promise<{ stop(): Promise<void> }> {
  const queue = getQueueBinding(options.binding, options.queueType);
  const jsm = options.jsm ?? await jetstreamManager(options.nats);
  const js = options.js ?? {
    consumers: {
      getConsumerFromInfo(info: unknown) {
        return jetstream(options.nats).consumers.getConsumerFromInfo(info as never) as unknown as WorkerConsumerLike;
      },
    },
  };
  const info = await ensureConsumerInfo(jsm, options.binding.workStream, queue);
  const consumer = js.consumers.getConsumerFromInfo(info) as WorkerConsumerLike;
  const cancelSubscription = options.nats.subscribe(`${queue.publishPrefix}.*.cancelled`) as unknown as CancelSubscriptionLike;

  return await startQueueWorkerLoop({
    manager: options.manager,
    consumer,
    cancelSubscription,
    hostCancellation: options.hostCancellation,
    payloadSchema: queue.payload,
    validatePayload: options.validatePayload,
    resultSchema: queue.result,
    validateResult: options.validateResult,
    handler: options.handler,
  });
}

export async function startWorkerHostFromBinding(
  binding: JobsRuntimeBinding,
  options: StartWorkerHostOptions,
): Promise<{ workerCount(): number; stop(): Promise<void> }> {
  const queueTypes = options.queueTypes ?? Object.keys(binding.jobs.queues).sort();
  for (const queueType of queueTypes) {
    const queue = binding.jobs.queues[queueType];
    if (!queue) {
      throw new Error(`Requested worker queue binding '${queueType}' is missing`);
    }
    if (queue.concurrency < 1) {
      throw new Error(`Worker queue '${queueType}' has invalid concurrency ${queue.concurrency}; expected >= 1`);
    }
  }

  const cancellation = new JobCancellationToken();
  const heartbeatLoops = options.heartbeatPublisher
    ? await Promise.all(queueTypes.map((queueType) => startWorkerHeartbeatLoop({
      publisher: options.heartbeatPublisher!,
      service: binding.jobs.namespace,
      jobType: queueType,
      instanceId: options.instanceId,
      concurrency: binding.jobs.queues[queueType].concurrency,
      version: options.version,
      intervalMs: options.heartbeatIntervalMs,
      nowIso: options.nowIso,
    })))
    : [];

  const workers: Array<{ stop(): Promise<void> }> = [];
  for (const queueType of queueTypes) {
    const queue = binding.jobs.queues[queueType];
    for (let workerIndex = 0; workerIndex < queue.concurrency; workerIndex += 1) {
      const handle = await options.startWorker({ queueType, workerIndex, cancellation });
      if (handle && typeof handle === "object" && "stop" in handle && typeof handle.stop === "function") {
        workers.push(handle);
      }
    }
  }

  return {
    workerCount(): number {
      return workers.length;
    },
    async stop(): Promise<void> {
      cancellation.cancelForShutdown();
      const results = await Promise.allSettled([
        ...workers.map((worker) => worker.stop()),
        ...heartbeatLoops.map((loop) => loop.stop()),
      ]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new WorkerHostStopError(failures);
      }
    },
  };
}

export async function startNatsWorkerHostFromBinding<TResult>(
  binding: JobsRuntimeBinding,
  options: StartNatsWorkerHostOptions<TResult>,
): Promise<{ workerCount(): number; stop(): Promise<void> }> {
  return await startWorkerHostFromBinding(binding, {
    instanceId: options.instanceId,
    queueTypes: options.queueTypes,
    heartbeatPublisher: options.heartbeatPublisher,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    version: options.version,
    nowIso: options.nowIso,
    startWorker: async ({ queueType, cancellation }) => await startNatsQueueWorker({
      nats: options.nats,
      manager: options.manager,
      binding,
      queueType,
      hostCancellation: cancellation,
      validatePayload: options.validatePayload,
      validateResult: options.validateResult,
      handler: options.handler,
      jsm: options.jsm,
      js: options.js,
    }),
  });
}

async function ensureConsumerInfo(
  jsm: {
    consumers: {
      add(stream: string, config: Record<string, unknown>): Promise<unknown>;
      info(stream: string, consumer: string): Promise<unknown>;
    };
  },
  stream: string,
  queue: JobsQueueBinding,
): Promise<unknown> {
  const config = {
    durable_name: queue.consumerName,
    ack_policy: "explicit",
    filter_subject: queue.workSubject,
    ack_wait: queue.ackWaitMs * 1_000_000,
    max_deliver: queue.maxDeliver,
    backoff: queue.backoffMs.map((delay) => delay * 1_000_000),
  };

  try {
    return await jsm.consumers.add(stream, config);
  } catch {
    return await jsm.consumers.info(stream, queue.consumerName);
  }
}

function getQueueBinding(binding: JobsRuntimeBinding, queueType: string): JobsQueueBinding {
  const queue = binding.jobs.queues[queueType];
  if (!queue) {
    throw new Error(`Requested worker queue binding '${queueType}' is missing`);
  }
  if (queue.concurrency < 1) {
    throw new Error(`Worker queue '${queueType}' has invalid concurrency ${queue.concurrency}; expected >= 1`);
  }
  return queue;
}

function parseWorkPayloadEvent(payload: Uint8Array): JobEvent | undefined {
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as JobEvent;
  } catch {
    return undefined;
  }
}
