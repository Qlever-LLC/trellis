use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JobsBindings {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<JobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<JobsBindings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApprovalScopeRecord {
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
pub struct ApprovalEntryRecord {
    pub answer: Value,
    #[serde(rename = "answeredAt")]
    pub answered_at: String,
    pub approval: ApprovalScopeRecord,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServiceListEntry {
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
    pub resource_bindings: Option<ResourceBindings>,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthenticatedUser {
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
pub struct SentinelCredsRecord {
    pub jwt: String,
    pub seed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RenewBindingTokenResponse {
    #[serde(rename = "bindingToken")]
    pub binding_token: String,
    pub expires: String,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    #[serde(rename = "natsServers")]
    pub nats_servers: Vec<String>,
    pub sentinel: SentinelCredsRecord,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ListApprovalsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RevokeApprovalRequest {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthInstallServiceResponse {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "resourceBindings")]
    pub resource_bindings: ResourceBindings,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpgradeServiceContractRequest {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthUpgradeServiceContractResponse {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "resourceBindings")]
    pub resource_bindings: ResourceBindings,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractRequest {
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponseContract {
    pub digest: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthGetInstalledContractResponse {
    pub contract: AuthGetInstalledContractResponseContract,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthValidateRequestRequest {
    pub capabilities: Option<Vec<String>>,
    #[serde(rename = "payloadHash")]
    pub payload_hash: String,
    pub proof: String,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthValidateRequestResponseUser {
    pub active: bool,
    pub email: String,
    pub id: String,
    pub name: String,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AuthValidateRequestResponse {
    pub allowed: bool,
    pub user: AuthValidateRequestResponseUser,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct ListApprovalsResponse {
    pub approvals: Vec<ApprovalEntryRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct ListServicesResponse {
    pub services: Vec<ServiceListEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct LogoutResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct MeResponse {
    pub user: AuthenticatedUser,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct RevokeApprovalResponse {
    pub success: bool,
}
