use async_nats::jetstream::{self, consumer};
use futures_util::StreamExt;
use serde::Deserialize;
use trellis_jobs::types::{Job, JobEvent};
use trellis_jobs::{dead_event, is_terminal, job_event_subject, job_from_work_event};
use trellis_server::ServerError;

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
    task: tokio::task::JoinHandle<Result<(), ServerError>>,
}

impl AdvisoryHandle {
    pub async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
    }

    pub async fn wait(&mut self) -> Result<(), ServerError> {
        match (&mut self.task).await {
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
    jobs_state_bucket: String,
    jobs_advisories_stream: String,
) -> Result<AdvisoryHandle, ServerError> {
    let jetstream = jetstream::new(nats.clone());
    let jobs_kv = jetstream
        .get_key_value(&jobs_state_bucket)
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;
    let stream = jetstream
        .get_stream(&jobs_advisories_stream)
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;
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
        .map_err(|error| ServerError::Nats(error.to_string()))?;
    let mut messages = consumer
        .messages()
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;

    let task = tokio::spawn(async move {
        while let Some(message) = messages.next().await {
            let message = message.map_err(|error| ServerError::Nats(error.to_string()))?;
            let Ok(advisory) = serde_json::from_slice::<MaxDeliveriesAdvisory>(&message.payload)
            else {
                let _ = message.ack().await;
                continue;
            };

            let stream = jetstream
                .get_stream(&advisory.stream)
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let raw_message = stream
                .get_raw_message(advisory.stream_seq)
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let Ok(work_event) = serde_json::from_slice::<JobEvent>(&raw_message.payload) else {
                let _ = message.ack().await;
                continue;
            };
            let Some(work_job) = job_from_work_event(&work_event) else {
                let _ = message.ack().await;
                continue;
            };

            let key = trellis_jobs::job_key(&work_job.service, &work_job.job_type, &work_job.id);
            let current = match jobs_kv.get(&key).await {
                Ok(Some(bytes)) => serde_json::from_slice::<Job>(&bytes).ok(),
                Ok(None) => None,
                Err(error) => return Err(ServerError::Nats(error.to_string())),
            };

            let Some(mapped) =
                map_dead_event_from_advisory_job(current.as_ref(), &work_job, &advisory)
            else {
                let _ = message.ack().await;
                continue;
            };

            let Ok(payload) = serde_json::to_vec(&mapped.event) else {
                let _ = message.ack().await;
                continue;
            };
            nats.publish(mapped.subject, payload.into())
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let _ = message.ack().await;
        }
        Ok(())
    });

    Ok(AdvisoryHandle { task })
}
