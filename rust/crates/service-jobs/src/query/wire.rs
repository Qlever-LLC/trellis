use serde::de::DeserializeOwned;
use serde_json::Value;
use trellis_rs::jobs::types::{Job, JobContext, JobLogEntry, JobProgress};
use trellis_rs::sdk::jobs::types::{
    JobsCancelResponseJob, JobsCancelResponseJobConcurrency, JobsCancelResponseJobLogsItem,
    JobsCancelResponseJobProgress, JobsCancelResponseJobQueuePolicy, JobsDismissDLQResponseJob,
    JobsDismissDLQResponseJobConcurrency, JobsDismissDLQResponseJobLogsItem,
    JobsDismissDLQResponseJobProgress, JobsDismissDLQResponseJobQueuePolicy, JobsGetResponseJob,
    JobsGetResponseJobConcurrency, JobsGetResponseJobLogsItem, JobsGetResponseJobProgress,
    JobsGetResponseJobQueuePolicy, JobsListDLQResponseEntriesItem,
    JobsListDLQResponseEntriesItemConcurrency, JobsListDLQResponseEntriesItemLogsItem,
    JobsListDLQResponseEntriesItemProgress, JobsListDLQResponseEntriesItemQueuePolicy,
    JobsListResponseEntriesItem, JobsListResponseEntriesItemConcurrency,
    JobsListResponseEntriesItemLogsItem, JobsListResponseEntriesItemProgress,
    JobsListResponseEntriesItemQueuePolicy, JobsListServicesResponseEntriesItemWorkersItem,
    JobsReplayDLQResponseJob, JobsReplayDLQResponseJobConcurrency,
    JobsReplayDLQResponseJobLogsItem, JobsReplayDLQResponseJobProgress,
    JobsReplayDLQResponseJobQueuePolicy, JobsRetryResponseJob, JobsRetryResponseJobConcurrency,
    JobsRetryResponseJobLogsItem, JobsRetryResponseJobProgress, JobsRetryResponseJobQueuePolicy,
};

use crate::storage::JobProjectionMetadata;
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
    ($fn_name:ident, $job_type:ident, $concurrency_type:ty, $queue_policy_type:ty, $log_type:ty, $progress_type:ty, $max_tries_model:literal, $state_model:literal, $tries_model:literal) => {
        pub(super) fn $fn_name(
            job: &Job,
            metadata: &JobProjectionMetadata,
        ) -> Result<$job_type, JobsQueryError> {
            Ok($job_type {
                completed_at: job.completed_at.clone(),
                context: map_context(&job.context, "job context")?,
                concurrency: map_concurrency_metadata::<$concurrency_type>(metadata)?,
                created_at: job.created_at.clone(),
                deadline: job.deadline.clone(),
                id: job.id.clone(),
                last_error: job.last_error.clone(),
                logs: map_logs::<$log_type>(&job.logs)?,
                max_tries: map_count(job.max_tries, $max_tries_model)?,
                payload: job.payload.clone(),
                progress: map_progress::<$progress_type>(&job.progress)?,
                queue_policy: map_queue_policy_metadata::<$queue_policy_type>(metadata),
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

fn map_concurrency_metadata<T>(
    metadata: &JobProjectionMetadata,
) -> Result<Option<T>, JobsQueryError>
where
    T: WireConcurrencyMetadata,
{
    metadata
        .concurrency
        .as_ref()
        .map(|concurrency| {
            Ok(T::from_concurrency_metadata(
                concurrency.heartbeat_at.clone(),
                concurrency.key.clone(),
                concurrency.key_hash.clone(),
                concurrency.lease_expires_at.clone(),
                concurrency
                    .stale_takeover_count
                    .map(|count| map_count(count, "job concurrency staleTakeoverCount"))
                    .transpose()?,
            ))
        })
        .transpose()
}

fn map_queue_policy_metadata<T>(metadata: &JobProjectionMetadata) -> Option<T>
where
    T: WireQueuePolicyMetadata,
{
    metadata.queue_policy.as_ref().map(|queue_policy| {
        T::from_queue_policy_metadata(
            queue_policy.existing_job_id.clone(),
            queue_policy.outcome.clone(),
            queue_policy.reason.clone(),
            queue_policy.replaced_job_id.clone(),
        )
    })
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
    JobsListResponseEntriesItemConcurrency,
    JobsListResponseEntriesItemQueuePolicy,
    JobsListResponseEntriesItemLogsItem,
    JobsListResponseEntriesItemProgress,
    "job list item maxTries",
    "job list item state",
    "job list item tries"
);
impl_job_to_wire!(
    job_to_dlq_item,
    JobsListDLQResponseEntriesItem,
    JobsListDLQResponseEntriesItemConcurrency,
    JobsListDLQResponseEntriesItemQueuePolicy,
    JobsListDLQResponseEntriesItemLogsItem,
    JobsListDLQResponseEntriesItemProgress,
    "job dlq list item maxTries",
    "job dlq list item state",
    "job dlq list item tries"
);
impl_job_to_wire!(
    job_to_get_item,
    JobsGetResponseJob,
    JobsGetResponseJobConcurrency,
    JobsGetResponseJobQueuePolicy,
    JobsGetResponseJobLogsItem,
    JobsGetResponseJobProgress,
    "job get response maxTries",
    "job get response state",
    "job get response tries"
);
impl_job_to_wire!(
    job_to_cancel_item,
    JobsCancelResponseJob,
    JobsCancelResponseJobConcurrency,
    JobsCancelResponseJobQueuePolicy,
    JobsCancelResponseJobLogsItem,
    JobsCancelResponseJobProgress,
    "job cancel response maxTries",
    "job cancel response state",
    "job cancel response tries"
);
impl_job_to_wire!(
    job_to_retry_item,
    JobsRetryResponseJob,
    JobsRetryResponseJobConcurrency,
    JobsRetryResponseJobQueuePolicy,
    JobsRetryResponseJobLogsItem,
    JobsRetryResponseJobProgress,
    "job retry response maxTries",
    "job retry response state",
    "job retry response tries"
);
impl_job_to_wire!(
    job_to_replay_item,
    JobsReplayDLQResponseJob,
    JobsReplayDLQResponseJobConcurrency,
    JobsReplayDLQResponseJobQueuePolicy,
    JobsReplayDLQResponseJobLogsItem,
    JobsReplayDLQResponseJobProgress,
    "job replay dlq response maxTries",
    "job replay dlq response state",
    "job replay dlq response tries"
);
impl_job_to_wire!(
    job_to_dismiss_item,
    JobsDismissDLQResponseJob,
    JobsDismissDLQResponseJobConcurrency,
    JobsDismissDLQResponseJobQueuePolicy,
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

trait WireConcurrencyMetadata {
    fn from_concurrency_metadata(
        heartbeat_at: Option<String>,
        key: String,
        key_hash: String,
        lease_expires_at: Option<String>,
        stale_takeover_count: Option<i64>,
    ) -> Self;
}

trait WireQueuePolicyMetadata {
    fn from_queue_policy_metadata(
        existing_job_id: Option<String>,
        outcome: String,
        reason: Option<String>,
        replaced_job_id: Option<String>,
    ) -> Self;
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

macro_rules! impl_wire_concurrency_metadata {
    ($type_name:ty) => {
        impl WireConcurrencyMetadata for $type_name {
            fn from_concurrency_metadata(
                heartbeat_at: Option<String>,
                key: String,
                key_hash: String,
                lease_expires_at: Option<String>,
                stale_takeover_count: Option<i64>,
            ) -> Self {
                Self {
                    heartbeat_at,
                    key,
                    key_hash,
                    lease_expires_at,
                    stale_takeover_count,
                }
            }
        }
    };
}

macro_rules! impl_wire_queue_policy_metadata {
    ($type_name:ty) => {
        impl WireQueuePolicyMetadata for $type_name {
            fn from_queue_policy_metadata(
                existing_job_id: Option<String>,
                outcome: String,
                reason: Option<String>,
                replaced_job_id: Option<String>,
            ) -> Self {
                Self {
                    existing_job_id,
                    outcome,
                    reason,
                    replaced_job_id,
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

impl_wire_concurrency_metadata!(JobsCancelResponseJobConcurrency);
impl_wire_concurrency_metadata!(JobsDismissDLQResponseJobConcurrency);
impl_wire_concurrency_metadata!(JobsReplayDLQResponseJobConcurrency);
impl_wire_concurrency_metadata!(JobsGetResponseJobConcurrency);
impl_wire_concurrency_metadata!(JobsListDLQResponseEntriesItemConcurrency);
impl_wire_concurrency_metadata!(JobsListResponseEntriesItemConcurrency);
impl_wire_concurrency_metadata!(JobsRetryResponseJobConcurrency);

impl_wire_queue_policy_metadata!(JobsCancelResponseJobQueuePolicy);
impl_wire_queue_policy_metadata!(JobsDismissDLQResponseJobQueuePolicy);
impl_wire_queue_policy_metadata!(JobsReplayDLQResponseJobQueuePolicy);
impl_wire_queue_policy_metadata!(JobsGetResponseJobQueuePolicy);
impl_wire_queue_policy_metadata!(JobsListDLQResponseEntriesItemQueuePolicy);
impl_wire_queue_policy_metadata!(JobsListResponseEntriesItemQueuePolicy);
impl_wire_queue_policy_metadata!(JobsRetryResponseJobQueuePolicy);

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
    use trellis_rs::jobs::types::{JobContext, JobProgress, JobState};

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
            concurrency: None,
            queue_policy: None,
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

        let item = job_to_list_item(&job, &JobProjectionMetadata::default()).expect("map job");

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

        let item = job_to_list_item(&job, &JobProjectionMetadata::default()).expect("map job");

        let progress = item.progress.expect("progress should be present");
        assert_eq!(progress.step.as_deref(), Some("scan"));
        assert_eq!(progress.message.as_deref(), Some("Scanning"));
        assert_eq!(progress.current, Some(2));
        assert_eq!(progress.total, Some(10));
    }
}
