use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use serde_json::json;
use trellis_jobs::bindings::{JobsBinding, JobsQueueBinding};
use trellis_jobs::events::{created_event, retried_event};
use trellis_jobs::manager::{JobManager, JobMetaSource, JobProcessError, JobProcessOutcome};
use trellis_jobs::publisher::JobEventPublisher;
use trellis_jobs::runtime_worker::{
    process_work_payload, process_work_payload_with_context,
    process_work_payload_with_context_and_heartbeat, JobCancellationToken, NatsJobEventPublisher,
};

#[derive(Default)]
struct RecordingPublisher {
    calls: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
}

impl RecordingPublisher {
    fn calls(&self) -> Vec<(String, Vec<u8>)> {
        self.calls.lock().expect("lock calls").clone()
    }
}

impl JobEventPublisher for RecordingPublisher {
    type Error = &'static str;

    fn publish(
        &self,
        subject: String,
        payload: Vec<u8>,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send {
        self.calls
            .lock()
            .expect("lock calls")
            .push((subject, payload));
        async { Ok(()) }
    }
}

struct SequenceMetaSource {
    times: Arc<Mutex<Vec<String>>>,
}

impl SequenceMetaSource {
    fn new(times: Vec<&str>) -> Self {
        Self {
            times: Arc::new(Mutex::new(times.into_iter().map(str::to_string).collect())),
        }
    }
}

impl JobMetaSource for SequenceMetaSource {
    fn next_job_id(&self) -> String {
        "job-1".to_string()
    }

    fn now_iso(&self) -> String {
        self.times.lock().expect("lock times").remove(0)
    }
}

fn sample_bindings() -> JobsBinding {
    JobsBinding {
        namespace: "documents".to_string(),
        jobs_state_bucket: None,
        queues: BTreeMap::from([(
            "document-process".to_string(),
            JobsQueueBinding {
                queue_type: "document-process".to_string(),
                publish_prefix: "trellis.jobs.documents.document-process".to_string(),
                work_subject: "trellis.work.documents.document-process".to_string(),
                consumer_name: "documents-document-process".to_string(),
                max_deliver: 2,
                backoff_ms: vec![5_000],
                ack_wait_ms: 60_000,
                default_deadline_ms: None,
                progress: true,
                logs: true,
                concurrency: 1,
            },
        )]),
    }
}

fn sample_work_payload() -> Vec<u8> {
    serde_json::to_vec(&created_event(
        "documents",
        "document-process",
        "job-1",
        json!({ "documentId": "doc-1" }),
        2,
        "2026-03-28T11:59:00.000Z",
        None,
    ))
    .expect("serialize work event")
}

fn sample_retried_work_payload() -> Vec<u8> {
    serde_json::to_vec(&retried_event(
        "documents",
        "document-process",
        "job-1",
        trellis_jobs::JobState::Failed,
        "2026-03-28T11:59:00.000Z",
        Some(json!({ "documentId": "doc-1" })),
        Some(2),
        None,
    ))
    .expect("serialize retried work event")
}

#[tokio::test]
async fn process_work_payload_runs_job_manager_process_and_emits_started_completed() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new(vec!["2026-03-28T12:00:00.000Z", "2026-03-28T12:00:05.000Z"]),
    );
    let payload = sample_work_payload();

    let outcome = process_work_payload(&manager, &payload, |_job| async {
        Ok::<_, JobProcessError<&'static str>>(json!({ "pages": 3 }))
    })
    .await
    .expect("process should succeed")
    .expect("payload should parse as job");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Completed { tries: 1, .. }
    ));
    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[0].0,
        "trellis.jobs.documents.document-process.job-1.started"
    );
    assert_eq!(
        calls[1].0,
        "trellis.jobs.documents.document-process.job-1.completed"
    );
}

#[tokio::test]
async fn process_work_payload_emits_retry_when_handler_fails_before_max_tries() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new(vec!["2026-03-28T12:00:00.000Z", "2026-03-28T12:00:05.000Z"]),
    );
    let payload = sample_work_payload();

    let outcome = process_work_payload(&manager, &payload, |_job| async {
        Err::<serde_json::Value, _>(JobProcessError::retryable("boom"))
    })
    .await
    .expect("process should succeed")
    .expect("payload should parse as job");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Retry {
            tries: 1,
            error,
        } if error == "boom"
    ));
    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[1].0,
        "trellis.jobs.documents.document-process.job-1.retry"
    );
}

#[tokio::test]
async fn process_work_payload_accepts_retried_work_events() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new(vec!["2026-03-28T12:00:00.000Z", "2026-03-28T12:00:05.000Z"]),
    );
    let payload = sample_retried_work_payload();

    let outcome = process_work_payload(&manager, &payload, |_job| async {
        Ok::<_, JobProcessError<&'static str>>(json!({ "pages": 3 }))
    })
    .await
    .expect("process should succeed")
    .expect("retried payload should parse as job");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Completed { tries: 1, .. }
    ));
    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[0].0,
        "trellis.jobs.documents.document-process.job-1.started"
    );
}

#[tokio::test]
async fn process_work_payload_returns_none_for_invalid_json_payload() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        sample_bindings(),
        SequenceMetaSource::new(vec!["2026-03-28T12:00:00.000Z"]),
    );

    let outcome = process_work_payload(&manager, br#"{"not":"a-job"}"#, |_job| async {
        Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true }))
    })
    .await
    .expect("invalid payload should be ignored, not error");

    assert_eq!(outcome, None);
    assert!(manager.publisher().calls().is_empty());
}

#[test]
fn nats_publisher_type_implements_job_event_publisher_trait() {
    fn assert_publisher_trait<T: JobEventPublisher<Error = String>>() {}
    assert_publisher_trait::<NatsJobEventPublisher>();
}

#[tokio::test]
async fn process_work_payload_with_context_passes_active_job_to_handler() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        sample_bindings(),
        SequenceMetaSource::new(vec![
            "2026-03-28T12:00:00.000Z",
            "2026-03-28T12:00:03.000Z",
            "2026-03-28T12:00:05.000Z",
        ]),
    );
    let payload = sample_work_payload();
    let cancellation = JobCancellationToken::new();
    cancellation.cancel();

    let outcome =
        process_work_payload_with_context(&manager, &payload, cancellation, |job| async move {
            if job.is_cancelled() {
                job.update_progress(1, 2, Some("cancelled".to_string()))
                    .await
                    .expect("progress should publish before cancellation");
                Ok::<_, JobProcessError<&'static str>>(json!({ "ignored": true }))
            } else {
                Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true }))
            }
        })
        .await
        .expect("process should succeed")
        .expect("payload should parse as job");

    assert!(matches!(outcome, JobProcessOutcome::Cancelled { .. }));
    assert_eq!(manager.publisher().calls().len(), 2);
}

#[tokio::test]
async fn process_work_payload_with_context_heartbeat_does_not_publish_job_event() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        sample_bindings(),
        SequenceMetaSource::new(vec!["2026-03-28T12:00:00.000Z", "2026-03-28T12:00:05.000Z"]),
    );
    let payload = sample_work_payload();
    let heartbeats = Arc::new(Mutex::new(0usize));

    let outcome = process_work_payload_with_context_and_heartbeat(
        &manager,
        &payload,
        JobCancellationToken::new(),
        {
            let heartbeats = Arc::clone(&heartbeats);
            move || -> BoxFuture<'static, Result<(), String>> {
                let heartbeats = Arc::clone(&heartbeats);
                Box::pin(async move {
                    *heartbeats.lock().expect("lock heartbeats") += 1;
                    Ok(())
                })
            }
        },
        |job| async move {
            job.heartbeat().await.expect("heartbeat should succeed");
            Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true }))
        },
    )
    .await
    .expect("process should succeed")
    .expect("payload should parse as job");

    assert!(matches!(outcome, JobProcessOutcome::Completed { .. }));
    assert_eq!(*heartbeats.lock().expect("lock heartbeats"), 1);
    assert_eq!(manager.publisher().calls().len(), 2);
}
