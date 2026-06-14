use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use serde_json::json;
use trellis_jobs::bindings::{
    JobKeyConcurrencyBinding, JobKeyStalePolicy, JobQueueDepthBinding, JobQueueWhenFull,
    JobsBinding, JobsQueueBinding,
};
use trellis_jobs::keys::{
    acquire_active_slot_from_state, admit_job, release_active_slot, renew_active_slot,
    restore_replaced_queued_entry, AcquireSlotInput, AcquireSlotOutcome, AdmitJobInput,
    AdmitJobOutcome, JobKeyActiveSlot, JobKeyCoordinator, JobKeyPolicy, JobKeyQueuedEntry,
    JobKeyState, LeaseMutationOutcome, NatsKeyCoordinatorError, QueueMutationOutcome,
};
use trellis_jobs::manager::{
    JobManager, JobManagerError, JobMetaSource, JobProcessError, JobProcessOutcome,
    JobSubmitOutcome, TerminalPublishDecision,
};
use trellis_jobs::publisher::{JobEventHeaders, JobEventPublisher};
use trellis_jobs::types::{Job, JobContext, JobEvent, JobEventType, JobState};
use trellis_jobs::JobCancellationToken;

#[derive(Default)]
struct RecordingPublisher {
    calls: Arc<Mutex<Vec<(String, JobEventHeaders, Vec<u8>)>>>,
    fail_event: Option<JobEventType>,
}

impl RecordingPublisher {
    fn fail_on(fail_event: JobEventType) -> Self {
        Self {
            calls: Arc::default(),
            fail_event: Some(fail_event),
        }
    }

    fn calls(&self) -> Vec<(String, JobEventHeaders, Vec<u8>)> {
        self.calls.lock().expect("lock calls").clone()
    }
}

impl JobEventPublisher for RecordingPublisher {
    type Error = &'static str;

    fn publish(
        &self,
        subject: String,
        headers: JobEventHeaders,
        payload: Vec<u8>,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send {
        self.calls
            .lock()
            .expect("lock calls")
            .push((subject, headers, payload.clone()));
        let fail_event = self.fail_event;
        async move {
            if let Some(fail_event) = fail_event {
                let event: JobEvent = serde_json::from_slice(&payload).expect("decode event");
                if event.event_type == fail_event {
                    return Err("publish failed");
                }
            }
            Ok(())
        }
    }
}

#[derive(Debug, Default)]
struct MemoryCoordinator {
    state: Mutex<Option<JobKeyState>>,
}

impl JobKeyCoordinator for MemoryCoordinator {
    fn admit(
        &self,
        policy: JobKeyPolicy,
        input: AdmitJobInput,
    ) -> BoxFuture<'static, Result<AdmitJobOutcome, NatsKeyCoordinatorError>> {
        let current = self.state.lock().expect("lock state").take();
        let outcome = admit_job(current, &policy, input);
        if let Some(next) = outcome.next_state().cloned() {
            *self.state.lock().expect("lock state") = Some(next);
        }
        Box::pin(async move { Ok(outcome) })
    }

    fn acquire(
        &self,
        policy: JobKeyPolicy,
        input: AcquireSlotInput,
    ) -> BoxFuture<'static, Result<AcquireSlotOutcome, NatsKeyCoordinatorError>> {
        let current = self.state.lock().expect("lock state").take();
        let outcome = acquire_active_slot_from_state(current, &policy, input);
        if let Some(next) = outcome.next_state().cloned() {
            *self.state.lock().expect("lock state") = Some(next);
        }
        Box::pin(async move { Ok(outcome) })
    }

    fn renew(
        &self,
        _policy: JobKeyPolicy,
        job_id: String,
        slot_token: String,
        heartbeat_at: String,
        lease_expires_at: String,
    ) -> BoxFuture<'static, Result<LeaseMutationOutcome, NatsKeyCoordinatorError>> {
        let current = self.state.lock().expect("lock state").take();
        let outcome = current.map_or_else(
            || LeaseMutationOutcome::Lost {
                state: empty_state(),
            },
            |state| {
                renew_active_slot(
                    state,
                    &job_id,
                    &slot_token,
                    &heartbeat_at,
                    &lease_expires_at,
                )
            },
        );
        if let Some(next) = outcome.next_state().cloned() {
            *self.state.lock().expect("lock state") = Some(next);
        }
        Box::pin(async move { Ok(outcome) })
    }

    fn release(
        &self,
        _policy: JobKeyPolicy,
        job_id: String,
        slot_token: String,
        released_at: String,
    ) -> BoxFuture<'static, Result<LeaseMutationOutcome, NatsKeyCoordinatorError>> {
        let current = self.state.lock().expect("lock state").take();
        let outcome = current.map_or_else(
            || LeaseMutationOutcome::Lost {
                state: empty_state(),
            },
            |state| release_active_slot(state, &job_id, &slot_token, &released_at),
        );
        if let Some(next) = outcome.next_state().cloned() {
            *self.state.lock().expect("lock state") = Some(next);
        }
        Box::pin(async move { Ok(outcome) })
    }

    fn remove_queued(
        &self,
        _policy: JobKeyPolicy,
        job_id: String,
        removed_at: String,
    ) -> BoxFuture<'static, Result<QueueMutationOutcome, NatsKeyCoordinatorError>> {
        let current = self.state.lock().expect("lock state").take();
        let outcome = current.map_or_else(
            || QueueMutationOutcome::Missing {
                state: empty_state(),
            },
            |state| trellis_jobs::keys::remove_queued_entry(state, &job_id, &removed_at),
        );
        if let Some(next) = outcome.next_state().cloned() {
            *self.state.lock().expect("lock state") = Some(next);
        }
        Box::pin(async move { Ok(outcome) })
    }

    fn restore_replaced(
        &self,
        _policy: JobKeyPolicy,
        replaced: JobKeyQueuedEntry,
        replacement_job_id: String,
        restored_at: String,
    ) -> BoxFuture<'static, Result<QueueMutationOutcome, NatsKeyCoordinatorError>> {
        let current = self.state.lock().expect("lock state").take();
        let outcome = current.map_or_else(
            || {
                let mut state = empty_state();
                state.queued.push(replaced.clone());
                QueueMutationOutcome::Restored { state }
            },
            |state| {
                restore_replaced_queued_entry(
                    state,
                    replaced.clone(),
                    &replacement_job_id,
                    &restored_at,
                )
            },
        );
        if let Some(next) = outcome.next_state().cloned() {
            *self.state.lock().expect("lock state") = Some(next);
        }
        Box::pin(async move { Ok(outcome) })
    }
}

trait TestKeyStateUpdate {
    fn next_state(&self) -> Option<&JobKeyState>;
}

impl TestKeyStateUpdate for AdmitJobOutcome {
    fn next_state(&self) -> Option<&JobKeyState> {
        match self {
            Self::Accepted { state } | Self::Replaced { state, .. } => Some(state),
            Self::Rejected { .. } | Self::Coalesced { .. } => None,
        }
    }
}

impl TestKeyStateUpdate for AcquireSlotOutcome {
    fn next_state(&self) -> Option<&JobKeyState> {
        match self {
            Self::Acquired { state, .. } => Some(state),
            Self::Blocked { .. } => None,
        }
    }
}

impl TestKeyStateUpdate for LeaseMutationOutcome {
    fn next_state(&self) -> Option<&JobKeyState> {
        match self {
            Self::Renewed { state } | Self::Released { state } => Some(state),
            Self::Lost { .. } => None,
        }
    }
}

impl TestKeyStateUpdate for QueueMutationOutcome {
    fn next_state(&self) -> Option<&JobKeyState> {
        match self {
            Self::Removed { state } | Self::Restored { state } => Some(state),
            Self::Missing { .. } => None,
        }
    }
}

struct SequenceMetaSource {
    ids: Arc<Mutex<Vec<String>>>,
    times: Arc<Mutex<Vec<String>>>,
}

impl SequenceMetaSource {
    fn new(ids: Vec<&str>, times: Vec<&str>) -> Self {
        Self {
            ids: Arc::new(Mutex::new(ids.into_iter().map(str::to_string).collect())),
            times: Arc::new(Mutex::new(times.into_iter().map(str::to_string).collect())),
        }
    }
}

impl JobMetaSource for SequenceMetaSource {
    fn next_job_id(&self) -> String {
        self.ids.lock().expect("lock ids").remove(0)
    }

    fn now_iso(&self) -> String {
        self.times.lock().expect("lock times").remove(0)
    }
}

fn keyed_bindings(when_full: JobQueueWhenFull, max_queued_per_key: u64) -> JobsBinding {
    JobsBinding {
        namespace: "documents".to_string(),
        queues: BTreeMap::from([(
            "sync".to_string(),
            JobsQueueBinding {
                queue_type: "sync".to_string(),
                publish_prefix: "trellis.jobs.documents.sync".to_string(),
                work_subject: "trellis.work.documents.sync".to_string(),
                consumer_name: "documents-sync".to_string(),
                max_deliver: 5,
                backoff_ms: vec![5_000],
                ack_wait_ms: 60_000,
                default_deadline_ms: None,
                progress: true,
                logs: true,
                concurrency: 1,
                key_concurrency: Some(JobKeyConcurrencyBinding {
                    key: vec![
                        "zendesk".to_string(),
                        "/origin".to_string(),
                        "tickets".to_string(),
                    ],
                    max_active: 1,
                    heartbeat_interval_ms: 30_000,
                    heartbeat_ttl_ms: 90_000,
                    stale_policy: JobKeyStalePolicy::FailStale,
                }),
                queue: Some(JobQueueDepthBinding {
                    max_queued_per_key,
                    when_full,
                }),
            },
        )]),
    }
}

fn manager(
    when_full: JobQueueWhenFull,
    max_queued_per_key: u64,
) -> JobManager<RecordingPublisher, SequenceMetaSource> {
    JobManager::new_with_key_coordinator(
        RecordingPublisher::default(),
        keyed_bindings(when_full, max_queued_per_key),
        SequenceMetaSource::new(
            vec![
                "job-1",
                "request-1",
                "job-2",
                "request-2",
                "job-3",
                "request-3",
            ],
            vec![
                "2026-06-13T00:00:00Z",
                "2026-06-13T00:00:01Z",
                "2026-06-13T00:00:02Z",
                "2026-06-13T00:00:03Z",
                "2026-06-13T00:00:04Z",
            ],
        ),
        Arc::new(MemoryCoordinator::default()),
    )
}

fn payload() -> serde_json::Value {
    json!({ "origin": "acme" })
}

fn empty_state() -> JobKeyState {
    JobKeyState {
        version: 1,
        service: "documents".to_string(),
        job_type: "sync".to_string(),
        key: "zendesk:acme:tickets".to_string(),
        key_hash: "f13b9f743f4ea7a98d6898821d27b0df6e86d33237e042a6f1542dae12cb52f0".to_string(),
        max_active: 1,
        max_queued_per_key: Some(0),
        active: Vec::<JobKeyActiveSlot>::new(),
        queued: Vec::new(),
        stale_takeover_count: 0,
        updated_at: "2026-06-13T00:00:00Z".to_string(),
    }
}

#[tokio::test]
async fn create_rejects_keyed_duplicate_before_created_publish() {
    let manager = manager(JobQueueWhenFull::Reject, 0);

    manager
        .create("sync", payload())
        .await
        .expect("first create should publish");
    let error = manager
        .create("sync", payload())
        .await
        .expect_err("duplicate create should reject");

    assert!(matches!(error, JobManagerError::NotEnqueued(_)));
    assert_eq!(manager.publisher().calls().len(), 1);
}

#[tokio::test]
async fn submit_returns_coalesced_without_created_publish() {
    let manager = manager(JobQueueWhenFull::Coalesce, 0);

    manager
        .submit("sync", payload())
        .await
        .expect("first submit should accept");
    let outcome = manager
        .submit("sync", payload())
        .await
        .expect("second submit should coalesce");

    assert!(matches!(
        outcome,
        JobSubmitOutcome::Coalesced {
            existing_job_id,
            ..
        } if existing_job_id == "job-1"
    ));
    assert_eq!(manager.publisher().calls().len(), 1);
}

#[tokio::test]
async fn submit_replace_oldest_publishes_skipped_then_created() {
    let manager = manager(JobQueueWhenFull::ReplaceOldest, 1);

    manager
        .submit("sync", payload())
        .await
        .expect("first submit should accept");
    manager
        .submit("sync", payload())
        .await
        .expect("second submit should fill active capacity");
    let outcome = manager
        .submit("sync", payload())
        .await
        .expect("third submit should replace");

    assert!(matches!(
        outcome,
        JobSubmitOutcome::Replaced {
            replaced_job_id,
            ..
        } if replaced_job_id == "job-1"
    ));
    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 4);
    let skipped: JobEvent = serde_json::from_slice(&calls[2].2).expect("decode skipped event");
    assert_eq!(skipped.event_type, JobEventType::Skipped);
    assert_eq!(skipped.job_id, "job-1");
    let created: JobEvent = serde_json::from_slice(&calls[3].2).expect("decode created event");
    assert_eq!(created.event_type, JobEventType::Created);
    assert_eq!(created.job_id, "job-3");
}

#[tokio::test]
async fn submit_replace_oldest_restores_replaced_job_when_skipped_publish_fails() {
    let coordinator = Arc::new(MemoryCoordinator::default());
    let manager = JobManager::new_with_key_coordinator(
        RecordingPublisher::fail_on(JobEventType::Skipped),
        keyed_bindings(JobQueueWhenFull::ReplaceOldest, 1),
        SequenceMetaSource::new(
            vec![
                "job-1",
                "request-1",
                "job-2",
                "request-2",
                "job-3",
                "request-3",
            ],
            vec![
                "2026-06-13T00:00:00Z",
                "2026-06-13T00:00:01Z",
                "2026-06-13T00:00:02Z",
                "2026-06-13T00:00:03Z",
                "2026-06-13T00:00:04Z",
            ],
        ),
        coordinator.clone(),
    );

    manager
        .submit("sync", payload())
        .await
        .expect("first submit should accept");
    manager
        .submit("sync", payload())
        .await
        .expect("second submit should fill active capacity");
    let error = manager
        .submit("sync", payload())
        .await
        .expect_err("skipped publish should fail");

    assert!(matches!(error, JobManagerError::Publish("publish failed")));
    let state = coordinator
        .state
        .lock()
        .expect("lock state")
        .clone()
        .expect("state should exist");
    assert_eq!(
        state
            .queued
            .iter()
            .map(|entry| entry.job_id.as_str())
            .collect::<Vec<_>>(),
        vec!["job-1", "job-2"]
    );
}

fn active_job() -> Job {
    Job {
        id: "job-1".to_string(),
        context: JobContext {
            request_id: "request-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        },
        service: "documents".to_string(),
        job_type: "sync".to_string(),
        state: JobState::Pending,
        payload: payload(),
        result: None,
        created_at: "2026-06-13T00:00:00Z".to_string(),
        updated_at: "2026-06-13T00:00:00Z".to_string(),
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

#[tokio::test]
async fn stale_completion_suppresses_normal_terminal_event() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        keyed_bindings(JobQueueWhenFull::Reject, 0),
        SequenceMetaSource::new(vec![], vec!["2026-06-13T00:00:10Z", "2026-06-13T00:00:20Z"]),
    );

    let outcome = manager
        .process_with_heartbeat_and_terminal_guard(
            active_job(),
            JobCancellationToken::new(),
            || async { Ok(()) },
            |_| async { Ok(TerminalPublishDecision::StaleCompletionIgnored) },
            |_job| async { Ok::<_, JobProcessError<&'static str>>(json!({ "ok": true })) },
        )
        .await
        .expect("process should succeed");

    assert!(matches!(
        outcome,
        JobProcessOutcome::StaleCompletionIgnored { tries: 1 }
    ));
    let calls = manager.publisher().calls();
    assert_eq!(calls.len(), 2);
    let ignored: JobEvent = serde_json::from_slice(&calls[1].2).expect("decode ignored event");
    assert_eq!(ignored.event_type, JobEventType::StaleCompletionIgnored);
}

#[tokio::test]
async fn keyed_cancel_without_coordinator_fails_before_publish() {
    let manager = JobManager::new(
        RecordingPublisher::default(),
        keyed_bindings(JobQueueWhenFull::Reject, 0),
        SequenceMetaSource::new(vec![], vec![]),
    );

    let error = manager
        .cancel(&active_job())
        .await
        .expect_err("keyed cancel should require coordinator");

    assert!(matches!(error, JobManagerError::KeyCoordinator(_)));
    assert!(manager.publisher().calls().is_empty());
}
