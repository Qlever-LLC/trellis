use serde_json::Value;

use crate::types::{JobEvent, JobEventType, JobLogEntry, JobProgress, JobState};

fn base_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    event_type: JobEventType,
    state: JobState,
    previous_state: Option<JobState>,
    tries: u64,
    timestamp: &str,
) -> JobEvent {
    JobEvent {
        job_id: job_id.to_string(),
        service: service.to_string(),
        job_type: job_type.to_string(),
        event_type,
        state,
        previous_state,
        tries,
        max_tries: None,
        error: None,
        progress: None,
        logs: None,
        payload: None,
        result: None,
        deadline: None,
        timestamp: timestamp.to_string(),
    }
}

pub fn created_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    payload: Value,
    max_tries: u64,
    timestamp: &str,
    deadline: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Created,
        JobState::Pending,
        None,
        0,
        timestamp,
    );
    event.payload = Some(payload);
    event.max_tries = Some(max_tries);
    event.deadline = deadline.map(ToString::to_string);
    event
}

pub fn started_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
) -> JobEvent {
    base_event(
        service,
        job_type,
        job_id,
        JobEventType::Started,
        JobState::Active,
        Some(previous_state),
        tries,
        timestamp,
    )
}

pub fn retry_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Retry,
        JobState::Retry,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = error.map(ToString::to_string);
    event
}

pub fn progress_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    tries: u64,
    timestamp: &str,
    progress: JobProgress,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Progress,
        JobState::Active,
        Some(JobState::Active),
        tries,
        timestamp,
    );
    event.progress = Some(progress);
    event
}

pub fn logged_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    tries: u64,
    timestamp: &str,
    logs: Vec<JobLogEntry>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Logged,
        JobState::Active,
        Some(JobState::Active),
        tries,
        timestamp,
    );
    event.logs = Some(logs);
    event
}

pub fn completed_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    tries: u64,
    timestamp: &str,
    result: Value,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Completed,
        JobState::Completed,
        Some(JobState::Active),
        tries,
        timestamp,
    );
    event.result = Some(result);
    event
}

pub fn failed_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: &str,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Failed,
        JobState::Failed,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = Some(error.to_string());
    event
}

pub fn cancelled_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
) -> JobEvent {
    base_event(
        service,
        job_type,
        job_id,
        JobEventType::Cancelled,
        JobState::Cancelled,
        Some(previous_state),
        tries,
        timestamp,
    )
}

pub fn expired_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: &str,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Expired,
        JobState::Expired,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = Some(error.to_string());
    event
}

pub fn retried_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    timestamp: &str,
    payload: Option<Value>,
    max_tries: Option<u64>,
    deadline: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Retried,
        JobState::Pending,
        Some(previous_state),
        0,
        timestamp,
    );
    event.payload = payload;
    event.max_tries = max_tries;
    event.deadline = deadline.map(ToString::to_string);
    event
}

pub fn dead_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: &str,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Dead,
        JobState::Dead,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = Some(error.to_string());
    event
}

pub fn dismissed_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    reason: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        JobEventType::Dismissed,
        JobState::Dismissed,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = reason.map(ToString::to_string);
    event
}
