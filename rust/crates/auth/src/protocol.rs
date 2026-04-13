use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Registry bucket metadata for a jobs binding.
pub struct JobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Jobs resource bindings attached to an installed service contract.
pub struct JobsBindings {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<JobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Resource bindings granted to an installed service contract.
pub struct ResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<JobsBindings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Canonical approval scope recorded for one contract digest.
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
/// Stored approval decision for one user and contract digest.
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
/// Actor metadata recorded on an instance grant policy.
pub struct InstanceGrantPolicyActorRecord {
    pub origin: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Provenance metadata recorded on an instance grant policy.
pub struct InstanceGrantPolicySourceRecord {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "createdBy")]
    pub created_by: Option<InstanceGrantPolicyActorRecord>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "updatedBy")]
    pub updated_by: Option<InstanceGrantPolicyActorRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Deployment-wide app grant policy keyed by contract lineage.
pub struct InstanceGrantPolicyRecord {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "allowedOrigins")]
    pub allowed_origins: Option<Vec<String>>,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub disabled: bool,
    #[serde(rename = "impliedCapabilities")]
    pub implied_capabilities: Vec<String>,
    pub source: InstanceGrantPolicySourceRecord,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Service record returned by `Auth.ListServices`.
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
/// User record returned by `Auth.Me`.
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
/// Sentinel credentials returned alongside a successful bind.
pub struct SentinelCredsRecord {
    pub jwt: String,
    pub seed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Response payload returned by `Auth.RenewBindingToken`.
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
/// Filter parameters for `Auth.ListApprovals`.
pub struct ListApprovalsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Request payload for `Auth.RevokeApproval`.
pub struct RevokeApprovalRequest {
    #[serde(rename = "contractDigest")]
    pub contract_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Request payload for `Auth.UpsertInstanceGrantPolicy`.
pub struct UpsertInstanceGrantPolicyRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "allowedOrigins")]
    pub allowed_origins: Option<Vec<String>>,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    #[serde(rename = "impliedCapabilities")]
    pub implied_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Request payload for `Auth.DisableInstanceGrantPolicy`.
pub struct DisableInstanceGrantPolicyRequest {
    #[serde(rename = "contractId")]
    pub contract_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Request payload for `Auth.InstallService`.
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
/// Response payload for `Auth.InstallService`.
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
/// Request payload for `Auth.UpgradeServiceContract`.
pub struct AuthUpgradeServiceContractRequest {
    pub contract: BTreeMap<String, Value>,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Response payload for `Auth.UpgradeServiceContract`.
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
/// Request payload for `Auth.GetInstalledContract`.
pub struct AuthGetInstalledContractRequest {
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Contract summary returned by `Auth.GetInstalledContract`.
pub struct AuthGetInstalledContractResponseContract {
    pub digest: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Response payload for `Auth.GetInstalledContract`.
pub struct AuthGetInstalledContractResponse {
    pub contract: AuthGetInstalledContractResponseContract,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Request payload for `Auth.ValidateRequest`.
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
/// Response payload returned by `Auth.ValidateRequest`.
pub struct AuthValidateRequestResponse {
    pub allowed: bool,
    pub caller: Value,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct ListInstanceGrantPoliciesResponse {
    pub policies: Vec<InstanceGrantPolicyRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct UpsertInstanceGrantPolicyResponse {
    pub policy: InstanceGrantPolicyRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct DisableInstanceGrantPolicyResponse {
    pub policy: InstanceGrantPolicyRecord,
}
