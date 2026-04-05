use std::time::Duration;

use async_nats::jetstream::{self, consumer, kv};
use futures_util::StreamExt;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis_jobs::{worker_presence_key, WorkerHeartbeat, WORKER_HEARTBEATS_WILDCARD};
use trellis_server::ServerError;

pub const WORKER_PRESENCE_CONSUMER_NAME: &str = "jobs-worker-presence-projector";
pub const WORKER_PRESENCE_FRESH_FOR: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerPresenceRecord {
    pub service: String,
    pub job_type: String,
    pub instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub heartbeat_at: String,
}

pub struct WorkerPresenceProjectorHandle {
    task: tokio::task::JoinHandle<Result<(), ServerError>>,
}

impl WorkerPresenceProjectorHandle {
    pub async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
    }

    pub async fn wait(&mut self) -> Result<(), ServerError> {
        match (&mut self.task).await {
            Ok(result) => result,
            Err(error) if error.is_cancelled() => Ok(()),
            Err(error) => Err(ServerError::Nats(format!(
                "worker presence projector loop task failed: {error}"
            ))),
        }
    }
}

pub fn worker_presence_bucket_name(jobs_stream: &str) -> String {
    format!("{jobs_stream}_WORKER_PRESENCE")
}

pub fn worker_presence_from_heartbeat(heartbeat: &WorkerHeartbeat) -> WorkerPresenceRecord {
    WorkerPresenceRecord {
        service: heartbeat.service.clone(),
        job_type: heartbeat.job_type.clone(),
        instance_id: heartbeat.instance_id.clone(),
        concurrency: heartbeat.concurrency,
        version: heartbeat.version.clone(),
        heartbeat_at: heartbeat.timestamp.clone(),
    }
}

pub fn reduce_worker_presence(
    current: Option<&WorkerPresenceRecord>,
    next: &WorkerPresenceRecord,
) -> Option<WorkerPresenceRecord> {
    match current {
        Some(current)
            if parse_timestamp(&current.heartbeat_at) > parse_timestamp(&next.heartbeat_at) =>
        {
            None
        }
        _ => Some(next.clone()),
    }
}

pub fn worker_presence_is_fresh(record: &WorkerPresenceRecord, now: OffsetDateTime) -> bool {
    parse_timestamp(&record.heartbeat_at) >= now - WORKER_PRESENCE_FRESH_FOR
}

pub async fn ensure_worker_presence_bucket(
    jetstream: &jetstream::Context,
    bucket: &str,
    replicas: usize,
) -> Result<jetstream::kv::Store, ServerError> {
    if let Ok(store) = jetstream.get_key_value(bucket).await {
        return Ok(store);
    }

    match jetstream
        .create_key_value(kv::Config {
            bucket: bucket.to_string(),
            history: 1,
            num_replicas: replicas,
            ..Default::default()
        })
        .await
    {
        Ok(store) => Ok(store),
        Err(error) if replicas > 1 => jetstream
            .create_key_value(kv::Config {
                bucket: bucket.to_string(),
                history: 1,
                num_replicas: 1,
                ..Default::default()
            })
            .await
            .map_err(|fallback| {
                ServerError::Nats(format!(
                    "failed to create worker presence bucket with {replicas} replicas ({error}); fallback with 1 replica also failed: {fallback}"
                ))
            }),
        Err(error) => Err(ServerError::Nats(error.to_string())),
    }
}

pub async fn start_worker_presence_projector(
    nats: async_nats::Client,
    jobs_stream: String,
    worker_presence_bucket: String,
    worker_presence_replicas: usize,
) -> Result<WorkerPresenceProjectorHandle, ServerError> {
    let jetstream = jetstream::new(nats);
    let kv = ensure_worker_presence_bucket(
        &jetstream,
        &worker_presence_bucket,
        worker_presence_replicas,
    )
    .await?;
    let stream = jetstream
        .get_stream(&jobs_stream)
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;
    let consumer = stream
        .get_or_create_consumer(
            WORKER_PRESENCE_CONSUMER_NAME,
            consumer::pull::Config {
                durable_name: Some(WORKER_PRESENCE_CONSUMER_NAME.to_string()),
                filter_subject: WORKER_HEARTBEATS_WILDCARD.to_string(),
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
            let Some((service, job_type, instance_id)) =
                parse_worker_heartbeat_subject(&message.subject)
            else {
                let _ = message.ack().await;
                continue;
            };
            let heartbeat = match serde_json::from_slice::<WorkerHeartbeat>(&message.payload) {
                Ok(heartbeat)
                    if heartbeat.service == service
                        && heartbeat.job_type == job_type
                        && heartbeat.instance_id == instance_id =>
                {
                    heartbeat
                }
                _ => {
                    let _ = message.ack().await;
                    continue;
                }
            };

            let key = worker_presence_key(&service, &job_type, &instance_id);
            let current = match kv.get(&key).await {
                Ok(Some(bytes)) => serde_json::from_slice::<WorkerPresenceRecord>(&bytes).ok(),
                Ok(None) => None,
                Err(error) => return Err(ServerError::Nats(error.to_string())),
            };
            let next = worker_presence_from_heartbeat(&heartbeat);
            let Some(next) = reduce_worker_presence(current.as_ref(), &next) else {
                let _ = message.ack().await;
                continue;
            };
            let payload =
                serde_json::to_vec(&next).map_err(|error| ServerError::Nats(error.to_string()))?;
            kv.put(&key, payload.into())
                .await
                .map_err(|error| ServerError::Nats(error.to_string()))?;
            let _ = message.ack().await;
        }
        Ok(())
    });

    Ok(WorkerPresenceProjectorHandle { task })
}

fn parse_timestamp(value: &str) -> OffsetDateTime {
    OffsetDateTime::parse(value, &Rfc3339).unwrap_or(OffsetDateTime::UNIX_EPOCH)
}

fn parse_worker_heartbeat_subject(subject: &str) -> Option<(String, String, String)> {
    let mut parts = subject.split('.');
    match (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) {
        (
            Some("trellis"),
            Some("jobs"),
            Some("workers"),
            Some(service),
            Some(job_type),
            Some(instance_id),
            Some("heartbeat"),
        ) if parts.next().is_none() => Some((
            service.to_string(),
            job_type.to_string(),
            instance_id.to_string(),
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::parse_worker_heartbeat_subject;
    use trellis_jobs::worker_heartbeat_subject;

    #[test]
    fn parse_worker_heartbeat_subject_extracts_components() {
        let parsed = parse_worker_heartbeat_subject(&worker_heartbeat_subject(
            "documents",
            "document-process",
            "instance-1",
        ))
        .expect("subject should parse");

        assert_eq!(parsed.0, "documents");
        assert_eq!(parsed.1, "document-process");
        assert_eq!(parsed.2, "instance-1");
    }
}
