//! Shared request and response types for `trellis.core@v1`.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
/// Generated schema type `TrellisBindingsGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetRequest {
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}
/// Generated schema type `TrellisBindingsGetResponse`.
/// Generated schema type `TrellisBindingsGetResponseBinding`.
/// Generated schema type `TrellisBindingsGetResponseBindingResources`.
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesEventConsumersValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesEventConsumersValue {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    pub concurrency: i64,
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    #[serde(rename = "filterSubjects")]
    pub filter_subjects: Vec<String>,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    pub ordering: String,
    pub replay: String,
    pub stream: String,
}
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesJobs`.
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesJobsQueuesValue`.
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesJobsQueuesValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesJobsQueuesValuePayload {
    pub schema: String,
}
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesJobsQueuesValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesJobsQueuesValueResult {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesJobsQueuesValue {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    pub concurrency: i64,
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    pub dlq: bool,
    pub logs: bool,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    pub payload: TrellisBindingsGetResponseBindingResourcesJobsQueuesValuePayload,
    pub progress: bool,
    #[serde(rename = "publishPrefix")]
    pub publish_prefix: String,
    #[serde(rename = "queueType")]
    pub queue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<TrellisBindingsGetResponseBindingResourcesJobsQueuesValueResult>,
    #[serde(rename = "workSubject")]
    pub work_subject: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesJobs {
    pub namespace: String,
    pub queues: BTreeMap<String, TrellisBindingsGetResponseBindingResourcesJobsQueuesValue>,
    #[serde(rename = "workStream")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_stream: Option<String>,
}
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesKvValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesKvValue {
    pub bucket: String,
    pub history: i64,
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
/// Generated schema type `TrellisBindingsGetResponseBindingResourcesStoreValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResourcesStoreValue {
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    pub name: String,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBindingResources {
    #[serde(rename = "eventConsumers")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_consumers:
        Option<BTreeMap<String, TrellisBindingsGetResponseBindingResourcesEventConsumersValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<TrellisBindingsGetResponseBindingResourcesJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, TrellisBindingsGetResponseBindingResourcesKvValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<BTreeMap<String, TrellisBindingsGetResponseBindingResourcesStoreValue>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseBinding {
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub digest: String,
    pub resources: TrellisBindingsGetResponseBindingResources,
}
/// Generated schema type `TrellisBindingsGetResponseEventConsumersValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponseEventConsumersValue {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: i64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<i64>,
    pub concurrency: i64,
    #[serde(rename = "consumerName")]
    pub consumer_name: String,
    #[serde(rename = "filterSubjects")]
    pub filter_subjects: Vec<String>,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: i64,
    pub ordering: String,
    pub replay: String,
    pub stream: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisBindingsGetResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding: Option<TrellisBindingsGetResponseBinding>,
    #[serde(rename = "eventConsumers")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_consumers: Option<BTreeMap<String, TrellisBindingsGetResponseEventConsumersValue>>,
}
/// Generated schema type `TrellisCatalogResponse`.
/// Generated schema type `TrellisCatalogResponseCatalog`.
/// Generated schema type `TrellisCatalogResponseCatalogContractsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponseCatalogContractsItem {
    pub description: String,
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
}
/// Generated schema type `TrellisCatalogResponseCatalogIssuesItem`.
/// Generated schema type `TrellisCatalogResponseCatalogIssuesItemActionsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponseCatalogIssuesItemActionsItem {
    pub action: String,
    #[serde(rename = "deploymentIds")]
    pub deployment_ids: Vec<String>,
    pub description: String,
    pub digests: Vec<String>,
    pub label: String,
    pub risk: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponseCatalogIssuesItem {
    pub actions: Vec<TrellisCatalogResponseCatalogIssuesItemActionsItem>,
    #[serde(rename = "conflictingDeploymentIds")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflicting_deployment_ids: Option<Vec<String>>,
    #[serde(rename = "conflictingDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflicting_digest: Option<String>,
    #[serde(rename = "conflictingDigests")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflicting_digests: Option<Vec<String>>,
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(rename = "deploymentIds")]
    pub deployment_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(rename = "effectiveDeploymentIds")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_deployment_ids: Option<Vec<String>>,
    #[serde(rename = "effectiveDigests")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_digests: Option<Vec<String>>,
    #[serde(rename = "issueId")]
    pub issue_id: String,
    pub kind: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponseCatalog {
    pub contracts: Vec<TrellisCatalogResponseCatalogContractsItem>,
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issues: Option<Vec<TrellisCatalogResponseCatalogIssuesItem>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisCatalogResponse {
    pub catalog: TrellisCatalogResponseCatalog,
}
/// Generated schema type `TrellisContractGetRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetRequest {
    pub digest: String,
}
/// Generated schema type `TrellisContractGetResponse`.
/// Generated schema type `TrellisContractGetResponseContract`.
/// Generated schema type `TrellisContractGetResponseContractDocs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractDocs {
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
/// Generated schema type `TrellisContractGetResponseContractExports`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractExports {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schemas: Option<Vec<String>>,
}
/// Generated schema type `TrellisContractGetResponseContractJobsValue`.
/// Generated schema type `TrellisContractGetResponseContractJobsValueDocs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractJobsValueDocs {
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
/// Generated schema type `TrellisContractGetResponseContractJobsValuePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractJobsValuePayload {
    pub schema: String,
}
/// Generated schema type `TrellisContractGetResponseContractJobsValueResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractJobsValueResult {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractJobsValue {
    #[serde(rename = "ackWaitMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ack_wait_ms: Option<i64>,
    #[serde(rename = "backoffMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backoff_ms: Option<Vec<i64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concurrency: Option<i64>,
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dlq: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<TrellisContractGetResponseContractJobsValueDocs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logs: Option<bool>,
    #[serde(rename = "maxDeliver")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_deliver: Option<i64>,
    pub payload: TrellisContractGetResponseContractJobsValuePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<TrellisContractGetResponseContractJobsValueResult>,
}
/// Generated schema type `TrellisContractGetResponseContractResources`.
/// Generated schema type `TrellisContractGetResponseContractResourcesKvValue`.
/// Generated schema type `TrellisContractGetResponseContractResourcesKvValueDocs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResourcesKvValueDocs {
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
/// Generated schema type `TrellisContractGetResponseContractResourcesKvValueSchema`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResourcesKvValueSchema {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResourcesKvValue {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<TrellisContractGetResponseContractResourcesKvValueDocs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history: Option<i64>,
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<i64>,
    pub purpose: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    pub schema: TrellisContractGetResponseContractResourcesKvValueSchema,
    #[serde(rename = "ttlMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<i64>,
}
/// Generated schema type `TrellisContractGetResponseContractResourcesStoreValue`.
/// Generated schema type `TrellisContractGetResponseContractResourcesStoreValueDocs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResourcesStoreValueDocs {
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResourcesStoreValue {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<TrellisContractGetResponseContractResourcesStoreValueDocs>,
    #[serde(rename = "maxObjectBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_object_bytes: Option<i64>,
    #[serde(rename = "maxTotalBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_total_bytes: Option<i64>,
    pub purpose: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(rename = "ttlMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_ms: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, TrellisContractGetResponseContractResourcesKvValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<BTreeMap<String, TrellisContractGetResponseContractResourcesStoreValue>>,
}
/// Generated schema type `TrellisContractGetResponseContractStateValue`.
/// Generated schema type `TrellisContractGetResponseContractStateValueAcceptedVersionsValue`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractStateValueAcceptedVersionsValue {
    pub schema: String,
}
/// Generated schema type `TrellisContractGetResponseContractStateValueDocs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractStateValueDocs {
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}
/// Generated schema type `TrellisContractGetResponseContractStateValueSchema`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractStateValueSchema {
    pub schema: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContractStateValue {
    #[serde(rename = "acceptedVersions")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_versions:
        Option<BTreeMap<String, TrellisContractGetResponseContractStateValueAcceptedVersionsValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<TrellisContractGetResponseContractStateValueDocs>,
    pub kind: String,
    pub schema: TrellisContractGetResponseContractStateValueSchema,
    #[serde(rename = "stateVersion")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_version: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponseContract {
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<TrellisContractGetResponseContractDocs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<BTreeMap<String, BTreeMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<BTreeMap<String, BTreeMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exports: Option<TrellisContractGetResponseContractExports>,
    pub format: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<BTreeMap<String, TrellisContractGetResponseContractJobsValue>>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operations: Option<BTreeMap<String, BTreeMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<TrellisContractGetResponseContractResources>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc: Option<BTreeMap<String, BTreeMap<String, Value>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schemas: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<BTreeMap<String, TrellisContractGetResponseContractStateValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uses: Option<BTreeMap<String, BTreeMap<String, Value>>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisContractGetResponse {
    pub contract: TrellisContractGetResponseContract,
}
/// Generated schema type `TrellisSurfaceStatusRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisSurfaceStatusRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub kind: String,
    pub surface: String,
}
/// Generated schema type `TrellisSurfaceStatusResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrellisSurfaceStatusResponse {
    pub status: Value,
}
