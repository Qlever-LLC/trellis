import type { NatsConnection } from "@nats-io/nats-core";
import { assertEquals, assertRejects } from "@std/assert";
import type { JobKeyCoordinator } from "./key-coordinator.ts";
import { JobManager } from "./job-manager.ts";
import {
  ackActionForOutcome,
  JobsInfrastructureMissingError,
  startNatsQueueWorker,
  startQueueWorkerLoop,
} from "./runtime-worker.ts";
import type { Job, JobContext } from "./types.ts";

const jobContext: JobContext = {
  requestId: "request-1",
  traceId: "0123456789abcdef0123456789abcdef",
  traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
};

const jobsBinding = {
  namespace: "svc",
  queues: {
    refresh: {
      queueType: "refresh",
      publishPrefix: "trellis.jobs.svc.refresh",
      workSubject: "trellis.work.svc.refresh",
      consumerName: "svc-refresh",
      payload: { schema: "RefreshPayload" },
      maxDeliver: 5,
      backoffMs: [1],
      ackWaitMs: 1_000,
      progress: true,
      logs: true,
      dlq: true,
      concurrency: 1,
    },
  },
};

const keyedJobsBinding = {
  namespace: "svc",
  queues: {
    sync: {
      queueType: "sync",
      publishPrefix: "trellis.jobs.svc.sync",
      workSubject: "trellis.work.svc.sync",
      consumerName: "svc-sync",
      payload: { schema: "SyncPayload" },
      maxDeliver: 5,
      backoffMs: [2_500],
      ackWaitMs: 1_000,
      progress: true,
      logs: true,
      dlq: true,
      concurrency: 1,
      keyConcurrency: {
        key: ["/tenant"],
        maxActive: 1,
        heartbeatIntervalMs: 30_000,
        heartbeatTtlMs: 120_000,
        stalePolicy: "fail-stale" as const,
      },
      queue: { maxQueuedPerKey: 0, whenFull: "reject" as const },
    },
  },
};

Deno.test("ackActionForOutcome naks keyed deferred work", () => {
  assertEquals(
    ackActionForOutcome({
      outcome: "deferred",
      tries: 1,
      reason: "active-limit",
    }),
    "nak",
  );
});

function cancelSubscription(unsubscribe: () => void): {
  unsubscribe(): void;
  [Symbol.asyncIterator](): AsyncIterator<
    { subject: string; data: Uint8Array }
  >;
} {
  let unsubscribed = false;
  return {
    unsubscribe: () => {
      unsubscribed = true;
      unsubscribe();
    },
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (!unsubscribed) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

Deno.test("startQueueWorkerLoop skips terminal projected jobs before processing", async () => {
  let acked = 0;
  let handled = 0;
  const job: Job = {
    id: "job-1",
    service: "svc",
    type: "refresh",
    state: "pending",
    context: jobContext,
    payload: { siteId: "site-1" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tries: 0,
    maxTries: 5,
  };
  const event = {
    jobId: job.id,
    service: job.service,
    jobType: job.type,
    eventType: "created",
    state: "pending",
    context: jobContext,
    tries: 0,
    maxTries: 5,
    payload: job.payload,
    timestamp: job.createdAt,
  };

  const loop = await startQueueWorkerLoop({
    manager: new JobManager({ nc: { publish: () => {} }, jobs: jobsBinding }),
    consumer: {
      consume() {
        return Promise.resolve((async function* () {
          yield {
            data: new TextEncoder().encode(JSON.stringify(event)),
            subject: "trellis.work.svc.refresh",
            ack: () => {
              acked += 1;
            },
            nak: () => {},
            inProgress: () => {},
          };
        })());
      },
    },
    cancelSubscription: cancelSubscription(() => {}),
    getProjectedJob: () => Promise.resolve({ ...job, state: "cancelled" }),
    handler: () => {
      handled += 1;
      return Promise.resolve({});
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await loop.stop();

  assertEquals(acked, 1);
  assertEquals(handled, 0);
});

Deno.test("startQueueWorkerLoop prefers latest lifecycle event over stale projection", async () => {
  let acked = 0;
  let handled = 0;
  const job: Job = {
    id: "job-2",
    service: "svc",
    type: "refresh",
    state: "pending",
    context: jobContext,
    payload: { siteId: "site-2" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tries: 0,
    maxTries: 5,
  };
  const event = {
    jobId: job.id,
    service: job.service,
    jobType: job.type,
    eventType: "created",
    state: "pending",
    context: jobContext,
    tries: 0,
    maxTries: 5,
    payload: job.payload,
    timestamp: job.createdAt,
  };

  const loop = await startQueueWorkerLoop({
    manager: new JobManager({ nc: { publish: () => {} }, jobs: jobsBinding }),
    consumer: {
      consume() {
        return Promise.resolve((async function* () {
          yield {
            data: new TextEncoder().encode(JSON.stringify(event)),
            subject: "trellis.work.svc.refresh",
            ack: () => {
              acked += 1;
            },
            nak: () => {},
            inProgress: () => {},
          };
        })());
      },
    },
    cancelSubscription: cancelSubscription(() => {}),
    getLatestLifecycleEvent: () =>
      Promise.resolve({
        ...event,
        eventType: "started",
        state: "active",
      }),
    getProjectedJob: () => Promise.resolve({ ...job, state: "cancelled" }),
    handler: () => {
      handled += 1;
      return Promise.resolve({});
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await loop.stop();

  assertEquals(acked, 1);
  assertEquals(handled, 1);
});

Deno.test("startQueueWorkerLoop cleans queued key state for terminal lifecycle before ack", async () => {
  let acked = 0;
  let handled = 0;
  let removed = 0;
  const job: Job = {
    id: "job-skipped",
    service: "svc",
    type: "sync",
    state: "pending",
    context: jobContext,
    payload: { tenant: "a" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tries: 0,
    maxTries: 5,
  };
  const event = createdEvent(job);
  const coordinator: JobKeyCoordinator = {
    admitCreate: () => Promise.reject(new Error("unexpected admit")),
    restoreReplacedQueuedJob: () =>
      Promise.reject(new Error("unexpected restore")),
    removeQueuedJob: () => {
      removed += 1;
      return Promise.resolve({
        kind: "removed",
        state: {
          version: 1,
          service: "svc",
          jobType: "sync",
          key: "a",
          keyHash: "hash",
          maxActive: 1,
          active: [],
          queued: [],
          staleTakeoverCount: 0,
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      });
    },
    acquireActiveSlot: () => Promise.reject(new Error("unexpected acquire")),
    renewHeartbeat: () => Promise.reject(new Error("unexpected renew")),
    releaseActiveSlot: () => Promise.reject(new Error("unexpected release")),
  };

  const loop = await startQueueWorkerLoop({
    manager: new JobManager({
      nc: { publish: () => {} },
      jobs: keyedJobsBinding,
      keyCoordinator: coordinator,
    }),
    consumer: {
      consume() {
        return Promise.resolve((async function* () {
          yield {
            data: new TextEncoder().encode(JSON.stringify(event)),
            subject: "trellis.work.svc.sync",
            ack: () => {
              acked += 1;
            },
            nak: () => {},
            inProgress: () => {},
          };
        })());
      },
    },
    cancelSubscription: cancelSubscription(() => {}),
    getLatestLifecycleEvent: () =>
      Promise.resolve({
        ...event,
        eventType: "skipped",
        state: "skipped",
      }),
    handler: () => {
      handled += 1;
      return Promise.resolve({});
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await loop.stop();

  assertEquals(acked, 1);
  assertEquals(handled, 0);
  assertEquals(removed, 1);
});

Deno.test("startQueueWorkerLoop delays NAK for keyed active-limit deferrals", async () => {
  const nakDelays: Array<number | undefined> = [];
  let handled = 0;
  const job: Job = {
    id: "job-deferred",
    service: "svc",
    type: "sync",
    state: "pending",
    context: jobContext,
    payload: { tenant: "a" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    tries: 0,
    maxTries: 5,
  };
  const event = createdEvent(job);
  const coordinator: JobKeyCoordinator = {
    admitCreate: () => Promise.reject(new Error("unexpected admit")),
    restoreReplacedQueuedJob: () =>
      Promise.reject(new Error("unexpected restore")),
    removeQueuedJob: () => Promise.reject(new Error("unexpected remove")),
    acquireActiveSlot: () =>
      Promise.resolve({
        kind: "blocked",
        key: "a",
        reason: "active-limit",
        active: 1,
        queued: 1,
        limit: 1,
      }),
    renewHeartbeat: () => Promise.reject(new Error("unexpected renew")),
    releaseActiveSlot: () => Promise.reject(new Error("unexpected release")),
  };

  const loop = await startQueueWorkerLoop({
    manager: new JobManager({
      nc: { publish: () => {} },
      jobs: keyedJobsBinding,
      keyCoordinator: coordinator,
    }),
    consumer: {
      consume() {
        return Promise.resolve((async function* () {
          yield {
            data: new TextEncoder().encode(JSON.stringify(event)),
            subject: "trellis.work.svc.sync",
            ack: () => {},
            nak: (delay?: number) => {
              nakDelays.push(delay);
            },
            inProgress: () => {},
          };
        })());
      },
    },
    cancelSubscription: cancelSubscription(() => {}),
    deferralBackoffMs: 2_500,
    handler: () => {
      handled += 1;
      return Promise.resolve({});
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await loop.stop();

  assertEquals(handled, 0);
  assertEquals(nakDelays, [2_500]);
});

Deno.test("startNatsQueueWorker reads approved existing consumer only", async () => {
  const requestedConsumers: Array<{ stream: string; consumerName: string }> =
    [];

  const worker = await startNatsQueueWorker({
    nats: {
      subscribe(): ReturnType<NatsConnection["subscribe"]> {
        return cancelSubscription(() => {}) as ReturnType<
          NatsConnection["subscribe"]
        >;
      },
    },
    jsm: {
      consumers: {
        info(stream, consumerName) {
          requestedConsumers.push({ stream, consumerName });
          return Promise.resolve({ config: {} });
        },
      },
    },
    js: {
      consumers: {
        getConsumerFromInfo() {
          return {
            consume() {
              return Promise.resolve((async function* () {})());
            },
          };
        },
      },
    },
    manager: new JobManager({ nc: { publish: () => {} }, jobs: jobsBinding }),
    binding: { jobs: jobsBinding, workStream: "JOBS_WORK" },
    queueType: "refresh",
    handler: () => Promise.resolve({}),
  });

  await worker.stop();

  assertEquals(requestedConsumers, [{
    stream: "JOBS_WORK",
    consumerName: "svc-refresh",
  }]);
});

function createdEvent(job: Job) {
  return {
    jobId: job.id,
    service: job.service,
    jobType: job.type,
    eventType: "created" as const,
    state: "pending" as const,
    context: job.context,
    tries: 0,
    maxTries: job.maxTries,
    payload: job.payload,
    timestamp: job.createdAt,
  };
}

Deno.test("startNatsQueueWorker fails closed when approved consumer is missing", async () => {
  await assertRejects(
    () =>
      startNatsQueueWorker({
        nats: {
          subscribe(): ReturnType<NatsConnection["subscribe"]> {
            return cancelSubscription(() => {}) as ReturnType<
              NatsConnection["subscribe"]
            >;
          },
        },
        jsm: {
          consumers: {
            info() {
              const error = new Error("consumer not found");
              error.name = "ConsumerNotFoundError";
              return Promise.reject(error);
            },
          },
        },
        js: {
          consumers: {
            getConsumerFromInfo() {
              throw new Error("consumer should not be built");
            },
          },
        },
        manager: new JobManager({
          nc: { publish: () => {} },
          jobs: jobsBinding,
        }),
        binding: { jobs: jobsBinding, workStream: "JOBS_WORK" },
        queueType: "refresh",
        handler: () => Promise.resolve({}),
      }),
    JobsInfrastructureMissingError,
    "Jobs work stream 'JOBS_WORK' was not found while starting queue 'refresh'",
  );
});
