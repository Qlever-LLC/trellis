//! Shared request and response types for `trellis.state@v1`.
use serde::{Deserialize, Serialize};
use serde_json::Value;
/// Generated schema type `StateAdminDeleteRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateAdminDeleteRequest(pub Value);
/// Generated schema type `StateAdminDeleteResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateAdminDeleteResponse {
    pub deleted: bool,
}
/// Generated schema type `StateAdminGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateAdminGetRequest(pub Value);
/// Generated schema type `StateAdminGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateAdminGetResponse(pub Value);
/// Generated schema type `StateAdminListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateAdminListRequest(pub Value);
/// Generated schema type `StateAdminListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateAdminListResponse {
    pub count: i64,
    pub entries: Vec<Value>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `StateDeleteRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateDeleteRequest {
    #[serde(rename = "expectedRevision")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub store: String,
}
/// Generated schema type `StateDeleteResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateDeleteResponse {
    pub deleted: bool,
}
/// Generated schema type `StateGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateGetRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub store: String,
}
/// Generated schema type `StateGetResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateGetResponse(pub Value);
/// Generated schema type `StateListRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateListRequest {
    pub limit: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    pub store: String,
}
/// Generated schema type `StateListResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StateListResponse {
    pub count: i64,
    pub entries: Vec<Value>,
    pub limit: i64,
    #[serde(rename = "nextOffset")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
    pub offset: i64,
}
/// Generated schema type `StatePutRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StatePutRequest {
    #[serde(rename = "expectedRevision")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub store: String,
    #[serde(rename = "ttlMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<i64>,
    pub value: Value,
}
/// Generated schema type `StatePutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StatePutResponse(pub Value);
