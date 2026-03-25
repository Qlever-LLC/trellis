use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

use trellis_client::SessionAuth;
use trellis_sdk_auth::{AuthenticatedUser, SentinelCredsRecord};

/// Persisted admin session details for the CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSessionState {
    pub auth_url: String,
    pub nats_servers: String,
    pub session_seed: String,
    pub session_key: String,
    pub binding_token: String,
    pub sentinel_jwt: String,
    pub sentinel_seed: String,
    pub expires: String,
}

/// A successfully bound user session.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BoundSession {
    #[serde(rename = "bindingToken")]
    pub binding_token: String,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    pub expires: String,
    pub sentinel: SentinelCredsRecord,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct BindResponseBound {
    #[serde(rename = "bindingToken")]
    pub binding_token: String,
    #[serde(rename = "inboxPrefix")]
    pub inbox_prefix: String,
    pub expires: String,
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
    #[serde(rename = "authToken")]
    pub auth_token: Option<String>,
    #[serde(rename = "authError")]
    pub auth_error: Option<String>,
}

#[derive(Debug)]
pub(crate) enum CallbackOutcome {
    AuthToken(String),
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
    pub auth_url: &'a str,
    pub provider: &'a str,
    pub listen: &'a str,
    pub contract_json: &'a str,
}

/// Successful browser-login result after the admin user has been verified.
pub struct AdminLoginOutcome {
    pub state: AdminSessionState,
    pub user: AuthenticatedUser,
}
