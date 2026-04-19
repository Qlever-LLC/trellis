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
#[serde(rename_all = "camelCase")]
/// One named transport endpoint family returned alongside a successful bind.
pub struct ClientTransportRecord {
    pub nats_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Transport variants returned alongside a successful bind.
pub struct ClientTransportsRecord {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native: Option<ClientTransportRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websocket: Option<ClientTransportRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// Request payload for `POST /auth/requests`.
pub struct AuthStartRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub redirect_to: String,
    pub session_key: String,
    pub sig: String,
    pub contract: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
/// Response payload for `POST /auth/requests`.
pub enum AuthStartResponse {
    Bound {
        expires: String,
        #[serde(rename = "inboxPrefix")]
        inbox_prefix: String,
        sentinel: SentinelCredsRecord,
        transports: ClientTransportsRecord,
    },
    FlowStarted {
        #[serde(rename = "flowId")]
        flow_id: String,
        #[serde(rename = "loginUrl")]
        login_url: String,
    },
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
/// Request payload for `Auth.GetInstalledContract`.
pub struct AuthGetInstalledContractRequest {
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
/// Contract detail returned by `Auth.GetInstalledContract`.
pub struct AuthGetInstalledContractResponseContract {
    pub digest: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<BTreeMap<String, Value>>,
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
