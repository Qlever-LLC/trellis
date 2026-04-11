use std::future::Future;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde::Serialize;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::{Duration as TimeDuration, OffsetDateTime};

use crate::active_job::ActiveJob;
use crate::bindings::{JobsBinding, JobsQueueBinding};
use crate::events::{
    cancelled_event, completed_event, created_event, failed_event, logged_event, progress_event,
    retry_event, started_event,
};
use crate::publisher::JobEventPublisher;
use crate::runtime_worker::JobCancellationToken;
use crate::types::{Job, JobEventType, JobLogEntry, JobProgress, JobState};

type HeartbeatHook = Arc<dyn Fn() -> BoxFuture<'static, Result<(), String>> + Send + Sync>;

#[derive(Debug, Clone, PartialEq)]
pub enum JobProcessError<E> {
    Retryable(E),
    Failed(E),
}

impl<E> JobProcessError<E> {
    pub fn retryable(error: E) -> Self {
        Self::Retryable(error)
    }

    pub fn failed(error: E) -> Self {
        Self::Failed(error)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum JobProcessOutcome<TResult> {
    Completed { tries: u64, result: TResult },
    Retry { tries: u64, error: String },
    Failed { tries: u64, error: String },
    Cancelled { tries: u64 },
    Interrupted { tries: u64 },
}

pub trait JobMetaSource {
    fn next_job_id(&self) -> String;
    fn now_iso(&self) -> String;
}

#[derive(Debug, thiserror::Error)]
pub enum JobManagerError<E> {
    #[error("missing jobs queue binding for queue type '{queue_type}'")]
    MissingQueueBinding { queue_type: String },
    #[error("failed to serialize job payload: {0}")]
    SerializePayload(serde_json::Error),
    #[error("failed to serialize created event payload: {0}")]
    SerializeEvent(serde_json::Error),
    #[error("failed to serialize job result: {0}")]
    SerializeResult(serde_json::Error),
    #[error("feature '{feature}' is disabled for queue type '{queue_type}'")]
    FeatureDisabled {
        queue_type: String,
        feature: &'static str,
    },
    #[error("invalid transition '{action}' for job '{job_id}' in state '{state:?}'")]
    InvalidTransition {
        job_id: String,
        state: JobState,
        action: &'static str,
    },
    #[error("failed to compute job deadline from timestamp '{timestamp}': {details}")]
    InvalidTimestamp { timestamp: String, details: String },
    #[error("failed to publish job event: {0}")]
    Publish(E),
}

struct JobManagerInner<P, M> {
    publisher: P,
    bindings: JobsBinding,
    meta: M,
}

pub struct JobManager<P, M> {
    inner: Arc<JobManagerInner<P, M>>,
}

impl<P, M> Clone for JobManager<P, M> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<P, M> JobManager<P, M> {
    pub fn new(publisher: P, bindings: JobsBinding, meta: M) -> Self {
        Self {
            inner: Arc::new(JobManagerInner {
                publisher,
                bindings,
                meta,
            }),
        }
    }

    pub fn publisher(&self) -> &P {
        &self.inner.publisher
    }

    pub fn bindings(&self) -> &JobsBinding {
        &self.inner.bindings
    }
}

impl<P, M> JobManager<P, M>
where
    P: JobEventPublisher,
    M: JobMetaSource,
{
    fn queue_binding(
        &self,
        queue_type: &str,
    ) -> Result<&JobsQueueBinding, JobManagerError<P::Error>> {
        self.inner.bindings.queues.get(queue_type).ok_or_else(|| {
            JobManagerError::MissingQueueBinding {
                queue_type: queue_type.to_string(),
            }
        })
    }

    fn queue_binding_for_job(
        &self,
        job: &Job,
    ) -> Result<&JobsQueueBinding, JobManagerError<P::Error>> {
        self.queue_binding(&job.job_type)
    }

    pub(crate) fn now_iso(&self) -> String {
        self.inner.meta.now_iso()
    }

    pub async fn create<TPayload>(
        &self,
        queue_type: &str,
        payload: TPayload,
    ) -> Result<Job, JobManagerError<P::Error>>
    where
        TPayload: Serialize + Clone,
    {
        let queue = self.queue_binding(queue_type)?;

        let now = self.inner.meta.now_iso();
        let id = self.inner.meta.next_job_id();
        let payload_value: Value =
            serde_json::to_value(payload.clone()).map_err(JobManagerError::SerializePayload)?;
        let deadline = compute_deadline(&now, queue.default_deadline_ms).map_err(|details| {
            JobManagerError::InvalidTimestamp {
                timestamp: now.clone(),
                details,
            }
        })?;

        let job = Job {
            id: id.clone(),
            service: self.inner.bindings.namespace.clone(),
            job_type: queue_type.to_string(),
            state: JobState::Pending,
            payload: payload_value.clone(),
            result: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            started_at: None,
            completed_at: None,
            tries: 0,
            max_tries: queue.max_deliver,
            last_error: None,
            deadline: deadline.clone(),
            progress: None,
            logs: None,
        };

        let created = created_event(
            &job.service,
            &job.job_type,
            &job.id,
            payload_value,
            queue.max_deliver,
            &now,
            deadline.as_deref(),
        );

        self.publish_queue_event(queue, &id, created.event_type, &created)
            .await?;

        Ok(job)
    }

    pub async fn process<TResult, E, F, Fut>(
        &self,
        job: Job,
        cancellation: JobCancellationToken,
        process: F,
    ) -> Result<JobProcessOutcome<TResult>, JobManagerError<P::Error>>
    where
        TResult: Serialize + Clone,
        E: ToString,
        F: FnOnce(ActiveJob<P, M>) -> Fut,
        Fut: Future<Output = Result<TResult, JobProcessError<E>>>,
    {
        self.process_with_heartbeat(
            job,
            cancellation,
            || async { Err("worker heartbeat unavailable".to_string()) },
            process,
        )
        .await
    }

    pub async fn process_with_heartbeat<TResult, E, HB, HBFut, F, Fut>(
        &self,
        job: Job,
        cancellation: JobCancellationToken,
        heartbeat: HB,
        process: F,
    ) -> Result<JobProcessOutcome<TResult>, JobManagerError<P::Error>>
    where
        TResult: Serialize + Clone,
        E: ToString,
        HB: Fn() -> HBFut + Send + Sync + 'static,
        HBFut: Future<Output = Result<(), String>> + Send + 'static,
        F: FnOnce(ActiveJob<P, M>) -> Fut,
        Fut: Future<Output = Result<TResult, JobProcessError<E>>>,
    {
        let queue = self.queue_binding_for_job(&job)?;

        let tries = job.tries.saturating_add(1);
        let started_at = self.now_iso();
        let started = started_event(
            &job.service,
            &job.job_type,
            &job.id,
            job.state,
            tries,
            &started_at,
        );
        self.publish_queue_event(queue, &job.id, started.event_type, &started)
            .await?;

        let active_job = self.make_active_job(
            job.clone(),
            tries,
            started_at,
            cancellation.clone(),
            Arc::new(move || Box::pin(heartbeat())),
        );

        match process(active_job).await {
            Ok(result) => {
                if cancellation.is_host_shutdown() {
                    return Ok(JobProcessOutcome::Interrupted { tries });
                }
                if cancellation.is_cancelled() {
                    return Ok(JobProcessOutcome::Cancelled { tries });
                }
                let result_value = serde_json::to_value(result.clone())
                    .map_err(JobManagerError::SerializeResult)?;
                let completed = completed_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    tries,
                    &self.now_iso(),
                    result_value,
                );
                self.publish_queue_event(queue, &job.id, completed.event_type, &completed)
                    .await?;
                Ok(JobProcessOutcome::Completed { tries, result })
            }
            Err(JobProcessError::Retryable(error)) => {
                if cancellation.is_host_shutdown() {
                    return Ok(JobProcessOutcome::Interrupted { tries });
                }
                if cancellation.is_cancelled() {
                    return Ok(JobProcessOutcome::Cancelled { tries });
                }
                let error = error.to_string();
                let retry = retry_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    JobState::Active,
                    tries,
                    &self.now_iso(),
                    Some(&error),
                );
                self.publish_queue_event(queue, &job.id, retry.event_type, &retry)
                    .await?;
                Ok(JobProcessOutcome::Retry { tries, error })
            }
            Err(JobProcessError::Failed(error)) => {
                if cancellation.is_host_shutdown() {
                    return Ok(JobProcessOutcome::Interrupted { tries });
                }
                if cancellation.is_cancelled() {
                    return Ok(JobProcessOutcome::Cancelled { tries });
                }
                let error = error.to_string();
                let failed = failed_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    JobState::Active,
                    tries,
                    &self.now_iso(),
                    &error,
                );
                self.publish_queue_event(queue, &job.id, failed.event_type, &failed)
                    .await?;
                Ok(JobProcessOutcome::Failed { tries, error })
            }
        }
    }

    pub async fn emit_progress(
        &self,
        job: &Job,
        progress: JobProgress,
    ) -> Result<(), JobManagerError<P::Error>> {
        let queue = self.queue_binding_for_job(job)?;
        if !queue.progress {
            return Err(JobManagerError::FeatureDisabled {
                queue_type: queue.queue_type.clone(),
                feature: "progress",
            });
        }
        if job.state != JobState::Active {
            return Err(JobManagerError::InvalidTransition {
                job_id: job.id.clone(),
                state: job.state,
                action: "emit_progress",
            });
        }

        let event = progress_event(
            &job.service,
            &job.job_type,
            &job.id,
            job.tries,
            &self.now_iso(),
            progress,
        );
        self.publish_queue_event(queue, &job.id, event.event_type, &event)
            .await
    }

    pub async fn emit_log(
        &self,
        job: &Job,
        log: JobLogEntry,
    ) -> Result<(), JobManagerError<P::Error>> {
        let queue = self.queue_binding_for_job(job)?;
        if !queue.logs {
            return Err(JobManagerError::FeatureDisabled {
                queue_type: queue.queue_type.clone(),
                feature: "logs",
            });
        }
        if job.state != JobState::Active {
            return Err(JobManagerError::InvalidTransition {
                job_id: job.id.clone(),
                state: job.state,
                action: "emit_log",
            });
        }

        let event = logged_event(
            &job.service,
            &job.job_type,
            &job.id,
            job.tries,
            &self.now_iso(),
            vec![log],
        );
        self.publish_queue_event(queue, &job.id, event.event_type, &event)
            .await
    }

    pub async fn cancel(&self, job: &Job) -> Result<(), JobManagerError<P::Error>> {
        let queue = self.queue_binding_for_job(job)?;
        if !matches!(
            job.state,
            JobState::Pending | JobState::Retry | JobState::Active
        ) {
            return Err(JobManagerError::InvalidTransition {
                job_id: job.id.clone(),
                state: job.state,
                action: "cancel",
            });
        }

        let event = cancelled_event(
            &job.service,
            &job.job_type,
            &job.id,
            job.state,
            job.tries,
            &self.now_iso(),
        );
        self.publish_queue_event(queue, &job.id, event.event_type, &event)
            .await
    }

    pub async fn with_active_job<T, F, Fut>(
        &self,
        job: Job,
        cancellation: JobCancellationToken,
        f: F,
    ) -> Result<T, JobManagerError<P::Error>>
    where
        F: FnOnce(ActiveJob<P, M>) -> Fut,
        Fut: Future<Output = Result<T, JobManagerError<P::Error>>>,
    {
        self.with_active_job_and_heartbeat(
            job,
            cancellation,
            || async { Err("worker heartbeat unavailable".to_string()) },
            f,
        )
        .await
    }

    pub async fn with_active_job_and_heartbeat<T, HB, HBFut, F, Fut>(
        &self,
        job: Job,
        cancellation: JobCancellationToken,
        heartbeat: HB,
        f: F,
    ) -> Result<T, JobManagerError<P::Error>>
    where
        HB: Fn() -> HBFut + Send + Sync + 'static,
        HBFut: Future<Output = Result<(), String>> + Send + 'static,
        F: FnOnce(ActiveJob<P, M>) -> Fut,
        Fut: Future<Output = Result<T, JobManagerError<P::Error>>>,
    {
        let heartbeat: HeartbeatHook = Arc::new(move || Box::pin(heartbeat()));
        f(ActiveJob::new(
            (*self).clone(),
            job,
            cancellation,
            heartbeat,
        ))
        .await
    }

    fn make_active_job(
        &self,
        job: Job,
        tries: u64,
        started_at: String,
        cancellation: JobCancellationToken,
        heartbeat: HeartbeatHook,
    ) -> ActiveJob<P, M> {
        ActiveJob::new(
            (*self).clone(),
            Job {
                state: JobState::Active,
                tries,
                started_at: Some(started_at.clone()),
                updated_at: started_at,
                ..job
            },
            cancellation,
            heartbeat,
        )
    }

    async fn publish_queue_event(
        &self,
        queue: &JobsQueueBinding,
        job_id: &str,
        event_type: JobEventType,
        event: &crate::types::JobEvent,
    ) -> Result<(), JobManagerError<P::Error>> {
        let payload = serde_json::to_vec(event).map_err(JobManagerError::SerializeEvent)?;
        let subject = format!(
            "{}.{}.{}",
            queue.publish_prefix,
            job_id,
            event_type.as_token()
        );
        self.publisher()
            .publish(subject, payload)
            .await
            .map_err(JobManagerError::Publish)
    }
}

fn compute_deadline(now: &str, default_deadline_ms: Option<u64>) -> Result<Option<String>, String> {
    let Some(default_deadline_ms) = default_deadline_ms else {
        return Ok(None);
    };
    let parsed = OffsetDateTime::parse(now, &Rfc3339).map_err(|error| error.to_string())?;
    let deadline =
        parsed + TimeDuration::milliseconds(i64::try_from(default_deadline_ms).unwrap_or(i64::MAX));
    deadline
        .format(&Rfc3339)
        .map(Some)
        .map_err(|error| error.to_string())
}
