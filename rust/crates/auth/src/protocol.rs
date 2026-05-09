use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Registry bucket metadata for a jobs binding.
pub struct JobsRegistry {
    pub bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Jobs resource bindings attached to a service deployment envelope.
pub struct JobsBindings {
    pub namespace: String,
    pub queues: BTreeMap<String, Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<JobsRegistry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Resource bindings granted through a service deployment envelope.
pub struct ResourceBindings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<JobsBindings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kv: Option<BTreeMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// User record returned by `Auth.Sessions.Me`.
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

/// Filter parameters for `Auth.Identities.List`.
pub type ListApprovalsRequest = trellis_sdk_auth::types::AuthIdentitiesListRequest;

/// Approval scope returned by `Auth.Identities.List`.
pub type ApprovalScopeRecord =
    trellis_sdk_auth::types::AuthIdentitiesListResponseApprovalsItemContractEvidence;

/// Stored approval decision returned by `Auth.Identities.List`.
pub type ApprovalEntryRecord = trellis_sdk_auth::types::AuthIdentitiesListResponseApprovalsItem;

/// Request payload for `Auth.IdentityEnvelopes.Revoke`.
pub type RevokeApprovalRequest = trellis_sdk_auth::types::AuthIdentityEnvelopesRevokeRequest;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Request payload for `Auth.Requests.Validate`.
pub struct AuthRequestsValidateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(rename = "payloadHash")]
    pub payload_hash: String,
    pub proof: String,
    #[serde(rename = "sessionKey")]
    pub session_key: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
/// Response payload returned by `Auth.Requests.Validate`.
pub struct AuthRequestsValidateResponse {
    pub allowed: bool,
    pub caller: Value,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct LogoutResponse {
    pub success: bool,
}
