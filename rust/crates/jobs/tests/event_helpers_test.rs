use serde_json::json;
use trellis_jobs::events::{
    cancelled_event, completed_event, created_event, dead_event, dismissed_event, expired_event,
    failed_event, heartbeat_event, logged_event, progress_event, retried_event, retry_event,
    skipped_event, stale_completion_ignored_event, stale_event, started_event,
    started_event_with_concurrency,
};
use trellis_jobs::subjects::job_event_subject;
use trellis_jobs::types::{
    JobConcurrency, JobContext, JobEventType, JobLogEntry, JobLogLevel, JobProgress, JobState,
};

fn sample_context() -> JobContext {
    JobContext {
        request_id: "request-1".to_string(),
        trace_id: "0123456789abcdef0123456789abcdef".to_string(),
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
        tracestate: None,
    }
}

#[test]
fn started_event_with_concurrency_serializes_instance_id() {
    let event = started_event_with_concurrency(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Pending,
        1,
        "2026-03-28T12:01:00.000Z",
        JobConcurrency {
            key: "tenant-1".to_string(),
            key_hash: "hash-1".to_string(),
            instance_id: Some("worker-1".to_string()),
            slot_token: Some("slot-1".to_string()),
            heartbeat_at: Some("2026-03-28T12:01:00.000Z".to_string()),
            lease_expires_at: Some("2026-03-28T12:02:00.000Z".to_string()),
            stale_takeover_count: Some(0),
        },
    );

    let value = serde_json::to_value(&event).expect("event should serialize");

    assert_eq!(value["concurrency"]["instanceId"], json!("worker-1"));
}

#[test]
fn created_event_sets_event_type_state_payload_and_max_tries() {
    let event = created_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        json!({ "documentId": "doc-1" }),
        5,
        "2026-03-28T12:00:00.000Z",
        Some("2026-03-28T12:30:00.000Z"),
    );

    assert_eq!(event.event_type, JobEventType::Created);
    assert_eq!(event.state, JobState::Pending);
    assert_eq!(event.payload, Some(json!({ "documentId": "doc-1" })));
    assert_eq!(event.max_tries, Some(5));
    assert_eq!(event.deadline.as_deref(), Some("2026-03-28T12:30:00.000Z"));
}

#[test]
fn retried_event_sets_pending_state_and_no_payload() {
    let event = retried_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Failed,
        "2026-03-28T12:10:00.000Z",
        None,
        None,
        None,
    );

    assert_eq!(event.event_type, JobEventType::Retried);
    assert_eq!(event.state, JobState::Pending);
    assert_eq!(event.previous_state, Some(JobState::Failed));
    assert_eq!(event.payload, None);
}

#[test]
fn event_helpers_round_trip_subject_suffix_with_subject_builder() {
    let created = created_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        json!({ "documentId": "doc-1" }),
        5,
        "2026-03-28T12:00:00.000Z",
        None,
    );
    let retried = retried_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Failed,
        "2026-03-28T12:10:00.000Z",
        None,
        None,
        None,
    );

    assert_eq!(
        job_event_subject(
            &created.service,
            &created.job_type,
            &created.job_id,
            created.event_type,
        ),
        "trellis.jobs.documents.document-process.job-1.created"
    );
    assert_eq!(
        job_event_subject(
            &retried.service,
            &retried.job_type,
            &retried.job_id,
            retried.event_type,
        ),
        "trellis.jobs.documents.document-process.job-1.retried"
    );
}

#[test]
fn event_helpers_set_expected_event_type_and_state_pairs() {
    let started = started_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Pending,
        1,
        "2026-03-28T12:01:00.000Z",
    );
    assert_eq!(started.event_type, JobEventType::Started);
    assert_eq!(started.state, JobState::Active);

    let retry = retry_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Active,
        1,
        "2026-03-28T12:02:00.000Z",
        Some("transient"),
    );
    assert_eq!(retry.event_type, JobEventType::Retry);
    assert_eq!(retry.state, JobState::Retry);

    let progress = progress_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        1,
        "2026-03-28T12:02:30.000Z",
        JobProgress {
            step: Some("extract".to_string()),
            message: Some("Extracting".to_string()),
            current: Some(2),
            total: Some(5),
        },
    );
    assert_eq!(progress.event_type, JobEventType::Progress);
    assert_eq!(progress.state, JobState::Active);

    let logged = logged_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        1,
        "2026-03-28T12:02:45.000Z",
        vec![JobLogEntry {
            timestamp: "2026-03-28T12:02:45.000Z".to_string(),
            level: JobLogLevel::Info,
            message: "halfway".to_string(),
        }],
    );
    assert_eq!(logged.event_type, JobEventType::Logged);
    assert_eq!(logged.state, JobState::Active);

    let completed = completed_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        1,
        "2026-03-28T12:03:00.000Z",
        json!({ "ok": true }),
    );
    assert_eq!(completed.event_type, JobEventType::Completed);
    assert_eq!(completed.state, JobState::Completed);

    let failed = failed_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Active,
        3,
        "2026-03-28T12:03:10.000Z",
        "fatal",
    );
    assert_eq!(failed.event_type, JobEventType::Failed);
    assert_eq!(failed.state, JobState::Failed);

    let cancelled = cancelled_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Retry,
        2,
        "2026-03-28T12:03:20.000Z",
    );
    assert_eq!(cancelled.event_type, JobEventType::Cancelled);
    assert_eq!(cancelled.state, JobState::Cancelled);

    let expired = expired_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Retry,
        2,
        "2026-03-28T12:03:30.000Z",
        "deadline",
    );
    assert_eq!(expired.event_type, JobEventType::Expired);
    assert_eq!(expired.state, JobState::Expired);

    let dead = dead_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Failed,
        3,
        "2026-03-28T12:03:40.000Z",
        "dlq",
    );
    assert_eq!(dead.event_type, JobEventType::Dead);
    assert_eq!(dead.state, JobState::Dead);

    let dismissed = dismissed_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Dead,
        3,
        "2026-03-28T12:03:50.000Z",
        Some("won't fix"),
    );
    assert_eq!(dismissed.event_type, JobEventType::Dismissed);
    assert_eq!(dismissed.state, JobState::Dismissed);

    let skipped = skipped_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        JobState::Pending,
        0,
        "2026-03-28T12:04:00.000Z",
        Some("replaced"),
    );
    assert_eq!(skipped.event_type, JobEventType::Skipped);
    assert_eq!(skipped.state, JobState::Skipped);

    let stale = stale_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        1,
        "2026-03-28T12:04:10.000Z",
        Some("lease expired"),
        None,
    );
    assert_eq!(stale.event_type, JobEventType::Stale);
    assert_eq!(stale.state, JobState::Stale);

    let heartbeat = heartbeat_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        1,
        "2026-03-28T12:04:20.000Z",
        None,
    );
    assert_eq!(heartbeat.event_type, JobEventType::Heartbeat);
    assert_eq!(heartbeat.state, JobState::Active);

    let ignored = stale_completion_ignored_event(
        "documents",
        "document-process",
        "job-1",
        &sample_context(),
        1,
        "2026-03-28T12:04:30.000Z",
        Some("lost key slot"),
        None,
    );
    assert_eq!(ignored.event_type, JobEventType::StaleCompletionIgnored);
    assert_eq!(ignored.state, JobState::Active);
}
