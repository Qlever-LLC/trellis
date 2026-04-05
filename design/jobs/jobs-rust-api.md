---
title: Jobs Rust API
description: Public Rust service-local and admin APIs for Trellis jobs.
order: 30
---

# Design: Jobs Rust API

## Prerequisites

- [trellis-jobs.md](./trellis-jobs.md) - subsystem semantics and authorization model
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - shared type-system and error guidance
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) - public async workflows that may attach to jobs

## Design

The Rust jobs surface mirrors the TypeScript jobs model, but it uses Rust-native traits, structs, and `Result`-based ergonomics. Service-local code works against typed job queues and handles, while admin code uses a separate query client surface.

It covers:

- service-local job creation and handling
- worker host lifecycle
- operator/admin query APIs

It does not redefine the jobs stream model, storage model, or admin authorization model; those remain in `trellis-jobs.md`.

The Rust API keeps jobs typed by job type, keeps admin access separate from service execution, and avoids exposing manual binding assembly in normal code.

Jobs are service-private execution primitives.

Service-local Rust jobs APIs are typed per job type.

`create(...)` returns `JobRef`.

`JobRef.wait()` is valid internally but is not a public caller contract.

Rust returns `Result` directly and does not model expected failures with exceptions.

Public service-local jobs APIs do not expose manual binding assembly or conversion helpers.

### Service-local surface

```rust
pub trait JobsService {
    fn jobs(&self) -> JobsFacade;
}

pub trait JobsFacade {
    fn refund_charge(&self) -> impl JobQueue<RefundChargePayload, RefundChargeResult>;
    async fn start_workers(&self) -> Result<JobWorkerHost, JobsError>;
}

pub trait JobQueue<TPayload, TResult> {
    async fn create(&self, payload: TPayload) -> Result<JobRef<TPayload, TResult>, JobsError>;
    async fn handle<H, Fut>(&self, handler: H) -> Result<(), JobsError>
    where
        H: Fn(ActiveJob<TPayload, TResult>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<TResult, JobsError>> + Send;
}

pub struct JobRef<TPayload, TResult> {
    // opaque
}

impl<TPayload, TResult> JobRef<TPayload, TResult> {
    pub async fn get(&self) -> Result<JobSnapshot<TPayload, TResult>, JobsError>;
    pub async fn wait(&self) -> Result<TerminalJob<TPayload, TResult>, JobsError>;
    pub async fn cancel(&self) -> Result<JobSnapshot<TPayload, TResult>, JobsError>;
}

pub struct ActiveJob<TPayload, TResult> {
    // opaque
}

impl<TPayload, TResult> ActiveJob<TPayload, TResult> {
    pub fn payload(&self) -> &TPayload;
    pub fn is_cancelled(&self) -> bool;
    pub async fn heartbeat(&self) -> Result<(), JobsError>;
    pub async fn progress(&self, value: JobProgress) -> Result<(), JobsError>;
    pub async fn log(&self, entry: JobLogEntry) -> Result<(), JobsError>;
    pub fn redelivery_count(&self) -> u64;
    pub fn is_redelivery(&self) -> bool;
}

pub trait JobWorkerHost {
    async fn stop(&self) -> Result<(), JobsError>;
    async fn join(&self) -> Result<(), JobsError>;
}
```

Example:

```rust
let created = service
    .jobs()
    .refund_charge()
    .create(RefundChargePayload {
        operation_id: op.id().to_string(),
        charge_id: input.charge_id.clone(),
        amount: input.amount,
    })
    .await?;

let terminal = created.wait().await?;

service
    .jobs()
    .refund_charge()
    .handle(|job| async move {
        job.progress(JobProgress {
            step: Some("processor".into()),
            message: Some("Submitting refund".into()),
            current: None,
            total: None,
        })
        .await?;

        Ok(RefundChargeResult {
            refund_id: "rf_123".into(),
            status: "refunded".into(),
        })
    })
    .await?;

let host = service.jobs().start_workers().await?;
host.stop().await?;
```

### Shared service-local types

```rust
pub struct JobProgress {
    pub step: Option<String>,
    pub message: Option<String>,
    pub current: Option<u64>,
    pub total: Option<u64>,
}

pub struct JobSnapshot<TPayload, TResult> {
    pub id: String,
    pub service: String,
    pub r#type: String,
    pub state: JobState,
    pub payload: TPayload,
    pub result: Option<TResult>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub tries: u64,
    pub max_tries: u64,
    pub last_error: Option<String>,
    pub progress: Option<JobProgress>,
    pub logs: Vec<JobLogEntry>,
}

pub type TerminalJob<TPayload, TResult> = JobSnapshot<TPayload, TResult>;
```

All job progress fields are optional. Use `step` and `message` for human-readable status, and `current` / `total` only when you have a numeric progress fraction.

### Admin surface

```rust
pub trait JobsAdminClient {
    async fn health(&self) -> Result<JobsHealth, JobsError>;
    async fn list_services(&self) -> Result<Vec<ServiceInfo>, JobsError>;
    async fn list(
        &self,
        filter: JobFilter,
    ) -> Result<Vec<JobSnapshot<serde_json::Value, serde_json::Value>>, JobsError>;
    async fn get(
        &self,
        id: JobIdentity,
    ) -> Result<JobSnapshot<serde_json::Value, serde_json::Value>, JobsError>;
    async fn cancel(
        &self,
        id: JobIdentity,
    ) -> Result<JobSnapshot<serde_json::Value, serde_json::Value>, JobsError>;
    async fn retry(
        &self,
        id: JobIdentity,
    ) -> Result<JobSnapshot<serde_json::Value, serde_json::Value>, JobsError>;
    async fn list_dlq(
        &self,
        filter: JobFilter,
    ) -> Result<Vec<JobSnapshot<serde_json::Value, serde_json::Value>>, JobsError>;
    async fn replay_dlq(
        &self,
        id: JobIdentity,
    ) -> Result<JobSnapshot<serde_json::Value, serde_json::Value>, JobsError>;
    async fn dismiss_dlq(
        &self,
        id: JobIdentity,
    ) -> Result<JobSnapshot<serde_json::Value, serde_json::Value>, JobsError>;
}

pub struct JobIdentity {
    pub service: String,
    pub job_type: String,
    pub id: String,
}

pub struct JobFilter {
    pub service: Option<String>,
    pub job_type: Option<String>,
    pub state: Option<JobState>,
}
```

Example:

```rust
let jobs = trellis.jobs();

let services = jobs.list_services().await?;
let listed = jobs.list(JobFilter {
    service: Some("billing".into()),
    job_type: None,
    state: None,
}).await?;
let one = jobs.get(JobIdentity {
    service: "billing".into(),
    job_type: "refund-charge".into(),
    id: "job_123".into(),
}).await?;
```

## Generation Rules

- generated Rust service surfaces MUST expose one typed method per declared job type such as `jobs().refund_charge()`
- any generic string-based queue lookup helper is a low-level escape hatch and MUST NOT be the primary public API
- `start_workers()` owns binding resolution and worker-loop startup; application code SHOULD NOT pass runtime bindings manually
- operator/admin APIs MAY return wire-shaped `serde_json::Value` payload and result fields because they are an observability and debugging surface rather than a typed service-author execution surface

## Non-goals

- defining TypeScript jobs APIs
- defining public caller-visible async workflows; use operations for that
- redefining the jobs wire model or centralized admin RPC contract
