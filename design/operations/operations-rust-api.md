---
title: Operations Rust API
description: Public Rust client and service APIs for Trellis operations.
order: 30
---

# Design: Operations Rust API

## Prerequisites

- [trellis-operations.md](./trellis-operations.md) - subsystem semantics and internal protocol
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - shared type-system and error guidance
- [../contracts/trellis-rust-contract-libraries.md](./../contracts/trellis-rust-contract-libraries.md) - contract-driven Rust surfaces

## Scope

This document defines the normative Rust public API surface for Trellis operations.

It defines only the Rust-facing surface. Internal control subjects, reply-stream framing, and auth rules remain in `trellis-operations.md`.

## Design Rules

- callers start operations with `operation::<Op>().start(input)`
- callers observe work through `OperationRef`
- owning services register handlers with `service.operation::<Op>().handle(...)`
- Rust returns `Result` directly rather than a JavaScript `Result` object, but the semantics match `../core/type-system-patterns.md`
- public Rust APIs do not expose hidden control subjects or runtime control envelopes

## Client Surface

```rust
pub trait OperationClient {
    fn operation<TOp>(&self) -> OperationInvoker<TOp>
    where
        TOp: OperationDescriptor;
}

pub trait OperationDescriptor {
    type Input;
    type Progress;
    type Output;
    const CANCELABLE: bool;
}

pub trait OperationInvoker<TOp>
where
    TOp: OperationDescriptor,
{
    async fn start(
        &self,
        input: TOp::Input,
    ) -> Result<OperationRef<TOp::Progress, TOp::Output>, OperationsError>;
}

pub struct OperationRef<TProgress, TOutput> {
    // opaque
}

impl<TProgress, TOutput> OperationRef<TProgress, TOutput> {
    pub async fn get(&self) -> Result<OperationSnapshot<TProgress, TOutput>, OperationsError>;
    pub async fn wait(&self) -> Result<TerminalOperation<TProgress, TOutput>, OperationsError>;
    pub async fn watch(
        &self,
    ) -> Result<impl Stream<Item = Result<OperationEvent<TProgress, TOutput>, OperationsError>>, OperationsError>;
}

pub trait CancelableOperationRef<TProgress, TOutput> {
    async fn cancel(&self) -> Result<OperationSnapshot<TProgress, TOutput>, OperationsError>;
}
```

Example:

```rust
let op = billing
    .operation::<BillingRefundOperation>()
    .start(BillingRefundRequest {
        charge_id: "ch_123".into(),
        amount: 5000,
    })
    .await?;

let snapshot = op.get().await?;
let done = op.wait().await?;

let mut watch = op.watch().await?;
while let Some(event) = watch.next().await {
    let event = event?;
    // typed progress/output
}
```

## Service-Owned Surface

```rust
pub trait OperationService {
    fn operation<TOp>(&self) -> OwnedOperation<TOp>
    where
        TOp: OperationDescriptor;
}

pub trait OwnedOperation<TOp>
where
    TOp: OperationDescriptor,
{
    async fn handle<H, Fut>(&self, handler: H) -> Result<(), OperationsError>
    where
        H: Fn(OperationContext<TOp>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<TOp::Output, OperationsError>> + Send;
}

pub struct OperationContext<TOp>
where
    TOp: OperationDescriptor,
{
    pub input: TOp::Input,
    pub op: ActiveOperation<TOp::Progress, TOp::Output>,
    pub caller: SessionUser,
}

pub struct ActiveOperation<TProgress, TOutput> {
    // opaque
}

impl<TProgress, TOutput> ActiveOperation<TProgress, TOutput> {
    pub fn id(&self) -> &str;
    pub async fn started(&self) -> Result<(), OperationsError>;
    pub async fn progress(&self, value: TProgress) -> Result<(), OperationsError>;
    pub async fn complete(
        &self,
        value: TOutput,
    ) -> Result<TerminalOperation<TProgress, TOutput>, OperationsError>;
    pub async fn fail(
        &self,
        error: OperationsError,
    ) -> Result<TerminalOperation<TProgress, TOutput>, OperationsError>;
    pub async fn attach<TPayload>(
        &self,
        job: JobRef<TPayload, TOutput>,
    ) -> Result<TerminalOperation<TProgress, TOutput>, OperationsError>;
}

pub trait CancelableActiveOperation<TProgress, TOutput> {
    async fn cancel(&self) -> Result<TerminalOperation<TProgress, TOutput>, OperationsError>;
}
```

Example:

```rust
service
    .operation::<BillingRefundOperation>()
    .handle(|ctx| async move {
        ctx.op.started().await?;
        ctx.op
            .progress(BillingRefundProgress {
                step: "processor".into(),
                message: "Submitting refund".into(),
            })
            .await?;

        let job = service
            .jobs()
            .refund_charge()
            .create(RefundChargePayload {
                operation_id: ctx.op.id().to_string(),
                charge_id: ctx.input.charge_id,
                amount: ctx.input.amount,
            })
            .await?;

        ctx.op.attach(job).await
    })
    .await?;
```

## Shared Types

```rust
pub enum OperationState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

pub struct OperationSnapshot<TProgress, TOutput> {
    pub id: String,
    pub service: String,
    pub operation: String,
    pub state: OperationState,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub progress: Option<TProgress>,
    pub output: Option<TOutput>,
    pub error: Option<OperationErrorView>,
}

pub type TerminalOperation<TProgress, TOutput> = OperationSnapshot<TProgress, TOutput>;

pub enum OperationEvent<TProgress, TOutput> {
    Accepted { snapshot: OperationSnapshot<TProgress, TOutput> },
    Started { snapshot: OperationSnapshot<TProgress, TOutput> },
    Progress { snapshot: OperationSnapshot<TProgress, TOutput> },
    Completed { snapshot: TerminalOperation<TProgress, TOutput> },
    Failed { snapshot: TerminalOperation<TProgress, TOutput> },
    Cancelled { snapshot: TerminalOperation<TProgress, TOutput> },
}
```

## Generation Rules

- generated Rust surfaces MUST derive operation descriptors from the contract manifest
- generated Rust surfaces MUST expose `operation::<Op>()` only for owned or explicitly used operations
- generated Rust surfaces MUST hide internal control envelopes and reply-subject mechanics
- generated Rust surfaces SHOULD implement cancellation only for cancelable operations

## Non-Goals

- defining the internal wire envelopes used by operation control subjects
- defining TypeScript APIs
- defining jobs APIs beyond the minimal `JobRef` reference needed by `attach(...)`
