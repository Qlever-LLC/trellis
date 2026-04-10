import { isErr, Result, UnexpectedError } from "@qlever-llc/result";
import { assertEquals } from "@std/assert";

import { JobClient } from "./client.ts";

function createTrellisStub(responses: Record<string, Result<unknown, UnexpectedError>>) {
  const calls: Array<{ method: string; input: unknown }> = [];
  return {
    trellis: {
      request<T>(method: string, input: unknown): Promise<Result<T, UnexpectedError>> {
        calls.push({ method, input });
        return Promise.resolve(
          (responses[method] ?? Result.err(new UnexpectedError({ cause: new Error(`missing ${method}`) }))) as Result<T, UnexpectedError>,
        );
      },
    },
    calls,
  };
}

Deno.test("JobClient health calls Jobs.Health and unwraps response", async () => {
  const { trellis, calls } = createTrellisStub({
    "Jobs.Health": Result.ok({
      status: "healthy",
      service: "jobs",
      timestamp: "2026-03-28T12:00:00.000Z",
      checks: [{ name: "kv", status: "ok", latencyMs: 12 }],
    }),
  });
  const client = new JobClient(trellis);

  const health = await client.health();

  assertEquals(calls, [{ method: "Jobs.Health", input: {} }]);
  const value = health.take();
  if (isErr(value)) throw value;
  assertEquals(value.status, "healthy");
});

Deno.test("JobClient listServices calls Jobs.ListServices and unwraps services", async () => {
  const { trellis, calls } = createTrellisStub({
    "Jobs.ListServices": Result.ok({
      services: [{
        name: "documents",
        workers: [{
          service: "documents",
          jobType: "document-process",
          instanceId: "instance-1",
          concurrency: 2,
          version: "1.2.3",
          timestamp: "2026-03-28T12:00:00.000Z",
        }],
        healthy: true,
      }],
    }),
  });
  const client = new JobClient(trellis);

  const services = await client.listServices();

  assertEquals(calls, [{ method: "Jobs.ListServices", input: {} }]);
  const value = services.take();
  if (isErr(value)) throw value;
  assertEquals(value[0]?.name, "documents");
  assertEquals(value[0]?.workers[0]?.jobType, "document-process");
});

Deno.test("JobClient list and get call Jobs.List and Jobs.Get", async () => {
  const job = {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "active",
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:01:00.000Z",
    tries: 1,
    maxTries: 5,
  };
  const { trellis, calls } = createTrellisStub({
    "Jobs.List": Result.ok({ jobs: [job] }),
    "Jobs.Get": Result.ok({ job }),
  });
  const client = new JobClient(trellis);

  const listed = await client.list({ service: "documents", limit: 10 });
  const fetched = await client.get("documents", "document-process", "job-1");

  assertEquals(calls, [
    { method: "Jobs.List", input: { service: "documents", limit: 10 } },
    { method: "Jobs.Get", input: { service: "documents", jobType: "document-process", id: "job-1" } },
  ]);
  const listedValue = listed.take();
  const fetchedValue = fetched.take();
  if (isErr(listedValue) || isErr(fetchedValue)) throw listedValue;
  assertEquals(listedValue.map((entry: { id: string }) => entry.id), ["job-1"]);
  assertEquals(fetchedValue?.id, "job-1");
});

Deno.test("JobClient retry and cancel call admin RPCs", async () => {
  const job = {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "pending",
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:01:00.000Z",
    tries: 0,
    maxTries: 5,
  };
  const { trellis, calls } = createTrellisStub({
    "Jobs.Retry": Result.ok({ job }),
    "Jobs.Cancel": Result.ok({ job }),
  });
  const client = new JobClient(trellis);

  await client.retry("documents", "document-process", "job-1");
  await client.cancel("documents", "document-process", "job-1");

  assertEquals(calls, [
    { method: "Jobs.Retry", input: { service: "documents", jobType: "document-process", id: "job-1" } },
    { method: "Jobs.Cancel", input: { service: "documents", jobType: "document-process", id: "job-1" } },
  ]);
});

Deno.test("JobClient listDLQ replayDLQ and dismissDLQ call DLQ RPCs", async () => {
  const job = {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "dead",
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:01:00.000Z",
    tries: 5,
    maxTries: 5,
  };
  const { trellis, calls } = createTrellisStub({
    "Jobs.ListDLQ": Result.ok({ jobs: [job] }),
    "Jobs.ReplayDLQ": Result.ok({ job }),
    "Jobs.DismissDLQ": Result.ok({ job }),
  });
  const client = new JobClient(trellis);

  const jobs = await client.listDLQ({ service: "documents", state: ["dead"] });
  await client.replayDLQ("documents", "document-process", "job-1");
  await client.dismissDLQ("documents", "document-process", "job-1");

  assertEquals(calls, [
    { method: "Jobs.ListDLQ", input: { service: "documents", state: ["dead"] } },
    { method: "Jobs.ReplayDLQ", input: { service: "documents", jobType: "document-process", id: "job-1" } },
    { method: "Jobs.DismissDLQ", input: { service: "documents", jobType: "document-process", id: "job-1" } },
  ]);
  const jobsValue = jobs.take();
  if (isErr(jobsValue)) throw jobsValue;
  assertEquals(jobsValue.map((entry: { id: string }) => entry.id), ["job-1"]);
});
