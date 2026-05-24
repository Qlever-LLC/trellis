use async_nats::jetstream::{self, consumer};
use futures_util::StreamExt;
use serde::Deserialize;
use trellis::jobs::types::{Job, JobEvent};
use trellis::jobs::{dead_event, is_terminal, job_event_subject, job_from_work_event};
use trellis::service::ServerError;

use crate::storage::SqliteJobsStore;

const MAX_DELIVERIES_ADVISORY_SUBJECT_WILDCARD: &str =
    "$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.>";
const ADVISORY_CONSUMER_NAME: &str = "jobs-advisories";

#[derive(Debug, Clone, PartialEq)]
pub struct MappedDeadEvent {
    pub subject: String,
    pub event: JobEvent,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct MaxDeliveriesAdvisory {
    pub stream: String,
    pub consumer: String,
    #[serde(rename = "stream_seq", alias = "streamSeq")]
    pub stream_seq: u64,
    #[serde(alias = "num_deliveries")]
    pub deliveries: u64,
    pub timestamp: String,
}

pub struct AdvisoryHandle {
    task: Option<tokio::task::JoinHandle<Result<(), ServerError>>>,
}

impl AdvisoryHandle {
    pub async fn stop(self) {
        let Some(task) = self.task else {
            return;
        };
        task.abort();
        let _ = task.await;
    }

    pub(crate) fn discard_completed(&mut self) {
        self.task = None;
    }

    pub async fn wait(&mut self) -> Result<(), ServerError> {
        let Some(task) = self.task.as_mut() else {
            return Ok(());
        };
        match task.await {
            Ok(result) => result,
            Err(error) if error.is_cancelled() => Ok(()),
            Err(error) => Err(ServerError::Nats(format!(
                "advisory loop task failed: {error}"
            ))),
        }
    }
}

pub fn map_dead_event_from_advisory_job(
    current: Option<&Job>,
    work_job: &Job,
    advisory: &MaxDeliveriesAdvisory,
) -> Option<MappedDeadEvent> {
    if current.is_some_and(|job| is_terminal(job.state)) {
        return None;
    }

    let previous_state = current.map(|job| job.state).unwrap_or(work_job.state);
    let tries = current
        .map(|job| job.tries)
        .unwrap_or(work_job.tries)
        .max(advisory.deliveries);
    let reason = format!(
        "max deliveries exceeded: stream={} consumer={} deliveries={}",
        advisory.stream, advisory.consumer, advisory.deliveries
    );

    let event = dead_event(
        &work_job.service,
        &work_job.job_type,
        &work_job.id,
        &work_job.context,
        previous_state,
        tries,
        &advisory.timestamp,
        &reason,
    );
    let subject = job_event_subject(
        &work_job.service,
        &work_job.job_type,
        &work_job.id,
        event.event_type,
    );

    Some(MappedDeadEvent { subject, event })
}

pub async fn start_advisory_loop(
    nats: async_nats::Client,
    store: SqliteJobsStore,
    jobs_advisories_stream: String,
) -> Result<AdvisoryHandle, ServerError> {
    let jetstream = jetstream::new(nats.clone());
    let stream = jetstream
        .get_stream(&jobs_advisories_stream)
        .await
        .map_err(|error| {
            ServerError::Nats(format!(
                "failed to open jobs advisory stream '{jobs_advisories_stream}': {error}"
            ))
        })?;
    let consumer = stream
        .get_or_create_consumer(
            ADVISORY_CONSUMER_NAME,
            consumer::pull::Config {
                durable_name: Some(ADVISORY_CONSUMER_NAME.to_string()),
                filter_subject: MAX_DELIVERIES_ADVISORY_SUBJECT_WILDCARD.to_string(),
                ack_policy: consumer::AckPolicy::Explicit,
                ..Default::default()
            },
        )
        .await
        .map_err(|error| {
            ServerError::Nats(format!(
                "failed to create jobs advisory consumer '{ADVISORY_CONSUMER_NAME}' on stream '{jobs_advisories_stream}': {error}"
            ))
        })?;
    let mut messages = consumer
        .messages()
        .await
        .map_err(|error| {
            ServerError::Nats(format!(
                "failed to start jobs advisory consumer '{ADVISORY_CONSUMER_NAME}' message stream: {error}"
            ))
        })?;

    let task = tokio::spawn(async move {
        while let Some(message) = messages.next().await {
            let message = message.map_err(|error| {
                ServerError::Nats(format!(
                    "jobs advisory loop failed to pull from consumer '{ADVISORY_CONSUMER_NAME}' on stream '{jobs_advisories_stream}': {error}"
                ))
            })?;
            let Ok(advisory) = serde_json::from_slice::<MaxDeliveriesAdvisory>(&message.payload)
            else {
                let _ = message.ack().await;
                continue;
            };

            let stream = jetstream
                .get_stream(&advisory.stream)
                .await
                .map_err(|error| {
                    ServerError::Nats(format!(
                        "jobs advisory loop failed to open work stream '{}': {error}",
                        advisory.stream
                    ))
                })?;
            let raw_message =
                stream
                    .get_raw_message(advisory.stream_seq)
                    .await
                    .map_err(|error| {
                        ServerError::Nats(format!(
                            "jobs advisory loop failed to read stream '{}' sequence {}: {error}",
                            advisory.stream, advisory.stream_seq
                        ))
                    })?;
            let Ok(work_event) = serde_json::from_slice::<JobEvent>(&raw_message.payload) else {
                let _ = message.ack().await;
                continue;
            };
            let Some(work_job) = job_from_work_event(&work_event) else {
                let _ = message.ack().await;
                continue;
            };

            let Some(mapped) = map_dead_event_from_store(&store, &work_job, &advisory).map_err(
                |error| {
                    ServerError::Nats(format!(
                        "jobs advisory loop failed to read SQLite projection for '{}/{}/{}': {error}",
                        work_job.service, work_job.job_type, work_job.id
                    ))
                },
            )? else {
                let _ = message.ack().await;
                continue;
            };

            let Ok(payload) = serde_json::to_vec(&mapped.event) else {
                let _ = message.ack().await;
                continue;
            };
            nats.publish_with_headers(
                mapped.subject,
                job_event_headers(&mapped.event),
                payload.into(),
            )
            .await
            .map_err(|error| {
                ServerError::Nats(format!(
                    "jobs advisory loop failed to publish dead event: {error}"
                ))
            })?;
            let _ = message.ack().await;
        }
        Ok(())
    });

    Ok(AdvisoryHandle { task: Some(task) })
}

fn job_event_headers(event: &JobEvent) -> async_nats::header::HeaderMap {
    let mut headers = async_nats::header::HeaderMap::new();
    headers.insert("request-id", event.context.request_id.as_str());
    headers.insert("traceparent", event.context.traceparent.as_str());
    if let Some(tracestate) = event.context.tracestate.as_deref() {
        headers.insert("tracestate", tracestate);
    }
    headers
}

fn map_dead_event_from_store(
    store: &SqliteJobsStore,
    work_job: &Job,
    advisory: &MaxDeliveriesAdvisory,
) -> Result<Option<MappedDeadEvent>, crate::storage::SqliteJobsStoreError> {
    let current = store.get_job(&work_job.service, &work_job.job_type, &work_job.id)?;
    Ok(map_dead_event_from_advisory_job(
        current.as_ref(),
        work_job,
        advisory,
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trellis::jobs::types::{JobContext, JobState};

    use super::*;

    fn job(id: &str, state: JobState) -> Job {
        Job {
            id: id.to_string(),
            context: context(id),
            service: "documents".to_string(),
            job_type: "document-process".to_string(),
            state,
            payload: json!({ "id": id }),
            result: None,
            created_at: "2026-03-28T11:00:00.000Z".to_string(),
            updated_at: "2026-03-28T11:59:00.000Z".to_string(),
            started_at: None,
            completed_at: None,
            tries: 2,
            max_tries: 5,
            last_error: None,
            deadline: None,
            progress: None,
            logs: None,
        }
    }

    fn context(id: &str) -> JobContext {
        JobContext {
            request_id: format!("request-{id}"),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        }
    }

    fn advisory() -> MaxDeliveriesAdvisory {
        MaxDeliveriesAdvisory {
            stream: "JOBS_WORK".to_string(),
            consumer: "documents-document-process".to_string(),
            stream_seq: 42,
            deliveries: 5,
            timestamp: "2026-03-28T12:03:00.000Z".to_string(),
        }
    }

    #[test]
    fn advisory_maps_dead_event_using_sql_current_state() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let current = job("job-1", JobState::Active);
        store.upsert_job(&current).expect("upsert should succeed");

        let mapped = map_dead_event_from_store(&store, &current, &advisory())
            .expect("mapping should succeed")
            .expect("active job should map");

        assert_eq!(mapped.event.job_id, "job-1");
        assert_eq!(mapped.event.previous_state, Some(JobState::Active));
        assert_eq!(mapped.event.state, JobState::Dead);
        assert_eq!(mapped.event.tries, 5);
    }

    #[test]
    fn advisory_skips_terminal_sql_current_state() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let completed = job("job-1", JobState::Completed);
        store.upsert_job(&completed).expect("upsert should succeed");

        let mapped = map_dead_event_from_store(&store, &completed, &advisory())
            .expect("mapping should succeed");

        assert!(mapped.is_none());
    }
}
