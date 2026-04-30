import { assertEquals } from "@std/assert";
import { JobManager } from "./job-manager.ts";
import { startQueueWorkerLoop } from "./runtime-worker.ts";
import type { Job } from "./types.ts";

Deno.test("startQueueWorkerLoop skips terminal projected jobs before processing", async () => {
  let acked = 0;
  let handled = 0;
  let unsubscribed = false;
  const job: Job = {
    id: "job-1",
    service: "svc",
    type: "refresh",
    state: "pending",
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
    tries: 0,
    maxTries: 5,
    payload: job.payload,
    timestamp: job.createdAt,
  };

  const loop = await startQueueWorkerLoop({
    manager: new JobManager({ nc: { publish: () => {} } }),
    consumer: {
      async consume() {
        return (async function* () {
          yield {
            data: new TextEncoder().encode(JSON.stringify(event)),
            subject: "trellis.work.svc.refresh",
            ack: () => {
              acked += 1;
            },
            nak: () => {},
            inProgress: () => {},
          };
        })();
      },
    },
    cancelSubscription: {
      unsubscribe: () => {
        unsubscribed = true;
      },
      async *[Symbol.asyncIterator]() {
        while (!unsubscribed) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      },
    },
    getProjectedJob: async () => ({ ...job, state: "cancelled" }),
    handler: async () => {
      handled += 1;
      return {};
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  await loop.stop();

  assertEquals(acked, 1);
  assertEquals(handled, 0);
});
