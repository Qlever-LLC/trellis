import { ulid } from "ulid";

import type { Job, JobEvent } from "./types.ts";

type Publisher = {
  publish(subject: string, payload: Uint8Array): void | Promise<void>;
};

type JobsBinding = {
  namespace: string;
  queues: Record<string, {
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
  }>;
};

type JobManagerContext = {
  nc: Publisher;
  jobs?: JobsBinding;
};

export class JobManager<TPayload = unknown, TResult = unknown> {
  readonly #context: JobManagerContext;

  constructor(context: JobManagerContext) {
    this.#context = context;
  }

  async create(type: string, payload: TPayload): Promise<Job<TPayload, TResult>> {
    const binding = this.#context.jobs?.queues[type];
    if (!binding || !this.#context.jobs) {
      throw new Error(`Missing jobs binding for queue '${type}'`);
    }

    const now = new Date().toISOString();
    const id = ulid();
    const job: Job<TPayload, TResult> = {
      id,
      service: this.#context.jobs.namespace,
      type,
      state: "pending",
      payload,
      createdAt: now,
      updatedAt: now,
      tries: 0,
      maxTries: binding.maxDeliver,
    };
    const event: JobEvent<TPayload, TResult> = {
      jobId: id,
      service: job.service,
      jobType: type,
      eventType: "created",
      state: "pending",
      tries: 0,
      maxTries: binding.maxDeliver,
      payload,
      timestamp: now,
    };

    await this.#context.nc.publish(
      `${binding.publishPrefix}.${id}.created`,
      new TextEncoder().encode(JSON.stringify(event)),
    );

    return job;
  }
}
