use serde_json::Value;
use trellis_jobs::types::{Job, JobLogEntry, JobProgress};
use trellis_sdk_jobs::types::{
    JobsCancelResponseJob, JobsCancelResponseJobLogsItem, JobsCancelResponseJobProgress,
    JobsGetResponseJob, JobsGetResponseJobLogsItem, JobsGetResponseJobProgress,
    JobsListDLQResponseJobsItem, JobsListDLQResponseJobsItemLogsItem,
    JobsListDLQResponseJobsItemProgress, JobsListResponseJobsItem,
    JobsListResponseJobsItemLogsItem, JobsListResponseJobsItemProgress,
    JobsListServicesResponseServicesItemWorkersItem, JobsReplayDLQResponseJob,
    JobsReplayDLQResponseJobLogsItem, JobsReplayDLQResponseJobProgress, JobsRetryResponseJob,
    JobsRetryResponseJobLogsItem, JobsRetryResponseJobProgress,
};

use crate::worker_presence::WorkerPresenceRecord;

use super::JobsQueryError;

pub(super) fn worker_presence_to_wire(
    worker: &WorkerPresenceRecord,
) -> JobsListServicesResponseServicesItemWorkersItem {
    JobsListServicesResponseServicesItemWorkersItem {
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
                state: map_json_value(&job.state, $state_model)?,
                tries: map_count(job.tries, $tries_model)?,
                r#type: job.job_type.clone(),
                updated_at: job.updated_at.clone(),
            })
        }
    };
}

impl_job_to_wire!(
    job_to_list_item,
    JobsListResponseJobsItem,
    JobsListResponseJobsItemLogsItem,
    JobsListResponseJobsItemProgress,
    "job list item maxTries",
    "job list item state",
    "job list item tries"
);
impl_job_to_wire!(
    job_to_dlq_item,
    JobsListDLQResponseJobsItem,
    JobsListDLQResponseJobsItemLogsItem,
    JobsListDLQResponseJobsItemProgress,
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
    JobsReplayDLQResponseJob,
    JobsReplayDLQResponseJobLogsItem,
    JobsReplayDLQResponseJobProgress,
    "job dismiss dlq response maxTries",
    "job dismiss dlq response state",
    "job dismiss dlq response tries"
);

trait WireLogItem {
    fn from_log(log: &JobLogEntry, level: Value) -> Self;
}

trait WireProgressItem {
    fn from_progress(progress: &JobProgress, current: i64, total: i64) -> Self;
}

macro_rules! impl_wire_log_item {
    ($type_name:ty) => {
        impl WireLogItem for $type_name {
            fn from_log(log: &JobLogEntry, level: Value) -> Self {
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
            fn from_progress(progress: &JobProgress, current: i64, total: i64) -> Self {
                Self {
                    current,
                    message: progress.message.clone(),
                    total,
                }
            }
        }
    };
}

impl_wire_log_item!(JobsCancelResponseJobLogsItem);
impl_wire_log_item!(JobsReplayDLQResponseJobLogsItem);
impl_wire_log_item!(JobsGetResponseJobLogsItem);
impl_wire_log_item!(JobsListDLQResponseJobsItemLogsItem);
impl_wire_log_item!(JobsListResponseJobsItemLogsItem);
impl_wire_log_item!(JobsRetryResponseJobLogsItem);

impl_wire_progress_item!(JobsCancelResponseJobProgress);
impl_wire_progress_item!(JobsReplayDLQResponseJobProgress);
impl_wire_progress_item!(JobsGetResponseJobProgress);
impl_wire_progress_item!(JobsListDLQResponseJobsItemProgress);
impl_wire_progress_item!(JobsListResponseJobsItemProgress);
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
                        map_json_value(&log.level, "job log level")?,
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
            let current = progress
                .current
                .ok_or_else(|| JobsQueryError::ConvertWireModel {
                    model: "job progress current",
                    details: "missing required field".to_string(),
                })?;
            let total = progress
                .total
                .ok_or_else(|| JobsQueryError::ConvertWireModel {
                    model: "job progress total",
                    details: "missing required field".to_string(),
                })?;
            Ok(T::from_progress(
                progress,
                map_count(current, "job progress current")?,
                map_count(total, "job progress total")?,
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
