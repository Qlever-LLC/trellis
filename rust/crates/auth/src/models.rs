use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::sync::oneshot;

use crate::{AuthenticatedUser, SentinelCredsRecord};
use trellis_client::SessionAuth;

/// Persisted admin session details for the CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSessionState {
    /// Base URL for the Trellis auth service.
    pub auth_url: String,
    /// Comma-separated NATS server list returned by Trellis.
    pub nats_servers: String,
    /// Session-key seed used to sign subsequent Trellis requests.
    pub session_seed: String,
    /// Public session key derived from `session_seed`.
    pub session_key: String,
    /// Current binding token for the admin session.
    pub binding_token: String,
    /// Sentinel JWT used for NATS authentication.
    pub sentinel_jwt: String,
    /// Sentinel seed used for NATS authentication.
    pub sentinel_seed: String,
    /// RFC3339 expiry timestamp for the current binding token.
    pub expires: String,
}

/// A successfully bound user session.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoundSession {
    /// Bind token used to establish NATS connections for the session.
    #[serde(rename = "bindingToken")]
    pub binding_token: String,
    /// Inbox prefix authorized for the bound session.
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    /// RFC3339 expiry timestamp for this binding.
    pub expires: String,
    /// Comma-separated runtime transport endpoints for the session.
    pub nats_servers: String,
    /// Sentinel credentials returned alongside the binding.
    pub sentinel: SentinelCredsRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BindResponseBound {
    #[serde(rename = "bindingToken")]
    pub binding_token: String,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    pub expires: String,
    #[serde(rename = "natsServers")]
    pub nats_servers: Vec<String>,
    pub sentinel: SentinelCredsRecord,
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

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct CallbackTokenRequest {
    #[serde(rename = "flowId")]
    pub flow_id: Option<String>,
    #[serde(rename = "authError")]
    pub auth_error: Option<String>,
}

#[derive(Debug)]
pub(crate) enum CallbackOutcome {
    FlowId(String),
    AuthError(String),
}

/// An in-progress browser login flow waiting for the auth callback.
pub struct BrowserLoginChallenge {
    pub(crate) login_url: String,
    pub(crate) session_seed: String,
    pub(crate) auth: SessionAuth,
    pub(crate) receiver: oneshot::Receiver<CallbackOutcome>,
    pub(crate) server_handle: tokio::task::JoinHandle<()>,
}

/// Options for starting a browser-based admin login flow.
pub struct StartBrowserLoginOpts<'a> {
    /// Base URL for the Trellis auth service.
    pub auth_url: &'a str,
    /// Local callback address in `host:port` form.
    pub listen: &'a str,
    /// Contract JSON sent to `/auth/login` when starting the flow.
    pub contract_json: &'a str,
}

/// Successful browser-login result after the admin user has been verified.
pub struct AdminLoginOutcome {
    /// Persistable admin session state for later CLI reuse.
    pub state: AdminSessionState,
    /// Authenticated user returned by `Auth.Me` after bind succeeds.
    pub user: AuthenticatedUser,
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
    pub auth_url: &'a str,
    pub public_identity_key: &'a str,
    pub nonce: &'a str,
    pub identity_seed_base64url: &'a str,
    pub contract_digest: Option<&'a str>,
    pub poll_interval: Duration,
}
