---
title: Jobs Rust API
description: Public Rust service-local and admin APIs for Trellis jobs.
order: 30
---

# Design: Jobs Rust API

## Prerequisites

- [trellis-jobs.md](./trellis-jobs.md) - subsystem semantics and authorization
  model
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - shared
  type-system and error guidance
- [../operations/trellis-operations.md](./../operations/trellis-operations.md) -
  public async workflows that may attach to jobs

## Design

The Rust jobs surface mirrors the TypeScript jobs model, but it uses Rust-native
traits, structs, and `Result`-based ergonomics. Service-local code works against
typed job queues and handles, while admin code uses the generated jobs SDK over
the `Jobs.*` RPC surface.

It covers:

- service-local job creation and handling
- service-owned worker lifecycle
- operator/admin query APIs

It does not redefine the jobs stream model, storage model, or admin
authorization model; those remain in `trellis-jobs.md`.

The Rust API keeps jobs typed by job type, keeps admin access separate from
service execution, and avoids exposing manual binding assembly in normal code.

Jobs are service-private execution primitives.

Service-local Rust jobs APIs are typed per job type.

`create(...)` returns `JobRef`.

`JobRef.wait()` is valid internally but is not a public caller contract.

Rust returns `Result` directly and does not model expected failures with
exceptions.

Public service-local jobs APIs do not expose manual binding assembly or
conversion helpers.

### Service-local surface

```rust
pub trait JobsService {
    fn jobs(&self) -> JobsFacade;
}

pub trait JobsFacade {
    fn refund_charge(&self) -> impl JobQueue<RefundChargePayload, RefundChargeResult>;
}

pub trait JobQueue<TPayload, TResult> {
    async fn create(&self, payload: TPayload) -> Result<JobRef<TPayload, TResult>, JobsError>;
    fn handle<H, Fut>(&self, handler: H)
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
    });

service.wait().await?;
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

All job progress fields are optional. Use `step` and `message` for
human-readable status, and `current` / `total` only when you have a numeric
progress fraction.

### Admin RPC surface

```rust
use trellis_sdk_jobs::JobsClient;

pub struct JobsClient<'a> {
    // wraps an already connected low-level Trellis client
}

impl<'a> JobsClient<'a> {
    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self;

    pub async fn jobs_list_services(
        &self,
    ) -> Result<trellis_sdk_jobs::JobsListServicesResponse, trellis_client::TrellisClientError>;

    pub async fn jobs_list(
        &self,
        request: &trellis_sdk_jobs::JobsListRequest,
    ) -> Result<trellis_sdk_jobs::JobsListResponse, trellis_client::TrellisClientError>;

    pub async fn jobs_get(
        &self,
        request: &trellis_sdk_jobs::JobsGetRequest,
    ) -> Result<trellis_sdk_jobs::JobsGetResponse, trellis_client::TrellisClientError>;
}
```

Example:

```rust
let jobs = trellis_sdk_jobs::JobsClient::new(&trellis);

let services = jobs.jobs_list_services().await?;
let listed = jobs.jobs_list(&trellis_sdk_jobs::JobsListRequest {
    service: Some("billing".into()),
    r#type: None,
    state: None,
    since: None,
    limit: None,
})
.await?;
let one = jobs.jobs_get(&trellis_sdk_jobs::JobsGetRequest {
    service: "billing".into(),
    job_type: "refund-charge".into(),
    id: "job_123".into(),
})
.await?;
```

## Generation Rules

- generated Rust service surfaces MUST expose one typed method per declared job
  type such as `jobs().refund_charge()`
- any generic string-based queue lookup helper is a low-level escape hatch and
  MUST NOT be the primary public API
- `start_workers()` owns binding resolution and worker-loop startup; application
  code SHOULD NOT pass runtime bindings manually
- operator/admin APIs MAY return wire-shaped `serde_json::Value` payload and
  result fields because they are an observability and debugging surface rather
  than a typed service-author execution surface
- connected Rust clients MUST NOT expose a generic `.jobs()` helper for admin
  queries; admin access should come from the generated jobs SDK or direct RPC
  calls

## Non-goals

- defining TypeScript jobs APIs
- defining public caller-visible async workflows; use operations for that
- redefining the jobs wire model or centralized admin RPC contract
