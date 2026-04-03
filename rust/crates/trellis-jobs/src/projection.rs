use crate::types::{Job, JobEvent, JobEventType, JobState};

pub fn is_terminal(state: JobState) -> bool {
    matches!(
        state,
        JobState::Completed
            | JobState::Failed
            | JobState::Cancelled
            | JobState::Expired
            | JobState::Dead
            | JobState::Dismissed
    )
}

pub fn job_from_work_event(event: &JobEvent) -> Option<Job> {
    match event.event_type {
        JobEventType::Created | JobEventType::Retried => seed_job_from_event(event),
        _ => None,
    }
}

pub fn reduce_job_event(current: Option<&Job>, event: &JobEvent) -> Option<Job> {
    let current = match current {
        Some(value) => value,
        None => {
            if event.event_type != JobEventType::Created {
                return None;
            }
            return seed_job_from_event(event);
        }
    };

    if !is_legal_transition(current, event) {
        return Some(current.clone());
    }

    let mut next = Job {
        id: current.id.clone(),
        service: current.service.clone(),
        job_type: current.job_type.clone(),
        state: event.state,
        payload: current.payload.clone(),
        result: current.result.clone(),
        created_at: current.created_at.clone(),
        updated_at: event.timestamp.clone(),
        started_at: current.started_at.clone(),
        completed_at: current.completed_at.clone(),
        tries: event.tries,
        max_tries: event.max_tries.unwrap_or(current.max_tries),
        last_error: current.last_error.clone(),
        deadline: current.deadline.clone(),
        progress: current.progress.clone(),
        logs: current.logs.clone(),
    };

    match event.event_type {
        JobEventType::Started => {
            next.started_at = Some(event.timestamp.clone());
        }
        JobEventType::Progress => {
            next.progress = event.progress.clone();
        }
        JobEventType::Logged => {
            let mut logs = next.logs.take().unwrap_or_default();
            if let Some(new_logs) = &event.logs {
                logs.extend(new_logs.iter().cloned());
            }
            next.logs = Some(logs);
        }
        JobEventType::Completed => {
            next.result = event.result.clone();
            next.completed_at = Some(event.timestamp.clone());
        }
        JobEventType::Failed
        | JobEventType::Cancelled
        | JobEventType::Expired
        | JobEventType::Dead
        | JobEventType::Dismissed => {
            next.last_error = event.error.clone();
            next.completed_at = Some(event.timestamp.clone());
        }
        JobEventType::Retry => {
            next.last_error = event.error.clone();
        }
        JobEventType::Retried => {
            if let Some(payload) = &event.payload {
                next.payload = payload.clone();
            }
            if let Some(deadline) = &event.deadline {
                next.deadline = Some(deadline.clone());
            }
            next.result = None;
            next.completed_at = None;
            next.started_at = None;
            next.last_error = None;
            next.progress = None;
            next.logs = None;
            next.tries = 0;
        }
        JobEventType::Created => {}
    }

    Some(next)
}

fn is_legal_transition(current: &Job, event: &JobEvent) -> bool {
    match event.event_type {
        JobEventType::Created => false,
        JobEventType::Started => {
            matches!(current.state, JobState::Pending | JobState::Retry)
                && event.previous_state == Some(current.state)
        }
        JobEventType::Retry => {
            current.state == JobState::Active && event.previous_state == Some(JobState::Active)
        }
        JobEventType::Progress | JobEventType::Logged | JobEventType::Completed => {
            current.state == JobState::Active && event.previous_state == Some(JobState::Active)
        }
        JobEventType::Failed => {
            current.state == JobState::Active && event.previous_state == Some(JobState::Active)
        }
        JobEventType::Cancelled => {
            matches!(
                current.state,
                JobState::Pending | JobState::Retry | JobState::Active
            ) && event.previous_state == Some(current.state)
        }
        JobEventType::Expired => {
            matches!(
                current.state,
                JobState::Pending | JobState::Retry | JobState::Active
            ) && event.previous_state == Some(current.state)
        }
        JobEventType::Retried => {
            matches!(current.state, JobState::Failed | JobState::Dead)
                && event.previous_state == Some(current.state)
        }
        JobEventType::Dead => {
            matches!(
                current.state,
                JobState::Active | JobState::Retry | JobState::Failed | JobState::Expired
            ) && event.previous_state == Some(current.state)
        }
        JobEventType::Dismissed => {
            current.state == JobState::Dead && event.previous_state == Some(JobState::Dead)
        }
    }
}

fn seed_job_from_event(event: &JobEvent) -> Option<Job> {
    let payload = event.payload.clone()?;
    Some(Job {
        id: event.job_id.clone(),
        service: event.service.clone(),
        job_type: event.job_type.clone(),
        state: event.state,
        payload,
        result: None,
        created_at: event.timestamp.clone(),
        updated_at: event.timestamp.clone(),
        started_at: None,
        completed_at: None,
        tries: event.tries,
        max_tries: event.max_tries.unwrap_or(1),
        last_error: None,
        deadline: event.deadline.clone(),
        progress: None,
        logs: None,
    })
}
