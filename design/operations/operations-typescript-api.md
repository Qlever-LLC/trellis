---
title: Operations TypeScript API
description: Public TypeScript client and service APIs for Trellis operations.
order: 20
---

# Design: Operations TypeScript API

## Prerequisites

- [trellis-operations.md](./trellis-operations.md) - subsystem semantics and
  internal protocol
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result
  conventions and error-model guidance
- [../contracts/trellis-typescript-contract-authoring.md](./../contracts/trellis-typescript-contract-authoring.md) -
  typed contract-driven TS surfaces

## Scope

This document defines the normative TypeScript public API surface for Trellis
operations.

It defines only the language-facing surface. Internal wire envelopes,
reply-subject behavior, and auth rules remain in `trellis-operations.md`.

## Design Rules

- callers configure operations with `operation(key).input(input)`
- callers observe work through `OperationRef`
- operation-native send transfer initiation is builder-only through
  `operation(key).input(input).transfer(body).start()`
- resumed operation refs observe transfer-backed operations through `get()`,
  `wait()`, and `watch()` but do not initiate byte transfer
- owning services register handlers with `service.operation(key).handle(...)`
- owning service handlers that delegate terminal completion to another durable
  path return `op.defer()`; this is the only supported way to leave an accepted
  operation non-terminal after the handler settles
- public TypeScript APIs use `Result` / `AsyncResult` for expected failures
- public APIs do not expose hidden control subjects or runtime control envelopes
- operation keys are typed contract keys, not free-form strings

## Client Surface

Operations use `direction: "send"` transfer declarations when the caller sends
bytes to a service-owned transfer endpoint. RPC-issued receive grants are
consumed through the root `trellis.transfer(grant)` helper, not through
`OperationRef`.

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
  input(
    input: TInput,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
};

type OperationInputBuilder<TProgress, TOutput, TCancelable extends boolean> = {
  onAccepted(
    handler: (
      event: AcceptedOperationEvent<TProgress, TOutput>,
    ) => void | Promise<void>,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
  onStarted(
    handler: (
      event: StartedOperationEvent<TProgress, TOutput>,
    ) => void | Promise<void>,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
  onProgress(
    handler: (
      event: ProgressOperationEvent<TProgress, TOutput>,
    ) => void | Promise<void>,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
  onCompleted(
    handler: (
      event: CompletedOperationEvent<TProgress, TOutput>,
    ) => void | Promise<void>,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
  onFailed(
    handler: (
      event: FailedOperationEvent<TProgress, TOutput>,
    ) => void | Promise<void>,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
  onCancelled(
    handler: (
      event: CancelledOperationEvent<TProgress, TOutput>,
    ) => void | Promise<void>,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
  onEvent(
    handler: (
      event: OperationEvent<TProgress, TOutput>,
    ) => void | Promise<void>,
  ): OperationInputBuilder<TProgress, TOutput, TCancelable>;
  start(): AsyncResult<
    OperationRef<TProgress, TOutput, TCancelable>,
    BaseError
  >;
  transfer?: (
    body: TransferBody,
  ) => TransferOperationBuilder<TProgress, TOutput, TCancelable>;
};

type TransferOperationBuilder<TProgress, TOutput, TCancelable extends boolean> =
  {
    onAccepted(
      handler: (
        event: AcceptedOperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    onStarted(
      handler: (
        event: StartedOperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    onTransfer(
      handler: (
        event: TransferOperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    onProgress(
      handler: (
        event: ProgressOperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    onCompleted(
      handler: (
        event: CompletedOperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    onFailed(
      handler: (
        event: FailedOperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    onCancelled(
      handler: (
        event: CancelledOperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    onEvent(
      handler: (
        event: OperationEvent<TProgress, TOutput>,
      ) => void | Promise<void>,
    ): TransferOperationBuilder<TProgress, TOutput, TCancelable>;
    start(): AsyncResult<
      StartedTransfer<TProgress, TOutput, TCancelable>,
      BaseError
    >;
  };

type StartedTransfer<TProgress, TOutput, TCancelable extends boolean> = {
  operation: OperationRef<TProgress, TOutput, TCancelable>;
  wait(): AsyncResult<CompletedTransfer<TProgress, TOutput>, BaseError>;
};

type CompletedTransfer<TProgress, TOutput> = {
  transferred: FileInfo;
  terminal: TerminalOperation<TProgress, TOutput>;
};

type OperationRef<
  TProgress,
  TOutput,
  TCancelable extends boolean,
> =
  & {
    id: string;
    service: string;
    operation: string;
    get(): AsyncResult<OperationSnapshot<TProgress, TOutput>, BaseError>;
    wait(): AsyncResult<TerminalOperation<TProgress, TOutput>, BaseError>;
    watch(): AsyncResult<
      AsyncIterable<OperationEvent<TProgress, TOutput>>,
      BaseError
    >;
  }
  & (TCancelable extends true ? {
      cancel(): AsyncResult<OperationSnapshot<TProgress, TOutput>, BaseError>;
    }
    : {});
```

Example:

```ts
const refund = await billing.operation("Billing.Refund")
  .input({
    chargeId: "ch_123",
    amount: 5000,
  })
  .onProgress((event) => {
    console.log(event.progress.message);
  })
  .start()
  .orThrow();

const refundDone = await refund.wait().orThrow();
console.log(refundDone.output);

const upload = await documents.operation("Documents.Files.Upload")
  .input({
    key: "incoming/report.pdf",
    contentType: "application/pdf",
  })
  .transfer(fileBytes)
  .onTransfer((event) => {
    console.log(event.transfer.transferredBytes);
  })
  .onProgress((event) => {
    console.log(event.progress.stage);
  })
  .start()
  .orThrow();

const completed = await upload.wait().orThrow();
console.log(completed.terminal.output);
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
  }): AsyncResult<
    AcceptedOperation<TProgress, TOutput, TCancelable>,
    BaseError
  >;
  handle(
    handler: (ctx: {
      input: TInput;
      op: ActiveOperation<TProgress, TOutput, TCancelable>;
      caller: SessionUser;
      transfer?: {
        updates(): AsyncIterable<OperationTransferProgress>;
        completed(): AsyncResult<FileInfo, TransferError>;
      };
    }) => Promise<Result<TOutput, BaseError>>,
  ): Promise<void>;
};

type ActiveOperation<
  TProgress,
  TOutput,
  TCancelable extends boolean,
> =
  & {
    id: string;
    started(): AsyncResult<void, BaseError>;
    progress(value: TProgress): AsyncResult<void, BaseError>;
    complete(
      value: TOutput,
    ): AsyncResult<TerminalOperation<TProgress, TOutput>, BaseError>;
    fail(
      error: BaseError,
    ): AsyncResult<TerminalOperation<TProgress, TOutput>, BaseError>;
    defer(): OperationDeferred;
    attach<TPayload>(
      job: JobRef<TPayload, TOutput>,
    ): AsyncResult<TerminalOperation<TProgress, TOutput>, BaseError>;
  }
  & (TCancelable extends true ? {
      cancel(): AsyncResult<TerminalOperation<TProgress, TOutput>, BaseError>;
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

type OperationDeferred = {
  kind: "deferred";
};
```

Example:

```ts
await service.operation("Documents.Files.Upload").handle(
  async ({ input, op, transfer }) => {
    const transferred = await transfer.completed();
    if (transferred.isErr()) {
      return Result.err(transferred.error);
    }

    const progress = await op.progress({
      step: "stored",
      message: `Stored ${transferred.value.size} bytes`,
    });
    if (progress.isErr()) {
      return Result.err(progress.error);
    }

    return Result.ok({
      key: input.key,
      size: transferred.value.size,
    });
  },
);
```

Use `op.defer()` when the operation was accepted by this handler but will be
completed by a separate durable control path, such as an admin review decision.
Do not return a never-resolving promise to keep the operation open:

```ts
await service.operation("Devices.Activate").handle(async ({ op }) => {
  const progress = await op.progress({ status: "pending_review" });
  if (progress.isErr()) {
    return Result.err(progress.error);
  }

  return op.defer();
});
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
  transfer?: {
    chunkIndex: number;
    chunkBytes: number;
    transferredBytes: number;
  };
  output?: TOutput;
  error?: {
    type: string;
    message: string;
  };
};

type TerminalOperation<TProgress, TOutput> =
  & OperationSnapshot<TProgress, TOutput>
  & {
    state: "completed" | "failed" | "cancelled";
  };

type AcceptedOperationEvent<TProgress, TOutput> = {
  type: "accepted";
  snapshot: OperationSnapshot<TProgress, TOutput>;
};

type StartedOperationEvent<TProgress, TOutput> = {
  type: "started";
  snapshot: OperationSnapshot<TProgress, TOutput>;
};

type TransferOperationEvent<TProgress, TOutput> = {
  type: "transfer";
  transfer: {
    chunkIndex: number;
    chunkBytes: number;
    transferredBytes: number;
  };
  snapshot: OperationSnapshot<TProgress, TOutput> & {
    transfer: {
      chunkIndex: number;
      chunkBytes: number;
      transferredBytes: number;
    };
  };
};

type ProgressOperationEvent<TProgress, TOutput> = {
  type: "progress";
  progress: TProgress;
  snapshot: OperationSnapshot<TProgress, TOutput> & {
    progress: TProgress;
  };
};

type CompletedOperationEvent<TProgress, TOutput> = {
  type: "completed";
  snapshot: TerminalOperation<TProgress, TOutput>;
};

type FailedOperationEvent<TProgress, TOutput> = {
  type: "failed";
  snapshot: TerminalOperation<TProgress, TOutput>;
};

type CancelledOperationEvent<TProgress, TOutput> = {
  type: "cancelled";
  snapshot: TerminalOperation<TProgress, TOutput>;
};

type OperationEvent<TProgress, TOutput> =
  | AcceptedOperationEvent<TProgress, TOutput>
  | StartedOperationEvent<TProgress, TOutput>
  | TransferOperationEvent<TProgress, TOutput>
  | ProgressOperationEvent<TProgress, TOutput>
  | CompletedOperationEvent<TProgress, TOutput>
  | FailedOperationEvent<TProgress, TOutput>
  | CancelledOperationEvent<TProgress, TOutput>;
```

## Generation Rules

- generated runtimes MUST expose one typed `operation(key)` helper per owned or
  used operation surface
- generated runtimes MUST expose `resume(ref)` so callers can bind behavior to
  an operation reference that was returned from another contract-owned API such
  as an RPC
- generated runtimes MUST expose `input(input)` as the explicit
  operation-builder entrypoint
- generated runtimes MUST expose `input(input).transfer(body).start()` when the
  contract operation declares `transfer.direction: "send"` so callers can
  combine input, observation, transfer, and wait through one helper while still
  receiving the underlying `OperationRef`
- generated runtimes MUST keep transfer initiation off resumed or
  already-started operation refs
- generated runtimes MUST derive `OperationInputOf`, `OperationProgressOf`,
  `OperationOutputOf`, and `OperationCancelableOf` from the contract
- generated runtimes MUST hide internal control envelopes and caller reply
  subjects
- generated service runtimes MUST expose provider-side `transfer.updates()` and
  `transfer.completed()` when the contract operation declares transfer support
- generated progress events MUST carry the progress payload as both
  `event.progress` and `event.snapshot.progress`; generated transfer events MUST
  carry transfer progress as both `event.transfer` and `event.snapshot.transfer`
- generated service runtimes MAY expose `accept(...)` for non-transfer
  operations started from other owned entrypoints
- generated service runtimes MUST expose `op.defer()` on active operation
  handles and treat the returned sentinel as explicit external completion
  ownership, not as a successful operation output
- generated runtimes SHOULD omit `cancel()` from non-cancelable operation
  handles rather than exposing a method that always fails
- generated runtimes MUST preserve Trellis `Result` conventions for expected
  remote failures

## Non-Goals

- defining the internal wire envelopes used by operation control subjects
- defining Rust APIs
- defining jobs APIs beyond the minimal `JobRef` reference needed by
  `attach(...)`
