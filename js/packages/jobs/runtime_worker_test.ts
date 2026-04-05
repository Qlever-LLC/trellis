import { assert, assertEquals, assertRejects } from "@std/assert";
import type { Msg, NatsConnection, Subscription } from "@nats-io/nats-core";

import type { ActiveJob } from "./active-job.ts";
import type { JobsRuntimeBinding } from "./bindings.ts";
import { ActiveJobCancellationRegistry } from "./cancellation-registry.ts";
import { JobCancellationToken, JobManager, JobProcessError } from "./job-manager.ts";
import {
  ackActionForOutcome,
  processWorkPayload,
  processWorkPayloadWithContext,
  processWorkPayloadWithContextAndHeartbeat,
  projectedWorkDecision,
  startNatsQueueWorker,
  startNatsWorkerHostFromBinding,
  startQueueWorkerLoop,
  startWorkerHostFromBinding,
} from "./runtime-worker.ts";
import type { Job, JobEvent } from "./types.ts";

function sampleBindings(): JobsRuntimeBinding {
  return {
    workStream: "JOBS_WORK",
    jobs: {
      namespace: "documents",
      queues: {
        "document-process": {
          queueType: "document-process",
          publishPrefix: "trellis.jobs.documents.document-process",
          workSubject: "trellis.work.documents.document-process",
          consumerName: "documents-document-process",
          payload: { schema: "DocumentPayload" },
          result: { schema: "DocumentResult" },
          maxDeliver: 2,
          backoffMs: [5000],
          ackWaitMs: 60000,
          progress: true,
          logs: true,
          dlq: true,
          concurrency: 1,
        },
      },
    },
  };
}

function sampleManager<TResult>(published: Array<{ subject: string; payload: JobEvent }>) {
  return sampleManagerWithBinding<TResult>(published, sampleBindings().jobs);
}

function sampleManagerWithBinding<TResult>(
  published: Array<{ subject: string; payload: JobEvent }>,
  jobsBinding: JobsRuntimeBinding["jobs"],
) {
  return new JobManager<unknown, TResult>({
    nc: {
      publish(subject: string, payload: Uint8Array) {
        published.push({
          subject,
          payload: JSON.parse(new TextDecoder().decode(payload)),
        });
      },
    },
    jobs: jobsBinding,
    meta: {
      nextJobId: () => "job-1",
      nowIso: (() => {
        const times = [
          "2026-03-28T12:00:00.000Z",
          "2026-03-28T12:00:05.000Z",
          "2026-03-28T12:00:10.000Z",
        ];
        return () => times.shift() ?? "2026-03-28T12:00:10.000Z";
      })(),
    },
  });
}

function sampleWorkPayload(eventType: "created" | "retried" = "created"): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    jobId: "job-1",
    service: "documents",
    jobType: "document-process",
    eventType,
    state: "pending",
    ...(eventType === "retried" ? { previousState: "failed" } : {}),
    tries: 0,
    maxTries: 2,
    payload: { documentId: "doc-1" },
    timestamp: "2026-03-28T11:59:00.000Z",
  }));
}

function sampleProjectedJob(state: Job["state"]): Job {
  return {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state,
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-28T11:59:00.000Z",
    updatedAt: "2026-03-28T11:59:00.000Z",
    tries: 0,
    maxTries: 2,
  };
}

const documentPayloadSchemaRef = { schema: "DocumentPayload" };

class AsyncQueue<T> implements AsyncIterable<T> {
  readonly #values: T[] = [];
  readonly #resolvers: Array<(value: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) {
      return;
    }
    const resolver = this.#resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }
    this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    while (this.#resolvers.length > 0) {
      const resolver = this.#resolvers.shift();
      resolver?.({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) {
          return Promise.resolve({ value, done: false });
        }
        if (this.#closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => this.#resolvers.push(resolve));
      },
    };
  }
}

class FakeWorkMessages extends AsyncQueue<FakeWorkMessage> {
  stopped = false;

  stop(): void {
    this.stopped = true;
    this.close();
  }
}

class FakeWorkMessage {
  readonly data: Uint8Array;
  readonly subject: string;
  readonly info?: { redeliveryCount: number };
  acked = 0;
  naked = 0;
  heartbeats = 0;

  constructor(
    data: Uint8Array,
    subject = "trellis.work.documents.document-process",
    info?: { redeliveryCount: number },
  ) {
    this.data = data;
    this.subject = subject;
    this.info = info;
  }

  ack(): void {
    this.acked += 1;
  }

  nak(): void {
    this.naked += 1;
  }

  inProgress(): void {
    this.heartbeats += 1;
  }
}

class FakeSubscription extends AsyncQueue<Msg> implements Subscription {
  unsubscribed = false;
  closed = Promise.resolve<void | Error>(undefined);
  callback = (_err: Error | null, _msg: Msg) => {};

  override push(value: { subject: string; data: Uint8Array } | Msg): void {
    const msg: Msg = "sid" in value
      ? value
      : {
        subject: value.subject,
        data: value.data,
        sid: 0,
        respond: () => false,
        json: <T>() => JSON.parse(new TextDecoder().decode(value.data)) as T,
        string: () => new TextDecoder().decode(value.data),
      };
    super.push(msg);
  }

  unsubscribe(): void {
    this.unsubscribed = true;
    this.close();
  }

  async drain(): Promise<void> {
    this.unsubscribe();
  }

  isDraining(): boolean {
    return this.unsubscribed;
  }

  isClosed(): boolean {
    return this.unsubscribed;
  }

  getSubject(): string {
    return "";
  }

  getReceived(): number {
    return 0;
  }

  getProcessed(): number {
    return 0;
  }

  getPending(): number {
    return 0;
  }

  getID(): number {
    return 0;
  }

  getMax(): number | undefined {
    return undefined;
  }
}

function fakeNatsSubscriber(subscription: FakeSubscription, seen?: string[]): Pick<NatsConnection, "subscribe"> {
  return {
    subscribe(subject: string) {
      seen?.push(subject);
      return subscription;
    },
  };
}

Deno.test("processWorkPayload emits started and completed", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ pages: number }>(published);

  const outcome = await processWorkPayload(manager, sampleWorkPayload(), async () => ({ pages: 3 }));

  assertEquals(outcome, { outcome: "completed", tries: 1, result: { pages: 3 } });
  assertEquals(published.map((entry) => entry.subject), [
    "trellis.jobs.documents.document-process.job-1.started",
    "trellis.jobs.documents.document-process.job-1.completed",
  ]);
});

Deno.test("processWorkPayload emits retry for retryable failure", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<unknown>(published);

  const outcome = await processWorkPayload(manager, sampleWorkPayload(), async () => {
    throw JobProcessError.retryable("boom");
  });

  assertEquals(outcome, { outcome: "retry", tries: 1, error: "boom" });
  assertEquals(published[1]?.subject, "trellis.jobs.documents.document-process.job-1.retry");
});

Deno.test("processWorkPayload accepts retried work events", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);

  const outcome = await processWorkPayload(manager, sampleWorkPayload("retried"), async () => ({ ok: true }));

  assertEquals(outcome, { outcome: "completed", tries: 1, result: { ok: true } });
  assertEquals(published[0]?.payload.eventType, "started");
});

Deno.test("processWorkPayload returns undefined for invalid payload", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);

  const outcome = await processWorkPayload(manager, new TextEncoder().encode('{"not":"a-job"}'), async () => ({ ok: true }));

  assertEquals(outcome, undefined);
  assertEquals(published.length, 0);
});

Deno.test("processWorkPayloadWithContextAndHeartbeat validates payload before handler execution", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  let handled = false;

  const outcome = await processWorkPayloadWithContextAndHeartbeat(
    manager,
    sampleWorkPayload(),
    new JobCancellationToken(),
    async () => {},
    async () => {
      handled = true;
      return { ok: true };
    },
    {
      payloadSchema: documentPayloadSchemaRef,
      validatePayload: async ({ schema, job }: { schema?: { schema: string }; job: Job<unknown, { ok: boolean }> }) => {
        if (schema?.schema !== "DocumentPayload") {
          throw new Error("unexpected payload schema");
        }
        if ((job.payload as { documentId?: string }).documentId !== "allowed-doc") {
          throw new Error(`payload does not match ${schema.schema}`);
        }
      },
    },
  );

  assertEquals(handled, false);
  assertEquals(outcome, { outcome: "failed", tries: 1, error: "payload does not match DocumentPayload" });
  assertEquals(published.map((entry) => entry.subject), [
    "trellis.jobs.documents.document-process.job-1.started",
    "trellis.jobs.documents.document-process.job-1.failed",
  ]);
});

Deno.test("processWorkPayloadWithContext passes cancellation into handler", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ignored: boolean }>(published);
  const cancellation = new JobCancellationToken();
  cancellation.cancel();

  const outcome = await processWorkPayloadWithContext(manager, sampleWorkPayload(), cancellation, async (job: ActiveJob<unknown, { ignored: boolean }>) => {
    if (job.isCancelled()) {
      await job.updateProgress({ step: "cancelled", current: 1, total: 2 });
    }
    return { ignored: true };
  });

  assertEquals(outcome, { outcome: "cancelled", tries: 1 });
  assertEquals(published.length, 2);
  assertEquals(published[1]?.payload.eventType, "progress");
});

Deno.test("processWorkPayloadWithContextAndHeartbeat uses heartbeat hook without extra job event", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  let heartbeats = 0;

  const outcome = await processWorkPayloadWithContextAndHeartbeat(
    manager,
    sampleWorkPayload(),
    new JobCancellationToken(),
    async () => {
      heartbeats += 1;
    },
    async (job: ActiveJob<unknown, { ok: boolean }>) => {
      await job.heartbeat();
      return { ok: true };
    },
  );

  assertEquals(outcome, { outcome: "completed", tries: 1, result: { ok: true } });
  assertEquals(heartbeats, 1);
  assertEquals(published.length, 2);
});

Deno.test("ackActionForOutcome maps retry and interrupted to nak", () => {
  assertEquals(ackActionForOutcome({ outcome: "retry", tries: 1, error: "boom" }), "nak");
  assertEquals(ackActionForOutcome({ outcome: "interrupted", tries: 1 }), "nak");
  assertEquals(ackActionForOutcome({ outcome: "completed", tries: 1, result: { ok: true } }), "ack");
  assertEquals(ackActionForOutcome(undefined), "ack");
});

Deno.test("projectedWorkDecision skips terminal projected jobs and processes active ones", () => {
  assertEquals(projectedWorkDecision(sampleProjectedJob("completed"), sampleProjectedJob("pending")), "skip-ack");
  assertEquals(projectedWorkDecision(sampleProjectedJob("active"), sampleProjectedJob("pending")), "process");
  assertEquals(projectedWorkDecision(undefined, sampleProjectedJob("pending")), "process");
});

Deno.test("startWorkerHostFromBinding starts workers and per-job-type heartbeats", async () => {
  const binding = sampleBindings();
  binding.jobs.queues.thumbnail = {
    ...binding.jobs.queues["document-process"],
    queueType: "thumbnail",
    publishPrefix: "trellis.jobs.documents.thumbnail",
    workSubject: "trellis.work.documents.thumbnail",
    consumerName: "documents-thumbnail",
    concurrency: 2,
  };

  const started: string[] = [];
  const stopped: string[] = [];
  const heartbeats: Array<{ subject: string; payload: unknown }> = [];

  const host = await startWorkerHostFromBinding(binding, {
    instanceId: "instance-1",
    queueTypes: ["thumbnail"],
    heartbeatPublisher: {
      publish(subject: string, payload: Uint8Array) {
        heartbeats.push({ subject, payload: JSON.parse(new TextDecoder().decode(payload)) });
      },
    },
    version: "1.2.3",
    heartbeatIntervalMs: 5,
    nowIso: () => "2026-03-28T12:00:00.000Z",
    startWorker: async ({ queueType, workerIndex, cancellation }: { queueType: string; workerIndex: number; cancellation: JobCancellationToken }) => {
      started.push(`${queueType}:${workerIndex}:${cancellation.isCancelled()}`);
      return {
        async stop() {
          stopped.push(`${queueType}:${workerIndex}`);
        },
      };
    },
  });

  assertEquals(host.workerCount(), 2);
  await host.stop();

  assertEquals(started, ["thumbnail:0:false", "thumbnail:1:false"]);
  assertEquals(stopped, ["thumbnail:0", "thumbnail:1"]);
  assertEquals(heartbeats[0], {
    subject: "trellis.jobs.workers.documents.thumbnail.instance-1.heartbeat",
    payload: {
      service: "documents",
      jobType: "thumbnail",
      instanceId: "instance-1",
      concurrency: 2,
      version: "1.2.3",
      timestamp: "2026-03-28T12:00:00.000Z",
    },
  });
});

Deno.test("startWorkerHostFromBinding rejects missing queue or invalid concurrency", async () => {
  await assertRejects(
    () => startWorkerHostFromBinding(sampleBindings(), {
      instanceId: "instance-1",
      startWorker: async () => ({ async stop() {} }),
      queueTypes: ["missing"],
    }),
    Error,
    "Requested worker queue binding 'missing' is missing",
  );

  const binding = sampleBindings();
  binding.jobs.queues["document-process"].concurrency = 0;
  await assertRejects(
    () => startWorkerHostFromBinding(binding, {
      instanceId: "instance-1",
      startWorker: async () => ({ async stop() {} }),
    }),
    Error,
    "Worker queue 'document-process' has invalid concurrency 0; expected >= 1",
  );
});

Deno.test("startQueueWorkerLoop acks completed work and naks retryable work", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const completed = new FakeWorkMessage(sampleWorkPayload());
  const retried = new FakeWorkMessage(sampleWorkPayload());

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    handler: async (job: ActiveJob<unknown, { ok: boolean }>) => {
      if (job.job().id === "job-1" && completed.acked === 0) {
        return { ok: true };
      }
      throw JobProcessError.retryable("boom");
    },
  });

  messages.push(completed);
  messages.push(retried);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await loop.stop();

  assertEquals(completed.acked, 1);
  assertEquals(completed.naked, 0);
  assertEquals(retried.acked, 0);
  assertEquals(retried.naked, 1);
});

Deno.test("startQueueWorkerLoop skips and acks work already terminal in projection", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(sampleWorkPayload());
  let handled = false;

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    getProjectedJob: async () => sampleProjectedJob("completed"),
    handler: async () => {
      handled = true;
      return { ok: true };
    },
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await loop.stop();

  assertEquals(handled, false);
  assertEquals(message.acked, 1);
  assertEquals(message.naked, 0);
  assertEquals(published.length, 0);
});

Deno.test("startQueueWorkerLoop clears pending cancellation when terminal work is skip-acked", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  let projectionCalls = 0;
  let cancelled = false;

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    getProjectedJob: async () => {
      projectionCalls += 1;
      return projectionCalls === 1 ? sampleProjectedJob("completed") : undefined;
    },
    handler: async (job) => {
      cancelled = job.isCancelled();
      return { ok: true };
    },
  });

  cancels.push({
    subject: "trellis.jobs.documents.document-process.job-1.cancelled",
    data: new TextEncoder().encode(JSON.stringify({
      jobId: "job-1",
      service: "documents",
      jobType: "document-process",
      eventType: "cancelled",
      state: "cancelled",
      previousState: "active",
      tries: 1,
      timestamp: "2026-03-28T12:00:00.000Z",
    })),
  });
  messages.push(new FakeWorkMessage(sampleWorkPayload()));
  messages.push(new FakeWorkMessage(sampleWorkPayload()));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await loop.stop();

  assertEquals(cancelled, false);
});

Deno.test("startQueueWorkerLoop fails invalid payloads before handler execution", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(sampleWorkPayload());
  let handled = false;

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    payloadSchema: documentPayloadSchemaRef,
    validatePayload: async ({ schema, job }: { schema?: { schema: string }; job: Job<unknown, { ok: boolean }> }) => {
      if (schema?.schema !== "DocumentPayload") {
        throw new Error(`unexpected schema ${schema}`);
      }
      if ((job.payload as { documentId?: string }).documentId !== "allowed-doc") {
        throw new Error("payload does not match DocumentPayload");
      }
    },
    handler: async () => {
      handled = true;
      return { ok: true };
    },
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await loop.stop();

  assertEquals(handled, false);
  assertEquals(message.acked, 1);
  assertEquals(message.naked, 0);
  assertEquals(published.map((entry) => entry.subject), [
    "trellis.jobs.documents.document-process.job-1.started",
    "trellis.jobs.documents.document-process.job-1.failed",
  ]);
  assertEquals(published[1]?.payload.error, "payload does not match DocumentPayload");
});

Deno.test("startQueueWorkerLoop propagates cancel events through in-flight registry", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(sampleWorkPayload());
  let sawCancelled = false;

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    handler: async (job: ActiveJob<unknown, { ok: boolean }>) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      sawCancelled = job.isCancelled();
      return { ok: true };
    },
  });

  messages.push(message);
  cancels.push({
    subject: "trellis.jobs.documents.document-process.job-1.cancelled",
    data: new TextEncoder().encode(JSON.stringify({
      jobId: "job-1",
      service: "documents",
      jobType: "document-process",
      eventType: "cancelled",
      state: "cancelled",
      previousState: "active",
      tries: 1,
      timestamp: "2026-03-28T12:00:00.000Z",
    })),
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  await loop.stop();

  assertEquals(sawCancelled, true);
  assertEquals(message.acked, 1);
});

Deno.test("startQueueWorkerLoop stop triggers shutdown cancellation and unsubscribes", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(sampleWorkPayload());
  let sawShutdown = false;

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    handler: async (job: ActiveJob<unknown, { ok: boolean }>) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      sawShutdown = job.cancellationToken().isHostShutdown();
      return { ok: true };
    },
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await loop.stop();

  assertEquals(sawShutdown, true);
  assertEquals(cancels.unsubscribed, true);
  assertEquals(messages.stopped, true);
  assertEquals(message.naked, 1);
});

Deno.test("startQueueWorkerLoop stop surfaces background worker failures", async () => {
  const manager = sampleManager<{ ok: boolean }>([]);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    handler: async () => {
      throw new Error("unexpected worker failure");
    },
  });

  messages.push(new FakeWorkMessage(sampleWorkPayload()));
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assertRejects(
    () => loop.stop(),
    Error,
    "queue worker loop failed",
  );
});

Deno.test("startNatsQueueWorker creates durable consumer and subscribes to cancel subjects", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const added: Array<{ stream: string; config: Record<string, unknown> }> = [];
  const infos: Array<{ stream: string; consumer: string }> = [];
  const subscribed: string[] = [];
  const message = new FakeWorkMessage(sampleWorkPayload());

  const nc = fakeNatsSubscriber(cancels, subscribed);

  const worker = await startNatsQueueWorker({
    nats: nc,
    manager,
    binding: sampleBindings(),
    queueType: "document-process",
    jsm: {
      consumers: {
        async add(stream: string, config: Record<string, unknown>) {
          added.push({ stream, config });
          return { name: "documents-document-process" };
        },
        async info(stream: string, consumer: string) {
          infos.push({ stream, consumer });
          return { name: consumer };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo() {
          return {
            async consume() {
              return messages;
            },
          };
        },
      },
    },
    handler: async () => ({ ok: true }),
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await worker.stop();

  assertEquals(added, [{
    stream: "JOBS_WORK",
    config: {
      durable_name: "documents-document-process",
      ack_policy: "explicit",
      filter_subject: "trellis.work.documents.document-process",
      ack_wait: 60000000000,
      max_deliver: 2,
      backoff: [5000000000],
    },
  }]);
  assertEquals(infos, []);
  assertEquals(subscribed, ["trellis.jobs.documents.document-process.*.cancelled"]);
  assertEquals(message.acked, 1);
});

Deno.test("startNatsQueueWorker falls back to consumer info when add fails", async () => {
  const manager = sampleManager<{ ok: boolean }>([]);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const infos: Array<{ stream: string; consumer: string }> = [];

  const worker = await startNatsQueueWorker({
    nats: fakeNatsSubscriber(cancels),
    manager,
    binding: sampleBindings(),
    queueType: "document-process",
    jsm: {
      consumers: {
        async add() {
          throw new Error("exists");
        },
        async info(stream: string, consumer: string) {
          infos.push({ stream, consumer });
          return { name: consumer };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo() {
          return { async consume() { return messages; } };
        },
      },
    },
    handler: async () => ({ ok: true }),
  });

  await worker.stop();
  assertEquals(infos, [{ stream: "JOBS_WORK", consumer: "documents-document-process" }]);
});

Deno.test("startNatsQueueWorker passes payload validation into the worker loop", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(sampleWorkPayload());
  let validatedSchema = "";
  let handled = false;

  const worker = await startNatsQueueWorker({
    nats: fakeNatsSubscriber(cancels),
    manager,
    binding: sampleBindings(),
    queueType: "document-process",
    validatePayload: async (args: { schema?: { schema: string }; job: Job<unknown, { ok: boolean }> }) => {
      validatedSchema = args.schema?.schema ?? "";
      if ((args.job.payload as { documentId?: string }).documentId !== "allowed-doc") {
        throw new Error(`payload does not match ${args.schema?.schema}`);
      }
    },
    jsm: {
      consumers: {
        async add() {
          return { name: "documents-document-process" };
        },
        async info() {
          return { name: "documents-document-process" };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo() {
          return { async consume() { return messages; } };
        },
      },
    },
    handler: async () => {
      handled = true;
      return { ok: true };
    },
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await worker.stop();

  assertEquals(validatedSchema, "DocumentPayload");
  assertEquals(handled, false);
  assertEquals(message.acked, 1);
  assertEquals(published.map((entry) => entry.subject), [
    "trellis.jobs.documents.document-process.job-1.started",
    "trellis.jobs.documents.document-process.job-1.failed",
  ]);
});

Deno.test("startNatsQueueWorker passes result validation into the worker loop", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ pages: number }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(new TextEncoder().encode(JSON.stringify({
    jobId: "job-1",
    service: "documents",
    jobType: "document-process",
    eventType: "created",
    state: "pending",
    tries: 0,
    maxTries: 2,
    payload: { documentId: "allowed-doc" },
    timestamp: "2026-03-28T11:59:00.000Z",
  })));
  let validatedSchema = "";
  let handled = false;

  const worker = await startNatsQueueWorker({
    nats: fakeNatsSubscriber(cancels),
    manager,
    binding: sampleBindings(),
    queueType: "document-process",
    validatePayload: async () => {},
    validateResult: async ({ schema, result }) => {
      validatedSchema = schema?.schema ?? "";
      if (result.pages !== 4) {
        throw new Error(`result does not match ${schema?.schema}`);
      }
    },
    jsm: {
      consumers: {
        async add() {
          return { name: "documents-document-process" };
        },
        async info() {
          return { name: "documents-document-process" };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo() {
          return { async consume() { return messages; } };
        },
      },
    },
    handler: async () => {
      handled = true;
      return { pages: 3 };
    },
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await worker.stop();

  assertEquals(validatedSchema, "DocumentResult");
  assertEquals(handled, true);
  assertEquals(message.acked, 1);
  assertEquals(published.map((entry) => entry.subject), [
    "trellis.jobs.documents.document-process.job-1.started",
    "trellis.jobs.documents.document-process.job-1.failed",
  ]);
});

Deno.test("startNatsQueueWorker runs validator then handler on valid payload", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(new TextEncoder().encode(JSON.stringify({
    jobId: "job-1",
    service: "documents",
    jobType: "document-process",
    eventType: "created",
    state: "pending",
    tries: 0,
    maxTries: 2,
    payload: { documentId: "allowed-doc" },
    timestamp: "2026-03-28T11:59:00.000Z",
  })));
  const calls: string[] = [];

  const worker = await startNatsQueueWorker({
    nats: fakeNatsSubscriber(cancels),
    manager,
    binding: sampleBindings(),
    queueType: "document-process",
    validatePayload: async ({ schema, job }: { schema?: { schema: string }; job: Job<unknown, { ok: boolean }> }) => {
      calls.push(`validate:${schema?.schema}:${(job.payload as { documentId?: string }).documentId}`);
    },
    jsm: {
      consumers: {
        async add() {
          return { name: "documents-document-process" };
        },
        async info() {
          return { name: "documents-document-process" };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo() {
          return { async consume() { return messages; } };
        },
      },
    },
    handler: async () => {
      calls.push("handle");
      return { ok: true };
    },
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await worker.stop();

  assertEquals(calls, ["validate:DocumentPayload:allowed-doc", "handle"]);
  assertEquals(message.acked, 1);
  assertEquals(published.map((entry) => entry.subject), [
    "trellis.jobs.documents.document-process.job-1.started",
    "trellis.jobs.documents.document-process.job-1.completed",
  ]);
});

Deno.test("startQueueWorkerLoop exposes redelivery metadata to handlers", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const message = new FakeWorkMessage(sampleWorkPayload(), undefined, { redeliveryCount: 2 });
  let seen: { redeliveryCount: number; redelivered: boolean } | undefined;

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    handler: async (job) => {
      seen = {
        redeliveryCount: job.redeliveryCount(),
        redelivered: job.isRedelivery(),
      };
      return { ok: true };
    },
  });

  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await loop.stop();

  assertEquals(seen, { redeliveryCount: 2, redelivered: true });
});

Deno.test("startNatsWorkerHostFromBinding wires validator into spawned queue workers", async () => {
  const binding = sampleBindings();
  binding.jobs.queues.thumbnail = {
    ...binding.jobs.queues["document-process"],
    queueType: "thumbnail",
    publishPrefix: "trellis.jobs.documents.thumbnail",
    workSubject: "trellis.work.documents.thumbnail",
    consumerName: "documents-thumbnail",
  };
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManagerWithBinding<{ ok: boolean }>(published, binding.jobs);
  const messagesByQueue = new Map<string, FakeWorkMessages>([
    ["document-process", new FakeWorkMessages()],
    ["thumbnail", new FakeWorkMessages()],
  ]);
  const cancels = new FakeSubscription();
  const validations: string[] = [];

  const host = await startNatsWorkerHostFromBinding(binding, {
    nats: fakeNatsSubscriber(cancels),
    instanceId: "instance-1",
    manager,
    validatePayload: async ({ schema }: { schema?: { schema: string }; job: Job<unknown, { ok: boolean }> }) => {
      validations.push(schema?.schema ?? "");
    },
    jsm: {
      consumers: {
        async add(_stream: string, config: Record<string, unknown>) {
          return { name: config.durable_name };
        },
        async info(_stream: string, consumer: string) {
          return { name: consumer };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo(info: { name: string }) {
          const queueType = info.name === "documents-thumbnail" ? "thumbnail" : "document-process";
          return { async consume() { return messagesByQueue.get(queueType)!; } };
        },
      },
    },
    handler: async () => ({ ok: true }),
  });

  messagesByQueue.get("document-process")?.push(new FakeWorkMessage(new TextEncoder().encode(JSON.stringify({
    jobId: "job-1",
    service: "documents",
    jobType: "document-process",
    eventType: "created",
    state: "pending",
    tries: 0,
    maxTries: 2,
    payload: { documentId: "allowed-doc" },
    timestamp: "2026-03-28T11:59:00.000Z",
  }))));
  messagesByQueue.get("thumbnail")?.push(new FakeWorkMessage(new TextEncoder().encode(JSON.stringify({
    jobId: "job-2",
    service: "documents",
    jobType: "thumbnail",
    eventType: "created",
    state: "pending",
    tries: 0,
    maxTries: 2,
    payload: { documentId: "allowed-doc" },
    timestamp: "2026-03-28T11:59:00.000Z",
  })), "trellis.work.documents.thumbnail"));
  await new Promise((resolve) => setTimeout(resolve, 15));
  await host.stop();

  assertEquals(validations.sort(), ["DocumentPayload", "DocumentPayload"]);
});

Deno.test("startNatsWorkerHostFromBinding propagates host shutdown to in-flight workers promptly", async () => {
  const binding = sampleBindings();
  binding.jobs.queues.thumbnail = {
    ...binding.jobs.queues["document-process"],
    queueType: "thumbnail",
    publishPrefix: "trellis.jobs.documents.thumbnail",
    workSubject: "trellis.work.documents.thumbnail",
    consumerName: "documents-thumbnail",
  };
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManagerWithBinding<{ ok: boolean }>(published, binding.jobs);
  const messagesByQueue = new Map<string, FakeWorkMessages>([
    ["document-process", new FakeWorkMessages()],
    ["thumbnail", new FakeWorkMessages()],
  ]);
  const subscriptions: FakeSubscription[] = [];
  const sawShutdown = new Map<string, boolean>();

  const host = await startNatsWorkerHostFromBinding(binding, {
    nats: {
      subscribe() {
        const sub = new FakeSubscription();
        subscriptions.push(sub);
        return sub;
      },
    },
    instanceId: "instance-1",
    manager,
    jsm: {
      consumers: {
        async add(_stream: string, config: Record<string, unknown>) {
          return { name: config.durable_name };
        },
        async info(_stream: string, consumer: string) {
          return { name: consumer };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo(info: { name: string }) {
          const queueType = info.name === "documents-thumbnail" ? "thumbnail" : "document-process";
          return { async consume() { return messagesByQueue.get(queueType)!; } };
        },
      },
    },
    handler: async (job) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      sawShutdown.set(job.job().type, job.cancellationToken().isHostShutdown());
      return { ok: true };
    },
  });

  messagesByQueue.get("document-process")?.push(new FakeWorkMessage(sampleWorkPayload()));
  messagesByQueue.get("thumbnail")?.push(new FakeWorkMessage(new TextEncoder().encode(JSON.stringify({
    jobId: "job-2",
    service: "documents",
    jobType: "thumbnail",
    eventType: "created",
    state: "pending",
    tries: 0,
    maxTries: 2,
    payload: { documentId: "allowed-doc" },
    timestamp: "2026-03-28T11:59:00.000Z",
  })), "trellis.work.documents.thumbnail"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await host.stop();

  assertEquals(sawShutdown.get("document-process"), true);
  assertEquals(sawShutdown.get("thumbnail"), true);
  assertEquals(subscriptions.every((sub) => sub.unsubscribed), true);
});

Deno.test("startNatsWorkerHostFromBinding stops consuming new work after shutdown begins", async () => {
  const binding = sampleBindings();
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManagerWithBinding<{ ok: boolean }>(published, binding.jobs);
  const messages = new FakeWorkMessages();
  const subscriptions: FakeSubscription[] = [];
  const startedJobs: string[] = [];

  const host = await startNatsWorkerHostFromBinding(binding, {
    nats: {
      subscribe() {
        const sub = new FakeSubscription();
        subscriptions.push(sub);
        return sub;
      },
    },
    instanceId: "instance-1",
    manager,
    jsm: {
      consumers: {
        async add(_stream: string, config: Record<string, unknown>) {
          return { name: config.durable_name };
        },
        async info(_stream: string, consumer: string) {
          return { name: consumer };
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo() {
          return { async consume() { return messages; } };
        },
      },
    },
    handler: async (job) => {
      startedJobs.push(job.job().id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true };
    },
  });

  messages.push(new FakeWorkMessage(sampleWorkPayload()));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const stopping = host.stop();
  messages.push(new FakeWorkMessage(new TextEncoder().encode(JSON.stringify({
    jobId: "job-2",
    service: "documents",
    jobType: "document-process",
    eventType: "created",
    state: "pending",
    tries: 0,
    maxTries: 2,
    payload: { documentId: "allowed-doc" },
    timestamp: "2026-03-28T11:59:00.000Z",
  }))));
  await stopping;

  assertEquals(startedJobs, ["job-1"]);
  assertEquals(subscriptions.every((sub) => sub.unsubscribed), true);
});

Deno.test("startQueueWorkerLoop does not start work once host shutdown is active", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = sampleManager<{ ok: boolean }>(published);
  const messages = new FakeWorkMessages();
  const cancels = new FakeSubscription();
  const hostCancellation = new JobCancellationToken();
  const message = new FakeWorkMessage(sampleWorkPayload());
  let handled = false;

  const loop = await startQueueWorkerLoop({
    manager,
    consumer: { async consume() { return messages; } },
    cancelSubscription: cancels,
    hostCancellation,
    handler: async () => {
      handled = true;
      return { ok: true };
    },
  });

  hostCancellation.cancelForShutdown();
  messages.push(message);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await loop.stop();

  assertEquals(handled, false);
  assertEquals(message.acked, 0);
  assertEquals(message.naked, 0);
  assertEquals(published.length, 0);
});
