import type { TrellisBindingsGetOutput } from "@qlever-llc/trellis-sdk-core";
import { assertEquals, assertThrows } from "@std/assert";
import type { ResourceBindingJobs } from "../server/service.ts";

import {
  jobsRuntimeBindingFromCoreBinding,
  parseJobsBinding,
} from "./bindings.ts";

function sampleJobsResource(): ResourceBindingJobs {
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
        backoffMs: [5000, 30000],
        ackWaitMs: 60000,
        defaultDeadlineMs: 120000,
        progress: true,
        logs: true,
        dlq: true,
        concurrency: 2,
      },
    },
  };
}

function sampleCoreBinding(): NonNullable<TrellisBindingsGetOutput["binding"]> {
  return {
    contractId: "trellis.jobs@v1",
    digest: "sha256:expected",
    resources: {
      jobs: sampleJobsResource(),
      kv: {
        jobsState: {
          bucket: "trellis_jobs",
          history: 1,
          ttlMs: 0,
        },
      },
      streams: {
        jobsWork: {
          name: "JOBS_WORK",
          subjects: ["trellis.work.>"],
        },
      },
    },
  };
}

Deno.test("parseJobsBinding maps queue values", () => {
  const binding = parseJobsBinding(sampleJobsResource());

  assertEquals(binding.namespace, "documents");
  assertEquals(binding.queues["document-process"], {
    queueType: "document-process",
    publishPrefix: "trellis.jobs.documents.document-process",
    workSubject: "trellis.work.documents.document-process",
    consumerName: "documents-document-process",
    payload: { schema: "DocumentPayload" },
    result: { schema: "DocumentResult" },
    maxDeliver: 5,
    backoffMs: [5000, 30000],
    ackWaitMs: 60000,
    defaultDeadlineMs: 120000,
    progress: true,
    logs: true,
    dlq: true,
    concurrency: 2,
  });
});

Deno.test("parseJobsBinding rejects invalid queue binding shapes", () => {
  assertThrows(
    () => parseJobsBinding({
      namespace: "documents",
      queues: {
        "document-process": {
          queueType: "document-process",
          publishPrefix: true,
        },
      },
    }),
    Error,
    "Invalid jobs queue binding for queue type 'document-process'",
  );
});

Deno.test("jobsRuntimeBindingFromCoreBinding maps work stream and queues only", () => {
  const runtime = jobsRuntimeBindingFromCoreBinding(sampleCoreBinding());

  assertEquals(runtime.workStream, "JOBS_WORK");
  assertEquals(runtime.jobs.namespace, "documents");
  assertEquals(runtime.jobs.queues["document-process"].defaultDeadlineMs, 120000);
});

Deno.test("parseJobsBinding and runtime binding share the same queue shape", () => {
  const parsed = parseJobsBinding(sampleJobsResource());
  const runtime = jobsRuntimeBindingFromCoreBinding(sampleCoreBinding());

  assertEquals(parsed.namespace, runtime.jobs.namespace);
  assertEquals(parsed.queues, runtime.jobs.queues);
});

Deno.test("jobsRuntimeBindingFromCoreBinding rejects missing jobs resource or jobsWork stream", () => {
  const missingJobs = sampleCoreBinding();
  delete missingJobs.resources.jobs;
  assertThrows(
    () => jobsRuntimeBindingFromCoreBinding(missingJobs),
    Error,
    "Bindings response is missing resources.jobs",
  );

  const missingWork = sampleCoreBinding();
  missingWork.resources.streams = {};
  assertThrows(
    () => jobsRuntimeBindingFromCoreBinding(missingWork),
    Error,
    "Bindings response is missing resources.streams.jobsWork",
  );
});

Deno.test("jobsRuntimeBindingFromCoreBinding rejects negative numeric queue fields", () => {
  const binding = sampleCoreBinding();
  if (!binding.resources.jobs) throw new Error("jobs missing");
  binding.resources.jobs.queues["document-process"].maxDeliver = -1;

  assertThrows(
    () => jobsRuntimeBindingFromCoreBinding(binding),
    Error,
    "Invalid jobs queue binding for queue type 'document-process'",
  );
});

Deno.test("jobsRuntimeBindingFromCoreBinding rejects concurrency beyond u32 range", () => {
  const binding = sampleCoreBinding();
  if (!binding.resources.jobs) throw new Error("jobs missing");
  binding.resources.jobs.queues["document-process"].concurrency = 0x1_0000_0000;

  assertThrows(
    () => jobsRuntimeBindingFromCoreBinding(binding),
    Error,
    "Invalid jobs queue binding for queue type 'document-process': concurrency exceeds u32 range",
  );
});
