import type { TrellisBindingsGetOutput } from "@qlever-llc/trellis-sdk/core";

export type JobsQueueBinding = {
  queueType: string;
  publishPrefix: string;
  workSubject: string;
  consumerName: string;
  payload: { schema: string };
  result?: { schema: string };
  maxDeliver: number;
  backoffMs: number[];
  ackWaitMs: number;
  defaultDeadlineMs?: number;
  progress: boolean;
  logs: boolean;
  dlq: boolean;
  concurrency: number;
};

export type JobsBinding = {
  namespace: string;
  queues: Record<string, JobsQueueBinding>;
};

export type ResourceBindingJobsQueue = JobsQueueBinding;
export type ResourceBindingJobs = JobsBinding;

export type JobsRuntimeBinding = {
  jobs: JobsBinding;
  workStream: string;
};

export class JobsBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobsBindingError";
  }
}

export function parseJobsBinding(binding: Pick<ResourceBindingJobs, "namespace"> & { queues: Record<string, unknown> }): JobsBinding {
  const queues = Object.fromEntries(
    Object.entries(binding.queues).map(([queueType, queue]) => [
      queueType,
      normalizeQueueBinding(queueType, queue),
    ]),
  );

  return {
    namespace: binding.namespace,
    queues,
  };
}

export function jobsRuntimeBindingFromCoreBinding(
  binding: NonNullable<TrellisBindingsGetOutput["binding"]>,
): JobsRuntimeBinding {
  if (!binding.resources.jobs) {
    throw new JobsBindingError("Bindings response is missing resources.jobs");
  }
  const workStream = binding.resources.streams?.jobsWork?.name;
  if (!workStream) {
    throw new JobsBindingError("Bindings response is missing resources.streams.jobsWork");
  }

  const jobs = parseJobsBinding(binding.resources.jobs);
  return {
    workStream,
    jobs,
  };
}

function normalizeQueueBinding(
  queueType: string,
  value: unknown,
): JobsQueueBinding {
  if (!value || typeof value !== "object") {
    throw invalidQueueBinding(queueType, "binding must be an object");
  }
  const queue = value as Record<string, unknown>;

  return {
    queueType: expectString(queueType, queue.queueType ?? queueType, "queueType"),
    publishPrefix: expectString(queueType, queue.publishPrefix, "publishPrefix"),
    workSubject: expectString(queueType, queue.workSubject, "workSubject"),
    consumerName: expectString(queueType, queue.consumerName, "consumerName"),
    payload: normalizeSchema(queueType, queue.payload, "payload"),
    ...(queue.result === undefined ? {} : { result: normalizeSchema(queueType, queue.result, "result") }),
    maxDeliver: expectNonNegativeNumber(queueType, queue.maxDeliver, "maxDeliver"),
    backoffMs: expectNumberArray(queueType, queue.backoffMs, "backoffMs"),
    ackWaitMs: expectNonNegativeNumber(queueType, queue.ackWaitMs, "ackWaitMs"),
    ...(queue.defaultDeadlineMs === undefined
      ? {}
      : { defaultDeadlineMs: expectNonNegativeNumber(queueType, queue.defaultDeadlineMs, "defaultDeadlineMs") }),
    progress: expectBoolean(queueType, queue.progress, "progress"),
    logs: expectBoolean(queueType, queue.logs, "logs"),
    dlq: expectBoolean(queueType, queue.dlq, "dlq"),
    concurrency: expectU32(queueType, queue.concurrency, "concurrency"),
  };
}

function normalizeSchema(
  queueType: string,
  value: unknown,
  field: string,
): { schema: string } {
  if (!value || typeof value !== "object" || typeof (value as { schema?: unknown }).schema !== "string") {
    throw invalidQueueBinding(queueType, `${field} must be an object with string schema`);
  }
  return { schema: (value as { schema: string }).schema };
}

function expectString(queueType: string, value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidQueueBinding(queueType, `${field} must be a non-empty string`);
  }
  return value;
}

function expectBoolean(queueType: string, value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidQueueBinding(queueType, `${field} must be a boolean`);
  }
  return value;
}

function expectNonNegativeNumber(queueType: string, value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw invalidQueueBinding(queueType, `${field} must be a non-negative integer`);
  }
  return value;
}

function expectU32(queueType: string, value: unknown, field: string): number {
  const normalized = expectNonNegativeNumber(queueType, value, field);
  if (normalized > 0xFFFF_FFFF) {
    throw invalidQueueBinding(queueType, `${field} exceeds u32 range`);
  }
  return normalized;
}

function expectNumberArray(queueType: string, value: unknown, field: string): number[] {
  if (!Array.isArray(value)) {
    throw invalidQueueBinding(queueType, `${field} must be an array`);
  }
  return value.map((entry) => expectNonNegativeNumber(queueType, entry, field));
}

function invalidQueueBinding(queueType: string, details: string): JobsBindingError {
  return new JobsBindingError(
    `Invalid jobs queue binding for queue type '${queueType}': ${details}`,
  );
}
