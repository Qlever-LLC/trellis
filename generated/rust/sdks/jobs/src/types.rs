//! Shared request and response types for `trellis.jobs@v1`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Generated schema type `JobsCancelRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelRequest {
    pub id: String,
    #[serde(rename = "jobType")]
    pub job_type: String,
    pub service: String,
}

/// Generated schema type `JobsCancelResponse`.
/// Generated schema type `JobsCancelResponseJob`.
/// Generated schema type `JobsCancelResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponseJobLogsItem {
    pub level: Value,
    pub message: String,
    pub timestamp: String,
}

/// Generated schema type `JobsCancelResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponseJobProgress {
    pub current: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsCancelResponseJobLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsCancelResponseJobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: Value,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponse {
    pub job: JobsCancelResponseJob,
}

/// Generated schema type `JobsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetRequest {
    pub id: String,
    #[serde(rename = "jobType")]
    pub job_type: String,
    pub service: String,
}

/// Generated schema type `JobsGetResponse`.
/// Generated schema type `JobsGetResponseJob`.
/// Generated schema type `JobsGetResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponseJobLogsItem {
    pub level: Value,
    pub message: String,
    pub timestamp: String,
}

/// Generated schema type `JobsGetResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponseJobProgress {
    pub current: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsGetResponseJobLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsGetResponseJobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: Value,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job: Option<JobsGetResponseJob>,
}

/// Generated schema type `JobsHealthResponse`.
/// Generated schema type `JobsHealthResponseChecksItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsHealthResponseChecksItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "latencyMs")]
    pub latency_ms: f64,
    pub name: String,
    pub status: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsHealthResponse {
    pub checks: Vec<JobsHealthResponseChecksItem>,
    pub service: String,
    pub status: Value,
    pub timestamp: String,
}

/// Generated schema type `JobsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}

/// Generated schema type `JobsListResponse`.
/// Generated schema type `JobsListResponseJobsItem`.
/// Generated schema type `JobsListResponseJobsItemLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponseJobsItemLogsItem {
    pub level: Value,
    pub message: String,
    pub timestamp: String,
}

/// Generated schema type `JobsListResponseJobsItemProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponseJobsItemProgress {
    pub current: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponseJobsItem {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsListResponseJobsItemLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsListResponseJobsItemProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: Value,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponse {
    pub jobs: Vec<JobsListResponseJobsItem>,
}

/// Generated schema type `JobsListServicesResponse`.
/// Generated schema type `JobsListServicesResponseServicesItem`.
/// Generated schema type `JobsListServicesResponseServicesItemInstancesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListServicesResponseServicesItemInstancesItem {
    #[serde(rename = "heartbeatAt")]
    pub heartbeat_at: String,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "jobTypes")]
    pub job_types: Vec<String>,
    #[serde(rename = "registeredAt")]
    pub registered_at: String,
    pub service: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListServicesResponseServicesItem {
    pub healthy: bool,
    pub instances: Vec<JobsListServicesResponseServicesItemInstancesItem>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListServicesResponse {
    pub services: Vec<JobsListServicesResponseServicesItem>,
}

/// Generated schema type `JobsRetryRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryRequest {
    pub id: String,
    #[serde(rename = "jobType")]
    pub job_type: String,
    pub service: String,
}

/// Generated schema type `JobsRetryResponse`.
/// Generated schema type `JobsRetryResponseJob`.
/// Generated schema type `JobsRetryResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponseJobLogsItem {
    pub level: Value,
    pub message: String,
    pub timestamp: String,
}

/// Generated schema type `JobsRetryResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponseJobProgress {
    pub current: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsRetryResponseJobLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsRetryResponseJobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: Value,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponse {
    pub job: JobsRetryResponseJob,
}

