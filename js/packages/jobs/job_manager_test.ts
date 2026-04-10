import { assertEquals, assertRejects } from "@std/assert";

import {
  JobCancellationToken,
  JobManager,
  JobProcessError,
  type JobsBinding,
} from "./job-manager.ts";
import type { Job, JobEvent } from "./types.ts";

function sampleBindings(): JobsBinding {
  return {
    namespace: "documents",
    queues: {
      "document-process": {
        queueType: "document-process",
        publishPrefix: "trellis.jobs.documents.document-process",
        workSubject: "trellis.work.documents.document-process",
      consumerName: "documents-document-process",
      payload: { schema: "DocumentPayload" },
      result: { schema: "DocumentResult" },
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
    state: "pending",
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-28T11:59:00.000Z",
    updatedAt: "2026-03-28T11:59:00.000Z",
    tries: 0,
    maxTries: 2,
    ...overrides,
  };
}

Deno.test("JobManager.create publishes a created event to the queue subject prefix", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
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

  const job = await manager.create("document-process", { documentId: "doc-1" });

  assertEquals(job.service, "documents");
  assertEquals(job.state, "pending");
  assertEquals(published.length, 1);
  assertEquals(
    published[0].subject,
    `trellis.jobs.documents.document-process.${job.id}.created`,
  );
  assertEquals(
    (published[0].payload as { payload: { documentId: string } }).payload
      .documentId,
    "doc-1",
  );
});

Deno.test("JobManager.create applies default deadline to job and created event", async () => {
  const published: Array<{ subject: string; payload: JobEvent }> = [];
  const bindings = sampleBindings();
  bindings.queues["document-process"].defaultDeadlineMs = 120000;
  const manager = new JobManager({
    nc: {
      publish(subject: string, payload: Uint8Array) {
        published.push({
          subject,
          payload: JSON.parse(new TextDecoder().decode(payload)),
        });
      },
    },
    jobs: bindings,
    meta: {
      nextJobId: () => "job-1",
      nowIso: () => "2026-03-28T12:00:00.000Z",
    },
  });

  const job = await manager.create("document-process", { documentId: "doc-1" });

  assertEquals(job.deadline, "2026-03-28T12:02:00.000Z");
  assertEquals(published[0].payload.deadline, "2026-03-28T12:02:00.000Z");
});

Deno.test("JobManager.process success publishes started then completed and returns completed", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
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

  const outcome = await manager.process(
    sampleJob(),
    new JobCancellationToken(),
    () => Promise.resolve({ pages: 3 }),
  );

  assertEquals(outcome, {
    outcome: "completed",
    tries: 1,
    result: { pages: 3 },
  });
  assertEquals(published.length, 2);
  assertEquals(
    published[0].subject,
    "trellis.jobs.documents.document-process.job-1.started",
  );
  assertEquals(
    published[1].subject,
    "trellis.jobs.documents.document-process.job-1.completed",
  );

  const started = published[0].payload as JobEvent;
  assertEquals(started.eventType, "started");
  assertEquals(started.state, "active");
  assertEquals(started.previousState, "pending");
  assertEquals(started.tries, 1);

  const completed = published[1].payload as JobEvent;
  assertEquals(completed.eventType, "completed");
  assertEquals(completed.state, "completed");
  assertEquals(completed.previousState, "active");
  assertEquals(completed.tries, 1);
  assertEquals(completed.result, { pages: 3 });
});

Deno.test("JobManager.process result validation failure publishes started then failed", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
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

  const outcome = await manager.process(
    sampleJob(),
    new JobCancellationToken(),
    () => Promise.resolve({ pages: 3 }),
    {},
    {
      validateResult: (result: unknown) => {
        if ((result as { pages?: number }).pages !== 4) {
          throw new Error("result does not match DocumentResult");
        }
      },
    },
  );

  assertEquals(outcome, { outcome: "failed", tries: 1, error: "result does not match DocumentResult" });
  assertEquals(published.map((entry) => entry.subject), [
    "trellis.jobs.documents.document-process.job-1.started",
    "trellis.jobs.documents.document-process.job-1.failed",
  ]);
});

Deno.test("JobManager.process failure below max publishes started then retry and returns retry", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
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

  const outcome = await manager.process(
    sampleJob(),
    new JobCancellationToken(),
    () => {
      throw JobProcessError.retryable("transient failure");
    },
  );

  assertEquals(outcome, {
    outcome: "retry",
    tries: 1,
    error: "transient failure",
  });
  assertEquals(published.length, 2);
  assertEquals(
    published[0].subject,
    "trellis.jobs.documents.document-process.job-1.started",
  );
  assertEquals(
    published[1].subject,
    "trellis.jobs.documents.document-process.job-1.retry",
  );

  const retry = published[1].payload as JobEvent;
  assertEquals(retry.eventType, "retry");
  assertEquals(retry.state, "retry");
  assertEquals(retry.previousState, "active");
  assertEquals(retry.tries, 1);
  assertEquals(retry.error, "transient failure");
});

Deno.test("JobManager.process failure publishes started then failed and returns failed", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
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

  const outcome = await manager.process(
    sampleJob({ tries: 1, maxTries: 2 }),
    new JobCancellationToken(),
    () => {
      throw JobProcessError.failed("final failure");
    },
  );

  assertEquals(outcome, { outcome: "failed", tries: 2, error: "final failure" });
  assertEquals(published.length, 2);
  assertEquals(
    published[0].subject,
    "trellis.jobs.documents.document-process.job-1.started",
  );
  assertEquals(
    published[1].subject,
    "trellis.jobs.documents.document-process.job-1.failed",
  );

  const failed = published[1].payload as JobEvent;
  assertEquals(failed.eventType, "failed");
  assertEquals(failed.state, "failed");
  assertEquals(failed.previousState, "active");
  assertEquals(failed.tries, 2);
  assertEquals(failed.error, "final failure");
});

Deno.test("JobManager.process returns cancelled when token is cancelled before completion", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
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
  const cancellation = new JobCancellationToken();
  cancellation.cancel();

  const outcome = await manager.process(
    sampleJob(),
    cancellation,
    () => Promise.resolve({ ok: true }),
  );

  assertEquals(outcome, { outcome: "cancelled", tries: 1 });
  assertEquals(published.length, 1);
  assertEquals(published[0].subject, "trellis.jobs.documents.document-process.job-1.started");
});

Deno.test("JobManager.process returns interrupted on host shutdown without publishing terminal event", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
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
  const cancellation = new JobCancellationToken();
  cancellation.cancelForShutdown();

  const outcome = await manager.process(
    sampleJob(),
    cancellation,
    () => Promise.resolve({ ok: true }),
  );

  assertEquals(outcome, { outcome: "interrupted", tries: 1 });
  assertEquals(published.length, 1);
});

Deno.test("JobManager.process errors when queue binding is missing", async () => {
  const manager = new JobManager({
    nc: { publish() {} },
    jobs: {
      namespace: "documents",
      queues: {},
    },
  });

  await assertRejects(
    () => manager.process(sampleJob(), new JobCancellationToken(), () => Promise.resolve({ ok: true })),
    Error,
    "Missing jobs binding for queue 'document-process'",
  );
});

Deno.test("JobManager.process propagates publish errors", async () => {
  const manager = new JobManager({
    nc: {
      publish() {
        throw new Error("publish failed");
      },
    },
    jobs: sampleBindings(),
  });

  const error = await assertRejects(
    () => manager.process(sampleJob(), new JobCancellationToken(), () => Promise.resolve({ ok: true })),
  );

  assertEquals(error instanceof Error, true);
  assertEquals((error as Error).message, "publish failed");
});
