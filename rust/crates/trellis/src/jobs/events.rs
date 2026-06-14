use serde_json::Value;

use crate::jobs::types::{
    JobConcurrency, JobContext, JobEvent, JobEventType, JobLogEntry, JobProgress, JobQueuePolicy,
    JobState,
};

fn base_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    event_type: JobEventType,
    state: JobState,
    previous_state: Option<JobState>,
    tries: u64,
    timestamp: &str,
) -> JobEvent {
    JobEvent {
        job_id: job_id.to_string(),
        context: context.clone(),
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
        concurrency: None,
        queue_policy: None,
        timestamp: timestamp.to_string(),
    }
}

pub fn created_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    payload: Value,
    max_tries: u64,
    timestamp: &str,
    deadline: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
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

/// Construct a `created` lifecycle event with keyed concurrency policy metadata.
pub fn created_event_with_policy(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    payload: Value,
    max_tries: u64,
    timestamp: &str,
    deadline: Option<&str>,
    concurrency: Option<JobConcurrency>,
    queue_policy: Option<JobQueuePolicy>,
) -> JobEvent {
    let mut event = created_event(
        service, job_type, job_id, context, payload, max_tries, timestamp, deadline,
    );
    event.concurrency = concurrency;
    event.queue_policy = queue_policy;
    event
}

pub fn started_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
) -> JobEvent {
    base_event(
        service,
        job_type,
        job_id,
        context,
        JobEventType::Started,
        JobState::Active,
        Some(previous_state),
        tries,
        timestamp,
    )
}

/// Construct a `started` lifecycle event with active key ownership metadata.
pub fn started_event_with_concurrency(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    concurrency: JobConcurrency,
) -> JobEvent {
    let mut event = started_event(
        service,
        job_type,
        job_id,
        context,
        previous_state,
        tries,
        timestamp,
    );
    event.concurrency = Some(concurrency);
    event
}

pub fn retry_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
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
    context: &JobContext,
    tries: u64,
    timestamp: &str,
    progress: JobProgress,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
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
    context: &JobContext,
    tries: u64,
    timestamp: &str,
    logs: Vec<JobLogEntry>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
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
    context: &JobContext,
    tries: u64,
    timestamp: &str,
    result: Value,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
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
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: &str,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
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
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
) -> JobEvent {
    base_event(
        service,
        job_type,
        job_id,
        context,
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
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: &str,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
        JobEventType::Expired,
        JobState::Expired,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = Some(error.to_string());
    event
}

/// Construct a `skipped` terminal lifecycle event for queued work replaced by policy.
pub fn skipped_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    reason: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
        JobEventType::Skipped,
        JobState::Skipped,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = reason.map(ToString::to_string);
    event
}

/// Construct a `stale` terminal lifecycle event for active work that lost its key lease.
pub fn stale_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    tries: u64,
    timestamp: &str,
    reason: Option<&str>,
    concurrency: Option<JobConcurrency>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
        JobEventType::Stale,
        JobState::Stale,
        Some(JobState::Active),
        tries,
        timestamp,
    );
    event.error = reason.map(ToString::to_string);
    event.concurrency = concurrency;
    event
}

/// Construct a keyed active-job heartbeat lifecycle event.
pub fn heartbeat_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    tries: u64,
    timestamp: &str,
    concurrency: Option<JobConcurrency>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
        JobEventType::Heartbeat,
        JobState::Active,
        Some(JobState::Active),
        tries,
        timestamp,
    );
    event.concurrency = concurrency;
    event
}

/// Construct an observability event for a stale worker completion that was ignored.
pub fn stale_completion_ignored_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
    tries: u64,
    timestamp: &str,
    reason: Option<&str>,
    concurrency: Option<JobConcurrency>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
        JobEventType::StaleCompletionIgnored,
        JobState::Active,
        Some(JobState::Active),
        tries,
        timestamp,
    );
    event.error = reason.map(ToString::to_string);
    event.concurrency = concurrency;
    event
}

pub fn retried_event(
    service: &str,
    job_type: &str,
    job_id: &str,
    context: &JobContext,
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
        context,
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
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    error: &str,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
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
    context: &JobContext,
    previous_state: JobState,
    tries: u64,
    timestamp: &str,
    reason: Option<&str>,
) -> JobEvent {
    let mut event = base_event(
        service,
        job_type,
        job_id,
        context,
        JobEventType::Dismissed,
        JobState::Dismissed,
        Some(previous_state),
        tries,
        timestamp,
    );
    event.error = reason.map(ToString::to_string);
    event
}
