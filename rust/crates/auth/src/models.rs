use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

use crate::{AuthenticatedUser, ClientTransportsRecord, SentinelCredsRecord};
use trellis_client::SessionAuth;

/// Persisted admin session details for the CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSessionState {
    /// Base URL for the Trellis deployment.
    pub trellis_url: String,
    /// Comma-separated NATS server list returned by Trellis.
    pub nats_servers: String,
    /// Session-key seed used to sign subsequent Trellis requests.
    pub session_seed: String,
    /// Public session key derived from `session_seed`.
    pub session_key: String,
    /// Current delegated contract digest for admin runtime auth.
    pub contract_digest: String,
    /// Sentinel JWT used for NATS authentication.
    pub sentinel_jwt: String,
    /// Sentinel seed used for NATS authentication.
    pub sentinel_seed: String,
    /// RFC3339 expiry timestamp for the current delegated agent grant.
    pub expires: String,
}

/// A successfully bound user session.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoundSession {
    /// Inbox prefix authorized for the bound session.
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    /// RFC3339 expiry timestamp for this binding.
    pub expires: String,
    /// Comma-separated native NATS transport endpoints for the session.
    pub nats_servers: String,
    /// Sentinel credentials returned alongside the binding.
    pub sentinel: SentinelCredsRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BindResponseBound {
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    pub expires: String,
    pub sentinel: SentinelCredsRecord,
    pub transports: ClientTransportsRecord,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum BindResponse {
    Bound(BindResponseBound),
    ApprovalRequired {
        approval: Value,
    },
    ApprovalDenied {
        approval: Value,
    },
    InsufficientCapabilities {
        approval: Value,
        #[serde(rename = "missingCapabilities")]
        missing_capabilities: Vec<String>,
    },
}

/// An in-progress agent login flow waiting for completion.
pub struct AgentLoginChallenge {
    pub(crate) flow_id: String,
    pub(crate) login_url: String,
    pub(crate) session_seed: String,
    pub(crate) contract_digest: String,
    pub(crate) auth: SessionAuth,
}

/// Options for starting an agent login flow.
pub struct StartAgentLoginOpts<'a> {
    /// Base URL for the Trellis deployment.
    pub trellis_url: &'a str,
    /// Contract JSON sent to `/auth/login` when starting the flow.
    pub contract_json: &'a str,
}

/// Successful agent-login result after the admin user has been verified.
pub struct AdminLoginOutcome {
    /// Persistable admin session state for later CLI reuse.
    pub state: AdminSessionState,
    /// Authenticated user returned by `Auth.Me` after bind succeeds.
    pub user: AuthenticatedUser,
}

/// Result of starting admin reauthentication for a changed contract.
pub enum AdminReauthOutcome {
    /// Contract change was auto-approved and the session was rebound immediately.
    Bound(AdminLoginOutcome),
    /// External interaction is still required to finish the agent auth flow.
    Flow(AgentLoginChallenge),
}

/// Derived device identity material used by the device activation helpers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceIdentity {
    #[serde(rename = "identitySeedBase64url")]
    pub identity_seed_base64url: String,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "activationKeyBase64url")]
    pub activation_key_base64url: String,
}

/// Encoded device activation payload carried in the activation QR.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceActivationPayload {
    pub v: u8,
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    pub nonce: String,
    #[serde(rename = "qrMac")]
    pub qr_mac: String,
}

/// Signed pre-auth request sent to `/auth/devices/activate/wait`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceActivationWaitRequest {
    #[serde(rename = "publicIdentityKey")]
    pub public_identity_key: String,
    #[serde(rename = "contractDigest", skip_serializing_if = "Option::is_none")]
    pub contract_digest: Option<String>,
    pub nonce: String,
    pub iat: u64,
    pub sig: String,
}

/// Signed pre-auth request sent to `/auth/devices/connect-info`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConnectInfoRequest {
    pub public_identity_key: String,
    pub contract_digest: String,
    pub iat: u64,
    pub sig: String,
}

/// Native NATS transport endpoints returned for an activated device.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConnectInfoNativeTransport {
    pub nats_servers: Vec<String>,
}

/// Transport endpoints returned for an activated device.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DeviceConnectInfoTransports {
    pub native: Option<DeviceConnectInfoNativeTransport>,
}

/// Sentinel credentials returned for an activated device connection.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DeviceConnectInfoSentinel {
    pub jwt: String,
    pub seed: String,
}

/// Selected runtime transport credentials for an activated device.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DeviceConnectInfoTransport {
    pub sentinel: DeviceConnectInfoSentinel,
}

/// Activated-device runtime auth settings returned by auth.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceConnectInfoAuthMode {
    /// Device authenticates with its durable device identity key.
    DeviceIdentity,
}

/// Activated-device runtime auth settings returned by auth.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConnectInfoAuth {
    pub mode: DeviceConnectInfoAuthMode,
    pub iat_skew_seconds: i64,
}

/// Current runtime connection information for an activated device.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConnectInfo {
    pub instance_id: String,
    pub deployment_id: String,
    pub contract_id: String,
    pub contract_digest: String,
    pub transports: DeviceConnectInfoTransports,
    pub transport: DeviceConnectInfoTransport,
    pub auth: DeviceConnectInfoAuth,
}

/// Ready response returned by `/auth/devices/connect-info`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConnectInfoResponse {
    pub status: String,
    pub connect_info: DeviceConnectInfo,
}

/// Options for refreshing activated-device runtime connection information.
pub struct GetDeviceConnectInfoOpts<'a> {
    pub trellis_url: &'a str,
    pub public_identity_key: &'a str,
    pub identity_seed_base64url: &'a str,
    pub contract_digest: &'a str,
    pub iat: u64,
}

/// Activated wait response returned by auth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceActivationActivatedResponse {
    pub status: String,
    #[serde(rename = "activatedAt")]
    pub activated_at: String,
    #[serde(rename = "confirmationCode", skip_serializing_if = "Option::is_none")]
    pub confirmation_code: Option<String>,
    #[serde(rename = "connectInfo")]
    pub connect_info: serde_json::Value,
}

/// Rejected wait response returned by auth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceActivationRejectedResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Pending wait response returned by auth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceActivationPendingResponse {
    pub status: String,
}

/// Union of possible wait responses returned by auth.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum WaitForDeviceActivationResponse {
    Activated {
        #[serde(rename = "activatedAt")]
        activated_at: String,
        #[serde(rename = "confirmationCode", skip_serializing_if = "Option::is_none")]
        confirmation_code: Option<String>,
        #[serde(rename = "connectInfo")]
        connect_info: serde_json::Value,
    },
    Rejected {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Pending,
}

/// Polling options for waiting on an activated device.
pub struct WaitForDeviceActivationOpts<'a> {
    pub trellis_url: &'a str,
    pub public_identity_key: &'a str,
    pub nonce: &'a str,
    pub identity_seed_base64url: &'a str,
    pub contract_digest: Option<&'a str>,
    pub poll_interval: Duration,
}
