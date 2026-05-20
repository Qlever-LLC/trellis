import { assertEquals } from "@std/assert";
import { JobManager } from "./job-manager.ts";
import { startQueueWorkerLoop } from "./runtime-worker.ts";
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
