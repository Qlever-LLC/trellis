import { assertEquals } from "@std/assert";

import { jobFromWorkEvent, reduceJobEvent } from "./projection.ts";
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
  const active = reduceJobEvent(completed, event({
    eventType: "started",
    state: "active",
    previousState: "pending",
    tries: 1,
    timestamp: "2026-03-27T12:00:30.000Z",
  }));
  const terminal = reduceJobEvent(active, event({
    eventType: "completed",
    state: "completed",
    previousState: "active",
    tries: 1,
    result: { ok: true },
    timestamp: "2026-03-27T12:01:00.000Z",
  }));
  const failedTerminal = reduceJobEvent(active, event({
    eventType: "failed",
    state: "failed",
    previousState: "active",
    tries: 1,
    error: "fatal",
    timestamp: "2026-03-27T12:01:30.000Z",
  }));

  const ignored = reduceJobEvent(terminal, event({
    eventType: "failed",
    state: "failed",
    previousState: "active",
    error: "too late",
    timestamp: "2026-03-27T12:02:00.000Z",
  }));

  const retried = reduceJobEvent(failedTerminal, event({
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

Deno.test("jobFromWorkEvent materializes created and retried events with payload", () => {
  const created = jobFromWorkEvent(event({
    eventType: "created",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 5,
    deadline: "2026-03-27T12:30:00.000Z",
  }));
  const retried = jobFromWorkEvent(event({
    eventType: "retried",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 5,
    deadline: "2026-03-27T12:30:00.000Z",
  }));

  assertEquals(created?.state, "pending");
  assertEquals(created?.payload, { documentId: "doc-1" });
  assertEquals(retried?.state, "pending");
  assertEquals(retried?.payload, { documentId: "doc-1" });
  assertEquals(retried?.deadline, "2026-03-27T12:30:00.000Z");
});

Deno.test("jobFromWorkEvent rejects retried event without payload", () => {
  assertEquals(jobFromWorkEvent(event({
    eventType: "retried",
    state: "pending",
  })), undefined);
});

Deno.test("reduceJobEvent returns undefined for missing current and non-created event", () => {
  assertEquals(reduceJobEvent(undefined, event({
    eventType: "started",
    state: "active",
    previousState: "pending",
    tries: 1,
  })), undefined);
});

Deno.test("reduceJobEvent returns undefined for created event without payload", () => {
  assertEquals(reduceJobEvent(undefined, event({
    eventType: "created",
    state: "pending",
    maxTries: 5,
  })), undefined);
});

Deno.test("reduceJobEvent rejects illegal transitions and preserves current job", () => {
  const created = reduceJobEvent(undefined, event({
    eventType: "created",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 5,
  }));

  const illegalCompleted = reduceJobEvent(created, event({
    eventType: "completed",
    state: "completed",
    previousState: "active",
    tries: 1,
    result: { ok: true },
  }));
  const illegalProgress = reduceJobEvent(created, event({
    eventType: "progress",
    state: "active",
    previousState: "active",
    tries: 1,
    progress: { current: 1, total: 5, message: "Extracting" },
  }));

  assertEquals(illegalCompleted, created);
  assertEquals(illegalProgress, created);
});

Deno.test("reduceJobEvent rejects started when previous state does not match current", () => {
  const current: Job = {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "active",
    payload: { documentId: "doc-1" },
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:01:00.000Z",
    startedAt: "2026-03-27T12:01:00.000Z",
    tries: 1,
    maxTries: 5,
  };

  const started = reduceJobEvent(current, event({
    eventType: "started",
    state: "active",
    previousState: "pending",
    tries: 2,
  }));

  assertEquals(started, current);
});

Deno.test("reduceJobEvent appends logs and supports retry redelivery flow", () => {
  const created = reduceJobEvent(undefined, event({
    eventType: "created",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 5,
  }));
  const active = reduceJobEvent(created, event({
    eventType: "started",
    state: "active",
    previousState: "pending",
    tries: 1,
  }));
  const retry = reduceJobEvent(active, event({
    eventType: "retry",
    state: "retry",
    previousState: "active",
    tries: 1,
    error: "backoff",
    timestamp: "2026-03-27T12:01:00.000Z",
  }));
  const redelivered = reduceJobEvent(retry, event({
    eventType: "started",
    state: "active",
    previousState: "retry",
    tries: 2,
    timestamp: "2026-03-27T12:02:00.000Z",
  }));
  const logged = reduceJobEvent(redelivered, event({
    eventType: "logged",
    state: "active",
    previousState: "active",
    tries: 2,
    logs: [{
      timestamp: "2026-03-27T12:02:30.000Z",
      level: "info",
      message: "halfway",
    }],
    timestamp: "2026-03-27T12:02:30.000Z",
  }));

  assertEquals(redelivered?.state, "active");
  assertEquals(redelivered?.startedAt, "2026-03-27T12:02:00.000Z");
  assertEquals(logged?.logs, [{
    timestamp: "2026-03-27T12:02:30.000Z",
    level: "info",
    message: "halfway",
  }]);
  assertEquals(retry?.lastError, "backoff");
});

Deno.test("reduceJobEvent preserves maxTries when event omits it and sets expired terminal fields", () => {
  const created = reduceJobEvent(undefined, event({
    eventType: "created",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 5,
  }));
  const active = reduceJobEvent(created, event({
    eventType: "started",
    state: "active",
    previousState: "pending",
    tries: 1,
  }));
  const expired = reduceJobEvent(active, event({
    eventType: "expired",
    state: "expired",
    previousState: "active",
    tries: 1,
    error: "deadline exceeded",
    timestamp: "2026-03-27T12:05:00.000Z",
  }));

  assertEquals(expired?.maxTries, 5);
  assertEquals(expired?.lastError, "deadline exceeded");
  assertEquals(expired?.completedAt, "2026-03-27T12:05:00.000Z");
});

Deno.test("reduceJobEvent sets completedAt for failed cancelled dead and dismissed terminal events", () => {
  const created = reduceJobEvent(undefined, event({
    eventType: "created",
    state: "pending",
    payload: { documentId: "doc-1" },
    maxTries: 5,
  }));
  const active = reduceJobEvent(created, event({
    eventType: "started",
    state: "active",
    previousState: "pending",
    tries: 1,
    timestamp: "2026-03-27T12:01:00.000Z",
  }));
  const retry = reduceJobEvent(active, event({
    eventType: "retry",
    state: "retry",
    previousState: "active",
    tries: 1,
    error: "backoff",
    timestamp: "2026-03-27T12:01:30.000Z",
  }));

  const failed = reduceJobEvent(active, event({
    eventType: "failed",
    state: "failed",
    previousState: "active",
    tries: 1,
    error: "fatal",
    timestamp: "2026-03-27T12:02:00.000Z",
  }));
  const cancelled = reduceJobEvent(retry, event({
    eventType: "cancelled",
    state: "cancelled",
    previousState: "retry",
    tries: 1,
    timestamp: "2026-03-27T12:02:10.000Z",
  }));
  const dead = reduceJobEvent(retry, event({
    eventType: "dead",
    state: "dead",
    previousState: "retry",
    tries: 1,
    error: "exhausted",
    timestamp: "2026-03-27T12:02:20.000Z",
  }));
  const dismissed = reduceJobEvent(dead, event({
    eventType: "dismissed",
    state: "dismissed",
    previousState: "dead",
    tries: 1,
    error: "dismissed by admin",
    timestamp: "2026-03-27T12:02:30.000Z",
  }));

  assertEquals(failed?.completedAt, "2026-03-27T12:02:00.000Z");
  assertEquals(cancelled?.completedAt, "2026-03-27T12:02:10.000Z");
  assertEquals(dead?.completedAt, "2026-03-27T12:02:20.000Z");
  assertEquals(dismissed?.completedAt, "2026-03-27T12:02:30.000Z");
});

Deno.test("reduceJobEvent retried resets runtime fields and refreshes payload deadline and maxTries", () => {
  const deadJob: Job = {
    id: "job-1",
    service: "documents",
    type: "document-process",
    state: "dead",
    payload: { documentId: "old-doc" },
    result: { pages: 3 },
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:10:00.000Z",
    startedAt: "2026-03-27T12:01:00.000Z",
    completedAt: "2026-03-27T12:09:00.000Z",
    tries: 5,
    maxTries: 5,
    lastError: "exhausted",
    deadline: "2026-03-27T13:00:00.000Z",
    progress: { current: 4, total: 5, message: "Almost done" },
    logs: [{
      timestamp: "2026-03-27T12:05:00.000Z",
      level: "error",
      message: "boom",
    }],
  };

  const retried = reduceJobEvent(deadJob, event({
    eventType: "retried",
    state: "pending",
    previousState: "dead",
    tries: 0,
    payload: { documentId: "new-doc" },
    maxTries: 7,
    deadline: "2026-03-28T13:00:00.000Z",
    timestamp: "2026-03-27T12:11:00.000Z",
  }));

  assertEquals(retried, {
    ...deadJob,
    state: "pending",
    payload: { documentId: "new-doc" },
    result: undefined,
    updatedAt: "2026-03-27T12:11:00.000Z",
    startedAt: undefined,
    completedAt: undefined,
    tries: 0,
    maxTries: 7,
    lastError: undefined,
    deadline: "2026-03-28T13:00:00.000Z",
    progress: undefined,
    logs: undefined,
  });
});
