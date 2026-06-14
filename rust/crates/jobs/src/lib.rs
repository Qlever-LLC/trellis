//! Shared jobs models, reducers, and helpers for Trellis.

pub mod active_job;
pub mod api;
pub mod bindings;
pub mod events;
pub mod keys;
pub mod manager;
pub mod projection;
pub mod publisher;
pub mod registry;
pub mod runtime_ref;
mod runtime_worker;
pub mod subjects;
pub mod types;

pub use active_job::ActiveJob as WorkerActiveJob;
pub use api::{
    ActiveJob, JobFilter, JobIdentity, JobNotEnqueued, JobNotEnqueuedReason, JobQueue, JobRef,
    JobSnapshot, JobSubmitOutcome, JobWorkerHost, JobsError, JobsFacade, JobsService, TerminalJob,
};
pub use bindings::{JobsBinding, JobsQueueBinding, JobsRuntimeBinding};
pub use events::{
    cancelled_event, completed_event, created_event, dead_event, dismissed_event, expired_event,
    failed_event, heartbeat_event, logged_event, progress_event, retried_event, retry_event,
    skipped_event, stale_completion_ignored_event, stale_event, started_event,
};
pub use keys::{derive_key, job_key, key_hash, worker_presence_key, KeyDerivationError};
pub use manager::{
    JobManager, JobManagerError, JobMetaSource, JobProcessError, JobProcessOutcome,
    TrellisJobMetaSource,
};
pub use projection::{is_terminal, job_from_work_event, reduce_job_event};
pub use publisher::{JobEventHeaders, JobEventPublisher};
pub use registry::{
    new_worker_heartbeat, publish_worker_heartbeat, start_worker_heartbeat_loop,
    ActiveJobCancellationRegistry, WorkerHeartbeatHandle,
};
pub use runtime_worker::{
    JobCancellationToken, NatsJobEventPublisher as TrellisJobEventPublisher, WorkerHostHandle,
    WorkerHostOptions,
};
pub use subjects::{job_event_subject, worker_heartbeat_subject, WORKER_HEARTBEATS_WILDCARD};
pub use types::{
    Job, JobConcurrency, JobContext, JobEvent, JobEventType, JobLogEntry, JobLogLevel, JobProgress,
    JobQueuePolicy, JobQueuePolicyOutcome, JobState, WorkerHeartbeat,
};

#[doc(hidden)]
pub mod internal {
    pub use super::runtime_worker::{
        process_work_payload, process_work_payload_with_context,
        process_work_payload_with_context_and_heartbeat, start_worker_host_from_binding,
        WorkerHostError,
    };
}
