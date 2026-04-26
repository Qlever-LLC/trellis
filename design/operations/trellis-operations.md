---
title: Trellis Operations
description: Caller-visible asynchronous workflow model, including durable state, watch semantics, and internal control protocol.
order: 10
---

# Design: Trellis Operations

## Prerequisites

- [../core/trellis-patterns.md](./../core/trellis-patterns.md) - service and
  library patterns
- [../contracts/trellis-contracts-catalog.md](./../contracts/trellis-contracts-catalog.md) -
  contract model and permission derivation
- [../auth/trellis-auth.md](./../auth/trellis-auth.md) - session proofs, inbox
  permissions, and reply-subject validation
- [../jobs/trellis-jobs.md](./../jobs/trellis-jobs.md) - service-local
  background execution

## Context

Trellis needs a clear model for caller-visible asynchronous workflows.

Today, long-running work is often implemented with service-local jobs, but jobs
are the wrong public abstraction:

- jobs are service-internal execution machinery
- job topology may change without changing the service contract
- global jobs visibility is too broad for ordinary callers
- caller-visible async work needs durable state, typed progress, and private
  live updates

We therefore need a distinct concept for async work that belongs in the public
service contract. Operations are part of the Trellis API model, alongside RPCs,
events, and owned subject spaces.

## Design

### 1) Jobs and operations are different things

- a `job` is a service-private execution primitive
- an `operation` is a caller-visible async contract owned by one service
- callers interact with operations; service internals may implement those
  operations with jobs, direct orchestration, or other storage/compute
  strategies

Regular users and peer services MUST NOT depend on `trellis.jobs` for normal
product behavior. `trellis.jobs` is an admin and observability surface. Public
async workflows belong to the owning service's operations.

### 2) Operations are part of the contract and API surface

Contracts MAY declare owned operations in a top-level `operations` object. These
are public API entries, not documentation-only annotations or an implementation
hint for jobs.

Example:

```json
{
  "operations": {
    "Billing.Refund": {
      "version": "v1",
      "subject": "operations.v1.Billing.Refund",
      "input": { "schema": "BillingRefundRequest" },
      "progress": { "schema": "BillingRefundProgress" },
      "output": { "schema": "BillingRefundResult" },
      "capabilities": {
        "call": ["billing.refund"],
        "read": ["billing.refund"],
        "cancel": ["billing.refund.cancel"]
      },
      "cancel": true
    }
  }
}
```

Descriptor rules:

- `subject` SHOULD default to `operations.<version>.<LogicalName>` when omitted
- `input` and `output` are required schema references
- `progress` is optional; if omitted, the operation does not emit typed progress
  payloads
- `capabilities.call` gates initial invocation
- `capabilities.read` gates `get`, `wait`, and `watch`; if omitted, it defaults
  to `capabilities.call`
- `capabilities.cancel` gates `cancel`; if omitted, cancellation is not
  caller-accessible unless the runtime is acting as the owning service
- `cancel: true` means the operation exposes cancellation semantics; omitted or
  `false` means callers cannot cancel it
- operations are always authenticated; invoking or observing an operation always
  requires an authenticated caller plus operation authorization

`uses` MUST support operations the same way it supports RPCs, events, and
subjects. A participant may only invoke, read, or cancel remote operations that
it explicitly declares in `uses` and that its current auth state authorizes.

### 3) Operations are durable by default

An operation is not just a live stream. The owning service MUST persist enough
operation state to support:

- `get()` after disconnect or process restart
- `wait()` after reconnect
- authorization checks against a specific operation id

The storage mechanism is service-owned and is not centralized in `trellis.jobs`.
The service MAY use KV, streams, a database, or another durable local
persistence strategy, but the public semantics are uniform:

- an operation has a durable snapshot
- an operation may emit live events
- `watch()` complements durable state; it does not replace it

### 4) Public runtime API

Rules:

- `operation(...).input(...).start()` returns an `OperationRef`, not a terminal
  result
- `OperationRef.get()` returns the current durable snapshot
- `OperationRef.wait()` resolves from durable state and live events to a
  terminal snapshot
- `OperationRef.watch()` returns a live async stream of typed operation events
- transfer-capable operations initiate caller-to-service send transfer through
  `operation(...).input(...).transfer(body).start()`
- public TypeScript operations APIs MUST use `Result` / `AsyncResult` for
  expected failures rather than exception-oriented wrappers
- runtimes MUST expose operation APIs through normal helpers; callers MUST NOT
  need to know hidden `*.Start`, `*.Get`, `*.Wait`, or `*.Watch` wire names

Caller surface:

- callers start async workflows with `operation(key).input(input).start()` and
  receive an `OperationRef`
- callers observe the operation through `get()`, `wait()`, `watch()`, and
  optional `cancel()`
- callers send bytes for transfer-backed operations through
  `operation(key).input(input).transfer(body).start()`

Owning-service surface:

- owning services register handlers with
  `service.operation(key).handle(handler)`
- transfer-capable handlers receive provider-side `transfer.updates()` and
  `transfer.completed()` helpers
- handlers may complete operations directly or attach local jobs to them

Language-specific public API details live in:

- [operations-typescript-api.md](./operations-typescript-api.md)
- [operations-rust-api.md](./operations-rust-api.md)

### 5) Operation types

Canonical logical shapes:

```ts
type OperationState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

type OperationRef<TProgress, TOutput> = {
  id: string;
  service: string;
  operation: string;
  get(): AsyncResult<OperationSnapshot<TProgress, TOutput>, BaseError>;
  wait(): AsyncResult<TerminalOperation<TProgress, TOutput>, BaseError>;
  watch(): AsyncResult<
    AsyncIterable<OperationEvent<TProgress, TOutput>>,
    BaseError
  >;
  cancel?(): AsyncResult<OperationSnapshot<TProgress, TOutput>, BaseError>;
};

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

type OperationEvent<TProgress, TOutput> =
  | { type: "accepted"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | { type: "started"; snapshot: OperationSnapshot<TProgress, TOutput> }
  | {
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
  }
  | {
    type: "progress";
    progress: TProgress;
    snapshot: OperationSnapshot<TProgress, TOutput> & {
      progress: TProgress;
    };
  }
  | { type: "completed"; snapshot: TerminalOperation<TProgress, TOutput> }
  | { type: "failed"; snapshot: TerminalOperation<TProgress, TOutput> }
  | { type: "cancelled"; snapshot: TerminalOperation<TProgress, TOutput> };
```

Lifecycle rules:

- the first externally visible event MUST be `accepted`
- `accepted` creates a durable operation snapshot in `pending`
- `started` transitions the snapshot to `running`
- `transfer` updates the stored transfer progress payload, emits once per
  acknowledged chunk, and MUST carry that payload as both `event.transfer` and
  `event.snapshot.transfer`
- `progress` updates the stored progress payload, does not change terminal
  state, and MUST carry that payload as both `event.progress` and
  `event.snapshot.progress`
- `completed`, `failed`, and `cancelled` are terminal

### 6) Operations use caller `_INBOX` subjects for live watch streams

Operation watch streams MUST use the caller's inbox space.

Rules:

- the caller opens `watch()` on the same authenticated NATS connection it
  already owns
- the runtime uses a reply subject under the caller's `_INBOX` prefix
- the service MUST validate that the reply subject starts with the caller's
  authorized inbox prefix
- the service streams operation events to that reply subject
- no new NATS connection is required to watch an operation

This keeps operation watches private to the authenticated caller while avoiding
general-purpose cross-service subscribe grants.

### 7) Operation wire model

The public API is `operation(...).input(...).start()` plus
`OperationRef.get/wait/watch/cancel`. Those methods are part of the normal
generated Trellis API surface, while the underlying wire model is standardized
enough for auth and codegen.

Rules:

- invoking an operation publishes the input payload to the operation's declared
  `subject`
- every operation also has a derived control subject: `<subject>.control`
- the runtime uses the control subject for `get`, `wait`, `watch`, and `cancel`
- `watch` and `wait` send a reply subject under the caller's `_INBOX` prefix and
  receive responses on that subject
- `get` and `cancel` are single-response control requests
- `watch` is a streaming control request
- `wait` is a streaming or long-poll control request that terminates on the
  first terminal snapshot

The control envelope format is an internal Trellis runtime detail rather than a
service-authored contract type, but it is still fixed by this document so
independent implementations remain compatible.

#### 7a) Internal invoke response envelope

Starting an operation sends the contract-defined input payload to the operation
subject and receives exactly one accepted response on the caller reply subject.

```ts
type OperationAcceptedEnvelope<TProgress, TOutput> = {
  kind: "accepted";
  ref: {
    id: string;
    service: string;
    operation: string;
  };
  snapshot: OperationSnapshot<TProgress, TOutput> & {
    revision: number;
  };
  transfer?: TransferGrant & { direction: "send" };
};
```

Rules:

- the service MUST allocate the operation id before replying
- the accepted reply MUST include the initial durable snapshot
- transfer-capable operations MUST include the runtime-owned send transfer
  session data needed to execute the builder-managed send step
- the initial snapshot revision MUST be `1`
- the accepted reply is the only response sent for
  `operation(...).input(...).start()`

#### 7b) Internal control request envelope

All follow-up operation control requests publish a runtime-owned envelope to
`<subject>.control`.

```ts
type OperationControlRequest =
  | {
    action: "get";
    operationId: string;
  }
  | {
    action: "wait";
    operationId: string;
    includeProgress?: boolean;
  }
  | {
    action: "watch";
    operationId: string;
  }
  | {
    action: "cancel";
    operationId: string;
  };
```

Rules:

- `operationId` is always required for control requests
- the public runtime owns this envelope; user code never constructs it directly
- every control request MUST be authenticated and authorization-checked against
  the referenced operation id

#### 7c) Internal control response frames

`get`, `wait`, `watch`, and `cancel` all respond with standardized internal
frames on the validated caller reply subject.

```ts
type OperationControlFrame<TProgress, TOutput> =
  | {
    kind: "snapshot";
    snapshot:
      & (
        | OperationSnapshot<TProgress, TOutput>
        | TerminalOperation<TProgress, TOutput>
      )
      & {
        revision: number;
      };
  }
  | {
    kind: "event";
    sequence: number;
    event: OperationEvent<TProgress, TOutput>;
  }
  | {
    kind: "keepalive";
  }
  | {
    kind: "error";
    error: {
      type: string;
      message: string;
    };
  };
```

Rules:

- `revision` is a monotonically increasing durable snapshot version scoped to
  one operation id
- `sequence` is a monotonically increasing stream sequence scoped to one
  operation id
- `error` frames are runtime/internal protocol failures; domain failure outcomes
  remain normal terminal operation snapshots with state `failed`
- runtimes MUST hide these internal frames behind `OperationRef` methods

#### 7d) Internal method behavior

`get`:

- sends one `OperationControlRequest` with `action: "get"`
- receives exactly one `snapshot` or `error` frame
- MUST then close the reply stream

`wait`:

- sends one `OperationControlRequest` with `action: "wait"`
- if the operation is already terminal, receives exactly one terminal `snapshot`
  frame and closes
- otherwise receives zero or more `event` frames, optional `keepalive` frames,
  then exactly one terminal `snapshot` frame and closes

`watch`:

- sends one `OperationControlRequest` with `action: "watch"`
- receives exactly one initial `snapshot` frame representing current durable
  state
- then receives zero or more `event` frames and optional `keepalive` frames
- after a terminal event, the service MUST close the reply stream

`cancel`:

- sends one `OperationControlRequest` with `action: "cancel"`
- receives exactly one `snapshot` frame containing the post-cancel durable
  state, or one `error` frame
- MUST then close the reply stream

Keepalive rules:

- `keepalive` frames are optional for `watch` and `wait`
- if emitted, they MUST NOT carry domain data
- if emitted, the interval MUST be at least 5 seconds and at most 30 seconds

### 8) Auth model for operations

Operations eliminate the need for a global end-user jobs-read capability.

Authorization rules:

- invocation is gated by authentication plus the operation's declared
  `capabilities.call`
- read access (`get`, `wait`, `watch`) is gated by authentication,
  `capabilities.read`, and the owning service's operation-level authorization
  logic
- cancel access is gated by authentication, `capabilities.cancel`, and the
  owning service's operation-level authorization logic
- the owning service MUST persist enough operation ownership metadata to
  authorize follow-up access to a specific operation id
- the default runtime rule is creator-bound visibility: the principal that
  created the operation may read it later unless the owning service explicitly
  grants broader domain access

Trellis MUST NOT introduce a broad deployment-wide capability equivalent to
"read every operation everywhere" for ordinary clients.

### 9) Auth callout and reply permissions

Unary RPC response semantics are insufficient for operation watch streams.

Rules:

- Trellis auth MUST permit bounded multi-response publishing to a validated
  caller reply subject for authenticated operation streams
- this permission applies to a reply subject derived from a request the service
  actually received; it is not a general publish grant to arbitrary inbox
  subjects
- unary RPCs remain single-response operations by convention even if the
  transport permission can support multiple responses

This keeps the security property of reply-subject validation while allowing
streamed responses for operations.

### 10) Jobs remain the service-private execution layer

Operations and jobs integrate, but they do not collapse into one concept.

Rules:

- a service MAY back an operation with one or more local jobs
- internal jobs SHOULD carry `operationId` when they contribute to
  caller-visible async work
- a service runtime SHOULD provide a helper to attach a `JobRef` to an
  `OperationRef`
- callers never need to know internal job ids or job types
- changing internal job topology MUST NOT break the public operation contract

### 11) Realistic example

Caller-visible API:

```ts
const refund = await billing.operation("Billing.Refund")
  .input({
    chargeId: "ch_123",
    amount: 5000,
  })
  .start()
  .orThrow();

for await (const event of await refund.watch().orThrow()) {
  if (event.type === "progress") {
    console.log(event.progress);
  }
}

const done = await refund.wait().orThrow();
```

Owning service:

```ts
await billing.operation("Billing.Refund").handle(async ({ input, op }) => {
  const job = await service.jobs.submitRefund.create({
    operationId: op.id,
    chargeId: input.chargeId,
    amount: input.amount,
  });

  return await op.attach(job);
});

await service.jobs.submitRefund.handle(async ({ job }) => {
  const { operationId, chargeId, amount } = job.payload;

  await operations.started(operationId);
  await operations.progress(operationId, {
    step: "processor",
    message: "Submitting refund to payment processor",
  });

  const payment = await payments.operation("Payments.Refund")
    .input({
      chargeId,
      amount,
    })
    .start();

  const paymentDone = await payment.wait();
  if (paymentDone.isErr()) {
    return Result.err(paymentDone.error);
  }

  void notifications.operation("Notifications.Email.Send")
    .input({
      template: "refund-receipt",
      refundId: paymentDone.value.output.refundId,
    })
    .start();

  return Result.ok({
    refundId: paymentDone.value.output.refundId,
    status: "refunded",
  });
});
```

In this example:

- `Billing.Refund` is the public operation
- `submitRefund` is an internal billing job
- `Payments.Refund` is a remote operation exposed by the `payments` service
- `Notifications.Email.Send` is another remote operation that is not part of
  refund completion semantics
