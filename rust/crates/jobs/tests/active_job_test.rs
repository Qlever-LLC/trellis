use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use trellis_jobs::active_job::ActiveJobRuntimeError;
use trellis_jobs::bindings::{JobsBinding, JobsQueueBinding};
use trellis_jobs::manager::{JobManager, JobManagerError, JobMetaSource};
use trellis_jobs::publisher::JobEventPublisher;
use trellis_jobs::runtime_worker::JobCancellationToken;
use trellis_jobs::{Job, JobEvent, JobEventType, JobLogLevel, JobState};

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

struct FixedMetaSource;

impl JobMetaSource for FixedMetaSource {
    fn next_job_id(&self) -> String {
        "job-1".to_string()
    }

    fn now_iso(&self) -> String {
        "2026-03-28T12:00:00Z".to_string()
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

fn sample_job(state: JobState) -> Job {
    Job {
        id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state,
        payload: serde_json::json!({ "documentId": "doc-1" }),
        result: None,
        created_at: "2026-03-28T11:59:00Z".to_string(),
        updated_at: "2026-03-28T11:59:00Z".to_string(),
        started_at: None,
        completed_at: None,
        tries: 1,
        max_tries: 5,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    }
}

#[tokio::test]
async fn active_job_update_progress_publishes_progress_event() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(publisher, sample_bindings(), FixedMetaSource);

    manager
        .with_active_job(
            sample_job(JobState::Active),
            JobCancellationToken::new(),
            |job| async move { job.update_progress(1, 3, Some("step 1".to_string())).await },
        )
        .await
        .expect("progress should publish");

    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].0.ends_with(".progress"));
    let event: JobEvent = serde_json::from_slice(&calls[0].1).expect("decode progress event");
    assert_eq!(event.event_type, JobEventType::Progress);
    assert_eq!(event.state, JobState::Active);
}

#[tokio::test]
async fn active_job_log_publishes_logged_event() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(publisher, sample_bindings(), FixedMetaSource);

    manager
        .with_active_job(
            sample_job(JobState::Active),
            JobCancellationToken::new(),
            |job| async move { job.log(JobLogLevel::Info, "started").await },
        )
        .await
        .expect("log should publish");

    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].0.ends_with(".logged"));
    let event: JobEvent = serde_json::from_slice(&calls[0].1).expect("decode logged event");
    assert_eq!(event.event_type, JobEventType::Logged);
    assert_eq!(event.state, JobState::Active);
}

#[tokio::test]
async fn active_job_rejects_progress_when_queue_progress_disabled() {
    let publisher = RecordingPublisher::default();
    let mut bindings = sample_bindings();
    bindings
        .queues
        .get_mut("document-process")
        .expect("queue binding")
        .progress = false;
    let manager = JobManager::new(publisher, bindings, FixedMetaSource);

    let error = manager
        .with_active_job(
            sample_job(JobState::Active),
            JobCancellationToken::new(),
            |job| async move { job.update_progress(1, 3, Some("step 1".to_string())).await },
        )
        .await
        .expect_err("disabled progress should fail");

    assert!(matches!(error, JobManagerError::FeatureDisabled { .. }));
}

#[tokio::test]
async fn active_job_exposes_cancellation_state() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(publisher, sample_bindings(), FixedMetaSource);
    let cancellation = JobCancellationToken::new();
    cancellation.cancel();

    let is_cancelled = manager
        .with_active_job(
            sample_job(JobState::Active),
            cancellation,
            |job| async move { Ok::<_, JobManagerError<&'static str>>(job.is_cancelled()) },
        )
        .await
        .expect("cancellation should be visible");

    assert!(is_cancelled);
}

#[tokio::test]
async fn active_job_heartbeat_calls_runtime_heartbeat_hook() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(publisher, sample_bindings(), FixedMetaSource);
    let heartbeats = Arc::new(Mutex::new(0usize));

    manager
        .with_active_job_and_heartbeat(
            sample_job(JobState::Active),
            JobCancellationToken::new(),
            {
                let heartbeats = Arc::clone(&heartbeats);
                move || {
                    let heartbeats = Arc::clone(&heartbeats);
                    async move {
                        *heartbeats.lock().expect("lock heartbeats") += 1;
                        Ok(())
                    }
                }
            },
            |job| async move {
                job.heartbeat().await.expect("heartbeat should succeed");
                Ok::<_, JobManagerError<&'static str>>(())
            },
        )
        .await
        .expect("heartbeat should succeed");

    assert_eq!(*heartbeats.lock().expect("lock heartbeats"), 1);
}

#[tokio::test]
async fn active_job_heartbeat_errors_without_runtime_hook() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(publisher, sample_bindings(), FixedMetaSource);

    let error = manager
        .with_active_job(
            sample_job(JobState::Active),
            JobCancellationToken::new(),
            |job| async move {
                job.heartbeat().await.map_err(|error| match error {
                    ActiveJobRuntimeError::Heartbeat(message) => {
                        JobManagerError::InvalidTransition {
                            job_id: message,
                            state: JobState::Active,
                            action: "heartbeat",
                        }
                    }
                })
            },
        )
        .await
        .expect_err("heartbeat without runtime hook should fail");

    assert!(
        matches!(error, JobManagerError::InvalidTransition { action, .. } if action == "heartbeat")
    );
}
