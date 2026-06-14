use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobContext {
    pub request_id: String,
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobState {
    Pending,
    Active,
    Retry,
    Completed,
    Failed,
    Cancelled,
    Expired,
    Skipped,
    Stale,
    Dead,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobEventType {
    Created,
    Started,
    Retry,
    Progress,
    Logged,
    Completed,
    Failed,
    Cancelled,
    Expired,
    Skipped,
    Stale,
    Heartbeat,
    #[serde(rename = "staleCompletionIgnored")]
    StaleCompletionIgnored,
    Retried,
    Dead,
    Dismissed,
}

impl JobEventType {
    pub fn as_token(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Started => "started",
            Self::Retry => "retry",
            Self::Progress => "progress",
            Self::Logged => "logged",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Expired => "expired",
            Self::Skipped => "skipped",
            Self::Stale => "stale",
            Self::Heartbeat => "heartbeat",
            Self::StaleCompletionIgnored => "staleCompletionIgnored",
            Self::Retried => "retried",
            Self::Dead => "dead",
            Self::Dismissed => "dismissed",
        }
    }
}

/// Keyed-concurrency metadata carried by lifecycle events and projections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobConcurrency {
    pub key: String,
    pub key_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lease_expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale_takeover_count: Option<u64>,
}

/// Queue-policy outcome recorded on keyed lifecycle events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobQueuePolicyOutcome {
    Accepted,
    Rejected,
    Coalesced,
    Replaced,
}

/// Queue-policy metadata carried by lifecycle events and projections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobQueuePolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<JobQueuePolicyOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replaced_job_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobLogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JobLogEntry {
    pub timestamp: String,
    pub level: JobLogLevel,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct JobProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub context: JobContext,
    pub service: String,
    #[serde(rename = "type")]
    pub job_type: String,
    pub state: JobState,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub tries: u64,
    pub max_tries: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobLogEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<JobConcurrency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_policy: Option<JobQueuePolicy>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub job_id: String,
    pub context: JobContext,
    pub service: String,
    pub job_type: String,
    pub event_type: JobEventType,
    pub state: JobState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_state: Option<JobState>,
    pub tries: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tries: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobLogEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<JobConcurrency>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_policy: Option<JobQueuePolicy>,
    pub timestamp: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerHeartbeat {
    pub service: String,
    pub job_type: String,
    pub instance_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub timestamp: String,
}
