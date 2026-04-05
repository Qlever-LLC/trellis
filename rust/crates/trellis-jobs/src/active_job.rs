//! Runtime-facing active job handle.

use std::sync::Arc;

use futures_util::future::BoxFuture;

use crate::manager::{JobManager, JobManagerError, JobMetaSource};
use crate::publisher::JobEventPublisher;
use crate::runtime_worker::JobCancellationToken;
use crate::types::{Job, JobLogEntry, JobLogLevel, JobProgress};

type HeartbeatHook = Arc<dyn Fn() -> BoxFuture<'static, Result<(), String>> + Send + Sync>;

/// Errors returned by [`ActiveJob`] runtime operations.
#[derive(Debug, thiserror::Error)]
pub enum ActiveJobRuntimeError {
    #[error("failed to send worker heartbeat: {0}")]
    Heartbeat(String),
}

/// Handler-facing runtime handle for an in-flight job.
///
/// This type wraps the projected [`Job`] snapshot together with the runtime
/// helpers needed while a worker is actively processing that job.
#[derive(Clone)]
pub struct ActiveJob<P, M> {
    manager: JobManager<P, M>,
    job: Job,
    cancellation: JobCancellationToken,
    heartbeat: HeartbeatHook,
}

impl<P, M> ActiveJob<P, M> {
    pub(crate) fn new(
        manager: JobManager<P, M>,
        job: Job,
        cancellation: JobCancellationToken,
        heartbeat: HeartbeatHook,
    ) -> Self {
        Self {
            manager,
            job,
            cancellation,
            heartbeat,
        }
    }

    /// Return the current in-memory job snapshot for this handler invocation.
    pub fn job(&self) -> &Job {
        &self.job
    }

    /// Return whether cooperative cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    /// Clone the underlying cooperative cancellation token.
    pub fn cancellation_token(&self) -> JobCancellationToken {
        self.cancellation.clone()
    }

    /// Extend the JetStream ack deadline for a long-running active job.
    ///
    /// This is only available when the job is running under a queue-worker path
    /// that provides a runtime heartbeat hook.
    pub async fn heartbeat(&self) -> Result<(), ActiveJobRuntimeError> {
        (self.heartbeat)()
            .await
            .map_err(ActiveJobRuntimeError::Heartbeat)
    }
}

impl<P, M> ActiveJob<P, M>
where
    P: JobEventPublisher,
    M: JobMetaSource,
{
    /// Publish a progress update for this active job.
    pub async fn update_progress(
        &self,
        current: u64,
        total: u64,
        message: Option<String>,
    ) -> Result<(), JobManagerError<P::Error>> {
        self.manager
            .emit_progress(
                &self.job,
                JobProgress {
                    step: None,
                    message,
                    current: Some(current),
                    total: Some(total),
                },
            )
            .await
    }

    /// Publish a log entry for this active job.
    pub async fn log(
        &self,
        level: JobLogLevel,
        message: impl Into<String>,
    ) -> Result<(), JobManagerError<P::Error>> {
        self.manager
            .emit_log(
                &self.job,
                JobLogEntry {
                    timestamp: self.manager.now_iso(),
                    level,
                    message: message.into(),
                },
            )
            .await
    }
}
