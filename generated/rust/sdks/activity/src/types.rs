//! Shared request and response types for `trellis.activity@v1`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Generated schema type `ActivityGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityGetRequest {
    pub id: String,
}

/// Generated schema type `ActivityGetResponse`.
/// Generated schema type `ActivityGetResponseEntry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityGetResponseEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    pub id: String,
    pub kind: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    #[serde(rename = "occurredAt")]
    pub occurred_at: String,
    #[serde(rename = "principalId")]
    pub principal_id: String,
    #[serde(rename = "principalLabel")]
    pub principal_label: String,
    #[serde(rename = "principalOrigin")]
    pub principal_origin: String,
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    pub summary: String,
    #[serde(rename = "userNkey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_nkey: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityGetResponse {
    pub entry: ActivityGetResponseEntry,
}

/// Generated schema type `ActivityHealthResponse`.
/// Generated schema type `ActivityHealthResponseChecksItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityHealthResponseChecksItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "latencyMs")]
    pub latency_ms: f64,
    pub name: String,
    pub status: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityHealthResponse {
    pub checks: Vec<ActivityHealthResponseChecksItem>,
    pub service: String,
    pub status: Value,
    pub timestamp: String,
}

/// Generated schema type `ActivityListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityListRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
}

/// Generated schema type `ActivityListResponse`.
/// Generated schema type `ActivityListResponseEntriesItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityListResponseEntriesItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    pub id: String,
    pub kind: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    #[serde(rename = "occurredAt")]
    pub occurred_at: String,
    #[serde(rename = "principalId")]
    pub principal_id: String,
    #[serde(rename = "principalLabel")]
    pub principal_label: String,
    #[serde(rename = "principalOrigin")]
    pub principal_origin: String,
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    pub summary: String,
    #[serde(rename = "userNkey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_nkey: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityListResponse {
    pub entries: Vec<ActivityListResponseEntriesItem>,
}

/// Generated schema type `ActivityRecordedEvent`.
/// Generated schema type `ActivityRecordedEventHeader`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityRecordedEventHeader {
    pub id: String,
    pub time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityRecordedEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    pub header: ActivityRecordedEventHeader,
    pub id: String,
    pub kind: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
    #[serde(rename = "occurredAt")]
    pub occurred_at: String,
    #[serde(rename = "principalId")]
    pub principal_id: String,
    #[serde(rename = "principalLabel")]
    pub principal_label: String,
    #[serde(rename = "principalOrigin")]
    pub principal_origin: String,
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    pub summary: String,
    #[serde(rename = "userNkey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_nkey: Option<String>,
}

