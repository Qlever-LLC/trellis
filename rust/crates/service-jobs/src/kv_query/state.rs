use std::collections::HashSet;

use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis_jobs::types::{Job, JobState};

use super::JobsQueryError;

#[derive(Debug, Clone)]
pub(super) enum JobsStateFilter {
    Single(JobState),
    Many(Vec<JobState>),
}

pub(super) fn parse_state_filter(
    state: Option<&serde_json::Value>,
) -> Result<Option<JobsStateFilter>, JobsQueryError> {
    let Some(state) = state else {
        return Ok(None);
    };

    if let Ok(single) = serde_json::from_value::<JobState>(state.clone()) {
        return Ok(Some(JobsStateFilter::Single(single)));
    }

    let many = serde_json::from_value::<Vec<JobState>>(state.clone()).map_err(|error| {
        JobsQueryError::ConvertWireModel {
            model: "job state filter",
            details: error.to_string(),
        }
    })?;
    Ok(Some(JobsStateFilter::Many(many)))
}

pub(super) fn filter_jobs(
    jobs: Vec<Job>,
    service: Option<&str>,
    job_type: Option<&str>,
    state: Option<&JobsStateFilter>,
    since: Option<&str>,
    limit: Option<u64>,
) -> Vec<Job> {
    let state_filter_many = match state {
        Some(JobsStateFilter::Many(states)) => {
            Some(states.iter().copied().collect::<HashSet<JobState>>())
        }
        _ => None,
    };

    let mut filtered = jobs
        .into_iter()
        .filter(|job| service.is_none_or(|service| service == job.service.as_str()))
        .filter(|job| job_type.is_none_or(|job_type| job_type == job.job_type.as_str()))
        .filter(|job| match state {
            None => true,
            Some(JobsStateFilter::Single(state)) => job.state == *state,
            Some(JobsStateFilter::Many(_)) => state_filter_many
                .as_ref()
                .is_some_and(|allowed| allowed.contains(&job.state)),
        })
        .filter(|job| since.is_none_or(|since| job.updated_at.as_str() >= since))
        .collect::<Vec<_>>();

    filtered.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    if let Some(limit) = limit {
        let limit = usize::try_from(limit).unwrap_or(usize::MAX);
        filtered.truncate(limit);
    }

    filtered
}

pub(super) fn now_timestamp_string() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
