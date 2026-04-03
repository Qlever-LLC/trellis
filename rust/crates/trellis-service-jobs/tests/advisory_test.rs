use serde_json::json;
use trellis_jobs::{Job, JobEventType, JobState};
use trellis_service_jobs::{map_dead_event_from_advisory_job, MaxDeliveriesAdvisory};

fn sample_job(id: &str, state: JobState, tries: u64) -> Job {
    Job {
        id: id.to_string(),
        service: "documents".to_string(),
        job_type: "document-process".to_string(),
        state,
        payload: json!({ "documentId": id }),
        result: None,
        created_at: "2026-03-28T11:00:00.000Z".to_string(),
        updated_at: "2026-03-28T11:00:00.000Z".to_string(),
        started_at: None,
        completed_at: None,
        tries,
        max_tries: 5,
        last_error: None,
        deadline: None,
        progress: None,
        logs: None,
    }
}

#[test]
fn map_dead_event_from_advisory_job_uses_current_state_and_max_tries() {
    let advisory = MaxDeliveriesAdvisory {
        stream: "JOBS_WORK".to_string(),
        consumer: "documents-document-process".to_string(),
        stream_seq: 41,
        deliveries: 3,
        timestamp: "2026-03-28T12:05:00.000Z".to_string(),
    };
    let work = sample_job("job-1", JobState::Pending, 0);
    let current = sample_job("job-1", JobState::Active, 2);

    let mapped = map_dead_event_from_advisory_job(Some(&current), &work, &advisory)
        .expect("active job should map to dead event");

    assert_eq!(
        mapped.subject,
        "trellis.jobs.documents.document-process.job-1.dead"
    );
    assert_eq!(mapped.event.event_type, JobEventType::Dead);
    assert_eq!(mapped.event.state, JobState::Dead);
    assert_eq!(mapped.event.previous_state, Some(JobState::Active));
    assert_eq!(mapped.event.tries, 3);
    assert_eq!(mapped.event.timestamp, "2026-03-28T12:05:00.000Z");
    assert_eq!(
        mapped.event.error.as_deref(),
        Some("max deliveries exceeded: stream=JOBS_WORK consumer=documents-document-process deliveries=3"),
    );
}

#[test]
fn map_dead_event_from_advisory_job_skips_terminal_current_job() {
    let advisory = MaxDeliveriesAdvisory {
        stream: "JOBS_WORK".to_string(),
        consumer: "documents-document-process".to_string(),
        stream_seq: 41,
        deliveries: 3,
        timestamp: "2026-03-28T12:05:00.000Z".to_string(),
    };
    let work = sample_job("job-1", JobState::Pending, 0);
    let current = sample_job("job-1", JobState::Completed, 2);

    let mapped = map_dead_event_from_advisory_job(Some(&current), &work, &advisory);
    assert_eq!(mapped, None);
}
