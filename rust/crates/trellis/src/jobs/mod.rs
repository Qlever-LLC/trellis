//! Service-local jobs runtime building blocks for Trellis.
//!
//! This module contains the handwritten Rust support code that sits around the
//! generated contract SDKs: binding parsing, event helpers, the projection
//! reducer, worker-loop glue, and service-instance registration.

use std::future::Future;

use serde_json::Value;

use crate::client::TrellisClient;

pub mod active_job;
pub mod api;
pub mod bindings;
pub mod events;
pub mod keys;
pub mod manager;
pub mod projection;
pub mod publisher;
pub mod registry;
mod runtime_worker;
pub mod subjects;
pub mod types;

pub use active_job::ActiveJob as WorkerActiveJob;
pub use api::{
    ActiveJob, JobFilter, JobIdentity, JobQueue, JobRef, JobSnapshot, JobWorkerHost, JobsError,
    JobsFacade, JobsService, TerminalJob,
};
pub use bindings::{JobsBinding, JobsQueueBinding, JobsRuntimeBinding};
pub use events::{
    cancelled_event, completed_event, created_event, dead_event, dismissed_event, expired_event,
    failed_event, retried_event, started_event,
};
pub use keys::{job_key, worker_presence_key};
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
pub use runtime_worker::{JobCancellationToken, WorkerHostHandle, WorkerHostOptions};
pub use subjects::{job_event_subject, worker_heartbeat_subject, WORKER_HEARTBEATS_WILDCARD};
pub use types::{
    Job, JobContext, JobEvent, JobEventType, JobLogEntry, JobLogLevel, JobProgress, JobState,
    WorkerHeartbeat,
};

#[derive(Debug, Clone)]
pub struct TrellisJobEventPublisher {
    nats: async_nats::Client,
}

impl JobEventPublisher for TrellisJobEventPublisher {
    type Error = String;

    fn publish(
        &self,
        subject: String,
        headers: JobEventHeaders,
        payload: Vec<u8>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let nats = self.nats.clone();
        async move {
            let mut nats_headers = async_nats::HeaderMap::new();
            nats_headers.insert("request-id", headers.request_id.as_str());
            nats_headers.insert("traceparent", headers.traceparent.as_str());
            if let Some(tracestate) = headers.tracestate.as_deref() {
                nats_headers.insert("tracestate", tracestate);
            }
            nats.publish_with_headers(subject, nats_headers, payload.into())
                .await
                .map_err(|error| error.to_string())
        }
    }
}

/// Start a service-private job worker host using a connected Trellis client.
pub async fn start_worker_host_from_client<MF, M, H, Fut, E>(
    client: &TrellisClient,
    binding: JobsRuntimeBinding,
    instance_id: String,
    meta_factory: MF,
    handler: H,
    options: WorkerHostOptions,
) -> Result<WorkerHostHandle, runtime_worker::WorkerHostError>
where
    MF: Fn(&str, u32) -> M + Clone + Send + Sync + 'static,
    M: JobMetaSource + Send + Sync + 'static,
    H: Fn(active_job::ActiveJob<TrellisJobEventPublisher, M>) -> Fut
        + Clone
        + Send
        + Sync
        + 'static,
    Fut: Future<Output = Result<Value, JobProcessError<E>>> + Send + 'static,
    E: ToString + Send + 'static,
{
    let nats = client.nats().clone();
    runtime_worker::start_worker_host_from_binding(
        nats.clone(),
        binding,
        instance_id,
        move || TrellisJobEventPublisher { nats: nats.clone() },
        meta_factory,
        handler,
        options,
    )
    .await
}
