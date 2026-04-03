import type { Job, JobEvent, JobState } from "./types.ts";

const TERMINAL_STATES = new Set<JobState>([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "dead",
  "dismissed",
]);

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

export function jobFromWorkEvent<TPayload = unknown, TResult = unknown>(
  event: JobEvent<TPayload, TResult>,
): Job<TPayload, TResult> | undefined {
  switch (event.eventType) {
    case "created":
    case "retried":
      return seedJobFromEvent(event);
    default:
      return undefined;
  }
}

export function reduceJobEvent<TPayload = unknown, TResult = unknown>(
  current: Job<TPayload, TResult> | undefined,
  event: JobEvent<TPayload, TResult>,
): Job<TPayload, TResult> | undefined {
  if (!current) {
    if (event.eventType !== "created") {
      return undefined;
    }

    return seedJobFromEvent(event);
  }

  if (!isLegalTransition(current, event)) {
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
    case "cancelled":
    case "expired":
    case "dead":
    case "dismissed":
      next.lastError = event.error;
      next.completedAt = event.timestamp;
      break;
    case "retry":
      next.lastError = event.error;
      break;
    case "retried":
      if (event.payload !== undefined) {
        next.payload = event.payload;
      }
      if (event.deadline !== undefined) {
        next.deadline = event.deadline;
      }
      next.result = undefined;
      next.completedAt = undefined;
      next.startedAt = undefined;
      next.lastError = undefined;
      next.progress = undefined;
      next.logs = undefined;
      next.tries = 0;
      break;
    case "created":
      break;
  }

  return next;
}

function isLegalTransition<TPayload, TResult>(
  current: Job<TPayload, TResult>,
  event: JobEvent<TPayload, TResult>,
): boolean {
  switch (event.eventType) {
    case "created":
      return false;
    case "started":
      return (current.state === "pending" || current.state === "retry") &&
        event.previousState === current.state;
    case "retry":
    case "progress":
    case "logged":
    case "completed":
    case "failed":
      return current.state === "active" && event.previousState === "active";
    case "cancelled":
    case "expired":
      return (current.state === "pending" || current.state === "retry" || current.state === "active") &&
        event.previousState === current.state;
    case "retried":
      return (current.state === "failed" || current.state === "dead") &&
        event.previousState === current.state;
    case "dead":
      return (
        current.state === "active" ||
        current.state === "retry" ||
        current.state === "failed" ||
        current.state === "expired"
      ) && event.previousState === current.state;
    case "dismissed":
      return current.state === "dead" && event.previousState === "dead";
  }
}

function seedJobFromEvent<TPayload = unknown, TResult = unknown>(
  event: JobEvent<TPayload, TResult>,
): Job<TPayload, TResult> | undefined {
  if (event.payload === undefined) {
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
    ...(event.deadline !== undefined ? { deadline: event.deadline } : {}),
  };
}
