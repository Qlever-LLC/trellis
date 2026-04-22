---
title: Jobs TypeScript API
description: Public TypeScript service-local and admin APIs for Trellis jobs.
order: 20
---

# Design: Jobs TypeScript API

## Prerequisites

- [trellis-jobs.md](./trellis-jobs.md) - subsystem semantics and authorization
  model
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result
  conventions and error-model guidance
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) -
  public async workflows that may attach to jobs

## Design

The TypeScript jobs surface is split into two shapes: a service-local API for
creating and handling jobs, and an admin API for observing jobs across the
system. Both live in `@qlever-llc/trellis` and follow the same jobs model
defined in `trellis-jobs.md`.

- service-local jobs are exposed on connected service runtimes such as
  `service.jobs` from `@qlever-llc/trellis/service*`
- admin and operator jobs access is exposed on connected clients such as
  `trellis.jobs()` from `@qlever-llc/trellis`

It covers:

- service-local job creation and handling
- worker host lifecycle
- operator/admin query APIs

It does not redefine the jobs stream model, storage model, or admin
authorization model; those remain in `trellis-jobs.md`.

The API surface stays typed by job type for service-local code, keeps
operator/admin access separate from service execution, and returns
`Result`/`AsyncResult` for expected failures.

Jobs are service-private execution primitives.

Service-local jobs APIs are typed per job type.

`create(...)` returns `JobRef`.

`JobRef.wait()` is valid internally but is not a public caller contract.

Public TypeScript jobs APIs use `Result` / `AsyncResult` for expected failures.

Public service-local jobs APIs do not expose manual binding assembly or
conversion helpers.

### Service-local surface

```ts
type JobsFacade = {
  refundCharge: JobQueue<RefundChargePayload, RefundChargeResult>;
  startWorkers(): AsyncResult<JobWorkerHost, BaseError>;
};

type JobQueue<TPayload, TResult> = {
  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  handle(
    handler: (
      args: { job: ActiveJob<TPayload, TResult>; trellis: object },
    ) => Promise<Result<TResult, BaseError>>,
  ): AsyncResult<void, BaseError>;
};

type JobRef<TPayload, TResult> = {
  id: string;
  service: string;
  type: string;
  get(): AsyncResult<JobSnapshot<TPayload, TResult>, BaseError>;
  wait(): AsyncResult<TerminalJob<TPayload, TResult>, BaseError>;
  cancel(): AsyncResult<JobSnapshot<TPayload, TResult>, BaseError>;
};

type ActiveJob<TPayload, TResult> = {
  ref: JobRef<TPayload, TResult>;
  payload: TPayload;
  cancelled: boolean;
  heartbeat(): AsyncResult<void, BaseError>;
  progress(value: JobProgress): AsyncResult<void, BaseError>;
  log(entry: JobLogEntry): AsyncResult<void, BaseError>;
  redeliveryCount(): number;
  isRedelivery(): boolean;
};

type JobWorkerHost = {
  stop(): AsyncResult<void, BaseError>;
  join(): AsyncResult<void, BaseError>;
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

const registered = await service.jobs.refundCharge.handle(async ({ job }) => {
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

if (registered.isErr()) {
  throw registered.error;
}

const host = await service.jobs.startWorkers();
if (host.isOk()) {
  await host.value.stop();
}
```

### Shared service-local types

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
  state:
    | "completed"
    | "failed"
    | "cancelled"
    | "expired"
    | "dead"
    | "dismissed";
};
```

All job progress fields are optional. Use `step` and `message` for
human-readable status, and `current` / `total` only when you have a numeric
progress fraction.

Job handlers use the canonical `({ job, trellis })` callback shape. The injected
`trellis` value is the narrow service runtime facade for handler code, not the
full `TrellisService` instance.

### Admin surface

```ts
type JobsAdminClient = {
  health(): AsyncResult<JobsHealth, BaseError>;
  listServices(): AsyncResult<ServiceInfo[], BaseError>;
  list(
    filter: JobFilter,
  ): AsyncResult<JobSnapshot<unknown, unknown>[], BaseError>;
  get(
    ref: JobIdentity,
  ): AsyncResult<JobSnapshot<unknown, unknown> | null, BaseError>;
  cancel(
    ref: JobIdentity,
  ): AsyncResult<JobSnapshot<unknown, unknown>, BaseError>;
  retry(
    ref: JobIdentity,
  ): AsyncResult<JobSnapshot<unknown, unknown>, BaseError>;
  listDLQ(
    filter: JobFilter,
  ): AsyncResult<JobSnapshot<unknown, unknown>[], BaseError>;
  replayDLQ(
    ref: JobIdentity,
  ): AsyncResult<JobSnapshot<unknown, unknown>, BaseError>;
  dismissDLQ(
    ref: JobIdentity,
  ): AsyncResult<JobSnapshot<unknown, unknown>, BaseError>;
};

type JobIdentity = {
  service: string;
  jobType: string;
  id: string;
};

type JobFilter = {
  service?: string;
  jobType?: string;
  state?: JobState | JobState[];
  since?: string;
  limit?: number;
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

### Generation rules

- generated service runtimes MUST expose one typed property per declared job
  type such as `service.jobs.refundCharge`
- generated service runtimes MUST derive those typed job handles from the
  contract's top-level `jobs` map rather than from `resources`
- any generic string-based queue lookup helper is a low-level escape hatch and
  MUST NOT be the primary public API
- `startWorkers()` owns binding resolution and worker-loop startup; application
  code SHOULD NOT pass runtime bindings manually
- operator/admin APIs MAY return wire-shaped `unknown` payload and result fields
  because they are an observability and debugging surface rather than a typed
  service-author execution surface
- generated admin wrappers are preferred over handwritten
  `requestOrThrow(...) as ...` adapters

## Non-goals

- defining Rust jobs APIs
- defining public caller-visible async workflows; use operations for that
- redefining the jobs wire model or centralized admin RPC contract
