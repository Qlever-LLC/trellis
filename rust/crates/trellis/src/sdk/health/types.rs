//! Shared request and response types for `trellis.health@v1`.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
/// Generated schema type `HealthHeartbeatEvent`.
/// Generated schema type `HealthHeartbeatEventChecksItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HealthHeartbeatEventChecksItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<BTreeMap<String, Value>>,
    #[serde(rename = "latencyMs")]
    pub latency_ms: f64,
    pub name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
/// Generated schema type `HealthHeartbeatEventHeader`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HealthHeartbeatEventHeader {
    pub id: String,
    pub time: String,
}
/// Generated schema type `HealthHeartbeatEventService`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HealthHeartbeatEventService {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info: Option<BTreeMap<String, Value>>,
    #[serde(rename = "instanceId")]
    pub instance_id: String,
    pub kind: String,
    pub name: String,
    #[serde(rename = "publishIntervalMs")]
    pub publish_interval_ms: i64,
    pub runtime: String,
    #[serde(rename = "runtimeVersion")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HealthHeartbeatEvent {
    pub checks: Vec<HealthHeartbeatEventChecksItem>,
    pub header: HealthHeartbeatEventHeader,
    pub service: HealthHeartbeatEventService,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
