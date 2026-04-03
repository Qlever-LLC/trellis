use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use trellis_jobs::bindings::{JobsBinding, JobsQueueBinding};
use trellis_jobs::manager::{
    JobManager, JobManagerError, JobMetaSource, JobProcessError, JobProcessOutcome,
};
use trellis_jobs::publisher::JobEventPublisher;
use trellis_jobs::types::{Job, JobEvent, JobEventType, JobState};

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

struct FailingPublisher;

impl JobEventPublisher for FailingPublisher {
    type Error = &'static str;

    fn publish(
        &self,
        _subject: String,
        _payload: Vec<u8>,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send {
        async { Err("publish failed") }
    }
}

struct SequenceMetaSource {
    id: String,
    times: Arc<Mutex<Vec<String>>>,
}

impl SequenceMetaSource {
    fn new(id: &str, times: Vec<&str>) -> Self {
        Self {
            id: id.to_string(),
            times: Arc::new(Mutex::new(times.into_iter().map(str::to_string).collect())),
        }
    }
}

impl JobMetaSource for SequenceMetaSource {
    fn next_job_id(&self) -> String {
        self.id.clone()
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
                max_deliver: 5,
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

fn sample_job(tries: u64, max_tries: u64) -> Job {
    Job {
        id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state: JobState::Pending,
        payload: json!({ "documentId": "doc-1" }),
        result: None,
        created_at: "2026-03-28T11:59:00.000Z".to_string(),
        updated_at: "2026-03-28T11:59:00.000Z".to_string(),
        started_at: None,
        completed_at: None,
        tries,
        max_tries,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    }
}

#[tokio::test]
async fn process_errors_when_queue_binding_missing() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        JobsBinding {
            namespace: "documents".to_string(),
            jobs_state_bucket: None,
            queues: BTreeMap::new(),
        },
        SequenceMetaSource::new("job-1", vec!["2026-03-28T12:00:00.000Z"]),
    );

    let error = manager
        .process(
            sample_job(0, 2),
            trellis_jobs::runtime_worker::JobCancellationToken::new(),
            |_job| async { Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true })) },
        )
        .await
        .expect_err("missing queue binding should fail");

    assert!(matches!(
        error,
        JobManagerError::MissingQueueBinding { queue_type } if queue_type == "document-process"
    ));
}

#[tokio::test]
async fn process_success_publishes_started_then_completed_and_returns_completed() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new(
            "job-1",
            vec!["2026-03-28T12:00:00.000Z", "2026-03-28T12:00:05.000Z"],
        ),
    );

    let outcome = manager
        .process(
            sample_job(0, 2),
            trellis_jobs::runtime_worker::JobCancellationToken::new(),
            |_job| async { Ok::<_, JobProcessError<&'static str>>(json!({ "pages": 3 })) },
        )
        .await
        .expect("process should succeed");

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

    let started: JobEvent = serde_json::from_slice(&calls[0].1).expect("decode started event");
    assert_eq!(started.event_type, JobEventType::Started);
    assert_eq!(started.tries, 1);
    let completed: JobEvent = serde_json::from_slice(&calls[1].1).expect("decode completed event");
    assert_eq!(completed.event_type, JobEventType::Completed);
    assert_eq!(completed.tries, 1);
    assert_eq!(completed.result, Some(json!({ "pages": 3 })));
}

#[tokio::test]
async fn process_failure_below_max_publishes_started_then_retry_and_returns_retry() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new(
            "job-1",
            vec!["2026-03-28T12:00:00.000Z", "2026-03-28T12:00:05.000Z"],
        ),
    );

    let outcome = manager
        .process(
            sample_job(0, 2),
            trellis_jobs::runtime_worker::JobCancellationToken::new(),
            |_job| async {
                Err::<serde_json::Value, _>(JobProcessError::retryable("transient failure"))
            },
        )
        .await
        .expect("process should return retry outcome");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Retry {
            tries: 1,
            error,
        } if error == "transient failure"
    ));

    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[1].0,
        "trellis.jobs.documents.document-process.job-1.retry"
    );
    let retry: JobEvent = serde_json::from_slice(&calls[1].1).expect("decode retry event");
    assert_eq!(retry.event_type, JobEventType::Retry);
    assert_eq!(retry.tries, 1);
    assert_eq!(retry.error.as_deref(), Some("transient failure"));
}

#[tokio::test]
async fn process_failure_publishes_started_then_failed_and_returns_failed() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new(
            "job-1",
            vec!["2026-03-28T12:00:00.000Z", "2026-03-28T12:00:05.000Z"],
        ),
    );

    let outcome = manager
        .process(
            sample_job(1, 2),
            trellis_jobs::runtime_worker::JobCancellationToken::new(),
            |_job| async { Err::<serde_json::Value, _>(JobProcessError::failed("final failure")) },
        )
        .await
        .expect("process should return dead outcome");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Failed {
            tries: 2,
            error,
        } if error == "final failure"
    ));

    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[1].0,
        "trellis.jobs.documents.document-process.job-1.failed"
    );
    let failed: JobEvent = serde_json::from_slice(&calls[1].1).expect("decode failed event");
    assert_eq!(failed.event_type, JobEventType::Failed);
    assert_eq!(failed.tries, 2);
    assert_eq!(failed.error.as_deref(), Some("final failure"));
}

#[tokio::test]
async fn process_propagates_publish_error() {
    let manager = JobManager::new(
        FailingPublisher,
        sample_bindings(),
        SequenceMetaSource::new("job-1", vec!["2026-03-28T12:00:00.000Z"]),
    );

    let error = manager
        .process(
            sample_job(0, 2),
            trellis_jobs::runtime_worker::JobCancellationToken::new(),
            |_job| async { Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true })) },
        )
        .await
        .expect_err("publish error should propagate");

    assert!(matches!(error, JobManagerError::Publish("publish failed")));
}

#[tokio::test]
async fn process_returns_cancelled_when_token_is_cancelled_before_completion() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new("job-1", vec!["2026-03-28T12:00:00.000Z"]),
    );
    let cancellation = trellis_jobs::runtime_worker::JobCancellationToken::new();
    cancellation.cancel();

    let outcome = manager
        .process(sample_job(0, 2), cancellation, |_job| async {
            Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true }))
        })
        .await
        .expect("process should succeed");

    assert!(matches!(outcome, JobProcessOutcome::Cancelled { tries: 1 }));
    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].0.ends_with(".started"));
}

#[tokio::test]
async fn process_returns_interrupted_when_token_is_cancelled_for_host_shutdown() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new("job-1", vec!["2026-03-28T12:00:00.000Z"]),
    );
    let cancellation = trellis_jobs::runtime_worker::JobCancellationToken::new();
    cancellation.cancel_for_shutdown();

    let outcome = manager
        .process(sample_job(0, 2), cancellation, |_job| async {
            Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true }))
        })
        .await
        .expect("process should succeed");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Interrupted { tries: 1 }
    ));
    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].0.ends_with(".started"));
}

#[tokio::test]
async fn process_returns_interrupted_when_shutdown_happens_before_job_cancel() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new("job-1", vec!["2026-03-28T12:00:00.000Z"]),
    );
    let cancellation = trellis_jobs::runtime_worker::JobCancellationToken::new();
    cancellation.cancel_for_shutdown();
    cancellation.cancel();

    let outcome = manager
        .process(sample_job(0, 2), cancellation, |_job| async {
            Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true }))
        })
        .await
        .expect("process should succeed");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Interrupted { tries: 1 }
    ));
}

#[tokio::test]
async fn process_returns_interrupted_when_shutdown_happens_after_job_cancel() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(
        publisher,
        sample_bindings(),
        SequenceMetaSource::new("job-1", vec!["2026-03-28T12:00:00.000Z"]),
    );
    let cancellation = trellis_jobs::runtime_worker::JobCancellationToken::new();
    cancellation.cancel();
    cancellation.cancel_for_shutdown();

    let outcome = manager
        .process(sample_job(0, 2), cancellation, |_job| async {
            Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true }))
        })
        .await
        .expect("process should succeed");

    assert!(matches!(
        outcome,
        JobProcessOutcome::Interrupted { tries: 1 }
    ));
}
