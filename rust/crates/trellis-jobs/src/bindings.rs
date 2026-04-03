//! Binding helpers for the jobs runtime.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;
use trellis_sdk_core::types::TrellisBindingsGetResponseBinding;

/// Resolved service-local jobs binding derived from Trellis resource bindings.
#[derive(Debug, Clone, PartialEq)]
pub struct JobsBinding {
    /// Service namespace used in job subjects.
    pub namespace: String,
    /// Optional projected jobs-state bucket used for preflight state checks.
    pub jobs_state_bucket: Option<String>,
    /// Queue bindings keyed by logical queue type.
    pub queues: BTreeMap<String, JobsQueueBinding>,
}

/// Full worker runtime binding including the work stream name.
#[derive(Debug, Clone, PartialEq)]
pub struct JobsRuntimeBinding {
    /// Service-local queue binding data.
    pub jobs: JobsBinding,
    /// Bound work stream name used for consumer creation.
    pub work_stream: String,
}

/// Resolved runtime settings for one jobs queue type.
#[derive(Debug, Clone, PartialEq)]
pub struct JobsQueueBinding {
    /// Logical queue type from the contract binding.
    pub queue_type: String,
    /// Publish prefix for lifecycle events in the jobs stream.
    pub publish_prefix: String,
    /// Work subject consumed by the worker.
    pub work_subject: String,
    /// Durable consumer name for the queue.
    pub consumer_name: String,
    /// Maximum delivery attempts before advisory-based dead-letter handling.
    pub max_deliver: u64,
    /// Redelivery backoff schedule in milliseconds.
    pub backoff_ms: Vec<u64>,
    /// Ack wait in milliseconds for the durable consumer.
    pub ack_wait_ms: u64,
    /// Optional business deadline applied to newly created jobs.
    pub default_deadline_ms: Option<u64>,
    /// Whether progress events are enabled for the queue.
    pub progress: bool,
    /// Whether log events are enabled for the queue.
    pub logs: bool,
    /// Suggested worker concurrency for the queue.
    pub concurrency: u32,
}

/// Errors returned while decoding jobs bindings from core bootstrap data.
#[derive(Debug, thiserror::Error)]
pub enum JobsBindingError {
    #[error("bindings response is missing resources.jobs")]
    MissingJobsResource,
    #[error("bindings response is missing resources.streams.jobsWork")]
    MissingWorkStream,
    #[error("invalid jobs queue binding for queue type '{queue_type}': {details}")]
    InvalidQueueBinding { queue_type: String, details: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobsQueueBindingValue {
    publish_prefix: String,
    work_subject: String,
    consumer_name: String,
    max_deliver: u64,
    backoff_ms: Vec<u64>,
    ack_wait_ms: u64,
    default_deadline_ms: Option<u64>,
    progress: bool,
    logs: bool,
    concurrency: u32,
}

#[derive(Debug)]
struct NormalizedJobsQueueBinding {
    queue_type: String,
    publish_prefix: String,
    work_subject: String,
    consumer_name: String,
    max_deliver: u64,
    backoff_ms: Vec<u64>,
    ack_wait_ms: u64,
    default_deadline_ms: Option<u64>,
    progress: bool,
    logs: bool,
    concurrency: u32,
}

/// Parse a raw jobs binding map into the handwritten runtime binding type.
pub fn parse_jobs_binding(
    namespace: &str,
    queues: &BTreeMap<String, Value>,
) -> Result<JobsBinding, JobsBindingError> {
    let normalized = queues
        .iter()
        .map(|(queue_type, value)| normalize_json_queue_binding(queue_type, value))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(build_jobs_binding(namespace.to_string(), None, normalized))
}

impl TryFrom<&TrellisBindingsGetResponseBinding> for JobsRuntimeBinding {
    type Error = JobsBindingError;

    fn try_from(binding: &TrellisBindingsGetResponseBinding) -> Result<Self, Self::Error> {
        let jobs = binding
            .resources
            .jobs
            .as_ref()
            .ok_or(JobsBindingError::MissingJobsResource)?;
        let normalized = jobs
            .queues
            .iter()
            .map(|(queue_type, queue)| normalize_core_queue_binding(queue_type, queue))
            .collect::<Result<Vec<_>, _>>()?;

        let work_stream = binding
            .resources
            .streams
            .as_ref()
            .and_then(|streams| streams.get("jobsWork"))
            .map(|stream| stream.name.clone())
            .ok_or(JobsBindingError::MissingWorkStream)?;

        Ok(Self {
            jobs: build_jobs_binding(
                jobs.namespace.clone(),
                binding
                    .resources
                    .kv
                    .as_ref()
                    .and_then(|kv| kv.get("jobsState"))
                    .map(|value| value.bucket.clone()),
                normalized,
            ),
            work_stream,
        })
    }
}

fn build_jobs_binding(
    namespace: String,
    jobs_state_bucket: Option<String>,
    queues: Vec<NormalizedJobsQueueBinding>,
) -> JobsBinding {
    JobsBinding {
        namespace,
        jobs_state_bucket,
        queues: queues
            .into_iter()
            .map(|queue| {
                let queue_type = queue.queue_type.clone();
                (queue_type, jobs_queue_binding_from_normalized(queue))
            })
            .collect(),
    }
}

fn jobs_queue_binding_from_normalized(queue: NormalizedJobsQueueBinding) -> JobsQueueBinding {
    JobsQueueBinding {
        queue_type: queue.queue_type,
        publish_prefix: queue.publish_prefix,
        work_subject: queue.work_subject,
        consumer_name: queue.consumer_name,
        max_deliver: queue.max_deliver,
        backoff_ms: queue.backoff_ms,
        ack_wait_ms: queue.ack_wait_ms,
        default_deadline_ms: queue.default_deadline_ms,
        progress: queue.progress,
        logs: queue.logs,
        concurrency: queue.concurrency,
    }
}

fn normalize_json_queue_binding(
    queue_type: &str,
    value: &Value,
) -> Result<NormalizedJobsQueueBinding, JobsBindingError> {
    let parsed: JobsQueueBindingValue = serde_json::from_value(value.clone()).map_err(|error| {
        JobsBindingError::InvalidQueueBinding {
            queue_type: queue_type.to_string(),
            details: error.to_string(),
        }
    })?;
    Ok(NormalizedJobsQueueBinding {
        queue_type: queue_type.to_string(),
        publish_prefix: parsed.publish_prefix,
        work_subject: parsed.work_subject,
        consumer_name: parsed.consumer_name,
        max_deliver: parsed.max_deliver,
        backoff_ms: parsed.backoff_ms,
        ack_wait_ms: parsed.ack_wait_ms,
        default_deadline_ms: parsed.default_deadline_ms,
        progress: parsed.progress,
        logs: parsed.logs,
        concurrency: parsed.concurrency,
    })
}

fn normalize_core_queue_binding(
    queue_type: &str,
    queue: &trellis_sdk_core::types::TrellisBindingsGetResponseBindingResourcesJobsQueuesValue,
) -> Result<NormalizedJobsQueueBinding, JobsBindingError> {
    Ok(NormalizedJobsQueueBinding {
        queue_type: queue.queue_type.clone(),
        publish_prefix: queue.publish_prefix.clone(),
        work_subject: queue.work_subject.clone(),
        consumer_name: queue.consumer_name.clone(),
        max_deliver: i64_to_u64(queue.max_deliver, queue_type, "maxDeliver")?,
        backoff_ms: queue
            .backoff_ms
            .iter()
            .copied()
            .map(|value| i64_to_u64(value, queue_type, "backoffMs"))
            .collect::<Result<Vec<_>, _>>()?,
        ack_wait_ms: i64_to_u64(queue.ack_wait_ms, queue_type, "ackWaitMs")?,
        default_deadline_ms: queue
            .default_deadline_ms
            .map(|value| i64_to_u64(value, queue_type, "defaultDeadlineMs"))
            .transpose()?,
        progress: queue.progress,
        logs: queue.logs,
        concurrency: i64_to_u32(queue.concurrency, queue_type, "concurrency")?,
    })
}

fn i64_to_u64(value: i64, queue_type: &str, field: &str) -> Result<u64, JobsBindingError> {
    if value < 0 {
        return Err(JobsBindingError::InvalidQueueBinding {
            queue_type: queue_type.to_string(),
            details: format!("{field} must be a non-negative integer"),
        });
    }
    Ok(value as u64)
}

fn i64_to_u32(value: i64, queue_type: &str, field: &str) -> Result<u32, JobsBindingError> {
    let value = i64_to_u64(value, queue_type, field)?;
    u32::try_from(value).map_err(|_| JobsBindingError::InvalidQueueBinding {
        queue_type: queue_type.to_string(),
        details: format!("{field} exceeds u32 range"),
    })
}
