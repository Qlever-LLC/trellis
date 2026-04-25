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
system. The service-local runtime API lives in `@qlever-llc/trellis`, while the
admin RPC contract and types live in `@qlever-llc/trellis/sdk/jobs`. Both follow
the same jobs model defined in `trellis-jobs.md`.

- service-local jobs are exposed on connected service runtimes such as
  `service.jobs` from `@qlever-llc/trellis/service*`
- admin and operator jobs access uses the `Jobs.*` RPC surface declared through
  `@qlever-llc/trellis/sdk/jobs`

It covers:

- service-local job creation and handling
- service-owned worker lifecycle
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
};

type JobQueue<TPayload, TResult> = {
  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  handle(
    handler: (
      args: { job: ActiveJob<TPayload, TResult>; trellis: object },
    ) => Promise<Result<TResult, BaseError>>,
  ): void;
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

service.jobs.refundCharge.handle(async ({ job }) => {
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

await service.wait();
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

Duplicate handler registration is a bootstrap-time programming error. The
runtime should fail fast if the same job queue registers more than one handler.

### Admin RPC surface

```ts
import { defineAppContract } from "@qlever-llc/trellis";
import { jobs as trellisJobs } from "@qlever-llc/trellis/sdk/jobs";
import type {
  JobsListInput,
  JobsListOutput,
  JobsListServicesOutput,
} from "@qlever-llc/trellis/sdk/jobs";

const app = defineAppContract(() => ({
  uses: {
    jobs: trellisJobs.use({
      rpc: {
        call: ["Jobs.List", "Jobs.ListServices"],
      },
    }),
  },
}));

const services: JobsListServicesOutput = await trellis.request(
  "Jobs.ListServices",
  {},
).orThrow();

const listed: JobsListOutput = await trellis.request(
  "Jobs.List",
  {
    service: "billing",
  } satisfies JobsListInput,
).orThrow();
```

Example:

```ts
const listed = await trellis.request("Jobs.List", {
  service: "billing",
}).orThrow();

const one = await trellis.request("Jobs.Get", {
  service: "billing",
  jobType: "refund-charge",
  id: "job_123",
}).orThrow();
```

### Generation rules

- generated service runtimes MUST expose one typed property per declared job
  type such as `service.jobs.refundCharge`
- generated service runtimes MUST derive those typed job handles from the
  contract's top-level `jobs` map rather than from `resources`
- any generic string-based queue lookup helper is a low-level escape hatch and
  MUST NOT be the primary public API
- service runtimes SHOULD own worker-loop startup and shutdown through the
  connected service lifecycle rather than exposing worker hosts on the normal
  public path
- application code SHOULD call `service.wait()` to start registered job handlers
  and `service.stop()` to tear them down
- operator/admin APIs MAY return wire-shaped `unknown` payload and result fields
  because they are an observability and debugging surface rather than a typed
  service-author execution surface
- generated SDK request and response types are preferred over handwritten
  `request(... ) as ...` adapters
- connected clients MUST NOT expose a generic `trellis.jobs()` helper for admin
  queries; jobs admin access should stay on the normal contract RPC surface

## Non-goals

- defining Rust jobs APIs
- defining public caller-visible async workflows; use operations for that
- redefining the jobs wire model or centralized admin RPC contract
