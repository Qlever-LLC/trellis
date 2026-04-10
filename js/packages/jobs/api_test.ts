import { Result } from "@qlever-llc/result";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { Value } from "typebox/value";

import {
  ActiveJob,
  type JobsFacade,
  JobProgressSchema,
  JobQueue,
  JobRef,
  JobWorkerHostAdapter,
} from "./api.ts";

Deno.test("JobProgressSchema accepts optional fields", () => {
  assert(Value.Check(JobProgressSchema, {}));
  assert(Value.Check(JobProgressSchema, { step: "processor", current: 1, total: 3 }));
  assertFalse(Value.Check(JobProgressSchema, { current: -1 }));
});

Deno.test("JobRef delegates to supplied callbacks and wraps thrown errors", async () => {
  const snapshot = {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "pending" as const,
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-28T12:00:00.000Z",
    updatedAt: "2026-03-28T12:00:00.000Z",
    tries: 0,
    maxTries: 5,
  };
  const ref = new JobRef(
    { id: "job-1", service: "documents", jobType: "document-process" },
    {
      get: () => Promise.resolve(Result.ok(snapshot)),
      wait: () => Promise.resolve(Result.ok({ ...snapshot, state: "completed" as const })),
      cancel: () => Promise.resolve(Result.ok({ ...snapshot, state: "cancelled" as const })),
    },
  );

  assertEquals(ref.id, "job-1");
  const gotResult = await ref.get();
  assert(gotResult.isOk());
  assertEquals(gotResult.unwrapOr(snapshot), snapshot);

  const waitedResult = await ref.wait();
  assert(waitedResult.isOk());
  assertEquals(waitedResult.unwrapOr(snapshot).state, "completed");

  const cancelledResult = await ref.cancel();
  assert(cancelledResult.isOk());
  assertEquals(cancelledResult.unwrapOr(snapshot).state, "cancelled");

  const failingRef = new JobRef(
    { id: "job-2", service: "documents", jobType: "document-process" },
    {
      get: () => {
        throw new Error("boom");
      },
      wait: () => Promise.resolve(Result.ok({ ...snapshot, id: "job-2", state: "completed" as const })),
      cancel: () => Promise.resolve(Result.ok({ ...snapshot, id: "job-2", state: "cancelled" as const })),
    },
  );
  const errored = await failingRef.get();
  assert(errored.isErr());
});

Deno.test("ActiveJob exposes the public handler surface", async () => {
  const ref = new JobRef(
    { id: "job-1", service: "documents", jobType: "document-process" },
    {
      get: () => Promise.resolve(Result.ok({
        id: "job-1",
        service: "documents",
        type: "document-process",
        state: "pending" as const,
        payload: { documentId: "doc-1" },
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
        tries: 0,
        maxTries: 5,
      })),
      wait: () => Promise.resolve(Result.ok({
        id: "job-1",
        service: "documents",
        type: "document-process",
        state: "completed" as const,
        payload: { documentId: "doc-1" },
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:01:00.000Z",
        completedAt: "2026-03-28T12:01:00.000Z",
        tries: 1,
        maxTries: 5,
      })),
      cancel: () => Promise.resolve(Result.ok({
        id: "job-1",
        service: "documents",
        type: "document-process",
        state: "cancelled" as const,
        payload: { documentId: "doc-1" },
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:01:00.000Z",
        completedAt: "2026-03-28T12:01:00.000Z",
        tries: 1,
        maxTries: 5,
      })),
    },
  );
  const calls: string[] = [];
  const job = new ActiveJob(
    ref,
    { documentId: "doc-1" },
    true,
    {
      heartbeat: () => {
        calls.push("heartbeat");
        return Promise.resolve(Result.ok(undefined));
      },
      progress: (value) => {
        calls.push(`progress:${value.step}`);
        return Promise.resolve(Result.ok(undefined));
      },
      log: (entry) => {
        calls.push(`log:${entry.message}`);
        return Promise.resolve(Result.ok(undefined));
      },
      redeliveryCount: 2,
    },
  );

  assertEquals(job.ref.id, "job-1");
  assertEquals(job.payload, { documentId: "doc-1" });
  assert(job.cancelled);
  assertEquals(job.redeliveryCount(), 2);
  assert(job.isRedelivery());
  assert((await job.heartbeat()).isOk());
  assert((await job.progress({ step: "processor", current: 1, total: 3 })).isOk());
  assert((await job.log({ timestamp: "2026-03-28T12:00:01.000Z", level: "info", message: "started" })).isOk());
  assertEquals(calls, ["heartbeat", "progress:processor", "log:started"]);
});

Deno.test("JobQueue delegates create and handle", async () => {
  const ref = new JobRef(
    { id: "job-1", service: "documents", jobType: "document-process" },
    {
      get: () => Promise.resolve(Result.ok({
        id: "job-1",
        service: "documents",
        type: "document-process",
        state: "pending" as const,
        payload: { documentId: "doc-1" },
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:00:00.000Z",
        tries: 0,
        maxTries: 5,
      })),
      wait: () => Promise.resolve(Result.ok({
        id: "job-1",
        service: "documents",
        type: "document-process",
        state: "completed" as const,
        payload: { documentId: "doc-1" },
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:01:00.000Z",
        completedAt: "2026-03-28T12:01:00.000Z",
        tries: 1,
        maxTries: 5,
      })),
      cancel: () => Promise.resolve(Result.ok({
        id: "job-1",
        service: "documents",
        type: "document-process",
        state: "cancelled" as const,
        payload: { documentId: "doc-1" },
        createdAt: "2026-03-28T12:00:00.000Z",
        updatedAt: "2026-03-28T12:01:00.000Z",
        completedAt: "2026-03-28T12:01:00.000Z",
        tries: 1,
        maxTries: 5,
      })),
    },
  );

  let handleCalls = 0;
  const queue = new JobQueue({
    create: (payload: { documentId: string }) => {
      assertEquals(payload.documentId, "doc-1");
      return Promise.resolve(Result.ok(ref));
    },
    handle: async (handler) => {
      handleCalls += 1;
      const outcome = await handler(
        new ActiveJob(
          ref,
          { documentId: "doc-1" },
          false,
          {
            heartbeat: () => Promise.resolve(Result.ok(undefined)),
            progress: () => Promise.resolve(Result.ok(undefined)),
            log: () => Promise.resolve(Result.ok(undefined)),
          },
        ),
      );
      assert(outcome.isOk());
    },
  });

  const createdResult = await queue.create({ documentId: "doc-1" });
  assert(createdResult.isOk());
  assertEquals(createdResult.unwrapOr(ref).id, "job-1");
  await queue.handle((job) => {
    assertEquals(job.payload, { documentId: "doc-1" });
    return Promise.resolve(Result.ok({ pages: 3 }));
  });
  assertEquals(handleCalls, 1);
});

Deno.test("JobWorkerHostAdapter wraps stop and join callbacks", async () => {
  const host = new JobWorkerHostAdapter({
    stop: () => Promise.resolve(Result.ok(undefined)),
    join: () => Promise.resolve(Result.ok(undefined)),
  });

  assert((await host.stop()).isOk());
  assert((await host.join()).isOk());
});

Deno.test("JobsFacade shape can be implemented by service code", async () => {
  const facade: JobsFacade & {
    refundCharge: JobQueue<{ amount: number }, { refundId: string }>;
  } = {
    refundCharge: new JobQueue({
      create: (payload) => Promise.resolve(Result.ok(new JobRef(
        { id: "job-1", service: "documents", jobType: "refund-charge" },
        {
          get: () => Promise.resolve(Result.ok({
            id: "job-1",
            service: "documents",
            type: "refund-charge",
            state: "pending" as const,
            payload,
            createdAt: "2026-03-28T12:00:00.000Z",
            updatedAt: "2026-03-28T12:00:00.000Z",
            tries: 0,
            maxTries: 5,
          })),
          wait: () => Promise.resolve(Result.ok({
            id: "job-1",
            service: "documents",
            type: "refund-charge",
            state: "completed" as const,
            payload,
            result: { refundId: "rf_123" },
            createdAt: "2026-03-28T12:00:00.000Z",
            updatedAt: "2026-03-28T12:01:00.000Z",
            completedAt: "2026-03-28T12:01:00.000Z",
            tries: 1,
            maxTries: 5,
          })),
          cancel: () => Promise.resolve(Result.ok({
            id: "job-1",
            service: "documents",
            type: "refund-charge",
            state: "cancelled" as const,
            payload,
            createdAt: "2026-03-28T12:00:00.000Z",
            updatedAt: "2026-03-28T12:01:00.000Z",
            completedAt: "2026-03-28T12:01:00.000Z",
            tries: 1,
            maxTries: 5,
          })),
        },
      ))),
      handle: () => Promise.resolve(),
    }),
    startWorkers() {
      return Promise.resolve(Result.ok(new JobWorkerHostAdapter({
        stop: () => Promise.resolve(Result.ok(undefined)),
        join: () => Promise.resolve(Result.ok(undefined)),
      })));
    },
  };

  assert((await facade.startWorkers()).isOk());
});
