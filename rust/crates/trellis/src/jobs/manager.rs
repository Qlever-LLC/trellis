use std::collections::hash_map::DefaultHasher;
use std::future::Future;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde::Serialize;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::{Duration as TimeDuration, OffsetDateTime};
use ulid::Ulid;

use crate::jobs::active_job::ActiveJob;
use crate::jobs::bindings::{JobQueueWhenFull, JobsBinding, JobsQueueBinding};
use crate::jobs::events::{
    cancelled_event, completed_event, created_event, created_event_with_policy, failed_event,
    logged_event, progress_event, retry_event, skipped_event, stale_completion_ignored_event,
    stale_event, started_event, started_event_with_concurrency,
};
use crate::jobs::keys::{
    derive_job_key, AdmitJobInput, AdmitJobOutcome, JobKeyActiveSlot, JobKeyCoordinator,
    JobKeyPolicy, JobKeyQueuedEntry, KeyRejectReason,
};
use crate::jobs::publisher::{JobEventHeaders, JobEventPublisher};
use crate::jobs::runtime_worker::JobCancellationToken;
use crate::jobs::types::{
    Job, JobConcurrency, JobContext, JobEventType, JobLogEntry, JobProgress, JobQueuePolicy,
    JobQueuePolicyOutcome, JobState,
};

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
    StaleCompletionIgnored { tries: u64 },
}

/// Raw manager-level result for policy-aware job submission.
#[derive(Debug, Clone, PartialEq)]
pub enum JobSubmitOutcome<TJob> {
    Accepted {
        job: TJob,
        key: Option<String>,
    },
    Rejected(JobNotEnqueued),
    Coalesced {
        key: String,
        existing_job_id: String,
        reason: String,
    },
    Replaced {
        key: String,
        replaced_job_id: String,
        job: TJob,
    },
}

/// Reason a raw manager-level job submission was not enqueued.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JobNotEnqueuedReason {
    ActiveLimit,
    QueueDepth,
    StaleBlocked,
    Coalesced,
}

/// Raw manager-level expected not-enqueued outcome details.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("job was not enqueued for key '{key}': {reason:?}")]
pub struct JobNotEnqueued {
    pub reason: JobNotEnqueuedReason,
    pub key: String,
    pub active: usize,
    pub queued: usize,
    pub limit: usize,
    pub existing_job_id: Option<String>,
}

pub trait JobMetaSource {
    fn next_job_id(&self) -> String;
    fn now_iso(&self) -> String;
}

/// Production Trellis metadata source for job ids and timestamps.
#[derive(Debug, Default, Clone, Copy)]
pub struct TrellisJobMetaSource;

impl JobMetaSource for TrellisJobMetaSource {
    fn next_job_id(&self) -> String {
        Ulid::new().to_string()
    }

    fn now_iso(&self) -> String {
        OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
    }
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
    #[error("failed to derive keyed job key: {0}")]
    KeyDerivation(#[from] crate::jobs::keys::KeyDerivationError),
    #[error(transparent)]
    NotEnqueued(#[from] JobNotEnqueued),
    #[error("failed to coordinate keyed job concurrency: {0}")]
    KeyCoordinator(String),
}

/// Decision returned by keyed terminal guards before lifecycle publication.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalPublishDecision {
    Publish,
    StaleCompletionIgnored,
}

struct JobManagerInner<P, M> {
    publisher: P,
    bindings: JobsBinding,
    meta: M,
    key_coordinator: Option<Arc<dyn JobKeyCoordinator>>,
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
                key_coordinator: None,
            }),
        }
    }

    /// Create a manager that coordinates keyed admission through `JOBS_KEYS`.
    pub fn new_with_key_coordinator(
        publisher: P,
        bindings: JobsBinding,
        meta: M,
        key_coordinator: Arc<dyn JobKeyCoordinator>,
    ) -> Self {
        Self {
            inner: Arc::new(JobManagerInner {
                publisher,
                bindings,
                meta,
                key_coordinator: Some(key_coordinator),
            }),
        }
    }

    pub fn publisher(&self) -> &P {
        &self.inner.publisher
    }

    pub fn bindings(&self) -> &JobsBinding {
        &self.inner.bindings
    }

    /// Return the optional keyed-concurrency coordinator used by this manager.
    pub fn key_coordinator(&self) -> Option<Arc<dyn JobKeyCoordinator>> {
        self.inner.key_coordinator.clone()
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
        match self.submit(queue_type, payload).await? {
            JobSubmitOutcome::Accepted { job, .. } | JobSubmitOutcome::Replaced { job, .. } => {
                Ok(job)
            }
            JobSubmitOutcome::Rejected(error) => Err(JobManagerError::NotEnqueued(error)),
            JobSubmitOutcome::Coalesced {
                key,
                existing_job_id,
                ..
            } => Err(JobManagerError::NotEnqueued(JobNotEnqueued {
                reason: JobNotEnqueuedReason::Coalesced,
                key,
                active: 0,
                queued: 0,
                limit: 0,
                existing_job_id: Some(existing_job_id),
            })),
        }
    }

    /// Submit a job through the policy-aware API surface.
    ///
    pub async fn submit<TPayload>(
        &self,
        queue_type: &str,
        payload: TPayload,
    ) -> Result<JobSubmitOutcome<Job>, JobManagerError<P::Error>>
    where
        TPayload: Serialize + Clone,
    {
        let queue = self.queue_binding(queue_type)?.clone();
        let (job, payload_value) = self.prepare_job(&queue, queue_type, payload)?;
        let Some(policy) = self.key_policy_for_job(&queue, &job)? else {
            self.publish_created(&queue, &job, payload_value, None, None)
                .await?;
            return Ok(JobSubmitOutcome::Accepted { job, key: None });
        };

        let Some(coordinator) = self.key_coordinator() else {
            return Err(JobManagerError::KeyCoordinator(format!(
                "keyed queue '{}' requires a key coordinator",
                queue.queue_type
            )));
        };

        let admission = coordinator
            .admit(
                policy.clone(),
                AdmitJobInput {
                    job_id: job.id.clone(),
                    request_id: job.context.request_id.clone(),
                    created_at: job.created_at.clone(),
                    context: job.context.clone(),
                },
            )
            .await
            .map_err(|error| JobManagerError::KeyCoordinator(error.to_string()))?;

        match admission {
            AdmitJobOutcome::Accepted { .. } => {
                let publish_result = self
                    .publish_created(
                        &queue,
                        &job,
                        payload_value,
                        Some(concurrency_metadata(&policy, None)),
                        Some(queue_policy_metadata(
                            JobQueuePolicyOutcome::Accepted,
                            None,
                            None,
                            None,
                        )),
                    )
                    .await;
                if let Err(error) = publish_result {
                    let _ = cleanup_queued_admission(
                        coordinator.as_ref(),
                        &policy,
                        &job.id,
                        &self.now_iso(),
                    )
                    .await;
                    return Err(error);
                }
                Ok(JobSubmitOutcome::Accepted {
                    job,
                    key: Some(policy.key),
                })
            }
            AdmitJobOutcome::Rejected {
                reason,
                active,
                queued,
                limit,
            } => Ok(JobSubmitOutcome::Rejected(not_enqueued(
                &policy, reason, active, queued, limit, None,
            ))),
            AdmitJobOutcome::Coalesced { existing_job_id } => Ok(JobSubmitOutcome::Coalesced {
                key: policy.key,
                existing_job_id,
                reason: "coalesced".to_string(),
            }),
            AdmitJobOutcome::Replaced { replaced, .. } => {
                if let Err(error) = self
                    .publish_skipped(&queue, &replaced, "replace-oldest")
                    .await
                {
                    let _ = restore_replaced_admission(
                        coordinator.as_ref(),
                        &policy,
                        replaced,
                        &job.id,
                        &self.now_iso(),
                    )
                    .await;
                    return Err(error);
                }
                let replaced_job_id = replaced.job_id;
                let publish_result = self
                    .publish_created(
                        &queue,
                        &job,
                        payload_value,
                        Some(concurrency_metadata(&policy, None)),
                        Some(queue_policy_metadata(
                            JobQueuePolicyOutcome::Replaced,
                            Some("replace-oldest"),
                            None,
                            Some(&replaced_job_id),
                        )),
                    )
                    .await;
                if let Err(error) = publish_result {
                    let _ = cleanup_queued_admission(
                        coordinator.as_ref(),
                        &policy,
                        &job.id,
                        &self.now_iso(),
                    )
                    .await;
                    return Err(error);
                }
                Ok(JobSubmitOutcome::Replaced {
                    key: policy.key,
                    replaced_job_id,
                    job,
                })
            }
        }
    }

    fn prepare_job<TPayload>(
        &self,
        queue: &JobsQueueBinding,
        queue_type: &str,
        payload: TPayload,
    ) -> Result<(Job, Value), JobManagerError<P::Error>>
    where
        TPayload: Serialize + Clone,
    {
        let now = self.inner.meta.now_iso();
        let id = self.inner.meta.next_job_id();
        let context = new_job_context(self.inner.meta.next_job_id(), &id, &now);
        let payload_value: Value =
            serde_json::to_value(payload.clone()).map_err(JobManagerError::SerializePayload)?;
        let deadline = compute_deadline(&now, queue.default_deadline_ms).map_err(|details| {
            JobManagerError::InvalidTimestamp {
                timestamp: now.clone(),
                details,
            }
        })?;
        Ok((
            Job {
                id,
                context,
                service: self.inner.bindings.namespace.clone(),
                job_type: queue_type.to_string(),
                state: JobState::Pending,
                payload: payload_value.clone(),
                result: None,
                created_at: now.clone(),
                updated_at: now,
                started_at: None,
                completed_at: None,
                tries: 0,
                max_tries: queue.max_deliver,
                last_error: None,
                deadline,
                progress: None,
                logs: None,
                concurrency: None,
                queue_policy: None,
            },
            payload_value,
        ))
    }

    fn key_policy_for_job(
        &self,
        queue: &JobsQueueBinding,
        job: &Job,
    ) -> Result<Option<JobKeyPolicy>, JobManagerError<P::Error>> {
        let Some(key_concurrency) = queue.key_concurrency.as_ref() else {
            return Ok(None);
        };
        let queue_depth = queue.queue.as_ref();
        let derived = derive_job_key(&job.payload, &key_concurrency.key)?;
        Ok(Some(JobKeyPolicy {
            service: job.service.clone(),
            job_type: job.job_type.clone(),
            key: derived.key,
            key_hash: derived.key_hash,
            max_active: key_concurrency.max_active,
            max_queued_per_key: queue_depth.map_or(0, |queue| queue.max_queued_per_key),
            when_full: queue_depth
                .map_or(JobQueueWhenFull::Reject, |queue| queue.when_full.clone()),
            stale_policy: key_concurrency.stale_policy.clone(),
        }))
    }

    async fn publish_created(
        &self,
        queue: &JobsQueueBinding,
        job: &Job,
        payload: Value,
        concurrency: Option<JobConcurrency>,
        queue_policy: Option<JobQueuePolicy>,
    ) -> Result<(), JobManagerError<P::Error>> {
        let event = match concurrency.or_else(|| job.concurrency.clone()) {
            Some(concurrency) => created_event_with_policy(
                &job.service,
                &job.job_type,
                &job.id,
                &job.context,
                payload,
                queue.max_deliver,
                &job.created_at,
                job.deadline.as_deref(),
                Some(concurrency),
                queue_policy.or_else(|| job.queue_policy.clone()),
            ),
            None => created_event(
                &job.service,
                &job.job_type,
                &job.id,
                &job.context,
                payload,
                queue.max_deliver,
                &job.created_at,
                job.deadline.as_deref(),
            ),
        };
        self.publish_queue_event(queue, &job.id, event.event_type, &event)
            .await
    }

    async fn publish_skipped(
        &self,
        queue: &JobsQueueBinding,
        entry: &JobKeyQueuedEntry,
        reason: &str,
    ) -> Result<(), JobManagerError<P::Error>> {
        let Some(context) = entry.context.as_ref() else {
            return Ok(());
        };
        let event = skipped_event(
            &self.inner.bindings.namespace,
            &queue.queue_type,
            &entry.job_id,
            context,
            JobState::Pending,
            0,
            &self.now_iso(),
            Some(reason),
        );
        self.publish_queue_event(queue, &entry.job_id, event.event_type, &event)
            .await
    }

    /// Publish a `stale` lifecycle event for an expired active key slot.
    pub async fn emit_stale_slot(
        &self,
        queue_type: &str,
        slot: &JobKeyActiveSlot,
        reason: &str,
    ) -> Result<(), JobManagerError<P::Error>> {
        let queue = self.queue_binding(queue_type)?;
        let Some(context) = slot.context.as_ref() else {
            return Ok(());
        };
        let event = stale_event(
            &self.inner.bindings.namespace,
            queue_type,
            &slot.job_id,
            context,
            slot.tries,
            &self.now_iso(),
            Some(reason),
            None,
        );
        self.publish_queue_event(queue, &slot.job_id, event.event_type, &event)
            .await
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
        self.process_with_heartbeat_and_terminal_guard(
            job,
            cancellation,
            heartbeat,
            |_| async { Ok(TerminalPublishDecision::Publish) },
            process,
        )
        .await
    }

    /// Process a job and run a guard before publishing normal terminal events.
    pub async fn process_with_heartbeat_and_terminal_guard<TResult, E, HB, HBFut, G, GFut, F, Fut>(
        &self,
        job: Job,
        cancellation: JobCancellationToken,
        heartbeat: HB,
        terminal_guard: G,
        process: F,
    ) -> Result<JobProcessOutcome<TResult>, JobManagerError<P::Error>>
    where
        TResult: Serialize + Clone,
        E: ToString,
        HB: Fn() -> HBFut + Send + Sync + 'static,
        HBFut: Future<Output = Result<(), String>> + Send + 'static,
        G: Fn(String) -> GFut + Send + Sync,
        GFut: Future<Output = Result<TerminalPublishDecision, String>>,
        F: FnOnce(ActiveJob<P, M>) -> Fut,
        Fut: Future<Output = Result<TResult, JobProcessError<E>>>,
    {
        self.process_with_heartbeat_and_terminal_hooks(
            job,
            cancellation,
            heartbeat,
            terminal_guard,
            |_| async { Ok(()) },
            process,
        )
        .await
    }

    /// Process a job with separate pre-publish guard and post-publish cleanup hooks.
    pub async fn process_with_heartbeat_and_terminal_hooks<
        TResult,
        E,
        HB,
        HBFut,
        G,
        GFut,
        C,
        CFut,
        F,
        Fut,
    >(
        &self,
        job: Job,
        cancellation: JobCancellationToken,
        heartbeat: HB,
        terminal_guard: G,
        terminal_cleanup: C,
        process: F,
    ) -> Result<JobProcessOutcome<TResult>, JobManagerError<P::Error>>
    where
        TResult: Serialize + Clone,
        E: ToString,
        HB: Fn() -> HBFut + Send + Sync + 'static,
        HBFut: Future<Output = Result<(), String>> + Send + 'static,
        G: Fn(String) -> GFut + Send + Sync,
        GFut: Future<Output = Result<TerminalPublishDecision, String>>,
        C: Fn(String) -> CFut + Send + Sync,
        CFut: Future<Output = Result<(), String>>,
        F: FnOnce(ActiveJob<P, M>) -> Fut,
        Fut: Future<Output = Result<TResult, JobProcessError<E>>>,
    {
        let queue = self.queue_binding_for_job(&job)?;

        let tries = job.tries.saturating_add(1);
        let started_at = self.now_iso();
        let started = match job.concurrency.clone() {
            Some(concurrency) => started_event_with_concurrency(
                &job.service,
                &job.job_type,
                &job.id,
                &job.context,
                job.state,
                tries,
                &started_at,
                concurrency,
            ),
            None => started_event(
                &job.service,
                &job.job_type,
                &job.id,
                &job.context,
                job.state,
                tries,
                &started_at,
            ),
        };
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
                    self.run_terminal_cleanup(&terminal_cleanup, &job.updated_at)
                        .await?;
                    return Ok(JobProcessOutcome::Interrupted { tries });
                }
                if cancellation.is_cancelled() {
                    self.run_terminal_cleanup(&terminal_cleanup, &job.updated_at)
                        .await?;
                    return Ok(JobProcessOutcome::Cancelled { tries });
                }
                let terminal_at = self.now_iso();
                if self
                    .guard_terminal_publish(&job, queue, tries, &terminal_at, &terminal_guard)
                    .await?
                    == TerminalPublishDecision::StaleCompletionIgnored
                {
                    return Ok(JobProcessOutcome::StaleCompletionIgnored { tries });
                }
                let result_value = serde_json::to_value(result.clone())
                    .map_err(JobManagerError::SerializeResult)?;
                let completed = completed_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    &job.context,
                    tries,
                    &terminal_at,
                    result_value,
                );
                self.publish_queue_event(queue, &job.id, completed.event_type, &completed)
                    .await?;
                self.run_terminal_cleanup(&terminal_cleanup, &terminal_at)
                    .await?;
                Ok(JobProcessOutcome::Completed { tries, result })
            }
            Err(JobProcessError::Retryable(error)) => {
                if cancellation.is_host_shutdown() {
                    self.run_terminal_cleanup(&terminal_cleanup, &job.updated_at)
                        .await?;
                    return Ok(JobProcessOutcome::Interrupted { tries });
                }
                if cancellation.is_cancelled() {
                    self.run_terminal_cleanup(&terminal_cleanup, &job.updated_at)
                        .await?;
                    return Ok(JobProcessOutcome::Cancelled { tries });
                }
                let error = error.to_string();
                let terminal_at = self.now_iso();
                if self
                    .guard_terminal_publish(&job, queue, tries, &terminal_at, &terminal_guard)
                    .await?
                    == TerminalPublishDecision::StaleCompletionIgnored
                {
                    return Ok(JobProcessOutcome::StaleCompletionIgnored { tries });
                }
                let retry = retry_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    &job.context,
                    JobState::Active,
                    tries,
                    &terminal_at,
                    Some(&error),
                );
                self.publish_queue_event(queue, &job.id, retry.event_type, &retry)
                    .await?;
                self.run_terminal_cleanup(&terminal_cleanup, &terminal_at)
                    .await?;
                Ok(JobProcessOutcome::Retry { tries, error })
            }
            Err(JobProcessError::Failed(error)) => {
                if cancellation.is_host_shutdown() {
                    self.run_terminal_cleanup(&terminal_cleanup, &job.updated_at)
                        .await?;
                    return Ok(JobProcessOutcome::Interrupted { tries });
                }
                if cancellation.is_cancelled() {
                    self.run_terminal_cleanup(&terminal_cleanup, &job.updated_at)
                        .await?;
                    return Ok(JobProcessOutcome::Cancelled { tries });
                }
                let error = error.to_string();
                let terminal_at = self.now_iso();
                if self
                    .guard_terminal_publish(&job, queue, tries, &terminal_at, &terminal_guard)
                    .await?
                    == TerminalPublishDecision::StaleCompletionIgnored
                {
                    return Ok(JobProcessOutcome::StaleCompletionIgnored { tries });
                }
                let failed = failed_event(
                    &job.service,
                    &job.job_type,
                    &job.id,
                    &job.context,
                    JobState::Active,
                    tries,
                    &terminal_at,
                    &error,
                );
                self.publish_queue_event(queue, &job.id, failed.event_type, &failed)
                    .await?;
                self.run_terminal_cleanup(&terminal_cleanup, &terminal_at)
                    .await?;
                Ok(JobProcessOutcome::Failed { tries, error })
            }
        }
    }

    async fn run_terminal_cleanup<C, CFut>(
        &self,
        terminal_cleanup: &C,
        cleanup_at: &str,
    ) -> Result<(), JobManagerError<P::Error>>
    where
        C: Fn(String) -> CFut + Send + Sync,
        CFut: Future<Output = Result<(), String>>,
    {
        terminal_cleanup(cleanup_at.to_string())
            .await
            .map_err(JobManagerError::KeyCoordinator)
    }

    async fn guard_terminal_publish<G, GFut>(
        &self,
        job: &Job,
        queue: &JobsQueueBinding,
        tries: u64,
        terminal_at: &str,
        terminal_guard: &G,
    ) -> Result<TerminalPublishDecision, JobManagerError<P::Error>>
    where
        G: Fn(String) -> GFut + Send + Sync,
        GFut: Future<Output = Result<TerminalPublishDecision, String>>,
    {
        let decision = terminal_guard(terminal_at.to_string())
            .await
            .map_err(JobManagerError::KeyCoordinator)?;
        if decision == TerminalPublishDecision::StaleCompletionIgnored {
            let ignored = stale_completion_ignored_event(
                &job.service,
                &job.job_type,
                &job.id,
                &job.context,
                tries,
                terminal_at,
                Some("lost key slot"),
                job.concurrency.clone(),
            );
            self.publish_queue_event(queue, &job.id, ignored.event_type, &ignored)
                .await?;
        }
        Ok(decision)
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
            &job.context,
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
            &job.context,
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

        if self.key_policy_for_job(queue, job)?.is_some() && self.key_coordinator().is_none() {
            return Err(JobManagerError::KeyCoordinator(format!(
                "keyed queue '{}' requires a key coordinator for cancellation cleanup",
                queue.queue_type
            )));
        }

        let cancelled_at = self.now_iso();
        let event = cancelled_event(
            &job.service,
            &job.job_type,
            &job.id,
            &job.context,
            job.state,
            job.tries,
            &cancelled_at,
        );
        self.publish_queue_event(queue, &job.id, event.event_type, &event)
            .await?;
        self.cleanup_cancelled_keyed_job(queue, job, &cancelled_at)
            .await?;
        Ok(())
    }

    async fn cleanup_cancelled_keyed_job(
        &self,
        queue: &JobsQueueBinding,
        job: &Job,
        cancelled_at: &str,
    ) -> Result<(), JobManagerError<P::Error>> {
        let Some(policy) = self.key_policy_for_job(queue, job)? else {
            return Ok(());
        };
        let Some(coordinator) = self.key_coordinator() else {
            return Err(JobManagerError::KeyCoordinator(format!(
                "keyed queue '{}' requires a key coordinator for cancellation cleanup",
                queue.queue_type
            )));
        };
        match job.state {
            JobState::Pending | JobState::Retry => {
                cleanup_queued_admission(coordinator.as_ref(), &policy, &job.id, cancelled_at)
                    .await
                    .map_err(JobManagerError::KeyCoordinator)
            }
            JobState::Active => {
                let Some(slot_token) = job
                    .concurrency
                    .as_ref()
                    .and_then(|concurrency| concurrency.slot_token.clone())
                else {
                    return Ok(());
                };
                coordinator
                    .release(policy, job.id.clone(), slot_token, cancelled_at.to_string())
                    .await
                    .map(|_| ())
                    .map_err(|error| JobManagerError::KeyCoordinator(error.to_string()))
            }
            _ => Ok(()),
        }
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
        event: &crate::jobs::types::JobEvent,
    ) -> Result<(), JobManagerError<P::Error>> {
        let payload = serde_json::to_vec(event).map_err(JobManagerError::SerializeEvent)?;
        let subject = format!(
            "{}.{}.{}",
            queue.publish_prefix,
            job_id,
            event_type.as_token()
        );
        self.publisher()
            .publish(subject, JobEventHeaders::from(&event.context), payload)
            .await
            .map_err(JobManagerError::Publish)
    }
}

fn concurrency_metadata(policy: &JobKeyPolicy, slot_token: Option<String>) -> JobConcurrency {
    JobConcurrency {
        key: policy.key.clone(),
        key_hash: policy.key_hash(),
        instance_id: None,
        slot_token,
        heartbeat_at: None,
        lease_expires_at: None,
        stale_takeover_count: None,
    }
}

fn queue_policy_metadata(
    outcome: JobQueuePolicyOutcome,
    reason: Option<&str>,
    existing_job_id: Option<&str>,
    replaced_job_id: Option<&str>,
) -> JobQueuePolicy {
    JobQueuePolicy {
        outcome: Some(outcome),
        reason: reason.map(ToString::to_string),
        existing_job_id: existing_job_id.map(ToString::to_string),
        replaced_job_id: replaced_job_id.map(ToString::to_string),
    }
}

async fn cleanup_queued_admission(
    coordinator: &dyn JobKeyCoordinator,
    policy: &JobKeyPolicy,
    job_id: &str,
    removed_at: &str,
) -> Result<(), String> {
    coordinator
        .remove_queued(policy.clone(), job_id.to_string(), removed_at.to_string())
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

async fn restore_replaced_admission(
    coordinator: &dyn JobKeyCoordinator,
    policy: &JobKeyPolicy,
    replaced: JobKeyQueuedEntry,
    replacement_job_id: &str,
    restored_at: &str,
) -> Result<(), String> {
    coordinator
        .restore_replaced(
            policy.clone(),
            replaced,
            replacement_job_id.to_string(),
            restored_at.to_string(),
        )
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn not_enqueued(
    policy: &JobKeyPolicy,
    reason: KeyRejectReason,
    active: usize,
    queued: usize,
    limit: usize,
    existing_job_id: Option<String>,
) -> JobNotEnqueued {
    JobNotEnqueued {
        reason: match reason {
            KeyRejectReason::ActiveLimit => JobNotEnqueuedReason::ActiveLimit,
            KeyRejectReason::QueueDepth => JobNotEnqueuedReason::QueueDepth,
            KeyRejectReason::StaleBlocked => JobNotEnqueuedReason::StaleBlocked,
        },
        key: policy.key.clone(),
        active,
        queued,
        limit,
        existing_job_id,
    }
}

fn new_job_context(request_id: String, job_id: &str, timestamp: &str) -> JobContext {
    let trace_id = synthesize_trace_id(&request_id, job_id, timestamp);
    let span_id = synthesize_span_id(&trace_id, &request_id);
    let traceparent = format!("00-{trace_id}-{span_id}-01");
    let trace_id = trace_id_from_traceparent(&traceparent)
        .expect("synthesized traceparent should be valid")
        .to_string();
    JobContext {
        request_id,
        trace_id,
        traceparent,
        tracestate: None,
    }
}

fn synthesize_trace_id(request_id: &str, job_id: &str, timestamp: &str) -> String {
    let left = stable_hash64(&(request_id, job_id, timestamp, "trace-left"));
    let right = stable_hash64(&(timestamp, job_id, request_id, "trace-right"));
    let trace_id = format!("{left:016x}{right:016x}");
    if trace_id == "00000000000000000000000000000000" {
        "00000000000000000000000000000001".to_string()
    } else {
        trace_id
    }
}

fn synthesize_span_id(trace_id: &str, request_id: &str) -> String {
    let value = stable_hash64(&(trace_id, request_id, "span"));
    if value == 0 {
        "0000000000000001".to_string()
    } else {
        format!("{value:016x}")
    }
}

fn stable_hash64(value: &impl Hash) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

pub(crate) fn trace_id_from_traceparent(traceparent: &str) -> Option<&str> {
    let mut parts = traceparent.split('-');
    let version = parts.next()?;
    let trace_id = parts.next()?;
    let span_id = parts.next()?;
    let flags = parts.next()?;
    if parts.next().is_some()
        || version.len() != 2
        || trace_id.len() != 32
        || span_id.len() != 16
        || flags.len() != 2
        || trace_id == "00000000000000000000000000000000"
        || span_id == "0000000000000000"
        || !trace_id.chars().all(|value| value.is_ascii_hexdigit())
        || !span_id.chars().all(|value| value.is_ascii_hexdigit())
    {
        return None;
    }
    Some(trace_id)
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
