//! Service-local jobs runtime building blocks for Trellis.
//!
//! This crate contains the handwritten Rust support code that sits around the
//! generated contract SDKs: binding parsing, event helpers, the projection
//! reducer, worker-loop glue, and service-instance registration.

pub mod active_job;
pub mod api;
pub mod bindings;
pub mod events;
pub mod keys;
pub mod manager;
pub mod projection;
pub mod publisher;
pub mod registry;
pub mod runtime_worker;
pub mod subjects;
pub mod types;

pub use api::{
    ActiveJob, JobFilter, JobIdentity, JobQueue, JobRef, JobSnapshot, JobWorkerHost, JobsError,
    JobsFacade, JobsService, TerminalJob,
};
pub use events::{cancelled_event, dead_event, dismissed_event, expired_event, retried_event};
pub use keys::{job_key, worker_presence_key};
pub use projection::{is_terminal, job_from_work_event, reduce_job_event};
pub use registry::{
    new_worker_heartbeat, publish_worker_heartbeat, start_worker_heartbeat_loop,
    ActiveJobCancellationRegistry, WorkerHeartbeatHandle,
};
pub use runtime_worker::{start_worker_host_from_binding, WorkerHostHandle, WorkerHostOptions};
pub use subjects::{job_event_subject, worker_heartbeat_subject, WORKER_HEARTBEATS_WILDCARD};
pub use types::{
    Job, JobEvent, JobEventType, JobLogEntry, JobLogLevel, JobProgress, JobState, WorkerHeartbeat,
};
