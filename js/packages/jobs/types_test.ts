import { assert, assertFalse } from "@std/assert";
import Value from "typebox/value";

import {
  JobEventSchema,
  JobSchema,
  JobStateSchema,
  JobsDismissDLQRequestSchema,
  JobsDismissDLQResponseSchema,
  JobsHealthRequestSchema,
  JobsHealthResponseSchema,
  JobsListDLQRequestSchema,
  JobsListDLQResponseSchema,
  JobsListServicesResponseSchema,
  JobsReplayDLQRequestSchema,
  JobsReplayDLQResponseSchema,
  ServiceInfoSchema,
  WorkerHeartbeatSchema,
} from "./types.ts";

const job = {
  id: "job-1",
  service: "documents",
  type: "document-process",
  state: "dismissed",
  payload: { documentId: "doc-1" },
  createdAt: "2026-03-28T11:59:00.000Z",
  updatedAt: "2026-03-28T12:00:00.000Z",
  tries: 2,
  maxTries: 5,
};

Deno.test("job handwritten schemas accept dismissed state and event types", () => {
  assert(Value.Check(JobStateSchema, "dismissed"));
  assert(Value.Check(JobSchema, job));
  assert(Value.Check(JobEventSchema, {
    jobId: "job-1",
    service: "documents",
    jobType: "document-process",
    eventType: "dismissed",
    state: "dismissed",
    previousState: "dead",
    tries: 2,
    timestamp: "2026-03-28T12:00:00.000Z",
  }));
  assertFalse(Value.Check(JobEventSchema, {
    jobId: "job-1",
    service: "documents",
    jobType: "document-process",
    eventType: "dismissed",
    state: "unknown",
    tries: 2,
    timestamp: "2026-03-28T12:00:00.000Z",
  }));
});

Deno.test("jobs handwritten health schemas validate request and response", () => {
  assert(Value.Check(JobsHealthRequestSchema, {}));
  assert(Value.Check(JobsHealthResponseSchema, {
    status: "healthy",
    service: "jobs",
    timestamp: "2026-03-28T12:00:00.000Z",
    checks: [{
      name: "kv",
      status: "ok",
      latencyMs: 12,
    }],
  }));
  assertFalse(Value.Check(JobsHealthResponseSchema, {
    status: "ok",
    service: "jobs",
    timestamp: "2026-03-28T12:00:00.000Z",
    checks: [],
  }));
});

Deno.test("jobs handwritten worker presence schemas accept workers and reject outdated instance shapes", () => {
  const worker = {
    service: "documents",
    jobType: "document-process",
    instanceId: "worker-1",
    concurrency: 2,
    version: "0.6.0",
    timestamp: "2026-03-30T12:00:00.000Z",
  };

  assert(Value.Check(WorkerHeartbeatSchema, worker));
  assert(Value.Check(ServiceInfoSchema, {
    name: "documents",
    healthy: true,
    workers: [worker],
  }));
  assert(Value.Check(JobsListServicesResponseSchema, {
    services: [{
      name: "documents",
      healthy: true,
      workers: [worker],
    }],
  }));

  assertFalse(Value.Check(ServiceInfoSchema, {
    name: "documents",
    healthy: true,
    instances: [{
      service: "documents",
      instanceId: "worker-1",
      jobTypes: ["document-process"],
      registeredAt: "2026-03-30T11:59:00.000Z",
      heartbeatAt: "2026-03-30T12:00:00.000Z",
    }],
  }));
});

Deno.test("jobs handwritten DLQ admin schemas validate request and response payloads", () => {
  const request = {
    service: "documents",
    jobType: "document-process",
    id: "job-1",
  };

  assert(Value.Check(JobsListDLQRequestSchema, {
    service: "documents",
    type: "document-process",
    state: ["dead"],
    since: "2026-03-28T12:00:00.000Z",
    limit: 10,
  }));
  assert(Value.Check(JobsListDLQResponseSchema, {
    jobs: [job],
  }));
  assert(Value.Check(JobsReplayDLQRequestSchema, request));
  assert(Value.Check(JobsReplayDLQResponseSchema, {
    job,
  }));
  assert(Value.Check(JobsDismissDLQRequestSchema, request));
  assert(Value.Check(JobsDismissDLQResponseSchema, {
    job,
  }));
  assertFalse(Value.Check(JobsDismissDLQRequestSchema, {
    service: "documents",
    jobType: "document-process",
  }));
});
