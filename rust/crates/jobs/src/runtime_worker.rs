use std::future::Future;
use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc,
};
use std::time::Duration;

use async_nats::jetstream::{self, consumer, AckKind};
use futures_util::future::BoxFuture;
use futures_util::StreamExt;
use serde_json::Value;

use crate::active_job::ActiveJob;
use crate::bindings::JobsRuntimeBinding;
use crate::job_key;
use crate::manager::{JobManager, JobMetaSource, JobProcessError, JobProcessOutcome};
use crate::projection::job_from_work_event;
use crate::publisher::JobEventPublisher;
use crate::registry::{
    start_worker_heartbeat_loop, ActiveJobCancellationRegistry, ServiceRegistryError,
    WorkerHeartbeatHandle,
};
use crate::types::{Job, JobEvent, JobEventType, JobState};

const CANCELLATION_NONE: u8 = 0;
const CANCELLATION_HOST_SHUTDOWN: u8 = 1;
const CANCELLATION_JOB: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkerAckAction {
    Ack,
    Nak,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProjectedWorkDecision {
    Process,
    SkipAck,
}

/// Cooperative cancellation token passed into worker handlers.
#[derive(Debug, Clone, Default)]
pub struct JobCancellationToken {
    cancelled: Arc<AtomicU8>,
    notify: Arc<tokio::sync::Notify>,
}

impl JobCancellationToken {
    /// Create a new uncancelled token.
    pub fn new() -> Self {
        Self::default()
    }

    /// Mark the token as cancelled.
    pub fn cancel(&self) {
        let _ = self.cancelled.compare_exchange(
            CANCELLATION_NONE,
            CANCELLATION_JOB,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
        self.notify.notify_waiters();
    }

    /// Mark the token as cancelled because the worker host is shutting down.
    pub fn cancel_for_shutdown(&self) {
        self.cancelled
            .store(CANCELLATION_HOST_SHUTDOWN, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    /// Return whether cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst) != CANCELLATION_NONE
    }

    /// Return whether cancellation came from a business-level job cancel event.
    pub fn is_job_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst) == CANCELLATION_JOB
    }

    /// Return whether cancellation came from worker-host shutdown.
    pub fn is_host_shutdown(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst) == CANCELLATION_HOST_SHUTDOWN
    }

    pub(crate) fn is_same_token(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }

    async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
            if self.is_cancelled() {
                return;
            }
        }
    }
}

/// [`JobEventPublisher`] backed by a NATS client.
#[derive(Clone)]
pub struct NatsJobEventPublisher {
    nats: async_nats::Client,
}

impl NatsJobEventPublisher {
    /// Create a publisher that writes encoded job events to NATS.
    pub fn new(nats: async_nats::Client) -> Self {
        Self { nats }
    }
}

impl JobEventPublisher for NatsJobEventPublisher {
    type Error = String;

    fn publish(
        &self,
        subject: String,
        payload: Vec<u8>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let nats = self.nats.clone();
        async move {
            nats.publish(subject, payload.into())
                .await
                .map_err(|error| error.to_string())
        }
    }
}

/// Errors returned while consuming or acknowledging job work items.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeWorkerError {
    #[error("failed to open work stream '{stream}': {details}")]
    OpenStream { stream: String, details: String },
    #[error("worker queue binding '{queue_type}' is missing")]
    MissingQueueBinding { queue_type: String },
    #[error("failed to open worker consumer '{consumer}' for subject '{subject}': {details}")]
    Consumer {
        consumer: String,
        subject: String,
        details: String,
    },
    #[error("failed to read worker messages for consumer '{consumer}': {details}")]
    Messages { consumer: String, details: String },
    #[error("failed to process job payload: {0}")]
    Process(String),
    #[error("failed to acknowledge worker message: {0}")]
    Ack(String),
    #[error("failed to subscribe to cancellation subject '{subject}': {details}")]
    CancellationSubscription { subject: String, details: String },
    #[error("failed to open projected jobs-state bucket '{bucket}': {details}")]
    ProjectedStateBucket { bucket: String, details: String },
    #[error("failed to read projected job key '{key}' from bucket '{bucket}': {details}")]
    ProjectedStateRead {
        bucket: String,
        key: String,
        details: String,
    },
    #[error("failed to decode projected job key '{key}' from bucket '{bucket}': {details}")]
    ProjectedStateDecode {
        bucket: String,
        key: String,
        details: String,
    },
}

/// Options controlling first-class worker-host startup from a resolved binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerHostOptions {
    /// Optional subset of queue types to run. When omitted, all bound queues run.
    pub queue_types: Option<Vec<String>>,
    /// How often worker presence heartbeats should be published.
    pub heartbeat_interval: Duration,
    /// Optional service version to include in worker heartbeats.
    pub version: Option<String>,
}

impl Default for WorkerHostOptions {
    fn default() -> Self {
        Self {
            queue_types: None,
            heartbeat_interval: Duration::from_secs(30),
            version: None,
        }
    }
}

/// Errors returned while composing or stopping a worker host.
#[derive(Debug, thiserror::Error)]
pub enum WorkerHostError {
    #[error("requested worker queue binding '{queue_type}' is missing")]
    MissingQueueBinding { queue_type: String },
    #[error("worker queue '{queue_type}' has invalid concurrency {concurrency}; expected >= 1")]
    InvalidConcurrency {
        queue_type: String,
        concurrency: u32,
    },
    #[error("failed to start worker heartbeat lifecycle: {0}")]
    Heartbeat(#[from] ServiceRegistryError),
    #[error("worker task for queue '{queue_type}' slot {worker_index} failed: {details}")]
    WorkerTask {
        queue_type: String,
        worker_index: u32,
        details: String,
    },
}

struct WorkerTaskHandle {
    queue_type: String,
    worker_index: u32,
    task: tokio::task::JoinHandle<Result<(), RuntimeWorkerError>>,
}

/// Handle for a binding-driven worker host.
pub struct WorkerHostHandle {
    cancellation: JobCancellationToken,
    heartbeats: Vec<WorkerHeartbeatHandle>,
    workers: Vec<WorkerTaskHandle>,
}

impl WorkerHostHandle {
    /// Return the number of queue-worker tasks owned by this host.
    pub fn worker_count(&self) -> usize {
        self.workers.len()
    }

    /// Stop all worker tasks and then stop host heartbeats.
    pub async fn stop(self) -> Result<(), WorkerHostError> {
        self.cancellation.cancel_for_shutdown();

        let mut first_error = None;
        for worker in self.workers {
            match worker.task.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    first_error.get_or_insert(WorkerHostError::WorkerTask {
                        queue_type: worker.queue_type,
                        worker_index: worker.worker_index,
                        details: error.to_string(),
                    });
                }
                Err(error) if error.is_cancelled() => {}
                Err(error) => {
                    first_error.get_or_insert(WorkerHostError::WorkerTask {
                        queue_type: worker.queue_type,
                        worker_index: worker.worker_index,
                        details: error.to_string(),
                    });
                }
            }
        }

        for heartbeat in self.heartbeats {
            heartbeat.stop().await.map_err(WorkerHostError::Heartbeat)?;
        }

        if let Some(error) = first_error {
            return Err(error);
        }
        Ok(())
    }
}

/// Decode a work payload and run it through a [`JobManager`].
pub async fn process_work_payload<P, M, H, Fut, E>(
    manager: &JobManager<P, M>,
    payload: &[u8],
    handler: H,
) -> Result<Option<JobProcessOutcome<Value>>, RuntimeWorkerError>
where
    P: JobEventPublisher,
    P::Error: std::fmt::Display,
    M: JobMetaSource,
    H: FnOnce(ActiveJob<P, M>) -> Fut,
    Fut: Future<Output = Result<Value, JobProcessError<E>>>,
    E: ToString,
{
    process_work_payload_with_context(manager, payload, JobCancellationToken::new(), handler).await
}

/// Decode a work payload and run it through a [`JobManager`] with cancellation context.
pub async fn process_work_payload_with_context<P, M, H, Fut, E>(
    manager: &JobManager<P, M>,
    payload: &[u8],
    cancellation: JobCancellationToken,
    handler: H,
) -> Result<Option<JobProcessOutcome<Value>>, RuntimeWorkerError>
where
    P: JobEventPublisher,
    P::Error: std::fmt::Display,
    M: JobMetaSource,
    H: FnOnce(ActiveJob<P, M>) -> Fut,
    Fut: Future<Output = Result<Value, JobProcessError<E>>>,
    E: ToString,
{
    process_work_payload_with_context_and_heartbeat(
        manager,
        payload,
        cancellation,
        || Box::pin(async { Err("worker heartbeat unavailable".to_string()) }),
        handler,
    )
    .await
}

/// Decode a work payload and run it through a [`JobManager`] with cancellation
/// context and a custom heartbeat hook.
pub async fn process_work_payload_with_context_and_heartbeat<P, M, HB, H, Fut, E>(
    manager: &JobManager<P, M>,
    payload: &[u8],
    cancellation: JobCancellationToken,
    heartbeat: HB,
    handler: H,
) -> Result<Option<JobProcessOutcome<Value>>, RuntimeWorkerError>
where
    P: JobEventPublisher,
    P::Error: std::fmt::Display,
    M: JobMetaSource,
    HB: Fn() -> BoxFuture<'static, Result<(), String>> + Send + Sync + 'static,
    H: FnOnce(ActiveJob<P, M>) -> Fut,
    Fut: Future<Output = Result<Value, JobProcessError<E>>>,
    E: ToString,
{
    let event = match serde_json::from_slice::<JobEvent>(payload) {
        Ok(event) => event,
        Err(_) => return Ok(None),
    };
    let Some(job) = job_from_work_event(&event) else {
        return Ok(None);
    };

    manager
        .process_with_heartbeat(job, cancellation, heartbeat, handler)
        .await
        .map(Some)
        .map_err(|error| RuntimeWorkerError::Process(error.to_string()))
}

fn parse_work_payload_job(payload: &[u8]) -> Option<Job> {
    let event = serde_json::from_slice::<JobEvent>(payload).ok()?;
    job_from_work_event(&event)
}

/// Run one queue worker against a bound work stream.
///
/// Service registration is intentionally not owned here. Callers that want
/// instance heartbeats should start them separately at the service-host level.
pub async fn run_single_queue_worker<P, M, H, Fut, E>(
    nats: async_nats::Client,
    work_stream: &str,
    queue_type: &str,
    manager: JobManager<P, M>,
    handler: H,
) -> Result<(), RuntimeWorkerError>
where
    P: JobEventPublisher + Send + Sync + 'static,
    P::Error: std::fmt::Display,
    M: JobMetaSource + Send + Sync + 'static,
    H: Fn(ActiveJob<P, M>) -> Fut + Clone + Send + Sync + 'static,
    Fut: Future<Output = Result<Value, JobProcessError<E>>> + Send,
    E: ToString + Send,
{
    run_single_queue_worker_with_context(
        nats,
        work_stream,
        queue_type,
        manager,
        JobCancellationToken::new(),
        move |job| handler(job),
    )
    .await
}

/// Run one queue worker against a bound work stream with cancellation context.
pub async fn run_single_queue_worker_with_context<P, M, H, Fut, E>(
    nats: async_nats::Client,
    work_stream: &str,
    queue_type: &str,
    manager: JobManager<P, M>,
    cancellation: JobCancellationToken,
    handler: H,
) -> Result<(), RuntimeWorkerError>
where
    P: JobEventPublisher + Send + Sync + 'static,
    P::Error: std::fmt::Display,
    M: JobMetaSource + Send + Sync + 'static,
    H: Fn(ActiveJob<P, M>) -> Fut + Clone + Send + Sync + 'static,
    Fut: Future<Output = Result<Value, JobProcessError<E>>> + Send,
    E: ToString + Send,
{
    run_single_queue_worker_with_context_and_registry(
        nats,
        work_stream,
        queue_type,
        manager,
        cancellation,
        ActiveJobCancellationRegistry::new(),
        handler,
    )
    .await
}

async fn run_single_queue_worker_with_context_and_registry<P, M, H, Fut, E>(
    nats: async_nats::Client,
    work_stream: &str,
    queue_type: &str,
    manager: JobManager<P, M>,
    cancellation: JobCancellationToken,
    cancellation_registry: ActiveJobCancellationRegistry,
    handler: H,
) -> Result<(), RuntimeWorkerError>
where
    P: JobEventPublisher + Send + Sync + 'static,
    P::Error: std::fmt::Display,
    M: JobMetaSource + Send + Sync + 'static,
    H: Fn(ActiveJob<P, M>) -> Fut + Clone + Send + Sync + 'static,
    Fut: Future<Output = Result<Value, JobProcessError<E>>> + Send,
    E: ToString + Send,
{
    let queue = manager
        .bindings()
        .queues
        .get(queue_type)
        .ok_or_else(|| RuntimeWorkerError::MissingQueueBinding {
            queue_type: queue_type.to_string(),
        })?
        .clone();
    let cancellation_subject = format!("{}.*.cancelled", queue.publish_prefix);
    let mut cancellation_subscriber =
        nats.subscribe(cancellation_subject.clone())
            .await
            .map_err(|error| RuntimeWorkerError::CancellationSubscription {
                subject: cancellation_subject.clone(),
                details: error.to_string(),
            })?;
    let cancellation_task = {
        let cancellation_registry = cancellation_registry.clone();
        tokio::spawn(async move {
            while let Some(message) = cancellation_subscriber.next().await {
                let Ok(event) = serde_json::from_slice::<JobEvent>(&message.payload) else {
                    continue;
                };
                if event.event_type != JobEventType::Cancelled {
                    continue;
                }
                let key = job_key(&event.service, &event.job_type, &event.job_id);
                cancellation_registry.cancel(&key);
            }
        })
    };

    let result = async {
        let jetstream = jetstream::new(nats);
        let projected_jobs_state =
            if let Some(bucket) = manager.bindings().jobs_state_bucket.as_deref() {
                Some(jetstream.get_key_value(bucket).await.map_err(|error| {
                    RuntimeWorkerError::ProjectedStateBucket {
                        bucket: bucket.to_string(),
                        details: error.to_string(),
                    }
                })?)
            } else {
                None
            };
        let stream = jetstream.get_stream(work_stream).await.map_err(|error| {
            RuntimeWorkerError::OpenStream {
                stream: work_stream.to_string(),
                details: error.to_string(),
            }
        })?;
        let consumer = stream
            .get_or_create_consumer(
                &queue.consumer_name,
                consumer::pull::Config {
                    durable_name: Some(queue.consumer_name.clone()),
                    filter_subject: queue.work_subject.clone(),
                    ack_policy: consumer::AckPolicy::Explicit,
                    ack_wait: Duration::from_millis(queue.ack_wait_ms),
                    max_deliver: i64::try_from(queue.max_deliver).unwrap_or(i64::MAX),
                    backoff: queue
                        .backoff_ms
                        .iter()
                        .copied()
                        .map(Duration::from_millis)
                        .collect(),
                    ..Default::default()
                },
            )
            .await
            .map_err(|error| RuntimeWorkerError::Consumer {
                consumer: queue.consumer_name.clone(),
                subject: queue.work_subject.clone(),
                details: error.to_string(),
            })?;
        let mut messages =
            consumer
                .messages()
                .await
                .map_err(|error| RuntimeWorkerError::Messages {
                    consumer: queue.consumer_name.clone(),
                    details: error.to_string(),
                })?;

        loop {
            let next_message = tokio::select! {
                _ = cancellation.cancelled() => break,
                next_message = messages.next() => next_message,
            };
            let Some(message) = next_message else {
                break;
            };
            let message = message.map_err(|error| RuntimeWorkerError::Messages {
                consumer: queue.consumer_name.clone(),
                details: error.to_string(),
            })?;
            let payload = message.payload.clone();
            let Some(parsed_job) = parse_work_payload_job(&payload) else {
                message.ack().await.map_err(map_ack_error)?;
                continue;
            };
            let job_key = job_key(&parsed_job.service, &parsed_job.job_type, &parsed_job.id);
            if let Some(projected_jobs_state) = projected_jobs_state.as_ref() {
                if projected_work_decision(
                    read_projected_job(
                        projected_jobs_state,
                        manager
                            .bindings()
                            .jobs_state_bucket
                            .as_deref()
                            .unwrap_or_default(),
                        &job_key,
                    )
                    .await?
                    .as_ref(),
                    &parsed_job,
                ) == ProjectedWorkDecision::SkipAck
                {
                    cancellation_registry.clear_pending(&job_key);
                    message.ack().await.map_err(map_ack_error)?;
                    continue;
                }
            }
            let job_cancellation = JobCancellationToken::new();
            if cancellation.is_host_shutdown() {
                job_cancellation.cancel_for_shutdown();
            } else if cancellation.is_job_cancelled() {
                job_cancellation.cancel();
            }
            let _cancellation_guard =
                cancellation_registry.register(job_key, job_cancellation.clone());
            let handler = handler.clone();
            let heartbeat_message = message.clone();
            let forward_cancellation = {
                let outer_cancellation = cancellation.clone();
                let job_cancellation = job_cancellation.clone();
                tokio::spawn(async move {
                    outer_cancellation.cancelled().await;
                    if outer_cancellation.is_host_shutdown() {
                        job_cancellation.cancel_for_shutdown();
                    } else if outer_cancellation.is_job_cancelled() {
                        job_cancellation.cancel();
                    }
                })
            };
            let process_result = process_work_payload_with_context_and_heartbeat(
                &manager,
                &payload,
                job_cancellation,
                move || {
                    let heartbeat_message = heartbeat_message.clone();
                    Box::pin(async move {
                        heartbeat_message
                            .ack_with(AckKind::Progress)
                            .await
                            .map_err(|error| error.to_string())
                    })
                },
                handler.clone(),
            )
            .await;
            forward_cancellation.abort();
            let _ = forward_cancellation.await;
            let process_result = process_result?;
            match ack_action_for_outcome(process_result.as_ref()) {
                WorkerAckAction::Ack => message.ack().await.map_err(map_ack_error)?,
                WorkerAckAction::Nak => message
                    .ack_with(AckKind::Nak(None))
                    .await
                    .map_err(map_ack_error)?,
            }
        }

        Ok(())
    }
    .await;
    cancellation_task.abort();
    let _ = cancellation_task.await;
    result
}

/// Run one queue worker using a previously resolved jobs runtime binding.
pub async fn run_single_queue_worker_from_binding<P, M, H, Fut, E>(
    nats: async_nats::Client,
    binding: JobsRuntimeBinding,
    queue_type: &str,
    publisher: P,
    meta: M,
    handler: H,
) -> Result<(), RuntimeWorkerError>
where
    P: JobEventPublisher + Send + Sync + 'static,
    P::Error: std::fmt::Display,
    M: JobMetaSource + Send + Sync + 'static,
    H: Fn(ActiveJob<P, M>) -> Fut + Clone + Send + Sync + 'static,
    Fut: Future<Output = Result<Value, JobProcessError<E>>> + Send,
    E: ToString + Send,
{
    let manager = JobManager::new(publisher, binding.jobs, meta);
    run_single_queue_worker(nats, &binding.work_stream, queue_type, manager, handler).await
}

/// Run one queue worker from a resolved binding with cancellation context.
pub async fn run_single_queue_worker_from_binding_with_context<P, M, H, Fut, E>(
    nats: async_nats::Client,
    binding: JobsRuntimeBinding,
    queue_type: &str,
    publisher: P,
    meta: M,
    cancellation: JobCancellationToken,
    handler: H,
) -> Result<(), RuntimeWorkerError>
where
    P: JobEventPublisher + Send + Sync + 'static,
    P::Error: std::fmt::Display,
    M: JobMetaSource + Send + Sync + 'static,
    H: Fn(ActiveJob<P, M>) -> Fut + Clone + Send + Sync + 'static,
    Fut: Future<Output = Result<Value, JobProcessError<E>>> + Send,
    E: ToString + Send,
{
    let manager = JobManager::new(publisher, binding.jobs, meta);
    run_single_queue_worker_with_context(
        nats,
        &binding.work_stream,
        queue_type,
        manager,
        cancellation,
        handler,
    )
    .await
}

/// Start a first-class worker host from a resolved runtime binding.
pub async fn start_worker_host_from_binding<PF, P, MF, M, H, Fut, E>(
    nats: async_nats::Client,
    binding: JobsRuntimeBinding,
    instance_id: String,
    publisher_factory: PF,
    meta_factory: MF,
    handler: H,
    options: WorkerHostOptions,
) -> Result<WorkerHostHandle, WorkerHostError>
where
    PF: Fn() -> P + Clone + Send + Sync + 'static,
    P: JobEventPublisher + Send + Sync + 'static,
    P::Error: std::fmt::Display,
    MF: Fn(&str, u32) -> M + Clone + Send + Sync + 'static,
    M: JobMetaSource + Send + Sync + 'static,
    H: Fn(ActiveJob<P, M>) -> Fut + Clone + Send + Sync + 'static,
    Fut: Future<Output = Result<Value, JobProcessError<E>>> + Send + 'static,
    E: ToString + Send + 'static,
{
    let queue_types = selected_queue_types(&binding, options.queue_types.as_deref())?;
    for queue_type in &queue_types {
        let queue = binding.jobs.queues.get(queue_type).ok_or_else(|| {
            WorkerHostError::MissingQueueBinding {
                queue_type: queue_type.clone(),
            }
        })?;
        if queue.concurrency == 0 {
            return Err(WorkerHostError::InvalidConcurrency {
                queue_type: queue_type.clone(),
                concurrency: queue.concurrency,
            });
        }
    }

    let cancellation = JobCancellationToken::new();
    let mut heartbeats = Vec::new();
    for queue_type in &queue_types {
        let queue = binding.jobs.queues.get(queue_type).ok_or_else(|| {
            WorkerHostError::MissingQueueBinding {
                queue_type: queue_type.clone(),
            }
        })?;
        heartbeats.push(
            start_worker_heartbeat_loop(
                nats.clone(),
                binding.jobs.namespace.clone(),
                queue_type.clone(),
                instance_id.clone(),
                Some(queue.concurrency),
                options.version.clone(),
                options.heartbeat_interval,
            )
            .await?,
        );
    }
    let mut workers = Vec::new();
    let cancellation_registry = ActiveJobCancellationRegistry::new();
    for queue_type in queue_types {
        let queue = binding.jobs.queues.get(&queue_type).ok_or_else(|| {
            WorkerHostError::MissingQueueBinding {
                queue_type: queue_type.clone(),
            }
        })?;

        for worker_index in 0..queue.concurrency {
            let worker_nats = nats.clone();
            let worker_binding = binding.clone();
            let worker_queue_type = queue_type.clone();
            let worker_publisher = publisher_factory.clone()();
            let worker_meta = meta_factory.clone()(&worker_queue_type, worker_index);
            let worker_handler = handler.clone();
            let worker_cancellation = cancellation.clone();
            let worker_cancellation_registry = cancellation_registry.clone();
            let task = tokio::spawn(async move {
                let work_stream = worker_binding.work_stream.clone();
                let manager = JobManager::new(worker_publisher, worker_binding.jobs, worker_meta);
                run_single_queue_worker_with_context_and_registry(
                    worker_nats,
                    &work_stream,
                    &worker_queue_type,
                    manager,
                    worker_cancellation,
                    worker_cancellation_registry,
                    worker_handler,
                )
                .await
            });
            workers.push(WorkerTaskHandle {
                queue_type: queue_type.clone(),
                worker_index,
                task,
            });
        }
    }

    Ok(WorkerHostHandle {
        cancellation,
        heartbeats,
        workers,
    })
}

fn selected_queue_types(
    binding: &JobsRuntimeBinding,
    requested: Option<&[String]>,
) -> Result<Vec<String>, WorkerHostError> {
    match requested {
        Some(queue_types) => queue_types
            .iter()
            .map(|queue_type| {
                if binding.jobs.queues.contains_key(queue_type) {
                    Ok(queue_type.clone())
                } else {
                    Err(WorkerHostError::MissingQueueBinding {
                        queue_type: queue_type.clone(),
                    })
                }
            })
            .collect(),
        None => {
            let mut queue_types = binding.jobs.queues.keys().cloned().collect::<Vec<_>>();
            queue_types.sort();
            Ok(queue_types)
        }
    }
}

fn map_ack_error(error: async_nats::Error) -> RuntimeWorkerError {
    RuntimeWorkerError::Ack(error.to_string())
}

async fn read_projected_job(
    kv: &jetstream::kv::Store,
    bucket: &str,
    key: &str,
) -> Result<Option<Job>, RuntimeWorkerError> {
    let payload = kv
        .get(key)
        .await
        .map_err(|error| RuntimeWorkerError::ProjectedStateRead {
            bucket: bucket.to_string(),
            key: key.to_string(),
            details: error.to_string(),
        })?;
    let Some(payload) = payload else {
        return Ok(None);
    };
    serde_json::from_slice::<Job>(&payload)
        .map(Some)
        .map_err(|error| RuntimeWorkerError::ProjectedStateDecode {
            bucket: bucket.to_string(),
            key: key.to_string(),
            details: error.to_string(),
        })
}

fn projected_work_decision(projected: Option<&Job>, work: &Job) -> ProjectedWorkDecision {
    let Some(projected) = projected else {
        return ProjectedWorkDecision::Process;
    };

    if is_terminal_projection_state(projected.state) {
        return ProjectedWorkDecision::SkipAck;
    }
    let _ = work;
    ProjectedWorkDecision::Process
}

fn is_terminal_projection_state(state: JobState) -> bool {
    matches!(
        state,
        JobState::Completed
            | JobState::Failed
            | JobState::Cancelled
            | JobState::Expired
            | JobState::Dead
            | JobState::Dismissed
    )
}

fn ack_action_for_outcome<TResult>(
    outcome: Option<&JobProcessOutcome<TResult>>,
) -> WorkerAckAction {
    match outcome {
        Some(JobProcessOutcome::Retry { .. }) => WorkerAckAction::Nak,
        Some(JobProcessOutcome::Interrupted { .. }) => WorkerAckAction::Nak,
        Some(JobProcessOutcome::Completed { .. })
        | Some(JobProcessOutcome::Cancelled { .. })
        | Some(JobProcessOutcome::Failed { .. })
        | None => WorkerAckAction::Ack,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::Value;

    use super::JobCancellationToken;

    use super::{
        ack_action_for_outcome, projected_work_decision, ProjectedWorkDecision, WorkerAckAction,
    };
    use crate::manager::JobProcessOutcome;
    use crate::types::{Job, JobState};

    fn sample_job(state: JobState, tries: u64) -> Job {
        Job {
            id: "job-1".to_string(),
            service: "documents".to_string(),
            job_type: "document-process".to_string(),
            state,
            payload: serde_json::json!({ "documentId": "doc-1" }),
            result: None,
            created_at: "2026-03-28T11:59:00.000Z".to_string(),
            updated_at: "2026-03-28T11:59:00.000Z".to_string(),
            started_at: None,
            completed_at: None,
            tries,
            max_tries: 2,
            last_error: None,
            deadline: None,
            progress: None,
            logs: None,
        }
    }

    #[test]
    fn interrupted_outcomes_use_nak_instead_of_ack() {
        assert_eq!(
            ack_action_for_outcome(Some(&JobProcessOutcome::<Value>::Interrupted { tries: 1 })),
            WorkerAckAction::Nak
        );
    }

    #[test]
    fn projected_work_decision_allows_when_projection_matches_seed_state() {
        let work = sample_job(JobState::Pending, 0);
        let projected = sample_job(JobState::Pending, 0);

        assert_eq!(
            projected_work_decision(Some(&projected), &work),
            ProjectedWorkDecision::Process
        );
    }

    #[test]
    fn projected_work_decision_skips_when_projection_is_cancelled() {
        let work = sample_job(JobState::Pending, 0);
        let projected = sample_job(JobState::Cancelled, 0);

        assert_eq!(
            projected_work_decision(Some(&projected), &work),
            ProjectedWorkDecision::SkipAck
        );
    }

    #[test]
    fn projected_work_decision_processes_when_projection_is_active_for_created_work() {
        let work = sample_job(JobState::Pending, 0);
        let projected = sample_job(JobState::Active, 1);

        assert_eq!(
            projected_work_decision(Some(&projected), &work),
            ProjectedWorkDecision::Process
        );
    }

    #[test]
    fn projected_work_decision_skips_when_projection_is_terminal() {
        let work = sample_job(JobState::Retry, 0);
        let projected = sample_job(JobState::Completed, 1);

        assert_eq!(
            projected_work_decision(Some(&projected), &work),
            ProjectedWorkDecision::SkipAck
        );
    }

    #[tokio::test]
    async fn job_cancellation_token_cancelled_returns_after_prior_cancel() {
        let token = JobCancellationToken::new();
        token.cancel();

        let result = tokio::time::timeout(Duration::from_millis(50), token.cancelled()).await;

        assert!(
            result.is_ok(),
            "cancelled should complete after prior cancel"
        );
    }

    #[test]
    fn job_cancellation_token_shutdown_wins_if_shutdown_happens_first() {
        let token = JobCancellationToken::new();

        token.cancel_for_shutdown();
        token.cancel();

        assert!(token.is_host_shutdown());
        assert!(!token.is_job_cancelled());
    }

    #[test]
    fn job_cancellation_token_shutdown_wins_if_job_cancel_happens_first() {
        let token = JobCancellationToken::new();

        token.cancel();
        token.cancel_for_shutdown();

        assert!(token.is_host_shutdown());
        assert!(!token.is_job_cancelled());
    }
}
