use async_nats::jetstream::{self, consumer};
use futures_util::StreamExt;
use trellis_jobs::types::{Job, JobEvent};
use trellis_jobs::{job_key, reduce_job_event};
use trellis_server::ServerError;

const JOBS_EVENTS_SUBJECT_WILDCARD: &str = "trellis.jobs.>";
const PROJECTOR_CONSUMER_NAME: &str = "jobs-projector";

pub struct JobsProjectorHandle {
    task: tokio::task::JoinHandle<Result<(), ServerError>>,
}

impl JobsProjectorHandle {
    pub async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
    }

    pub async fn wait(&mut self) -> Result<(), ServerError> {
        match (&mut self.task).await {
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
    jobs_state_bucket: String,
    jobs_stream: String,
) -> Result<JobsProjectorHandle, ServerError> {
    let jetstream = jetstream::new(nats);
    let kv = jetstream
        .get_key_value(&jobs_state_bucket)
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;
    let stream = jetstream
        .get_stream(&jobs_stream)
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;
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
        .map_err(|error| ServerError::Nats(error.to_string()))?;
    let mut messages = consumer
        .messages()
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;

    let task = tokio::spawn(async move {
        while let Some(message) = messages.next().await {
            let message = message.map_err(|error| ServerError::Nats(error.to_string()))?;
            let event = match serde_json::from_slice::<JobEvent>(&message.payload) {
                Ok(event) => event,
                Err(_) => {
                    let _ = message.ack().await;
                    continue;
                }
            };

            let key = job_key(&event.service, &event.job_type, &event.job_id);
            let current = match kv.get(&key).await {
                Ok(Some(bytes)) => serde_json::from_slice::<Job>(&bytes).ok(),
                Ok(None) => None,
                Err(error) => return Err(ServerError::Nats(error.to_string())),
            };

            let Some(next) = reduce_job_event(current.as_ref(), &event) else {
                let _ = message.ack().await;
                continue;
            };

            let payload = match serde_json::to_vec(&next) {
                Ok(payload) => payload,
                Err(_) => {
                    let _ = message.ack().await;
                    continue;
                }
            };

            kv.put(&key, payload.into())
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let _ = message.ack().await;
        }
        Ok(())
    });

    Ok(JobsProjectorHandle { task })
}
