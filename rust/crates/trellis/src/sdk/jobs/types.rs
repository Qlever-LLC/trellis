//! Shared request and response types for `trellis.jobs@v1`.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
/// Generated schema type `JobsCancelRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelRequest {
    pub id: String,
}
/// Generated schema type `JobsCancelResponse`.
/// Generated schema type `JobsCancelResponseJob`.
/// Generated schema type `JobsCancelResponseJobContext`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponseJobContext {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}
/// Generated schema type `JobsCancelResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponseJobLogsItem {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
/// Generated schema type `JobsCancelResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponseJobProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub context: JobsCancelResponseJobContext,
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
    pub state: String,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsCancelResponse {
    pub job: JobsCancelResponseJob,
}
/// Generated schema type `JobsDismissDLQRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsDismissDLQRequest {
    pub id: String,
}
/// Generated schema type `JobsDismissDLQResponse`.
/// Generated schema type `JobsDismissDLQResponseJob`.
/// Generated schema type `JobsDismissDLQResponseJobContext`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsDismissDLQResponseJobContext {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}
/// Generated schema type `JobsDismissDLQResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsDismissDLQResponseJobLogsItem {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
/// Generated schema type `JobsDismissDLQResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsDismissDLQResponseJobProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsDismissDLQResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub context: JobsDismissDLQResponseJobContext,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsDismissDLQResponseJobLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsDismissDLQResponseJobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: String,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsDismissDLQResponse {
    pub job: JobsDismissDLQResponseJob,
}
/// Generated schema type `JobsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetRequest {
    pub id: String,
}
/// Generated schema type `JobsGetResponse`.
/// Generated schema type `JobsGetResponseJob`.
/// Generated schema type `JobsGetResponseJobContext`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponseJobContext {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}
/// Generated schema type `JobsGetResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponseJobLogsItem {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
/// Generated schema type `JobsGetResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponseJobProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub context: JobsGetResponseJobContext,
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
    pub state: String,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsGetResponse {
    pub job: JobsGetResponseJob,
}
/// Generated schema type `JobsHealthResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsHealthResponse {
    pub checks: Vec<BTreeMap<String, Value>>,
    pub service: String,
    pub status: Value,
    pub timestamp: String,
}
/// Generated schema type `JobsListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}
/// Generated schema type `JobsListResponse`.
/// Generated schema type `JobsListResponseEntriesItem`.
/// Generated schema type `JobsListResponseEntriesItemContext`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponseEntriesItemContext {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}
/// Generated schema type `JobsListResponseEntriesItemLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponseEntriesItemLogsItem {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
/// Generated schema type `JobsListResponseEntriesItemProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponseEntriesItemProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponseEntriesItem {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub context: JobsListResponseEntriesItemContext,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsListResponseEntriesItemLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsListResponseEntriesItemProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: String,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListResponse {
    pub count: i64,
    pub entries: Vec<JobsListResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `JobsListDLQRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListDLQRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}
/// Generated schema type `JobsListDLQResponse`.
/// Generated schema type `JobsListDLQResponseEntriesItem`.
/// Generated schema type `JobsListDLQResponseEntriesItemContext`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListDLQResponseEntriesItemContext {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}
/// Generated schema type `JobsListDLQResponseEntriesItemLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListDLQResponseEntriesItemLogsItem {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
/// Generated schema type `JobsListDLQResponseEntriesItemProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListDLQResponseEntriesItemProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListDLQResponseEntriesItem {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub context: JobsListDLQResponseEntriesItemContext,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsListDLQResponseEntriesItemLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsListDLQResponseEntriesItemProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: String,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListDLQResponse {
    pub count: i64,
    pub entries: Vec<JobsListDLQResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `JobsListServicesRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListServicesRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}
/// Generated schema type `JobsListServicesResponse`.
/// Generated schema type `JobsListServicesResponseEntriesItem`.
/// Generated schema type `JobsListServicesResponseEntriesItemWorkersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListServicesResponseEntriesItemWorkersItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<i64>,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    #[serde(rename = "jobType")]
    pub job_type: String,
    pub service: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListServicesResponseEntriesItem {
    pub healthy: bool,
    pub name: String,
    pub workers: Vec<JobsListServicesResponseEntriesItemWorkersItem>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsListServicesResponse {
    pub count: i64,
    pub entries: Vec<JobsListServicesResponseEntriesItem>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `JobsReplayDLQRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsReplayDLQRequest {
    pub id: String,
}
/// Generated schema type `JobsReplayDLQResponse`.
/// Generated schema type `JobsReplayDLQResponseJob`.
/// Generated schema type `JobsReplayDLQResponseJobContext`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsReplayDLQResponseJobContext {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}
/// Generated schema type `JobsReplayDLQResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsReplayDLQResponseJobLogsItem {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
/// Generated schema type `JobsReplayDLQResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsReplayDLQResponseJobProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsReplayDLQResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub context: JobsReplayDLQResponseJobContext,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    pub id: String,
    #[serde(rename = "lastError")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<Vec<JobsReplayDLQResponseJobLogsItem>>,
    #[serde(rename = "maxTries")]
    pub max_tries: i64,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobsReplayDLQResponseJobProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    pub service: String,
    #[serde(rename = "startedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    pub state: String,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsReplayDLQResponse {
    pub job: JobsReplayDLQResponseJob,
}
/// Generated schema type `JobsRetryRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryRequest {
    pub id: String,
}
/// Generated schema type `JobsRetryResponse`.
/// Generated schema type `JobsRetryResponseJob`.
/// Generated schema type `JobsRetryResponseJobContext`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponseJobContext {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "traceId")]
    pub trace_id: String,
    pub traceparent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracestate: Option<String>,
}
/// Generated schema type `JobsRetryResponseJobLogsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponseJobLogsItem {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}
/// Generated schema type `JobsRetryResponseJobProgress`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponseJobProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponseJob {
    #[serde(rename = "completedAt")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub context: JobsRetryResponseJobContext,
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
    pub state: String,
    pub tries: i64,
    pub r#type: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRetryResponse {
    pub job: JobsRetryResponseJob,
}
