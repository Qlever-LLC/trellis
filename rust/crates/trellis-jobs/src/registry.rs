//! Worker-heartbeat and cancellation helpers for jobs workers.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::runtime_worker::JobCancellationToken;
use crate::subjects::worker_heartbeat_subject;
use crate::types::WorkerHeartbeat;

/// Errors returned while publishing or maintaining worker heartbeats.
#[derive(Debug, thiserror::Error)]
pub enum ServiceRegistryError {
    #[error("worker heartbeat task failed: {details}")]
    HeartbeatTask { details: String },
    #[error("failed to encode worker heartbeat for subject '{subject}': {details}")]
    EncodeWorkerHeartbeat { subject: String, details: String },
    #[error("failed to publish worker heartbeat on subject '{subject}': {details}")]
    PublishWorkerHeartbeat { subject: String, details: String },
}

/// Handle for a background worker heartbeat loop.
pub struct WorkerHeartbeatHandle {
    task: tokio::task::JoinHandle<Result<(), ServiceRegistryError>>,
}

impl WorkerHeartbeatHandle {
    /// Stop the heartbeat task and swallow expected cancellation shutdown.
    pub async fn stop(self) -> Result<(), ServiceRegistryError> {
        self.task.abort();
        match self.task.await {
            Ok(result) => result,
            Err(error) if error.is_cancelled() => Ok(()),
            Err(error) => Err(ServiceRegistryError::HeartbeatTask {
                details: error.to_string(),
            }),
        }
    }
}

#[derive(Clone, Default)]
pub struct ActiveJobCancellationRegistry {
    inner: Arc<Mutex<ActiveJobCancellationRegistryInner>>,
}

#[derive(Default)]
struct ActiveJobCancellationRegistryInner {
    tokens: HashMap<String, Vec<JobCancellationToken>>,
    pending: HashSet<String>,
}

pub struct ActiveJobCancellationGuard {
    key: String,
    token: JobCancellationToken,
    registry: ActiveJobCancellationRegistry,
}

impl ActiveJobCancellationRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(
        &self,
        key: impl Into<String>,
        token: JobCancellationToken,
    ) -> ActiveJobCancellationGuard {
        let key = key.into();
        let mut inner = self.inner.lock().expect("lock cancellation registry");
        inner
            .tokens
            .entry(key.clone())
            .or_default()
            .push(token.clone());
        if inner.pending.remove(&key) {
            token.cancel();
        }
        ActiveJobCancellationGuard {
            key,
            token,
            registry: self.clone(),
        }
    }

    pub fn cancel(&self, key: &str) -> bool {
        let mut found = false;
        let mut inner = self.inner.lock().expect("lock cancellation registry");
        if let Some(tokens) = inner.tokens.get(key) {
            for token in tokens {
                token.cancel();
                found = true;
            }
        }
        if !found {
            inner.pending.insert(key.to_string());
        }
        found
    }

    /// Forget a pending cancel for work that will never register a live token.
    pub fn clear_pending(&self, key: &str) {
        let mut inner = self.inner.lock().expect("lock cancellation registry");
        inner.pending.remove(key);
    }

    fn unregister(&self, key: &str, token: &JobCancellationToken) {
        let mut inner = self.inner.lock().expect("lock cancellation registry");
        if let Some(tokens) = inner.tokens.get_mut(key) {
            tokens.retain(|existing| !existing.is_same_token(token));
            if tokens.is_empty() {
                inner.tokens.remove(key);
            }
        }
    }
}

impl Drop for ActiveJobCancellationGuard {
    fn drop(&mut self) {
        self.registry.unregister(&self.key, &self.token);
    }
}

/// Build a fresh worker heartbeat payload.
pub fn new_worker_heartbeat(
    service: &str,
    job_type: &str,
    instance_id: &str,
    concurrency: Option<u32>,
    version: Option<String>,
    now_iso: String,
) -> WorkerHeartbeat {
    WorkerHeartbeat {
        service: service.to_string(),
        job_type: job_type.to_string(),
        instance_id: instance_id.to_string(),
        concurrency,
        version,
        timestamp: now_iso,
    }
}

/// Publish one worker heartbeat immediately.
pub async fn publish_worker_heartbeat(
    nats: async_nats::Client,
    heartbeat: &WorkerHeartbeat,
) -> Result<(), ServiceRegistryError> {
    let subject = worker_heartbeat_subject(
        &heartbeat.service,
        &heartbeat.job_type,
        &heartbeat.instance_id,
    );
    let payload = serde_json::to_vec(heartbeat).map_err(|error| {
        ServiceRegistryError::EncodeWorkerHeartbeat {
            subject: subject.clone(),
            details: error.to_string(),
        }
    })?;
    nats.publish(subject.clone(), payload.into())
        .await
        .map_err(|error| ServiceRegistryError::PublishWorkerHeartbeat {
            subject,
            details: error.to_string(),
        })?;
    Ok(())
}

/// Start a background heartbeat loop for one worker-host queue type.
pub async fn start_worker_heartbeat_loop(
    nats: async_nats::Client,
    service: String,
    job_type: String,
    instance_id: String,
    concurrency: Option<u32>,
    version: Option<String>,
    interval: Duration,
) -> Result<WorkerHeartbeatHandle, ServiceRegistryError> {
    let publish = move |nats: async_nats::Client, timestamp: String| {
        let heartbeat = new_worker_heartbeat(
            &service,
            &job_type,
            &instance_id,
            concurrency,
            version.clone(),
            timestamp,
        );
        async move { publish_worker_heartbeat(nats, &heartbeat).await }
    };

    publish(nats.clone(), now_timestamp_string()).await?;

    let task = tokio::spawn(async move {
        let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
        loop {
            ticker.tick().await;
            publish(nats.clone(), now_timestamp_string()).await?;
        }
    });

    Ok(WorkerHeartbeatHandle { task })
}

fn now_timestamp_string() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
