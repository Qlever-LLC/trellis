use serde_json::json;
use trellis_jobs::types::{Job, JobEvent, JobEventType, JobLogLevel, JobState, WorkerHeartbeat};

#[test]
fn job_state_and_event_type_serde_use_lowercase_tokens() {
    assert_eq!(
        serde_json::to_value(JobState::Pending).unwrap(),
        json!("pending")
    );
    assert_eq!(
        serde_json::to_value(JobState::Cancelled).unwrap(),
        json!("cancelled")
    );
    assert_eq!(
        serde_json::to_value(JobEventType::Retried).unwrap(),
        json!("retried")
    );
    assert_eq!(
        serde_json::to_value(JobState::Dismissed).unwrap(),
        json!("dismissed")
    );
}

#[test]
fn job_and_event_serde_use_expected_wire_keys() {
    let job = Job {
        id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state: JobState::Pending,
        payload: json!({ "documentId": "doc-1" }),
        result: None,
        created_at: "2026-03-28T12:00:00.000Z".to_string(),
        updated_at: "2026-03-28T12:00:00.000Z".to_string(),
        started_at: None,
        completed_at: None,
        tries: 0,
        max_tries: 5,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    };
    let job_json = serde_json::to_value(job).unwrap();
    assert_eq!(job_json.get("type"), Some(&json!("document-process")));
    assert_eq!(job_json.get("maxTries"), Some(&json!(5)));
    assert!(job_json.get("job_type").is_none());

    let event = JobEvent {
        job_id: "job-1".to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        event_type: JobEventType::Created,
        state: JobState::Pending,
        previous_state: None,
        tries: 0,
        max_tries: Some(5),
        error: None,
        progress: None,
        logs: None,
        payload: Some(json!({ "documentId": "doc-1" })),
        result: None,
        deadline: None,
        timestamp: "2026-03-28T12:00:00.000Z".to_string(),
    };
    let event_json = serde_json::to_value(event).unwrap();
    assert_eq!(event_json.get("jobId"), Some(&json!("job-1")));
    assert_eq!(event_json.get("jobType"), Some(&json!("document-process")));
    assert_eq!(event_json.get("eventType"), Some(&json!("created")));
}

#[test]
fn log_level_serde_uses_expected_wire_keys() {
    assert_eq!(
        serde_json::to_value(JobLogLevel::Info).unwrap(),
        json!("info")
    );
}

#[test]
fn worker_heartbeat_serde_uses_expected_wire_keys() {
    let heartbeat = WorkerHeartbeat {
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        instance_id: "instance-1".to_string(),
        concurrency: Some(2),
        version: Some("0.5.1".to_string()),
        timestamp: "2026-03-30T12:00:00.000Z".to_string(),
    };

    let value = serde_json::to_value(&heartbeat).unwrap();
    assert_eq!(value.get("jobType"), Some(&json!("document-process")));
    assert_eq!(value.get("instanceId"), Some(&json!("instance-1")));
    assert_eq!(value.get("concurrency"), Some(&json!(2)));
    assert_eq!(value.get("version"), Some(&json!("0.5.1")));
    assert_eq!(
        value.get("timestamp"),
        Some(&json!("2026-03-30T12:00:00.000Z"))
    );
}
