---
title: Operations TypeScript API
description: Public TypeScript client and service APIs for Trellis operations.
order: 20
---

# Design: Operations TypeScript API

## Prerequisites

- [trellis-operations.md](./trellis-operations.md) - subsystem semantics and internal protocol
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result conventions and error-model guidance
- [../contracts/trellis-typescript-contract-authoring.md](./../contracts/trellis-typescript-contract-authoring.md) - typed contract-driven TS surfaces

## Scope

This document defines the normative TypeScript public API surface for Trellis operations.

It defines only the language-facing surface. Internal wire envelopes, reply-subject behavior, and auth rules remain in `trellis-operations.md`.

## Design Rules

- callers start operations with `operation(key).start(input)`
- callers observe work through `OperationRef`
- owning services register handlers with `service.operation(key).handle(...)`
- public TypeScript APIs use `Result` / `AsyncResult` for expected failures
- public APIs do not expose hidden control subjects or runtime control envelopes
- operation keys are typed contract keys, not free-form strings

## Client Surface

```ts
type OperationCapableClient<API> = {
  operation<K extends keyof API["operations"] & string>(
    operation: K,
  ): OperationInvoker<
    OperationInputOf<API, K>,
    OperationProgressOf<API, K>,
    OperationOutputOf<API, K>,
    OperationCancelableOf<API, K>
  >;
};

type OperationInvoker<
  TInput,
  TProgress,
  TOutput,
  TCancelable extends boolean,
> = {
  resume(
    ref: OperationRefData,
  ): OperationRef<TProgress, TOutput, TCancelable>;
  start(
    input: TInput,
  ): Promise<Result<OperationRef<TProgress, TOutput, TCancelable>, BaseError>>;
};

type OperationRef<
  TProgress,
  TOutput,
  TCancelable extends boolean,
> = {
  id: string;
  service: string;
  operation: string;
  get(): Promise<Result<OperationSnapshot<TProgress, TOutput>, BaseError>>;
  wait(): Promise<Result<TerminalOperation<TProgress, TOutput>, BaseError>>;
  watch(): Promise<Result<AsyncIterable<OperationEvent<TProgress, TOutput>>, BaseError>>;
} & (TCancelable extends true
  ? {
      cancel(): Promise<Result<OperationSnapshot<TProgress, TOutput>, BaseError>>;
    }
  : {});
```

Example:

```ts
const started = await billing.operation("Billing.Refund").start({
  chargeId: "ch_123",
  amount: 5000,
});

if (started.isErr()) {
  throw started.error;
}

const op = started.value;
const snapshot = await op.get();
const terminal = await op.wait();
const watch = await op.watch();

if (watch.isOk()) {
  for await (const event of watch.value) {
    if (event.type === "progress") {
      console.log(event.snapshot.progress);
    }
  }
}
```

## Service-Owned Surface

```ts
type OperationCapableService<API> = {
  operation<K extends keyof API["operations"] & string>(
    operation: K,
  ): OperationDefinition<
    OperationInputOf<API, K>,
    OperationProgressOf<API, K>,
    OperationOutputOf<API, K>,
    OperationCancelableOf<API, K>
  >;
};

type OperationDefinition<
  TInput,
  TProgress,
  TOutput,
  TCancelable extends boolean,
> = {
  accept(args: {
    sessionKey: string;
  }): Promise<Result<AcceptedOperation<TProgress, TOutput, TCancelable>, BaseError>>;
  handle(
    handler: (ctx: {
      input: TInput;
      op: ActiveOperation<TProgress, TOutput, TCancelable>;
      caller: SessionUser;
    }) => Promise<Result<TOutput, BaseError>>,
  ): Promise<void>;
};

type ActiveOperation<
  TProgress,
  TOutput,
  TCancelable extends boolean,
> = {
  id: string;
  started(): Promise<Result<void, BaseError>>;
  progress(value: TProgress): Promise<Result<void, BaseError>>;
  complete(value: TOutput): Promise<Result<TerminalOperation<TProgress, TOutput>, BaseError>>;
  fail(error: BaseError): Promise<Result<TerminalOperation<TProgress, TOutput>, BaseError>>;
  attach<TPayload>(
    job: JobRef<TPayload, TOutput>,
  ): Promise<Result<TerminalOperation<TProgress, TOutput>, BaseError>>;
} & (TCancelable extends true
  ? {
      cancel(): Promise<Result<TerminalOperation<TProgress, TOutput>, BaseError>>;
    }
  : {});

type AcceptedOperation<
  TProgress,
  TOutput,
  TCancelable extends boolean,
> = ActiveOperation<TProgress, TOutput, TCancelable> & {
  ref: OperationRefData;
  snapshot: OperationSnapshot<TProgress, TOutput>;
};
```

Example:

```ts
await service.operation("Billing.Refund").handle(async ({ input, op }) => {
  const started = await op.started();
  if (started.isErr()) {
    return Result.err(started.error);
  }

  const progress = await op.progress({
    step: "processor",
    message: "Submitting refund",
  });
  if (progress.isErr()) {
    return Result.err(progress.error);
  }

  const created = await service.jobs.refundCharge.create({
    operationId: op.id,
    chargeId: input.chargeId,
    amount: input.amount,
  });
  if (created.isErr()) {
    return Result.err(created.error);
  }

  return await op.attach(created.value);
});

const accepted = await service.operation("Billing.Refund").accept({
  sessionKey: callerSessionKey,
});
if (accepted.isOk()) {
  await accepted.value.started();
}
```

## Shared Types

```ts
type OperationState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

type OperationSnapshot<TProgress, TOutput> = {
  id: string;
  service: string;
  operation: string;
  state: OperationState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress?: TProgress;
  output?: TOutput;
  error?: {
    type: string;
    message: string;
  };
};

type TerminalOperation<TProgress, TOutput> = OperationSnapshot<TProgress, TOutput> & {
  state: "completed" | "failed" | "cancelled";
};

type OperationEvent<TProgress, TOutput> =
  | { type: "accepted"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | { type: "started"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | { type: "progress"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | { type: "completed"; snapshot: TerminalOperation<TProgress, TOutput> }
  | { type: "failed"; snapshot: TerminalOperation<TProgress, TOutput> }
  | { type: "cancelled"; snapshot: TerminalOperation<TProgress, TOutput> };
```

## Generation Rules

- generated runtimes MUST expose one typed `operation(key)` helper per owned or used operation surface
- generated runtimes MUST expose `resume(ref)` so callers can bind behavior to an operation reference that was returned from another contract-owned API such as an RPC
- generated runtimes MUST derive `OperationInputOf`, `OperationProgressOf`, `OperationOutputOf`, and `OperationCancelableOf` from the contract
- generated runtimes MUST hide internal control envelopes and caller reply subjects
- generated service runtimes MUST expose `accept(...)` so service code can create durable operation refs from other owned entrypoints such as RPCs or transfer callbacks
- generated runtimes SHOULD omit `cancel()` from non-cancelable operation handles rather than exposing a method that always fails
- generated runtimes MUST preserve Trellis `Result` conventions for expected remote failures

## Non-Goals

- defining the internal wire envelopes used by operation control subjects
- defining Rust APIs
- defining jobs APIs beyond the minimal `JobRef` reference needed by `attach(...)`
