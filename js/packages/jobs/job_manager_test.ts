import { assertEquals } from "@std/assert";

import { JobManager } from "./job-manager.ts";

Deno.test("JobManager.create publishes a created event to the queue subject prefix", async () => {
  const published: Array<{ subject: string; payload: unknown }> = [];
  const manager = new JobManager({
    nc: {
      publish(subject: string, payload: Uint8Array) {
        published.push({ subject, payload: JSON.parse(new TextDecoder().decode(payload)) });
      },
    },
    jobs: {
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
    },
  });

  const job = await manager.create("document-process", { documentId: "doc-1" });

  assertEquals(job.service, "documents");
  assertEquals(job.state, "pending");
  assertEquals(published.length, 1);
  assertEquals(published[0].subject, `trellis.jobs.documents.document-process.${job.id}.created`);
  assertEquals((published[0].payload as { payload: { documentId: string } }).payload.documentId, "doc-1");
});
