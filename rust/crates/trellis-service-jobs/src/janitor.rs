use async_nats::jetstream;
use futures_util::TryStreamExt;
use trellis_jobs::types::{Job, JobEvent};
use trellis_jobs::{expired_event, is_terminal, job_event_subject};
use trellis_server::ServerError;

const EXPIRED_REASON: &str = "job exceeded deadline";

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedExpiredEvent {
    pub key: String,
    pub subject: String,
    pub event: JobEvent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JanitorRunStats {
    pub scanned: usize,
    pub eligible: usize,
    pub published: usize,
}

pub struct JanitorHandle {
    task: tokio::task::JoinHandle<Result<(), ServerError>>,
}

impl JanitorHandle {
    pub async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
    }

    pub async fn wait(&mut self) -> Result<(), ServerError> {
        match (&mut self.task).await {
            Ok(result) => result,
            Err(error) if error.is_cancelled() => Ok(()),
            Err(error) => Err(ServerError::Nats(format!(
                "janitor loop task failed: {error}"
            ))),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum JanitorError {
    #[error("failed to open jobsState bucket '{bucket}': {details}")]
    OpenBucket { bucket: String, details: String },
    #[error("failed to list keys in jobsState bucket '{bucket}': {details}")]
    ListKeys { bucket: String, details: String },
    #[error("failed to read key '{key}' from bucket '{bucket}': {details}")]
    ReadKey {
        bucket: String,
        key: String,
        details: String,
    },
    #[error("failed to publish expired event on subject '{subject}': {details}")]
    Publish { subject: String, details: String },
    #[error("failed to encode expired event payload for key '{key}': {details}")]
    EncodeEvent { key: String, details: String },
}

pub fn plan_expired_events(
    jobs_by_key: &[(String, Job)],
    now_iso: &str,
    reason: &str,
) -> Vec<PlannedExpiredEvent> {
    jobs_by_key
        .iter()
        .filter_map(|(key, job)| {
            let deadline = job.deadline.as_deref()?;
            if deadline > now_iso {
                return None;
            }
            if is_terminal(job.state) {
                return None;
            }

            let event = expired_event(
                &job.service,
                &job.job_type,
                &job.id,
                job.state,
                job.tries,
                now_iso,
                reason,
            );
            let subject = job_event_subject(&job.service, &job.job_type, &job.id, event.event_type);
            Some(PlannedExpiredEvent {
                key: key.clone(),
                subject,
                event,
            })
        })
        .collect()
}

pub async fn run_janitor_once(
    nats: async_nats::Client,
    jobs_state_bucket: &str,
    now_iso: &str,
) -> Result<JanitorRunStats, JanitorError> {
    let jetstream = jetstream::new(nats.clone());
    let kv = jetstream
        .get_key_value(jobs_state_bucket)
        .await
        .map_err(|error| JanitorError::OpenBucket {
            bucket: jobs_state_bucket.to_string(),
            details: error.to_string(),
        })?;

    let mut keys = kv.keys().await.map_err(|error| JanitorError::ListKeys {
        bucket: jobs_state_bucket.to_string(),
        details: error.to_string(),
    })?;

    let mut jobs_by_key = Vec::new();
    while let Some(key) = keys
        .try_next()
        .await
        .map_err(|error| JanitorError::ListKeys {
            bucket: jobs_state_bucket.to_string(),
            details: error.to_string(),
        })?
    {
        let payload = kv.get(&key).await.map_err(|error| JanitorError::ReadKey {
            bucket: jobs_state_bucket.to_string(),
            key: key.clone(),
            details: error.to_string(),
        })?;

        let Some(payload) = payload else {
            continue;
        };
        let Ok(job) = serde_json::from_slice::<Job>(&payload) else {
            continue;
        };
        jobs_by_key.push((key, job));
    }

    let scanned = jobs_by_key.len();
    let planned = plan_expired_events(&jobs_by_key, now_iso, EXPIRED_REASON);
    let eligible = planned.len();

    let mut published = 0usize;
    for plan in planned {
        let payload =
            serde_json::to_vec(&plan.event).map_err(|error| JanitorError::EncodeEvent {
                key: plan.key.clone(),
                details: error.to_string(),
            })?;
        nats.publish(plan.subject.clone(), payload.into())
            .await
            .map_err(|error| JanitorError::Publish {
                subject: plan.subject,
                details: error.to_string(),
            })?;
        published += 1;
    }

    Ok(JanitorRunStats {
        scanned,
        eligible,
        published,
    })
}

pub async fn start_janitor_loop(
    nats: async_nats::Client,
    jobs_state_bucket: String,
    interval: std::time::Duration,
) -> Result<JanitorHandle, ServerError> {
    let task = tokio::spawn(async move {
        let mut ticker = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
        loop {
            ticker.tick().await;
            let now = time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
            run_janitor_once(nats.clone(), &jobs_state_bucket, &now)
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
        }
    });

    Ok(JanitorHandle { task })
}
