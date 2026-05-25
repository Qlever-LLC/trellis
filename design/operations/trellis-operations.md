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

This document defines operation architecture, durable state semantics,
authorization, and the internal wire/control protocol. Ordinary TypeScript and
Rust usage examples belong in `/guides/libraries/typescript`,
`/guides/libraries/rust`, and the generated references linked from `/api`.

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
        "observe": ["billing.refund"],
        "cancel": ["billing.refund.cancel"],
        "control": ["billing.refund.control"]
      },
      "signals": {
        "approveRefund": {
          "input": { "schema": "BillingRefundApproval" }
        }
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
- `capabilities.observe` gates `get`, `wait`, and `watch`; if omitted, it
  defaults to `capabilities.call`
- `capabilities.cancel` gates `cancel`; if omitted, cancellation is not
  caller-accessible unless the runtime is acting as the owning service
- `capabilities.control` gates named operation signals; if omitted, signal
  submission does not require additional Trellis capabilities beyond
  authentication and operation ownership, but services SHOULD declare explicit
  control capabilities for caller-visible workflows that accept post-start input
- `signals` declares named post-start inputs for schema validation, docs,
  authorization review, and generated SDK aliases
- `cancel: true` means the operation exposes cancellation semantics; omitted or
  `false` means callers cannot cancel it
- operations are always authenticated; invoking or observing an operation always
  requires an authenticated caller plus operation authorization

`uses` MUST support operation invocation the same way it supports RPC calls,
events, and subjects. A participant may only start remote operations that it
explicitly declares in `uses` and that its current auth state authorizes.
Follow-up gets, waits, watches, cancels, and signals are authorized against the
specific operation id, creator/owner metadata, and action-specific operation
capabilities.

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

- public operation surfaces are descriptor-driven and typed from the contract;
  exact language signatures, overloads, exported names, and generated member
  inventories belong in the generated TypeScript API reference and Rustdoc under
  `/api`
- callers configure new operations through typed builders derived from
  contract-owned operation keys, not free-form string dispatch
- `operation.<group>.<leaf>.start(input)` returns an `OperationRef`, not a
  terminal result
- `OperationRef.get()` returns the current durable snapshot
- `OperationRef.wait()` resolves from durable state and live events to a
  terminal snapshot
- `OperationRef.watch()` returns a live async stream of typed operation events
- transfer-capable operations initiate caller-to-service send transfer through
  `operation.<group>.<leaf>.input(input).transfer(body).start()`
- transfer initiation is builder-only: callers MUST NOT start an operation once
  and attach bytes later, and resumed operation references MUST only observe
  transfer-backed operations
- receive grants returned by RPCs are consumed through the root transfer helper,
  not through an operation reference; the operation reference remains an
  observation handle
- public TypeScript operations APIs MUST use `Result` / `AsyncResult` for
  expected failures rather than exception-oriented wrappers
- Rust operation APIs return Rust `Result` values directly while preserving the
  same expected-failure semantics
- runtimes MUST expose operation APIs through normal helpers; callers MUST NOT
  need to know hidden `*.Start`, `*.Get`, `*.Wait`, or `*.Watch` wire names
- public APIs MUST NOT expose hidden control subjects, caller reply subjects,
  reply-stream mechanics, or runtime control envelopes
- the TypeScript runtime exposes universal `cancel()` and `signal(...)` helpers
  on operation references; unsupported cancel or signal attempts MUST return an
  expected failure (`Result.err` / language equivalent), not throw as a normal
  control-flow path and not mutate operation state
- non-TypeScript generated runtimes SHOULD expose equivalent operation-reference
  control helpers as their operation runtime support catches up; exact current
  language support belongs in `/api` and Rustdoc
- event streams and generated callbacks MUST keep runtime control frames hidden;
  public cancellation and signal affordances are operation-reference methods,
  not lifecycle watch events

Caller surface:

- callers start async workflows with `operation.<group>.<leaf>.start(input)` and
  receive an `OperationRef`
- callers observe the operation through `get()`, `wait()`, `watch()`, and
  operation-reference control helpers such as `cancel()` and `signal(...)`
- callers send bytes for transfer-backed operations through the generated
  operation leaf's builder path,
  `operation.<group>.<leaf>.input(input).transfer(body).start()`

Owning-service surface:

- owning services register handlers with
  `service.handle.operation.<group>.<leaf>(handler)`
- generated service surfaces expose typed input, caller identity, and an active
  operation handle to handlers
- transfer-capable handlers receive provider-side transfer progress and durable
  completion helpers, such as TypeScript `transfer.updates()` /
  `transfer.completed()` or Rust `UploadTransferCompletion::completed()`
- handlers may complete operations directly or attach local jobs to them
- handler-visible active operation handles are the normal in-handler path for
  publishing lifecycle changes, progress, terminal success, terminal failure,
  cancellation, or job attachment
- owning services also expose an operation-scoped control path such as
  `service.handle.operation.<group>.<leaf>.control(operationId)` for
  service-private jobs and other durable service-owned execution paths that only
  have the operation id after handler return, restart, redelivery, retry, or
  delayed execution
- service-side control by id MUST load the durable operation record, verify the
  record belongs to the current service and requested operation key, validate
  progress/output against the operation descriptor, reject terminal mutations,
  and return normal expected errors rather than re-running the operation handler
- handler-visible active operation handles expose a durable private signal
  stream for named caller inputs submitted after start; handlers consume it
  through runtime helpers such as `signals()` or `nextSignal(name?)`
- handlers that intentionally leave terminal completion to another control path
  return `op.defer()` after recording any durable progress they own. The runtime
  MUST NOT auto-complete, auto-fail, or keep the handler promise pending for a
  deferred operation. The deferred sentinel is explicit external terminal
  ownership; it is not an operation output and MUST NOT be replaced with a
  never-resolving promise.

Generated operation runtimes MUST derive input, progress, output, cancelability,
signals, transfer behavior, and provider-side transfer helpers from the
operation descriptor. They MUST expose typed operation helpers only for
operations the participant owns or explicitly declares in `uses`, and they MUST
preserve enough descriptor metadata for language-specific generated facades. For
exact TypeScript and Rust signatures, use the generated API reference and
Rustdoc under `/api`.

### 5) Operation model

The public operation model is shared across languages. Exact exported type names
and method signatures belong in generated API reference/Rustdoc, but every
runtime MUST preserve these logical fields and semantics:

- operation state is one of pending, running, completed, failed, or cancelled
- an operation reference identifies the operation id, owning service, and
  operation key, and supports current-state reads, terminal waits, live watches,
  cancellation, and named signals; unsupported cancellation or signal submission
  returns an expected failure rather than silently succeeding
- a durable snapshot carries operation identity, a monotonic revision,
  timestamps, current state, optional typed progress, optional transfer
  progress, optional typed output, and an error view for failed terminal
  outcomes
- terminal snapshots are snapshots whose state is completed, failed, or
  cancelled
- lifecycle events carry accepted, started, transfer progress, progress,
  completed, failed, and cancelled changes as appropriate for the descriptor
- generated progress events carry the progress payload both as the event payload
  and on the embedded snapshot; generated transfer events do the same for
  transfer progress
- runtime control events that are not part of this public lifecycle remain
  hidden behind the operation reference
- accepted operation signals are private operation-control inputs; they are not
  public lifecycle events and do not appear on `watch()` unless the service
  later reflects their effects through progress or terminal snapshots

Lifecycle rules:

- the first externally visible event MUST be `accepted`
- `accepted` creates a durable operation snapshot in `pending`
- every durable snapshot exposes a monotonic public `revision`
- accepted signals are persisted with a private monotonic signal sequence and do
  not increment the public snapshot `revision`
- `started` transitions the snapshot to `running`
- `transfer` updates the stored transfer progress payload, emits once per
  acknowledged chunk, and MUST carry that payload as both `event.transfer` and
  `event.snapshot.transfer`
- `progress` updates the stored progress payload, does not change terminal
  state, and MUST carry that payload as both `event.progress` and
  `event.snapshot.progress`
- `completed`, `failed`, and `cancelled` are terminal
- a service handler may explicitly defer terminal completion only by returning
  the runtime's operation-deferred sentinel. Deferral means the accepted
  operation remains durable and non-terminal until another authorized service
  path completes, fails, or cancels the same operation id.
- service-side control by id is that durable external terminal path for
  service-private jobs. Calling it MUST NOT create a new operation, publish a
  new `accepted` event, or invoke the original operation handler again.

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

The TypeScript public API is `operation.<group>.<leaf>.start(input)` plus
`OperationRef.get/wait/watch/cancel/signal`. Other language runtimes expose the
same protocol through their generated facade support as it lands. The underlying
wire model is standardized enough for auth and codegen.

Rules:

- invoking an operation publishes the input payload to the operation's declared
  `subject`
- every operation also has a derived control subject: `<subject>.control`
- the runtime uses the control subject for `get`, `wait`, `watch`, `cancel`, and
  `signal`
- `watch` and `wait` send a reply subject under the caller's `_INBOX` prefix and
  receive responses on that subject
- `get`, `cancel`, and `signal` are single-response control requests
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
  `operation.<group>.<leaf>.start(input)`

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
  }
  | {
    action: "signal";
    operationId: string;
    signal: string;
    input?: JsonValue;
  };
```

Rules:

- `operationId` is always required for control requests
- `signal` is the contract-declared signal name for `action: "signal"`
- `input` is validated against the matching signal descriptor's input schema;
  rejected signals are not persisted
- the public runtime owns this envelope; user code never constructs it directly
- every control request MUST be authenticated and authorization-checked against
  the referenced operation id

#### 7c) Internal control response frames

`get`, `wait`, `watch`, `cancel`, and `signal` all respond with standardized
internal frames on the validated caller reply subject.

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
    kind: "signal-accepted";
    operationId: string;
    signal: string;
    signalSequence: number;
    acceptedAt: string;
    snapshot: OperationSnapshot<TProgress, TOutput>;
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
- `signalSequence` is a private monotonically increasing signal-log sequence
  scoped to one operation id and is independent of public snapshot `revision`
- `error` frames are expected control-request failures or runtime/internal
  protocol failures; domain failure outcomes remain normal terminal operation
  snapshots with state `failed`
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
- if the descriptor is not cancelable, the service MUST return an `error` frame
  and MUST NOT mutate the durable operation state
- cancel authorization uses `capabilities.cancel`, not `capabilities.control`
- MUST then close the reply stream

`signal`:

- sends one `OperationControlRequest` with `action: "signal"`
- receives exactly one `signal-accepted` frame containing the accepted signal
  sequence and current durable snapshot, or one `error` frame
- the service MUST persist the accepted signal before acknowledging it
- the service MUST reject unknown signal names, invalid signal payloads,
  terminal operations, and operations not running in the current service process
- accepted signals MUST NOT emit public watch events by themselves
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
- observe access (`get`, `wait`, `watch`) is gated by authentication,
  `capabilities.observe`, and the owning service's operation-level authorization
  logic
- cancel access is gated by authentication, `capabilities.cancel`, and the
  owning service's operation-level authorization logic
- signal access is gated by authentication, `capabilities.control`, and the
  owning service's operation-level authorization logic
- the owning service MUST persist enough operation ownership metadata to
  authorize follow-up access to a specific operation id
- the default runtime rule is creator-bound visibility: the principal that
  created the operation may observe it later unless the owning service
  explicitly grants broader domain access

Trellis MUST NOT introduce a broad deployment-wide capability equivalent to
"observe every operation everywhere" for ordinary clients.

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
- when a handler returns `op.defer()`, the corresponding job SHOULD resume the
  operation through the public operation-scoped service control helper using
  only the stored `operationId`
- callers never need to know internal job ids or job types
- changing internal job topology MUST NOT break the public operation contract

### 11) Realistic example

Scenario:

- `Billing.Refund` is the public operation
- `submitRefund` is an internal billing job
- `Payments.Refund` is a remote operation exposed by the `payments` service
- `Notifications.Email.Send` is another remote operation that is not part of
  refund completion semantics

The caller starts `Billing.Refund`, receives an operation reference, watches
progress, and waits for a terminal snapshot. The billing service may accept the
operation, persist its operation id, enqueue `submitRefund`, and return a
deferred sentinel. The job later resumes service-side operation control by id,
marks the operation started, publishes domain progress, invokes
`Payments.Refund`, optionally triggers a notification, and completes or fails
the original billing operation.

The important design invariant is that callers depend only on the public
`Billing.Refund` operation contract. They do not see the billing job id, the job
queue topology, or whether notification sending is implemented as an operation,
RPC, event, or local side effect. Language-specific code for this scenario
belongs in `/guides/libraries/typescript`, `/guides/libraries/rust`, and `/api`.
