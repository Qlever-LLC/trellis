use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

use crate::runtime_worker::JobCancellationToken;
use crate::types::{Job, JobLogEntry, JobProgress, JobState};

type HeartbeatFn = Arc<dyn Fn() -> BoxFuture<'static, Result<(), JobsError>> + Send + Sync>;
type ProgressFn = Arc<dyn Fn(JobProgress) -> BoxFuture<'static, Result<(), JobsError>> + Send + Sync>;
type LogFn = Arc<dyn Fn(JobLogEntry) -> BoxFuture<'static, Result<(), JobsError>> + Send + Sync>;

/// Errors returned by the typed jobs API.
#[derive(Debug, thiserror::Error)]
pub enum JobsError {
    #[error("{message}")]
    Message { message: String },
    #[error("failed to decode job payload: {0}")]
    DecodePayload(serde_json::Error),
    #[error("failed to decode job result: {0}")]
    DecodeResult(serde_json::Error),
    #[error("failed to encode job payload: {0}")]
    EncodePayload(serde_json::Error),
    #[error("failed to encode job result: {0}")]
    EncodeResult(serde_json::Error),
}

/// Service-local jobs API entrypoint.
pub trait JobsService {
    type Facade: JobsFacade;

    fn jobs(&self) -> Self::Facade;
}

/// Typed service-local jobs facade.
pub trait JobsFacade {
    type WorkerHost: JobWorkerHost;

    fn start_workers(&self) -> impl Future<Output = Result<Self::WorkerHost, JobsError>> + Send;
}

/// Typed queue API for one job type.
pub trait JobQueue<TPayload, TResult> {
    fn create(
        &self,
        payload: TPayload,
    ) -> impl Future<Output = Result<JobRef<TPayload, TResult>, JobsError>> + Send;

    fn handle<H, Fut>(&self, handler: H) -> impl Future<Output = Result<(), JobsError>> + Send
    where
        H: Fn(ActiveJob<TPayload, TResult>) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<TResult, JobsError>> + Send;
}

/// Handle for a created job.
pub struct JobRef<TPayload, TResult> {
    identity: JobIdentity,
    get: Arc<dyn Fn() -> BoxFuture<'static, Result<JobSnapshot<TPayload, TResult>, JobsError>> + Send + Sync>,
    wait: Arc<dyn Fn() -> BoxFuture<'static, Result<TerminalJob<TPayload, TResult>, JobsError>> + Send + Sync>,
    cancel: Arc<dyn Fn() -> BoxFuture<'static, Result<JobSnapshot<TPayload, TResult>, JobsError>> + Send + Sync>,
}

impl<TPayload, TResult> Clone for JobRef<TPayload, TResult> {
    fn clone(&self) -> Self {
        Self {
            identity: self.identity.clone(),
            get: Arc::clone(&self.get),
            wait: Arc::clone(&self.wait),
            cancel: Arc::clone(&self.cancel),
        }
    }
}

impl<TPayload, TResult> JobRef<TPayload, TResult>
where
    TPayload: Clone + Send + Sync + 'static,
    TResult: Clone + Send + Sync + 'static,
{
    pub fn new(
        identity: JobIdentity,
        get: impl Fn() -> BoxFuture<'static, Result<JobSnapshot<TPayload, TResult>, JobsError>> + Send + Sync + 'static,
        wait: impl Fn() -> BoxFuture<'static, Result<TerminalJob<TPayload, TResult>, JobsError>> + Send + Sync + 'static,
        cancel: impl Fn() -> BoxFuture<'static, Result<JobSnapshot<TPayload, TResult>, JobsError>> + Send + Sync + 'static,
    ) -> Self {
        Self {
            identity,
            get: Arc::new(get),
            wait: Arc::new(wait),
            cancel: Arc::new(cancel),
        }
    }

    pub fn identity(&self) -> &JobIdentity {
        &self.identity
    }

    pub async fn get(&self) -> Result<JobSnapshot<TPayload, TResult>, JobsError> {
        (self.get)().await
    }

    pub async fn wait(&self) -> Result<TerminalJob<TPayload, TResult>, JobsError> {
        (self.wait)().await
    }

    pub async fn cancel(&self) -> Result<JobSnapshot<TPayload, TResult>, JobsError> {
        (self.cancel)().await
    }
}

/// Typed snapshot of one job.
#[derive(Debug, Clone, PartialEq)]
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

impl<TPayload, TResult> TryFrom<Job> for JobSnapshot<TPayload, TResult>
where
    TPayload: DeserializeOwned,
    TResult: DeserializeOwned,
{
    type Error = JobsError;

    fn try_from(job: Job) -> Result<Self, Self::Error> {
        let payload = serde_json::from_value(job.payload).map_err(JobsError::DecodePayload)?;
        let result = job
            .result
            .map(|value| serde_json::from_value(value).map_err(JobsError::DecodeResult))
            .transpose()?;

        Ok(Self {
            id: job.id,
            service: job.service,
            r#type: job.job_type,
            state: job.state,
            payload,
            result,
            created_at: job.created_at,
            updated_at: job.updated_at,
            started_at: job.started_at,
            completed_at: job.completed_at,
            tries: job.tries,
            max_tries: job.max_tries,
            last_error: job.last_error,
            progress: job.progress,
            logs: job.logs.unwrap_or_default(),
        })
    }
}

/// Terminal snapshot of one job.
pub type TerminalJob<TPayload, TResult> = JobSnapshot<TPayload, TResult>;

/// Typed active-job handle.
pub struct ActiveJob<TPayload, TResult> {
    payload: TPayload,
    state: JobState,
    tries: u64,
    cancellation: JobCancellationToken,
    heartbeat: HeartbeatFn,
    progress: ProgressFn,
    log: LogFn,
    _result: PhantomData<TResult>,
}

impl<TPayload, TResult> ActiveJob<TPayload, TResult>
where
    TPayload: Send + Sync + 'static,
    TResult: Send + Sync + 'static,
{
    pub fn new(
        payload: TPayload,
        state: JobState,
        tries: u64,
        cancellation: JobCancellationToken,
        heartbeat: impl Fn() -> BoxFuture<'static, Result<(), JobsError>> + Send + Sync + 'static,
        progress: impl Fn(JobProgress) -> BoxFuture<'static, Result<(), JobsError>> + Send + Sync + 'static,
        log: impl Fn(JobLogEntry) -> BoxFuture<'static, Result<(), JobsError>> + Send + Sync + 'static,
    ) -> Self {
        Self {
            payload,
            state,
            tries,
            cancellation,
            heartbeat: Arc::new(heartbeat),
            progress: Arc::new(progress),
            log: Arc::new(log),
            _result: PhantomData,
        }
    }

    pub fn payload(&self) -> &TPayload {
        &self.payload
    }

    pub fn state(&self) -> JobState {
        self.state
    }

    pub fn tries(&self) -> u64 {
        self.tries
    }

    pub fn redelivery_count(&self) -> u64 {
        self.tries.saturating_sub(1)
    }

    pub fn is_redelivery(&self) -> bool {
        self.redelivery_count() > 0
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    pub async fn heartbeat(&self) -> Result<(), JobsError> {
        (self.heartbeat)().await
    }

    pub async fn progress(&self, value: JobProgress) -> Result<(), JobsError> {
        (self.progress)(value).await
    }

    pub async fn log(&self, entry: JobLogEntry) -> Result<(), JobsError> {
        (self.log)(entry).await
    }
}

/// Job identity fields used by service-local and admin APIs.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct JobIdentity {
    pub service: String,
    pub job_type: String,
    pub id: String,
}

/// Filter used by admin query helpers.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct JobFilter {
    pub service: Option<String>,
    pub job_type: Option<String>,
    pub state: Option<JobState>,
}

impl From<&Job> for JobIdentity {
    fn from(job: &Job) -> Self {
        Self {
            service: job.service.clone(),
            job_type: job.job_type.clone(),
            id: job.id.clone(),
        }
    }
}

/// Typed worker-host abstraction.
pub trait JobWorkerHost {
    fn stop(self) -> impl Future<Output = Result<(), JobsError>> + Send;
    fn join(self) -> impl Future<Output = Result<(), JobsError>> + Send;
}

/// Convert a typed payload into a JSON value for legacy helpers.
pub fn to_value<T: Serialize>(value: T) -> Result<Value, JobsError> {
    serde_json::to_value(value).map_err(JobsError::EncodePayload)
}
