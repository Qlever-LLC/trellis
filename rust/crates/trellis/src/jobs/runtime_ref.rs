use std::time::Duration;

use async_nats::jetstream::{self, stream};
use futures_util::StreamExt;

use crate::jobs::bindings::JobsQueueBinding;
use crate::jobs::projection::{is_terminal, reduce_job_event};
use crate::jobs::types::{Job, JobEvent, JobEventType};
use crate::jobs::JobsError;

const JOBS_STREAM: &str = "JOBS";

/// NATS-backed implementation of Trellis service-local job waiting.
#[derive(Clone)]
pub struct NatsJobWaiter {
    nats: async_nats::Client,
    queue: JobsQueueBinding,
    timeout: Duration,
}

impl NatsJobWaiter {
    /// Create a waiter for one bound service-local jobs queue.
    pub fn new(nats: async_nats::Client, queue: JobsQueueBinding, timeout: Duration) -> Self {
        Self {
            nats,
            queue,
            timeout,
        }
    }

    /// Wait until the given job reaches a terminal lifecycle state.
    pub async fn wait_for_terminal(&self, seed: Job) -> Result<Job, JobsError> {
        let subject = format!("{}.{}.*", self.queue.publish_prefix, seed.id);
        let mut subscriber = self
            .nats
            .subscribe(subject.clone())
            .await
            .map_err(|error| jobs_message(format!("job lifecycle subscribe failed: {error}")))?;

        let jetstream = jetstream::new(self.nats.clone());
        let lifecycle_stream = jetstream
            .get_stream_no_info(JOBS_STREAM)
            .await
            .map_err(|error| jobs_message(format!("open jobs lifecycle stream failed: {error}")))?;

        let mut current = latest_job_from_lifecycle(&lifecycle_stream, &subject, seed).await?;
        if is_terminal(current.state) {
            return Ok(current);
        }

        let timeout_job_id = current.id.clone();
        let wait = async {
            while let Some(message) = subscriber.next().await {
                let event: JobEvent =
                    serde_json::from_slice(&message.payload).map_err(|error| {
                        jobs_message(format!("decode job lifecycle event: {error}"))
                    })?;
                if event.job_id != current.id || event.job_type != self.queue.queue_type {
                    continue;
                }
                current = apply_lifecycle_event(&current, &event);
                if is_terminal(current.state) {
                    return Ok(current);
                }
            }
            Err(jobs_message(format!(
                "job lifecycle subscription ended before terminal event for job '{}'",
                current.id
            )))
        };

        tokio::time::timeout(self.timeout, wait)
            .await
            .map_err(|_| jobs_message(format!("job '{timeout_job_id}' timed out")))?
    }
}

async fn latest_job_from_lifecycle(
    lifecycle_stream: &stream::Stream<()>,
    subject: &str,
    seed: Job,
) -> Result<Job, JobsError> {
    let latest = match latest_lifecycle_message(lifecycle_stream, subject).await {
        Ok(Some(message)) => message,
        Ok(None) => return Ok(seed),
        Err(error) => {
            return Err(jobs_message(format!(
                "read latest job lifecycle event failed: {error}"
            )));
        }
    };
    let event: JobEvent = serde_json::from_slice(&latest.payload)
        .map_err(|error| jobs_message(format!("decode latest job lifecycle event: {error}")))?;
    Ok(apply_lifecycle_event(&seed, &event))
}

async fn latest_lifecycle_message(
    lifecycle_stream: &stream::Stream<()>,
    subject: &str,
) -> Result<Option<async_nats::jetstream::message::StreamMessage>, JobsError> {
    match lifecycle_stream.direct_get_last_for_subject(subject).await {
        Ok(message) => return Ok(Some(message)),
        Err(error) if matches!(error.kind(), stream::DirectGetErrorKind::NotFound) => {}
        Err(direct_error) => match lifecycle_stream
            .get_last_raw_message_by_subject(subject)
            .await
        {
            Ok(message) => return Ok(Some(message)),
            Err(error)
                if matches!(
                    error.kind(),
                    stream::LastRawMessageErrorKind::NoMessageFound
                ) => {}
            Err(error) => {
                return Err(jobs_message(format!(
                    "direct get failed: {direct_error}; raw get failed: {error}"
                )));
            }
        },
    }

    match lifecycle_stream
        .get_last_raw_message_by_subject(subject)
        .await
    {
        Ok(message) => Ok(Some(message)),
        Err(error)
            if matches!(
                error.kind(),
                stream::LastRawMessageErrorKind::NoMessageFound
            ) =>
        {
            Ok(None)
        }
        Err(error) => Err(jobs_message(format!("raw get failed: {error}"))),
    }
}

fn apply_lifecycle_event(current: &Job, event: &JobEvent) -> Job {
    if event.service != current.service
        || event.job_type != current.job_type
        || event.job_id != current.id
    {
        return current.clone();
    }
    let next = reduce_job_event(Some(current), event).unwrap_or_else(|| current.clone());
    if next.state == current.state && is_terminal(event.state) {
        return terminal_job_from_event(current, event);
    }
    next
}

fn terminal_job_from_event(current: &Job, event: &JobEvent) -> Job {
    let mut next = current.clone();
    next.state = event.state;
    next.updated_at = event.timestamp.clone();
    next.completed_at = Some(event.timestamp.clone());
    next.tries = event.tries;
    next.max_tries = event.max_tries.unwrap_or(current.max_tries);
    match event.event_type {
        JobEventType::Completed => {
            next.result = event.result.clone();
        }
        JobEventType::Failed
        | JobEventType::Cancelled
        | JobEventType::Expired
        | JobEventType::Skipped
        | JobEventType::Stale
        | JobEventType::Dead
        | JobEventType::Dismissed => {
            next.last_error = event.error.clone();
        }
        _ => {}
    }
    next
}

fn jobs_message(message: String) -> JobsError {
    JobsError::Message { message }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{apply_lifecycle_event, terminal_job_from_event};
    use crate::jobs::events::{completed_event, started_event};
    use crate::jobs::types::{Job, JobContext, JobState};

    fn sample_context() -> JobContext {
        JobContext {
            request_id: "request-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        }
    }

    fn sample_job() -> Job {
        Job {
            id: "job-1".to_string(),
            context: sample_context(),
            service: "svc".to_string(),
            job_type: "refresh".to_string(),
            state: JobState::Pending,
            payload: json!({ "siteId": "site-1" }),
            result: None,
            created_at: "2026-05-03T00:00:00.000Z".to_string(),
            updated_at: "2026-05-03T00:00:00.000Z".to_string(),
            started_at: None,
            completed_at: None,
            tries: 0,
            max_tries: 5,
            last_error: None,
            deadline: None,
            progress: None,
            logs: None,
            concurrency: None,
            queue_policy: None,
        }
    }

    #[test]
    fn apply_lifecycle_event_applies_legal_transition() {
        let job = sample_job();
        let event = started_event(
            &job.service,
            &job.job_type,
            &job.id,
            &job.context,
            JobState::Pending,
            1,
            "2026-05-03T00:00:01.000Z",
        );

        let next = apply_lifecycle_event(&job, &event);

        assert_eq!(next.state, JobState::Active);
        assert_eq!(next.started_at.as_deref(), Some("2026-05-03T00:00:01.000Z"));
    }

    #[test]
    fn terminal_job_from_event_handles_latest_terminal_event_without_prior_events() {
        let job = sample_job();
        let event = completed_event(
            &job.service,
            &job.job_type,
            &job.id,
            &job.context,
            1,
            "2026-05-03T00:00:02.000Z",
            json!({ "ok": true }),
        );

        let next = terminal_job_from_event(&job, &event);

        assert_eq!(next.state, JobState::Completed);
        assert_eq!(next.result, Some(json!({ "ok": true })));
        assert_eq!(
            next.completed_at.as_deref(),
            Some("2026-05-03T00:00:02.000Z")
        );
    }
}
