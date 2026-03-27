import type { Job, JobEvent } from "./types.ts";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "expired", "dead"]);

export function reduceJobEvent<TPayload = unknown, TResult = unknown>(
  current: Job<TPayload, TResult> | undefined,
  event: JobEvent<TPayload, TResult>,
): Job<TPayload, TResult> | undefined {
  if (!current) {
    if (event.eventType !== "created" || event.payload === undefined) {
      return undefined;
    }

    return {
      id: event.jobId,
      service: event.service,
      type: event.jobType,
      state: event.state,
      payload: event.payload,
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      tries: event.tries,
      maxTries: event.maxTries ?? 1,
      ...(event.deadline ? { deadline: event.deadline } : {}),
    };
  }

  if (TERMINAL_STATES.has(current.state) && event.eventType !== "retried") {
    return current;
  }

  const next: Job<TPayload, TResult> = {
    ...current,
    state: event.state,
    updatedAt: event.timestamp,
    tries: event.tries,
    ...(event.maxTries !== undefined ? { maxTries: event.maxTries } : {}),
  };

  switch (event.eventType) {
    case "started":
      next.startedAt = event.timestamp;
      break;
    case "progress":
      next.progress = event.progress;
      break;
    case "logged":
      next.logs = [...(current.logs ?? []), ...(event.logs ?? [])];
      break;
    case "completed":
      next.result = event.result;
      next.completedAt = event.timestamp;
      break;
    case "failed":
    case "retry":
    case "dead":
    case "expired":
      next.lastError = event.error;
      break;
    case "cancelled":
      break;
    case "retried":
      next.result = undefined;
      next.completedAt = undefined;
      next.startedAt = undefined;
      next.lastError = undefined;
      next.progress = undefined;
      break;
    default:
      break;
  }

  return next;
}
