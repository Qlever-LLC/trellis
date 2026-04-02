---
title: Jobs TypeScript API
description: Public TypeScript service-local and admin APIs for Trellis jobs.
order: 20
---

# Design: Jobs TypeScript API

## Prerequisites

- [trellis-jobs.md](./trellis-jobs.md) - subsystem semantics and authorization model
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result conventions and error-model guidance
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) - public async workflows that may attach to jobs

## Scope

This document defines the normative TypeScript public API surface for Trellis jobs.

It covers:

- service-local job creation and handling
- worker host lifecycle
- operator/admin query APIs

It does not redefine the jobs stream model, storage model, or admin authorization model; those remain in `trellis-jobs.md`.

## Design Rules

- jobs are service-private execution primitives
- service-local jobs APIs are typed per job type
- `create(...)` returns `JobRef`
- `JobRef.wait()` is valid internally but is not a public caller contract
- public TypeScript jobs APIs use `Result` / `AsyncResult` for expected failures
- public service-local jobs APIs do not expose manual binding assembly or conversion helpers

## Service-Local Surface

```ts
type JobsFacade = {
  refundCharge: JobQueue<RefundChargePayload, RefundChargeResult>;
  startWorkers(): Promise<Result<JobWorkerHost, BaseError>>;
};

type JobQueue<TPayload, TResult> = {
  create(payload: TPayload): Promise<Result<JobRef<TPayload, TResult>, BaseError>>;
  handle(
    handler: (job: ActiveJob<TPayload, TResult>) => Promise<Result<TResult, BaseError>>,
  ): Promise<void>;
};

type JobRef<TPayload, TResult> = {
  id: string;
  service: string;
  type: string;
  get(): Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>>;
  wait(): Promise<Result<TerminalJob<TPayload, TResult>, BaseError>>;
  cancel(): Promise<Result<JobSnapshot<TPayload, TResult>, BaseError>>;
};

type ActiveJob<TPayload, TResult> = {
  ref: JobRef<TPayload, TResult>;
  payload: TPayload;
  cancelled: boolean;
  heartbeat(): Promise<Result<void, BaseError>>;
  progress(value: JobProgress): Promise<Result<void, BaseError>>;
  log(entry: JobLogEntry): Promise<Result<void, BaseError>>;
  redeliveryCount(): number;
  isRedelivery(): boolean;
};

type JobWorkerHost = {
  stop(): Promise<Result<void, BaseError>>;
  join(): Promise<Result<void, BaseError>>;
};
```

Example:

```ts
const created = await service.jobs.refundCharge.create({
  operationId: op.id,
  chargeId: input.chargeId,
  amount: input.amount,
});

if (created.isErr()) {
  throw created.error;
}

const job = created.value;
const terminal = await job.wait();

await service.jobs.refundCharge.handle(async (job) => {
  const progress = await job.progress({
    step: "processor",
    message: "Submitting refund",
  });
  if (progress.isErr()) {
    return Result.err(progress.error);
  }

  if (job.cancelled) {
    return Result.err(new JobCancelledError());
  }

  return Result.ok({
    refundId: "rf_123",
    status: "refunded",
  });
});

const host = await service.jobs.startWorkers();
if (host.isOk()) {
  await host.value.stop();
}
```

## Shared Service-Local Types

```ts
type JobProgress = {
  step?: string;
  message?: string;
  current?: number;
  total?: number;
};

type JobSnapshot<TPayload, TResult> = {
  id: string;
  service: string;
  type: string;
  state: JobState;
  payload: TPayload;
  result?: TResult;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  tries: number;
  maxTries: number;
  lastError?: string;
  progress?: JobProgress;
  logs?: JobLogEntry[];
};

type TerminalJob<TPayload, TResult> = JobSnapshot<TPayload, TResult> & {
  state: "completed" | "failed" | "cancelled" | "expired" | "dead" | "dismissed";
};
```

All job progress fields are optional. Use `step` and `message` for human-readable status, and `current` / `total` only when you have a numeric progress fraction.

## Admin Surface

```ts
type JobsAdminClient = {
  health(): Promise<Result<JobsHealth, BaseError>>;
  listServices(): Promise<Result<ServiceInfo[], BaseError>>;
  list(filter: JobFilter): Promise<Result<JobSnapshot<unknown, unknown>[], BaseError>>;
  get(ref: JobIdentity): Promise<Result<JobSnapshot<unknown, unknown>, BaseError>>;
  cancel(ref: JobIdentity): Promise<Result<JobSnapshot<unknown, unknown>, BaseError>>;
  retry(ref: JobIdentity): Promise<Result<JobSnapshot<unknown, unknown>, BaseError>>;
  listDLQ(filter: JobFilter): Promise<Result<JobSnapshot<unknown, unknown>[], BaseError>>;
  replayDLQ(ref: JobIdentity): Promise<Result<JobSnapshot<unknown, unknown>, BaseError>>;
  dismissDLQ(ref: JobIdentity): Promise<Result<JobSnapshot<unknown, unknown>, BaseError>>;
};

type JobIdentity = {
  service: string;
  jobType: string;
  id: string;
};

type JobFilter = {
  service?: string;
  jobType?: string;
  state?: JobState;
};
```

Example:

```ts
const jobs = trellis.jobs();

const services = await jobs.listServices();
const listed = await jobs.list({ service: "billing" });
const one = await jobs.get({
  service: "billing",
  jobType: "refund-charge",
  id: "job_123",
});
const retried = await jobs.retry({
  service: "billing",
  jobType: "refund-charge",
  id: "job_123",
});
```

## Generation Rules

- generated service runtimes MUST expose one typed property per declared job type such as `service.jobs.refundCharge`
- any generic string-based queue lookup helper is a low-level escape hatch and MUST NOT be the primary public API
- `startWorkers()` owns binding resolution and worker-loop startup; application code SHOULD NOT pass runtime bindings manually
- operator/admin APIs MAY return wire-shaped `unknown` payload and result fields because they are an observability and debugging surface rather than a typed service-author execution surface
- generated admin wrappers are preferred over handwritten `requestOrThrow(...) as ...` adapters

## Non-Goals

- defining Rust jobs APIs
- defining public caller-visible async workflows; use operations for that
- redefining the jobs wire model or centralized admin RPC contract
