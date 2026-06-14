use async_nats::jetstream::{self, consumer};
use futures_util::StreamExt;
use serde_json::Value;
use trellis_rs::jobs::reduce_job_event;
use trellis_rs::jobs::types::{Job, JobEvent};
use trellis_rs::service::ServerError;

use crate::storage::{
    JobConcurrencyMetadata, JobProjectionMetadataPatch, JobQueuePolicyMetadata, SqliteJobsStore,
    SqliteJobsStoreError,
};

const JOBS_EVENTS_SUBJECT_WILDCARD: &str = "trellis.jobs.>";
const PROJECTOR_CONSUMER_NAME: &str = "jobs-projector";

pub struct JobsProjectorHandle {
    task: Option<tokio::task::JoinHandle<Result<(), ServerError>>>,
}

impl JobsProjectorHandle {
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
                "projector loop task failed: {error}"
            ))),
        }
    }
}

pub async fn start_jobs_projector(
    nats: async_nats::Client,
    store: SqliteJobsStore,
    jobs_stream: String,
) -> Result<JobsProjectorHandle, ServerError> {
    let jetstream = jetstream::new(nats);
    let stream = jetstream.get_stream(&jobs_stream).await.map_err(|error| {
        ServerError::Nats(format!(
            "failed to open jobs projector stream '{jobs_stream}': {error}"
        ))
    })?;
    let consumer = stream
        .get_or_create_consumer(
            PROJECTOR_CONSUMER_NAME,
            consumer::pull::Config {
                durable_name: Some(PROJECTOR_CONSUMER_NAME.to_string()),
                filter_subject: JOBS_EVENTS_SUBJECT_WILDCARD.to_string(),
                ack_policy: consumer::AckPolicy::Explicit,
                ..Default::default()
            },
        )
        .await
        .map_err(|error| {
            ServerError::Nats(format!(
                "failed to create jobs projector consumer '{PROJECTOR_CONSUMER_NAME}' on stream '{jobs_stream}': {error}"
            ))
        })?;
    let mut messages = consumer
        .messages()
        .await
        .map_err(|error| {
            ServerError::Nats(format!(
                "failed to start jobs projector consumer '{PROJECTOR_CONSUMER_NAME}' message stream: {error}"
            ))
        })?;

    let task = tokio::spawn(async move {
        while let Some(message) = messages.next().await {
            let message = message.map_err(|error| {
                ServerError::Nats(format!(
                    "jobs projector failed to pull from consumer '{PROJECTOR_CONSUMER_NAME}' on stream '{jobs_stream}': {error}"
                ))
            })?;
            let raw_event = match serde_json::from_slice::<Value>(&message.payload) {
                Ok(raw_event) => raw_event,
                Err(_) => {
                    let _ = message.ack().await;
                    continue;
                }
            };
            let event = match serde_json::from_value::<JobEvent>(raw_event.clone()) {
                Ok(event) => event,
                Err(_) => {
                    let _ = message.ack().await;
                    continue;
                }
            };

            project_job_event_with_payload(&store, &event, &raw_event).map_err(|error| {
                ServerError::Nats(format!(
                    "jobs projector failed to project job '{}/{}/{}': {error}",
                    event.service, event.job_type, event.job_id
                ))
            })?;
            let _ = message.ack().await;
        }
        Ok(())
    });

    Ok(JobsProjectorHandle { task: Some(task) })
}

pub fn project_job_event(
    store: &SqliteJobsStore,
    event: &JobEvent,
) -> Result<Option<Job>, SqliteJobsStoreError> {
    let raw_event =
        serde_json::to_value(event).map_err(|error| SqliteJobsStoreError::EncodeJson {
            model: "job event",
            details: error.to_string(),
        })?;
    project_job_event_with_payload(store, event, &raw_event)
}

pub fn project_job_event_with_payload(
    store: &SqliteJobsStore,
    event: &JobEvent,
    raw_event: &Value,
) -> Result<Option<Job>, SqliteJobsStoreError> {
    let current = store.get_job(&event.service, &event.job_type, &event.job_id)?;
    let Some(next) = reduce_job_event(current.as_ref(), event) else {
        return Ok(None);
    };
    store.upsert_job(&next)?;
    let metadata = metadata_patch_from_event_payload(raw_event);
    store.apply_job_metadata_patch(
        &event.service,
        &event.job_type,
        &event.job_id,
        &event.timestamp,
        &metadata,
    )?;
    Ok(Some(next))
}

fn metadata_patch_from_event_payload(raw_event: &Value) -> JobProjectionMetadataPatch {
    JobProjectionMetadataPatch {
        concurrency: raw_event
            .get("concurrency")
            .and_then(concurrency_metadata_from_value),
        queue_policy: raw_event
            .get("queuePolicy")
            .and_then(queue_policy_metadata_from_value),
    }
}

fn concurrency_metadata_from_value(value: &Value) -> Option<JobConcurrencyMetadata> {
    let key = value.get("key")?.as_str()?.to_string();
    let key_hash = value.get("keyHash")?.as_str()?.to_string();
    Some(JobConcurrencyMetadata {
        key,
        key_hash,
        instance_id: optional_string(value, "instanceId"),
        heartbeat_at: optional_string(value, "heartbeatAt"),
        lease_expires_at: optional_string(value, "leaseExpiresAt"),
        stale_takeover_count: value.get("staleTakeoverCount").and_then(Value::as_u64),
    })
}

fn queue_policy_metadata_from_value(value: &Value) -> Option<JobQueuePolicyMetadata> {
    let outcome = value.get("outcome")?.as_str()?.to_string();
    Some(JobQueuePolicyMetadata {
        outcome,
        reason: optional_string(value, "reason"),
        existing_job_id: optional_string(value, "existingJobId"),
        replaced_job_id: optional_string(value, "replacedJobId"),
    })
}

fn optional_string(value: &Value, field: &str) -> Option<String> {
    value.get(field)?.as_str().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trellis_rs::jobs::events::{created_event, started_event_with_concurrency};
    use trellis_rs::jobs::types::{JobConcurrency, JobContext, JobState};

    use super::*;

    #[test]
    fn project_job_event_upserts_sql_projection() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let event = created_event(
            "documents",
            "document-process",
            "job-1",
            &context(),
            json!({ "documentId": "doc-1" }),
            3,
            "2026-03-28T12:00:00.000Z",
            None,
        );

        let projected = project_job_event(&store, &event)
            .expect("projection should succeed")
            .expect("event should reduce");

        assert_eq!(projected.state, JobState::Pending);
        let stored = store
            .get_job("documents", "document-process", "job-1")
            .expect("get should succeed")
            .expect("job should be stored");
        assert_eq!(stored.id, "job-1");
        assert_eq!(stored.payload, json!({ "documentId": "doc-1" }));
    }

    #[test]
    fn project_job_event_projects_keyed_concurrency_metadata() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let event = created_event(
            "documents",
            "document-process",
            "job-1",
            &context(),
            json!({ "documentId": "doc-1" }),
            3,
            "2026-03-28T12:00:00.000Z",
            None,
        );
        let mut raw_event = serde_json::to_value(&event).expect("event should encode");
        raw_event["concurrency"] = json!({
            "key": "tenant-1:document:doc-1",
            "keyHash": "hash-1",
            "instanceId": "worker-1",
            "heartbeatAt": "2026-03-28T12:00:30.000Z",
            "leaseExpiresAt": "2026-03-28T12:02:30.000Z",
            "staleTakeoverCount": 2
        });

        project_job_event_with_payload(&store, &event, &raw_event)
            .expect("projection should succeed");

        let metadata = store
            .get_job_metadata("documents", "document-process", "job-1")
            .expect("metadata get should succeed")
            .expect("metadata should exist");
        let concurrency = metadata.concurrency.expect("concurrency should project");
        assert_eq!(concurrency.key, "tenant-1:document:doc-1");
        assert_eq!(concurrency.key_hash, "hash-1");
        assert_eq!(concurrency.instance_id.as_deref(), Some("worker-1"));
        assert_eq!(concurrency.stale_takeover_count, Some(2));
    }

    #[test]
    fn project_started_event_projects_active_key_instance_id() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let created = created_event(
            "documents",
            "document-process",
            "job-1",
            &context(),
            json!({ "documentId": "doc-1" }),
            3,
            "2026-03-28T12:00:00.000Z",
            None,
        );
        project_job_event(&store, &created).expect("created projection should succeed");
        let started = started_event_with_concurrency(
            "documents",
            "document-process",
            "job-1",
            &context(),
            JobState::Pending,
            1,
            "2026-03-28T12:01:00.000Z",
            JobConcurrency {
                key: "tenant-1:document:doc-1".to_string(),
                key_hash: "hash-1".to_string(),
                instance_id: Some("worker-1".to_string()),
                slot_token: Some("slot-1".to_string()),
                heartbeat_at: Some("2026-03-28T12:01:00.000Z".to_string()),
                lease_expires_at: Some("2026-03-28T12:03:00.000Z".to_string()),
                stale_takeover_count: Some(0),
            },
        );

        project_job_event(&store, &started).expect("started projection should succeed");

        let key = store
            .get_projected_key("documents", "document-process", "tenant-1:document:doc-1")
            .expect("key query should succeed")
            .expect("key should exist");
        assert_eq!(key.active.len(), 1);
        assert_eq!(key.active[0].job_id, "job-1");
        assert_eq!(key.active[0].instance_id.as_deref(), Some("worker-1"));
    }

    #[test]
    fn project_job_event_projects_queue_policy_reason_metadata() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let event = created_event(
            "documents",
            "document-process",
            "job-2",
            &context(),
            json!({ "documentId": "doc-2" }),
            3,
            "2026-03-28T12:00:00.000Z",
            None,
        );
        let mut raw_event = serde_json::to_value(&event).expect("event should encode");
        raw_event["queuePolicy"] = json!({
            "outcome": "coalesced",
            "reason": "queue-full",
            "existingJobId": "job-1"
        });

        project_job_event_with_payload(&store, &event, &raw_event)
            .expect("projection should succeed");

        let metadata = store
            .get_job_metadata("documents", "document-process", "job-2")
            .expect("metadata get should succeed")
            .expect("metadata should exist");
        let queue_policy = metadata.queue_policy.expect("queue policy should project");
        assert_eq!(queue_policy.outcome, "coalesced");
        assert_eq!(queue_policy.reason.as_deref(), Some("queue-full"));
        assert_eq!(queue_policy.existing_job_id.as_deref(), Some("job-1"));
    }

    fn context() -> JobContext {
        JobContext {
            request_id: "request-job-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        }
    }
}
