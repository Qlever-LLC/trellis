use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use trellis_jobs::bindings::{JobsBinding, JobsQueueBinding};
use trellis_jobs::manager::{JobManager, JobManagerError, JobMetaSource};
use trellis_jobs::publisher::JobEventPublisher;
use trellis_jobs::types::{JobEvent, JobEventType, JobState};

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

struct FixedMetaSource;

impl JobMetaSource for FixedMetaSource {
    fn next_job_id(&self) -> String {
        "job-1".to_string()
    }

    fn now_iso(&self) -> String {
        "2026-03-28T12:00:00.000Z".to_string()
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

#[tokio::test]
async fn create_errors_when_queue_binding_missing() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        JobsBinding {
            namespace: "documents".to_string(),
            jobs_state_bucket: None,
            queues: BTreeMap::new(),
        },
        FixedMetaSource,
    );

    let error = manager
        .create("document-process", json!({ "documentId": "doc-1" }))
        .await
        .expect_err("missing queue binding should fail");

    assert!(matches!(
        error,
        JobManagerError::MissingQueueBinding { queue_type } if queue_type == "document-process"
    ));
}

#[tokio::test]
async fn create_returns_pending_job_with_namespace_and_max_deliver() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        sample_bindings(),
        FixedMetaSource,
    );

    let job = manager
        .create("document-process", json!({ "documentId": "doc-1" }))
        .await
        .expect("create should succeed");

    assert_eq!(job.id, "job-1");
    assert_eq!(job.service, "documents");
    assert_eq!(job.job_type, "document-process");
    assert_eq!(job.state, JobState::Pending);
    assert_eq!(job.tries, 0);
    assert_eq!(job.max_tries, 5);
}

#[tokio::test]
async fn create_publishes_created_event_to_publish_prefix_jobid_created_subject() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(publisher, sample_bindings(), FixedMetaSource);

    let job = manager
        .create("document-process", json!({ "documentId": "doc-1" }))
        .await
        .expect("create should succeed");
    let calls = manager.publisher().calls();

    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].0,
        format!("trellis.jobs.documents.document-process.{}.created", job.id)
    );
}

#[tokio::test]
async fn create_publishes_created_event_payload_with_expected_fields() {
    let publisher = RecordingPublisher::default();
    let manager = JobManager::new(publisher, sample_bindings(), FixedMetaSource);

    manager
        .create("document-process", json!({ "documentId": "doc-1" }))
        .await
        .expect("create should succeed");

    let calls = manager.publisher().calls();
    let event: JobEvent = serde_json::from_slice(&calls[0].1).expect("decode created event");
    assert_eq!(event.event_type, JobEventType::Created);
    assert_eq!(event.state, JobState::Pending);
    assert_eq!(event.max_tries, Some(5));
    assert_eq!(event.payload, Some(json!({ "documentId": "doc-1" })));
}

#[tokio::test]
async fn create_propagates_publisher_error() {
    let manager = JobManager::new(FailingPublisher, sample_bindings(), FixedMetaSource);

    let error = manager
        .create("document-process", json!({ "documentId": "doc-1" }))
        .await
        .expect_err("publisher error should propagate");

    assert!(matches!(error, JobManagerError::Publish("publish failed")));
}

#[tokio::test]
async fn create_applies_default_deadline_from_queue_binding() {
    let publisher = RecordingPublisher::default();
    let mut bindings = sample_bindings();
    bindings
        .queues
        .get_mut("document-process")
        .expect("queue binding")
        .default_deadline_ms = Some(120_000);
    let manager = JobManager::new(publisher, bindings, FixedMetaSource);

    let job = manager
        .create("document-process", json!({ "documentId": "doc-1" }))
        .await
        .expect("create should succeed");

    assert_eq!(job.deadline.as_deref(), Some("2026-03-28T12:02:00Z"));
    let calls = manager.publisher().calls();
    let event: JobEvent = serde_json::from_slice(&calls[0].1).expect("decode created event");
    assert_eq!(event.deadline.as_deref(), Some("2026-03-28T12:02:00Z"));
}
