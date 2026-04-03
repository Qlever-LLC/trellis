import { assertEquals, assertRejects } from "@std/assert";

import { ActiveJobRuntimeError, JobCancellationToken, JobManager } from "./job-manager.ts";
import type { Job, JobEvent } from "./types.ts";

function sampleBindings() {
  return {
    namespace: "documents",
    queues: {
      "document-process": {
        queueType: "document-process",
        publishPrefix: "trellis.jobs.documents.document-process",
        workSubject: "trellis.work.documents.document-process",
        consumerName: "documents-document-process",
        payload: { schema: "DocumentPayload" },
        maxDeliver: 5,
        backoffMs: [5000],
        ackWaitMs: 60000,
        progress: true,
        logs: true,
        dlq: true,
        concurrency: 1,
      },
    },
  };
}

function sampleJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "active",
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-28T11:59:00.000Z",
    updatedAt: "2026-03-28T11:59:00.000Z",
    tries: 1,
    maxTries: 5,
    ...overrides,
  };
}

Deno.test("ActiveJob updateProgress publishes a progress event", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = new JobManager({
    nc: {
      publish(subject: string, payload: Uint8Array) {
        published.push({
          subject,
          payload: JSON.parse(new TextDecoder().decode(payload)),
        });
      },
    },
    jobs: sampleBindings(),
  });

  await manager.withActiveJob(
    sampleJob(),
    new JobCancellationToken(),
    async (job) => {
      await job.updateProgress({ step: "step 1", current: 1, total: 3 });
    },
  );

  assertEquals(published.length, 1);
  assertEquals(published[0].subject, "trellis.jobs.documents.document-process.job-1.progress");
  assertEquals(published[0].payload.eventType, "progress");
  assertEquals(published[0].payload.state, "active");
  assertEquals(published[0].payload.progress, { step: "step 1", current: 1, total: 3 });
});

Deno.test("ActiveJob log publishes a logged event", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const manager = new JobManager({
    nc: {
      publish(subject: string, payload: Uint8Array) {
        published.push({
          subject,
          payload: JSON.parse(new TextDecoder().decode(payload)),
        });
      },
    },
    jobs: sampleBindings(),
  });

  await manager.withActiveJob(
    sampleJob(),
    new JobCancellationToken(),
    async (job) => {
      await job.log("info", "started");
    },
  );

  assertEquals(published.length, 1);
  assertEquals(published[0].subject, "trellis.jobs.documents.document-process.job-1.logged");
  assertEquals(published[0].payload.eventType, "logged");
  assertEquals(published[0].payload.logs?.[0]?.message, "started");
  assertEquals(published[0].payload.logs?.[0]?.level, "info");
});

Deno.test("ActiveJob rejects progress when queue progress is disabled", async () => {
  const bindings = sampleBindings();
  bindings.queues["document-process"].progress = false;
  const manager = new JobManager({ nc: { publish() {} }, jobs: bindings });

  await assertRejects(
    () => manager.withActiveJob(sampleJob(), new JobCancellationToken(), async (job) => {
      await job.updateProgress({ step: "step 1", current: 1, total: 3 });
    }),
    Error,
    "Feature 'progress' is disabled",
  );
});

Deno.test("ActiveJob exposes cancellation state and signal", async () => {
  const manager = new JobManager({ nc: { publish() {} }, jobs: sampleBindings() });
  const cancellation = new JobCancellationToken();
  cancellation.cancel();

  const state = await manager.withActiveJob(sampleJob(), cancellation, async (job) => ({
    cancelled: job.isCancelled(),
    aborted: job.signal.aborted,
  }));

  assertEquals(state, { cancelled: true, aborted: true });
});

Deno.test("ActiveJob heartbeat calls runtime heartbeat hook", async () => {
  const manager = new JobManager({ nc: { publish() {} }, jobs: sampleBindings() });
  let heartbeats = 0;

  await manager.withActiveJobAndHeartbeat(
    sampleJob(),
    new JobCancellationToken(),
    async () => {
      heartbeats += 1;
    },
    async (job) => {
      await job.heartbeat();
    },
  );

  assertEquals(heartbeats, 1);
});

Deno.test("ActiveJob heartbeat errors without runtime hook", async () => {
  const manager = new JobManager({ nc: { publish() {} }, jobs: sampleBindings() });

  await assertRejects(
    () => manager.withActiveJob(sampleJob(), new JobCancellationToken(), async (job) => {
      await job.heartbeat();
    }),
    ActiveJobRuntimeError,
    "worker heartbeat unavailable",
  );
});

Deno.test("ActiveJob exposes redelivery metadata", async () => {
  const manager = new JobManager({ nc: { publish() {} }, jobs: sampleBindings() });

  const metadata = await manager.withActiveJobAndHeartbeat(
    sampleJob(),
    new JobCancellationToken(),
    async () => {},
    async (job) => ({
      redeliveryCount: job.redeliveryCount(),
      redelivered: job.isRedelivery(),
    }),
    { redeliveryCount: 2 },
  );

  assertEquals(metadata, { redeliveryCount: 2, redelivered: true });
});
