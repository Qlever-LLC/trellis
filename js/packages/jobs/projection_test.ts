import { assertEquals } from "@std/assert";

import { reduceJobEvent } from "./projection.ts";
import type { Job, JobEvent } from "./types.ts";

function event(overrides: Partial<JobEvent> & Pick<JobEvent, "eventType" | "state">): JobEvent {
  return {
    jobId: overrides.jobId ?? "job-1",
    service: overrides.service ?? "documents",
    jobType: overrides.jobType ?? "document-process",
    eventType: overrides.eventType,
    state: overrides.state,
    timestamp: overrides.timestamp ?? "2026-03-27T12:00:00.000Z",
    tries: overrides.tries ?? 0,
    ...(overrides.previousState ? { previousState: overrides.previousState } : {}),
    ...(overrides.payload !== undefined ? { payload: overrides.payload } : {}),
    ...(overrides.result !== undefined ? { result: overrides.result } : {}),
    ...(overrides.progress ? { progress: overrides.progress } : {}),
    ...(overrides.logs ? { logs: overrides.logs } : {}),
    ...(overrides.error ? { error: overrides.error } : {}),
    ...(overrides.maxTries !== undefined ? { maxTries: overrides.maxTries } : {}),
    ...(overrides.deadline ? { deadline: overrides.deadline } : {}),
  };
}

Deno.test("reduceJobEvent builds a job through its happy-path lifecycle", () => {
  const created = reduceJobEvent(undefined, event({
    eventType: "created",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 5,
  }));

  const started = reduceJobEvent(created, event({
    eventType: "started",
    state: "active",
    previousState: "pending",
    tries: 1,
    timestamp: "2026-03-27T12:01:00.000Z",
  }));

  const progressed = reduceJobEvent(started, event({
    eventType: "progress",
    state: "active",
    previousState: "active",
    tries: 1,
    progress: { current: 2, total: 5, message: "Extracting" },
    timestamp: "2026-03-27T12:02:00.000Z",
  }));

  const completed = reduceJobEvent(progressed, event({
    eventType: "completed",
    state: "completed",
    previousState: "active",
    tries: 1,
    result: { pages: 3 },
    timestamp: "2026-03-27T12:03:00.000Z",
  }));

  assertEquals(completed, {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "completed",
    payload: { documentId: "doc-1" },
    result: { pages: 3 },
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:03:00.000Z",
    startedAt: "2026-03-27T12:01:00.000Z",
    completedAt: "2026-03-27T12:03:00.000Z",
    tries: 1,
    maxTries: 5,
    progress: { current: 2, total: 5, message: "Extracting" },
  } satisfies Job);
});

Deno.test("reduceJobEvent preserves terminal jobs unless explicitly retried", () => {
  const completed = reduceJobEvent(undefined, event({
    eventType: "created",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 3,
  }));
  const terminal = reduceJobEvent(completed, event({
    eventType: "completed",
    state: "completed",
    previousState: "pending",
    result: { ok: true },
    timestamp: "2026-03-27T12:01:00.000Z",
  }));

  const ignored = reduceJobEvent(terminal, event({
    eventType: "failed",
    state: "failed",
    previousState: "active",
    error: "too late",
    timestamp: "2026-03-27T12:02:00.000Z",
  }));

  const retried = reduceJobEvent(terminal, event({
    eventType: "retried",
    state: "pending",
    previousState: "failed",
    tries: 0,
    timestamp: "2026-03-27T12:03:00.000Z",
  }));

  assertEquals(ignored?.state, "completed");
  assertEquals(retried?.state, "pending");
  assertEquals(retried?.result, undefined);
});
