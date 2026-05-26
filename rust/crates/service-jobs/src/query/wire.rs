use serde::de::DeserializeOwned;
use serde_json::Value;
use trellis::jobs::types::{Job, JobContext, JobLogEntry, JobProgress};
use trellis::sdk::jobs::types::{
    JobsCancelResponseJob, JobsCancelResponseJobLogsItem, JobsCancelResponseJobProgress,
    JobsDismissDLQResponseJob, JobsDismissDLQResponseJobLogsItem,
    JobsDismissDLQResponseJobProgress, JobsGetResponseJob, JobsGetResponseJobLogsItem,
    JobsGetResponseJobProgress, JobsListDLQResponseEntriesItem,
    JobsListDLQResponseEntriesItemLogsItem, JobsListDLQResponseEntriesItemProgress,
    JobsListResponseEntriesItem, JobsListResponseEntriesItemLogsItem,
    JobsListResponseEntriesItemProgress, JobsListServicesResponseEntriesItemWorkersItem,
    JobsReplayDLQResponseJob, JobsReplayDLQResponseJobLogsItem, JobsReplayDLQResponseJobProgress,
    JobsRetryResponseJob, JobsRetryResponseJobLogsItem, JobsRetryResponseJobProgress,
};

use crate::worker_presence::WorkerPresenceRecord;

use super::JobsQueryError;

pub(super) fn worker_presence_to_wire(
    worker: &WorkerPresenceRecord,
) -> JobsListServicesResponseEntriesItemWorkersItem {
    JobsListServicesResponseEntriesItemWorkersItem {
        concurrency: worker.concurrency.map(i64::from),
        instance_id: worker.instance_id.clone(),
        job_type: worker.job_type.clone(),
        service: worker.service.clone(),
        timestamp: worker.heartbeat_at.clone(),
        version: worker.version.clone(),
    }
}

macro_rules! impl_job_to_wire {
    ($fn_name:ident, $job_type:ident, $log_type:ty, $progress_type:ty, $max_tries_model:literal, $state_model:literal, $tries_model:literal) => {
        pub(super) fn $fn_name(job: &Job) -> Result<$job_type, JobsQueryError> {
            Ok($job_type {
                completed_at: job.completed_at.clone(),
                context: map_context(&job.context, "job context")?,
                created_at: job.created_at.clone(),
                deadline: job.deadline.clone(),
                id: job.id.clone(),
                last_error: job.last_error.clone(),
                logs: map_logs::<$log_type>(&job.logs)?,
                max_tries: map_count(job.max_tries, $max_tries_model)?,
                payload: job.payload.clone(),
                progress: map_progress::<$progress_type>(&job.progress)?,
                result: job.result.clone(),
                service: job.service.clone(),
                started_at: job.started_at.clone(),
                state: map_string_value(&job.state, $state_model)?,
                tries: map_count(job.tries, $tries_model)?,
                r#type: job.job_type.clone(),
                updated_at: job.updated_at.clone(),
            })
        }
    };
}

fn map_context<T>(context: &JobContext, model: &'static str) -> Result<T, JobsQueryError>
where
    T: DeserializeOwned,
{
    serde_json::from_value(map_json_value(context, model)?).map_err(|error| {
        JobsQueryError::ConvertWireModel {
            model,
            details: error.to_string(),
        }
    })
}

impl_job_to_wire!(
    job_to_list_item,
    JobsListResponseEntriesItem,
    JobsListResponseEntriesItemLogsItem,
    JobsListResponseEntriesItemProgress,
    "job list item maxTries",
    "job list item state",
    "job list item tries"
);
impl_job_to_wire!(
    job_to_dlq_item,
    JobsListDLQResponseEntriesItem,
    JobsListDLQResponseEntriesItemLogsItem,
    JobsListDLQResponseEntriesItemProgress,
    "job dlq list item maxTries",
    "job dlq list item state",
    "job dlq list item tries"
);
impl_job_to_wire!(
    job_to_get_item,
    JobsGetResponseJob,
    JobsGetResponseJobLogsItem,
    JobsGetResponseJobProgress,
    "job get response maxTries",
    "job get response state",
    "job get response tries"
);
impl_job_to_wire!(
    job_to_cancel_item,
    JobsCancelResponseJob,
    JobsCancelResponseJobLogsItem,
    JobsCancelResponseJobProgress,
    "job cancel response maxTries",
    "job cancel response state",
    "job cancel response tries"
);
impl_job_to_wire!(
    job_to_retry_item,
    JobsRetryResponseJob,
    JobsRetryResponseJobLogsItem,
    JobsRetryResponseJobProgress,
    "job retry response maxTries",
    "job retry response state",
    "job retry response tries"
);
impl_job_to_wire!(
    job_to_replay_item,
    JobsReplayDLQResponseJob,
    JobsReplayDLQResponseJobLogsItem,
    JobsReplayDLQResponseJobProgress,
    "job replay dlq response maxTries",
    "job replay dlq response state",
    "job replay dlq response tries"
);
impl_job_to_wire!(
    job_to_dismiss_item,
    JobsDismissDLQResponseJob,
    JobsDismissDLQResponseJobLogsItem,
    JobsDismissDLQResponseJobProgress,
    "job dismiss dlq response maxTries",
    "job dismiss dlq response state",
    "job dismiss dlq response tries"
);

trait WireLogItem {
    fn from_log(log: &JobLogEntry, level: String) -> Self;
}

trait WireProgressItem {
    fn from_progress(progress: &JobProgress, current: Option<i64>, total: Option<i64>) -> Self;
}

macro_rules! impl_wire_log_item {
    ($type_name:ty) => {
        impl WireLogItem for $type_name {
            fn from_log(log: &JobLogEntry, level: String) -> Self {
                Self {
                    level,
                    message: log.message.clone(),
                    timestamp: log.timestamp.clone(),
                }
            }
        }
    };
}

macro_rules! impl_wire_progress_item {
    ($type_name:ty) => {
        impl WireProgressItem for $type_name {
            fn from_progress(
                progress: &JobProgress,
                current: Option<i64>,
                total: Option<i64>,
            ) -> Self {
                Self {
                    current,
                    message: progress.message.clone(),
                    step: progress.step.clone(),
                    total,
                }
            }
        }
    };
}

impl_wire_log_item!(JobsCancelResponseJobLogsItem);
impl_wire_log_item!(JobsDismissDLQResponseJobLogsItem);
impl_wire_log_item!(JobsReplayDLQResponseJobLogsItem);
impl_wire_log_item!(JobsGetResponseJobLogsItem);
impl_wire_log_item!(JobsListDLQResponseEntriesItemLogsItem);
impl_wire_log_item!(JobsListResponseEntriesItemLogsItem);
impl_wire_log_item!(JobsRetryResponseJobLogsItem);

impl_wire_progress_item!(JobsCancelResponseJobProgress);
impl_wire_progress_item!(JobsDismissDLQResponseJobProgress);
impl_wire_progress_item!(JobsReplayDLQResponseJobProgress);
impl_wire_progress_item!(JobsGetResponseJobProgress);
impl_wire_progress_item!(JobsListDLQResponseEntriesItemProgress);
impl_wire_progress_item!(JobsListResponseEntriesItemProgress);
impl_wire_progress_item!(JobsRetryResponseJobProgress);

fn map_logs<T>(logs: &Option<Vec<JobLogEntry>>) -> Result<Option<Vec<T>>, JobsQueryError>
where
    T: WireLogItem,
{
    logs.as_ref()
        .map(|logs| {
            logs.iter()
                .map(|log| {
                    Ok(T::from_log(
                        log,
                        map_string_value(&log.level, "job log level")?,
                    ))
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()
}

fn map_progress<T>(progress: &Option<JobProgress>) -> Result<Option<T>, JobsQueryError>
where
    T: WireProgressItem,
{
    progress
        .as_ref()
        .map(|progress| {
            Ok(T::from_progress(
                progress,
                progress
                    .current
                    .map(|current| map_count(current, "job progress current"))
                    .transpose()?,
                progress
                    .total
                    .map(|total| map_count(total, "job progress total"))
                    .transpose()?,
            ))
        })
        .transpose()
}

fn map_count(value: u64, model: &'static str) -> Result<i64, JobsQueryError> {
    i64::try_from(value).map_err(|error| JobsQueryError::ConvertWireModel {
        model,
        details: error.to_string(),
    })
}

fn map_json_value<T>(input: &T, model: &'static str) -> Result<Value, JobsQueryError>
where
    T: serde::Serialize,
{
    serde_json::to_value(input).map_err(|error| JobsQueryError::ConvertWireModel {
        model,
        details: error.to_string(),
    })
}

fn map_string_value<T>(input: &T, model: &'static str) -> Result<String, JobsQueryError>
where
    T: serde::Serialize,
{
    serde_json::from_value(map_json_value(input, model)?).map_err(|error| {
        JobsQueryError::ConvertWireModel {
            model,
            details: error.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trellis::jobs::types::{JobContext, JobProgress, JobState};

    use super::*;

    fn job_with_progress(progress: JobProgress) -> Job {
        Job {
            id: "job-1".to_string(),
            context: context(),
            service: "documents".to_string(),
            job_type: "document-process".to_string(),
            state: JobState::Active,
            payload: json!({ "documentId": "doc-1" }),
            result: None,
            created_at: "2026-03-28T12:00:00.000Z".to_string(),
            updated_at: "2026-03-28T12:01:00.000Z".to_string(),
            started_at: Some("2026-03-28T12:00:30.000Z".to_string()),
            completed_at: None,
            tries: 1,
            max_tries: 5,
            last_error: None,
            deadline: None,
            progress: Some(progress),
            logs: None,
        }
    }

    fn context() -> JobContext {
        JobContext {
            request_id: "request-job-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        }
    }

    #[test]
    fn job_progress_wire_mapping_allows_message_only_progress() {
        let job = job_with_progress(JobProgress {
            step: None,
            message: Some("Scanning".to_string()),
            current: None,
            total: None,
        });

        let item = job_to_list_item(&job).expect("map job");

        let progress = item.progress.expect("progress should be present");
        assert_eq!(progress.message.as_deref(), Some("Scanning"));
        assert_eq!(progress.current, None);
        assert_eq!(progress.total, None);
    }

    #[test]
    fn job_progress_wire_mapping_preserves_step_current_and_total() {
        let job = job_with_progress(JobProgress {
            step: Some("scan".to_string()),
            message: Some("Scanning".to_string()),
            current: Some(2),
            total: Some(10),
        });

        let item = job_to_list_item(&job).expect("map job");

        let progress = item.progress.expect("progress should be present");
        assert_eq!(progress.step.as_deref(), Some("scan"));
        assert_eq!(progress.message.as_deref(), Some("Scanning"));
        assert_eq!(progress.current, Some(2));
        assert_eq!(progress.total, Some(10));
    }
}
