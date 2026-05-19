#[cfg(test)]
use std::cmp::Ordering;
#[cfg(test)]
use std::collections::HashSet;

#[cfg(test)]
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
#[cfg(test)]
use trellis_jobs::types::Job;
use trellis_jobs::types::JobState;

use super::JobsQueryError;

#[derive(Debug, Clone)]
pub(super) enum JobsStateFilter {
    Single(JobState),
    Many(Vec<JobState>),
}

#[derive(Debug, Clone, PartialEq)]
#[cfg(test)]
pub(super) struct JobsPage {
    pub jobs: Vec<Job>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg(test)]
struct JobsCursor {
    updated_at: String,
    service: String,
    job_type: String,
    id: String,
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

#[cfg(test)]
pub(super) fn filter_jobs(
    jobs: Vec<Job>,
    service: Option<&str>,
    job_type: Option<&str>,
    state: Option<&JobsStateFilter>,
    since: Option<&str>,
    limit: Option<u64>,
    cursor: Option<&str>,
) -> Result<JobsPage, JobsQueryError> {
    let cursor = cursor.map(decode_cursor).transpose()?;
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

    filtered.sort_by(compare_jobs);

    if let Some(cursor) = cursor.as_ref() {
        filtered.retain(|job| compare_job_to_cursor(job, cursor) == Ordering::Greater);
    }

    let mut has_more = false;
    let mut next_cursor = None;
    if let Some(limit) = limit {
        let limit = usize::try_from(limit).unwrap_or(usize::MAX);
        if filtered.len() > limit {
            has_more = true;
            filtered.truncate(limit);
            next_cursor = filtered.last().map(encode_cursor).transpose()?;
        }
    }

    Ok(JobsPage {
        jobs: filtered,
        has_more,
        next_cursor,
    })
}

pub(super) fn now_timestamp_string() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
pub(super) fn find_job_by_id(jobs: Vec<Job>, id: &str) -> Result<Option<Job>, JobsQueryError> {
    let mut found = None;
    for job in jobs {
        if job.id != id {
            continue;
        }
        if found.is_some() {
            return Err(JobsQueryError::DuplicateJobId { id: id.to_string() });
        }
        found = Some(job);
    }
    Ok(found)
}

#[cfg(test)]
fn compare_jobs(left: &Job, right: &Job) -> Ordering {
    right
        .updated_at
        .cmp(&left.updated_at)
        .then_with(|| left.service.cmp(&right.service))
        .then_with(|| left.job_type.cmp(&right.job_type))
        .then_with(|| left.id.cmp(&right.id))
}

#[cfg(test)]
fn compare_job_to_cursor(job: &Job, cursor: &JobsCursor) -> Ordering {
    cursor
        .updated_at
        .cmp(&job.updated_at)
        .then_with(|| job.service.cmp(&cursor.service))
        .then_with(|| job.job_type.cmp(&cursor.job_type))
        .then_with(|| job.id.cmp(&cursor.id))
}

#[cfg(test)]
fn encode_cursor(job: &Job) -> Result<String, JobsQueryError> {
    serde_json::to_string(&JobsCursor {
        updated_at: job.updated_at.clone(),
        service: job.service.clone(),
        job_type: job.job_type.clone(),
        id: job.id.clone(),
    })
    .map_err(|error| JobsQueryError::ConvertWireModel {
        model: "jobs cursor",
        details: error.to_string(),
    })
}

#[cfg(test)]
fn decode_cursor(cursor: &str) -> Result<JobsCursor, JobsQueryError> {
    serde_json::from_str(cursor).map_err(|error| JobsQueryError::ConvertWireModel {
        model: "jobs cursor",
        details: error.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trellis_jobs::types::JobContext;

    use super::*;

    fn job(id: &str, service: &str, job_type: &str, updated_at: &str, state: JobState) -> Job {
        Job {
            id: id.to_string(),
            context: context(id),
            service: service.to_string(),
            job_type: job_type.to_string(),
            state,
            payload: json!({}),
            result: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
            started_at: None,
            completed_at: None,
            tries: 0,
            max_tries: 3,
            last_error: None,
            deadline: None,
            progress: None,
            logs: None,
        }
    }

    fn context(id: &str) -> JobContext {
        JobContext {
            request_id: format!("request-{id}"),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        }
    }

    #[test]
    fn filter_jobs_orders_by_stable_cursor_tuple() {
        let page = filter_jobs(
            vec![
                job(
                    "b",
                    "beta",
                    "import",
                    "2025-01-01T00:00:00Z",
                    JobState::Pending,
                ),
                job(
                    "a",
                    "alpha",
                    "zeta",
                    "2025-01-02T00:00:00Z",
                    JobState::Pending,
                ),
                job(
                    "c",
                    "alpha",
                    "import",
                    "2025-01-02T00:00:00Z",
                    JobState::Pending,
                ),
                job(
                    "d",
                    "alpha",
                    "import",
                    "2025-01-02T00:00:00Z",
                    JobState::Pending,
                ),
            ],
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .expect("pagination should succeed");

        let ids = page
            .jobs
            .iter()
            .map(|job| job.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["c", "d", "a", "b"]);
        assert!(!page.has_more);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn filter_jobs_returns_records_strictly_after_cursor() {
        let jobs = vec![
            job(
                "a",
                "alpha",
                "import",
                "2025-01-03T00:00:00Z",
                JobState::Pending,
            ),
            job(
                "b",
                "alpha",
                "import",
                "2025-01-02T00:00:00Z",
                JobState::Pending,
            ),
            job(
                "c",
                "alpha",
                "import",
                "2025-01-01T00:00:00Z",
                JobState::Pending,
            ),
        ];
        let first_page = filter_jobs(jobs.clone(), None, None, None, None, Some(2), None)
            .expect("first page should succeed");

        assert!(first_page.has_more);
        assert_eq!(
            first_page
                .jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );

        let second_page = filter_jobs(
            jobs,
            None,
            None,
            None,
            None,
            Some(2),
            first_page.next_cursor.as_deref(),
        )
        .expect("second page should succeed");

        assert!(!second_page.has_more);
        assert_eq!(second_page.next_cursor, None);
        assert_eq!(
            second_page
                .jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["c"]
        );
    }

    #[test]
    fn filter_jobs_preserves_filters_with_cursor_pagination() {
        let jobs = vec![
            job(
                "a",
                "alpha",
                "import",
                "2025-01-03T00:00:00Z",
                JobState::Pending,
            ),
            job(
                "b",
                "alpha",
                "export",
                "2025-01-02T00:00:00Z",
                JobState::Pending,
            ),
            job(
                "c",
                "beta",
                "import",
                "2025-01-01T00:00:00Z",
                JobState::Pending,
            ),
        ];

        let page = filter_jobs(
            jobs,
            Some("alpha"),
            Some("import"),
            Some(&JobsStateFilter::Single(JobState::Pending)),
            Some("2025-01-02T00:00:00Z"),
            Some(2),
            None,
        )
        .expect("filtered page should succeed");

        assert_eq!(page.jobs.len(), 1);
        assert_eq!(page.jobs[0].id, "a");
        assert!(!page.has_more);
    }

    #[test]
    fn filter_jobs_rejects_invalid_cursor() {
        let error = filter_jobs(
            vec![job(
                "a",
                "alpha",
                "import",
                "2025-01-01T00:00:00Z",
                JobState::Pending,
            )],
            None,
            None,
            None,
            None,
            Some(1),
            Some("not-json"),
        )
        .expect_err("invalid cursor should fail");

        assert!(matches!(
            error,
            JobsQueryError::ConvertWireModel {
                model: "jobs cursor",
                ..
            }
        ));
    }

    #[test]
    fn find_job_by_id_uses_global_job_id() {
        let found = find_job_by_id(
            vec![
                job(
                    "target",
                    "alpha",
                    "import",
                    "2025-01-01T00:00:00Z",
                    JobState::Pending,
                ),
                job(
                    "other",
                    "beta",
                    "export",
                    "2025-01-01T00:00:00Z",
                    JobState::Pending,
                ),
            ],
            "target",
        )
        .expect("id lookup should succeed")
        .expect("id should resolve");

        assert_eq!(found.service, "alpha");
        assert_eq!(found.job_type, "import");
    }

    #[test]
    fn find_job_by_id_rejects_duplicate_global_ids() {
        let error = find_job_by_id(
            vec![
                job(
                    "duplicate",
                    "alpha",
                    "import",
                    "2025-01-01T00:00:00Z",
                    JobState::Pending,
                ),
                job(
                    "duplicate",
                    "beta",
                    "export",
                    "2025-01-01T00:00:00Z",
                    JobState::Pending,
                ),
            ],
            "duplicate",
        )
        .expect_err("duplicate ids should be rejected");

        assert!(matches!(
            error,
            JobsQueryError::DuplicateJobId { id } if id == "duplicate"
        ));
    }
}
