//! Shared request and response types for `trellis.auth@v1`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Generated schema type `AuthGetInstalledContractRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractRequest {
    pub digest: String,
}

/// Generated schema type `AuthGetInstalledContractResponse`.
/// Generated schema type `AuthGetInstalledContractResponseContract`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysis`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisEvents`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisEventsEventsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisEventsEventsItem {
    pub key: String,
    #[serde(rename = "publishCapabilities")]
    pub publish_capabilities: Vec<String>,
    pub subject: String,
    #[serde(rename = "subscribeCapabilities")]
    pub subscribe_capabilities: Vec<String>,
    #[serde(rename = "wildcardSubject")]
    pub wildcard_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisEvents {
    pub events: Vec<AuthGetInstalledContractResponseContractAnalysisEventsEventsItem>,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisNats`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisNatsPublishItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisNatsPublishItem {
    pub kind: String,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    pub subject: String,
    #[serde(rename = "wildcardSubject")]
    pub wildcard_subject: String,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisNatsSubscribeItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisNatsSubscribeItem {
    pub kind: String,
    #[serde(rename = "requiredCapabilities")]
    pub required_capabilities: Vec<String>,
    pub subject: String,
    #[serde(rename = "wildcardSubject")]
    pub wildcard_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisNats {
    pub publish: Vec<AuthGetInstalledContractResponseContractAnalysisNatsPublishItem>,
    pub subscribe: Vec<AuthGetInstalledContractResponseContractAnalysisNatsSubscribeItem>,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisResources`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisResourcesJobsItem`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisResourcesJobsItemPayload`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisResourcesJobsItemPayload {
    pub schema: String,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisResourcesJobsItemResult`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisResourcesJobsItemResult {
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisResourcesJobsItem {
    #[serde(rename = "ackWaitMs")]
    pub ack_wait_ms: f64,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: Vec<f64>,
    pub concurrency: f64,
    #[serde(rename = "defaultDeadlineMs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_deadline_ms: Option<f64>,
    pub dlq: bool,
    pub logs: bool,
    #[serde(rename = "maxDeliver")]
    pub max_deliver: f64,
    pub payload: AuthGetInstalledContractResponseContractAnalysisResourcesJobsItemPayload,
    pub progress: bool,
    #[serde(rename = "queueType")]
    pub queue_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<AuthGetInstalledContractResponseContractAnalysisResourcesJobsItemResult>,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisResourcesKvItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisResourcesKvItem {
    pub alias: String,
    pub history: f64,
    #[serde(rename = "maxValueBytes")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_value_bytes: Option<f64>,
    pub purpose: String,
    pub required: bool,
    #[serde(rename = "ttlMs")]
    pub ttl_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisResources {
    pub jobs: Vec<AuthGetInstalledContractResponseContractAnalysisResourcesJobsItem>,
    pub kv: Vec<AuthGetInstalledContractResponseContractAnalysisResourcesKvItem>,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisRpc`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisRpcMethodsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisRpcMethodsItem {
    #[serde(rename = "callerCapabilities")]
    pub caller_capabilities: Vec<String>,
    pub key: String,
    pub subject: String,
    #[serde(rename = "wildcardSubject")]
    pub wildcard_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisRpc {
    pub methods: Vec<AuthGetInstalledContractResponseContractAnalysisRpcMethodsItem>,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisSubjects`.
/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisSubjectsSubjectsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisSubjectsSubjectsItem {
    pub key: String,
    #[serde(rename = "publishCapabilities")]
    pub publish_capabilities: Vec<String>,
    pub subject: String,
    #[serde(rename = "subscribeCapabilities")]
    pub subscribe_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisSubjects {
    pub subjects: Vec<AuthGetInstalledContractResponseContractAnalysisSubjectsSubjectsItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysis {
    pub events: AuthGetInstalledContractResponseContractAnalysisEvents,
    pub namespaces: Vec<String>,
    pub nats: AuthGetInstalledContractResponseContractAnalysisNats,
    pub resources: AuthGetInstalledContractResponseContractAnalysisResources,
    pub rpc: AuthGetInstalledContractResponseContractAnalysisRpc,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subjects: Option<AuthGetInstalledContractResponseContractAnalysisSubjects>,
}

/// Generated schema type `AuthGetInstalledContractResponseContractAnalysisSummary`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractAnalysisSummary {
    pub events: f64,
    #[serde(rename = "jobsQueues")]
    pub jobs_queues: f64,
    #[serde(rename = "kvResources")]
    pub kv_resources: f64,
    pub namespaces: Vec<String>,
    #[serde(rename = "natsPublish")]
    pub nats_publish: f64,
    #[serde(rename = "natsSubscribe")]
    pub nats_subscribe: f64,
    #[serde(rename = "rpcMethods")]
    pub rpc_methods: f64,
}

/// Generated schema type `AuthGetInstalledContractResponseContractResourceBindings`.
/// Generated schema type `AuthGetInstalledContractResponseContractResourceBindingsJobs`.
/// Generated schema type `AuthGetInstalledContractResponseContractResourceBindingsJobsRegistry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractResourceBindingsJobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<AuthGetInstalledContractResponseContractResourceBindingsJobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthGetInstalledContractResponseContractResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

/// Generated schema type `AuthGetInstalledContractResponseContractResources`.
/// Generated schema type `AuthGetInstalledContractResponseContractResourcesJobs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractResourcesJobs {
    pub queues: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContractResources {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthGetInstalledContractResponseContractResourcesJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContract {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis: Option<AuthGetInstalledContractResponseContractAnalysis>,
    #[serde(rename = "analysisSummary")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_summary: Option<AuthGetInstalledContractResponseContractAnalysisSummary>,
    pub contract: BTreeMap<String, Value>,
    pub description: String,
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
    #[serde(rename = "installedAt")]
    pub installed_at: String,
    pub kind: String,
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthGetInstalledContractResponseContractResourceBindings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<AuthGetInstalledContractResponseContractResources>,
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponse {
    pub contract: AuthGetInstalledContractResponseContract,
}

/// Generated schema type `AuthHealthResponse`.
/// Generated schema type `AuthHealthResponseChecksItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthHealthResponseChecksItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "latencyMs")]
    pub latency_ms: f64,
    pub name: String,
    pub status: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthHealthResponse {
    pub checks: Vec<AuthHealthResponseChecksItem>,
    pub service: String,
    pub status: Value,
    pub timestamp: String,
}

/// Generated schema type `AuthInstallServiceRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthInstallServiceRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    pub contract: BTreeMap<String, Value>,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub namespaces: Vec<String>,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}

/// Generated schema type `AuthInstallServiceResponse`.
/// Generated schema type `AuthInstallServiceResponseResourceBindings`.
/// Generated schema type `AuthInstallServiceResponseResourceBindingsJobs`.
/// Generated schema type `AuthInstallServiceResponseResourceBindingsJobsRegistry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthInstallServiceResponseResourceBindingsJobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthInstallServiceResponseResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<AuthInstallServiceResponseResourceBindingsJobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthInstallServiceResponseResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthInstallServiceResponseResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthInstallServiceResponse {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "resourceBindings")]
    pub resource_bindings: AuthInstallServiceResponseResourceBindings,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub success: bool,
}

/// Generated schema type `AuthKickConnectionRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthKickConnectionRequest {
    #[serde(rename = "userNkey")]
    pub user_nkey: String,
}

/// Generated schema type `AuthKickConnectionResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthKickConnectionResponse {
    pub success: bool,
}

/// Generated schema type `AuthListApprovalsRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListApprovalsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

/// Generated schema type `AuthListApprovalsResponse`.
/// Generated schema type `AuthListApprovalsResponseApprovalsItem`.
/// Generated schema type `AuthListApprovalsResponseApprovalsItemApproval`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListApprovalsResponseApprovalsItemApproval {
    pub capabilities: Vec<String>,
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListApprovalsResponseApprovalsItem {
    pub answer: Value,
    #[serde(rename = "answeredAt")]
    pub answered_at: String,
    pub approval: AuthListApprovalsResponseApprovalsItemApproval,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListApprovalsResponse {
    pub approvals: Vec<AuthListApprovalsResponseApprovalsItem>,
}

/// Generated schema type `AuthListConnectionsRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListConnectionsRequest {
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

/// Generated schema type `AuthListConnectionsResponse`.
/// Generated schema type `AuthListConnectionsResponseConnectionsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListConnectionsResponseConnectionsItem {
    #[serde(rename = "clientId")]
    pub client_id: f64,
    #[serde(rename = "connectedAt")]
    pub connected_at: String,
    pub key: String,
    #[serde(rename = "serverId")]
    pub server_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListConnectionsResponse {
    pub connections: Vec<AuthListConnectionsResponseConnectionsItem>,
}

/// Generated schema type `AuthListInstalledContractsRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListInstalledContractsRequest {
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
}

/// Generated schema type `AuthListInstalledContractsResponse`.
/// Generated schema type `AuthListInstalledContractsResponseContractsItem`.
/// Generated schema type `AuthListInstalledContractsResponseContractsItemAnalysisSummary`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListInstalledContractsResponseContractsItemAnalysisSummary {
    pub events: f64,
    #[serde(rename = "jobsQueues")]
    pub jobs_queues: f64,
    #[serde(rename = "kvResources")]
    pub kv_resources: f64,
    pub namespaces: Vec<String>,
    #[serde(rename = "natsPublish")]
    pub nats_publish: f64,
    #[serde(rename = "natsSubscribe")]
    pub nats_subscribe: f64,
    #[serde(rename = "rpcMethods")]
    pub rpc_methods: f64,
}

/// Generated schema type `AuthListInstalledContractsResponseContractsItemResourceBindings`.
/// Generated schema type `AuthListInstalledContractsResponseContractsItemResourceBindingsJobs`.
/// Generated schema type `AuthListInstalledContractsResponseContractsItemResourceBindingsJobsRegistry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListInstalledContractsResponseContractsItemResourceBindingsJobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListInstalledContractsResponseContractsItemResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry:
        Option<AuthListInstalledContractsResponseContractsItemResourceBindingsJobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListInstalledContractsResponseContractsItemResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthListInstalledContractsResponseContractsItemResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListInstalledContractsResponseContractsItem {
    #[serde(rename = "analysisSummary")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_summary: Option<AuthListInstalledContractsResponseContractsItemAnalysisSummary>,
    pub description: String,
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub id: String,
    #[serde(rename = "installedAt")]
    pub installed_at: String,
    pub kind: String,
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthListInstalledContractsResponseContractsItemResourceBindings>,
    #[serde(rename = "sessionKey")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListInstalledContractsResponse {
    pub contracts: Vec<AuthListInstalledContractsResponseContractsItem>,
}

/// Generated schema type `AuthListServicesResponse`.
/// Generated schema type `AuthListServicesResponseServicesItem`.
/// Generated schema type `AuthListServicesResponseServicesItemResourceBindings`.
/// Generated schema type `AuthListServicesResponseServicesItemResourceBindingsJobs`.
/// Generated schema type `AuthListServicesResponseServicesItemResourceBindingsJobsRegistry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListServicesResponseServicesItemResourceBindingsJobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListServicesResponseServicesItemResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<AuthListServicesResponseServicesItemResourceBindingsJobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListServicesResponseServicesItemResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthListServicesResponseServicesItemResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListServicesResponseServicesItem {
    pub active: bool,
    pub capabilities: Vec<String>,
    #[serde(rename = "contractDigest")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_digest: Option<String>,
    #[serde(rename = "contractId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_id: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub description: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub namespaces: Vec<String>,
    #[serde(rename = "resourceBindings")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_bindings: Option<AuthListServicesResponseServicesItemResourceBindings>,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListServicesResponse {
    pub services: Vec<AuthListServicesResponseServicesItem>,
}

/// Generated schema type `AuthListSessionsRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListSessionsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

/// Generated schema type `AuthListSessionsResponse`.
/// Generated schema type `AuthListSessionsResponseSessionsItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListSessionsResponseSessionsItem {
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub key: String,
    #[serde(rename = "lastAuth")]
    pub last_auth: String,
    pub r#type: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListSessionsResponse {
    pub sessions: Vec<AuthListSessionsResponseSessionsItem>,
}

/// Generated schema type `AuthListUsersResponse`.
/// Generated schema type `AuthListUsersResponseUsersItem`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListUsersResponseUsersItem {
    pub active: bool,
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthListUsersResponse {
    pub users: Vec<AuthListUsersResponseUsersItem>,
}

/// Generated schema type `AuthLogoutResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthLogoutResponse {
    pub success: bool,
}

/// Generated schema type `AuthMeResponse`.
/// Generated schema type `AuthMeResponseUser`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthMeResponseUser {
    pub active: bool,
    pub capabilities: Vec<String>,
    pub email: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(rename = "lastLogin")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_login: Option<String>,
    pub name: String,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthMeResponse {
    pub user: AuthMeResponseUser,
}

/// Generated schema type `AuthRenewBindingTokenResponse`.
/// Generated schema type `AuthRenewBindingTokenResponseSentinel`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRenewBindingTokenResponseSentinel {
    pub jwt: String,
    pub seed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRenewBindingTokenResponse {
    #[serde(rename = "bindingToken")]
    pub binding_token: String,
    pub expires: String,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    #[serde(rename = "natsServers")]
    pub nats_servers: Vec<String>,
    pub sentinel: AuthRenewBindingTokenResponseSentinel,
    pub status: String,
}

/// Generated schema type `AuthRevokeApprovalRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRevokeApprovalRequest {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

/// Generated schema type `AuthRevokeApprovalResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRevokeApprovalResponse {
    pub success: bool,
}

/// Generated schema type `AuthRevokeSessionRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRevokeSessionRequest {
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}

/// Generated schema type `AuthRevokeSessionResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthRevokeSessionResponse {
    pub success: bool,
}

/// Generated schema type `AuthUpdateUserRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpdateUserRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    pub id: String,
    pub origin: String,
}

/// Generated schema type `AuthUpdateUserResponse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpdateUserResponse {
    pub success: bool,
}

/// Generated schema type `AuthUpgradeServiceContractRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpgradeServiceContractRequest {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}

/// Generated schema type `AuthUpgradeServiceContractResponse`.
/// Generated schema type `AuthUpgradeServiceContractResponseResourceBindings`.
/// Generated schema type `AuthUpgradeServiceContractResponseResourceBindingsJobs`.
/// Generated schema type `AuthUpgradeServiceContractResponseResourceBindingsJobsRegistry`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpgradeServiceContractResponseResourceBindingsJobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpgradeServiceContractResponseResourceBindingsJobs {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<AuthUpgradeServiceContractResponseResourceBindingsJobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpgradeServiceContractResponseResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<AuthUpgradeServiceContractResponseResourceBindingsJobs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpgradeServiceContractResponse {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "resourceBindings")]
    pub resource_bindings: AuthUpgradeServiceContractResponseResourceBindings,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub success: bool,
}

/// Generated schema type `AuthValidateRequestRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthValidateRequestRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(rename = "payloadHash")]
    pub payload_hash: String,
    pub proof: String,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub subject: String,
}

/// Generated schema type `AuthValidateRequestResponse`.
/// Generated schema type `AuthValidateRequestResponseUser`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthValidateRequestResponseUser {
    pub active: bool,
    pub capabilities: Vec<String>,
    pub email: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(rename = "lastLogin")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_login: Option<String>,
    pub name: String,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthValidateRequestResponse {
    pub allowed: bool,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    pub user: AuthValidateRequestResponseUser,
}

/// Generated schema type `AuthConnectEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectEvent(pub Value);

/// Generated schema type `AuthConnectionKickedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthConnectionKickedEvent(pub Value);

/// Generated schema type `AuthDisconnectEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthDisconnectEvent(pub Value);

/// Generated schema type `AuthSessionRevokedEvent`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthSessionRevokedEvent(pub Value);
