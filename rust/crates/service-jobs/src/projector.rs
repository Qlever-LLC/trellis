use async_nats::jetstream::{self, consumer};
use futures_util::StreamExt;
use trellis_jobs::reduce_job_event;
use trellis_jobs::types::{Job, JobEvent};
use trellis_service::ServerError;

use crate::storage::{SqliteJobsStore, SqliteJobsStoreError};

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
            let event = match serde_json::from_slice::<JobEvent>(&message.payload) {
                Ok(event) => event,
                Err(_) => {
                    let _ = message.ack().await;
                    continue;
                }
            };

            project_job_event(&store, &event).map_err(|error| {
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
    let current = store.get_job(&event.service, &event.job_type, &event.job_id)?;
    let Some(next) = reduce_job_event(current.as_ref(), event) else {
        return Ok(None);
    };
    store.upsert_job(&next)?;
    Ok(Some(next))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trellis_jobs::events::created_event;
    use trellis_jobs::types::{JobContext, JobState};

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

    fn context() -> JobContext {
        JobContext {
            request_id: "request-job-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        }
    }
}
