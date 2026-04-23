use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::SigningKey;
use reqwest::Client as HttpClient;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::client::{connect_admin_client_async, AuthClient};
use crate::models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, AgentLoginChallenge, BindResponse,
    BindResponseBound, BoundSession, StartAgentLoginOpts,
};
use crate::TrellisAuthError;
use crate::{AuthStartRequest, AuthStartResponse, ClientTransportsRecord};
use trellis_client::SessionAuth;

pub(crate) const DETACHED_LOGIN_POLL_INTERVAL: Duration = Duration::from_secs(2);

fn canonicalize_json_value(value: &Value) -> Result<String, TrellisAuthError> {
    match value {
        Value::Null => Ok("null".to_string()),
        Value::Bool(value) => Ok(if *value { "true" } else { "false" }.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => Ok(serde_json::to_string(value)?),
        Value::Array(values) => {
            let mut canonical = String::from("[");
            for (index, entry) in values.iter().enumerate() {
                if index > 0 {
                    canonical.push(',');
                }
                canonical.push_str(&canonicalize_json_value(entry)?);
            }
            canonical.push(']');
            Ok(canonical)
        }
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));

            let mut canonical = String::from("{");
            for (index, (key, entry)) in entries.into_iter().enumerate() {
                if index > 0 {
                    canonical.push(',');
                }
                canonical.push_str(&serde_json::to_string(key)?);
                canonical.push(':');
                canonical.push_str(&canonicalize_json_value(entry)?);
            }
            canonical.push('}');
            Ok(canonical)
        }
    }
}

pub(crate) fn build_auth_start_signature_payload(
    redirect_to: &str,
    provider: Option<&str>,
    contract: &Value,
    context: Option<&Value>,
) -> Result<String, TrellisAuthError> {
    Ok(format!(
        "{}:{}:{}:{}",
        redirect_to,
        provider.unwrap_or_default(),
        canonicalize_json_value(contract)?,
        canonicalize_json_value(context.unwrap_or(&Value::Null))?,
    ))
}

fn join_native_nats_servers(
    transports: &ClientTransportsRecord,
) -> Result<String, TrellisAuthError> {
    let Some(native) = &transports.native else {
        return Err(TrellisAuthError::UnexpectedBindStatus(
            "missing_native_transport".to_string(),
        ));
    };
    let servers = &native.nats_servers;
    if servers.is_empty() {
        return Err(TrellisAuthError::UnexpectedBindStatus(
            "missing_native_transport".to_string(),
        ));
    }
    Ok(servers.join(","))
}

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Compute the canonical Trellis contract digest for a JSON contract document.
pub fn contract_digest(contract_json: &str) -> Result<String, TrellisAuthError> {
    let contract: Value = serde_json::from_str(contract_json)?;
    let canonical = canonicalize_json_value(&contract)?;
    Ok(base64url_encode(&Sha256::digest(canonical.as_bytes())))
}

/// Generate a new base64url-encoded Ed25519 session seed and public key.
pub fn generate_session_keypair() -> (String, String) {
    let seed: [u8; 32] = rand::random();
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    (base64url_encode(&seed), base64url_encode(&public_key))
}

pub(crate) fn detached_login_redirect_to() -> Result<String, TrellisAuthError> {
    Ok("/_trellis/portal/users/login".to_string())
}

async fn start_auth_request(
    trellis_url: &str,
    redirect_to: &str,
    auth: &SessionAuth,
    contract_json: &str,
) -> Result<AuthStartResponse, TrellisAuthError> {
    let contract: Value = serde_json::from_str(contract_json)?;
    let contract = contract.as_object().cloned().ok_or_else(|| {
        TrellisAuthError::InvalidArgument("contract json must be an object".to_string())
    })?;
    let sig = auth.sign_sha256_domain(
        "oauth-init",
        &build_auth_start_signature_payload(
            redirect_to,
            None,
            &Value::Object(contract.clone()),
            None,
        )?,
    );
    let client = HttpClient::builder().build()?;
    let response = client
        .post(format!(
            "{}/auth/requests",
            trellis_url.trim_end_matches('/')
        ))
        .json(&AuthStartRequest {
            provider: None,
            redirect_to: redirect_to.to_string(),
            session_key: auth.session_key.clone(),
            sig,
            contract: contract.into_iter().collect(),
            context: None,
        })
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::AuthRequestHttpFailure(
            status.as_u16(),
            text,
        ));
    }
    Ok(serde_json::from_str::<AuthStartResponse>(&text)?)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum AgentFlowStatusResponse {
    Redirect { location: String },
    ChooseProvider,
    ApprovalRequired,
    ApprovalDenied,
    InsufficientCapabilities,
    Expired,
}

async fn fetch_agent_flow_status(
    trellis_url: &str,
    flow_id: &str,
) -> Result<AgentFlowStatusResponse, TrellisAuthError> {
    let client = HttpClient::builder().build()?;
    let response = client
        .get(format!(
            "{}/auth/flow/{}",
            trellis_url.trim_end_matches('/'),
            flow_id
        ))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::AuthRequestHttpFailure(
            status.as_u16(),
            text,
        ));
    }
    Ok(serde_json::from_str::<AgentFlowStatusResponse>(&text)?)
}

pub(crate) async fn poll_agent_flow_until_ready(
    trellis_url: &str,
    flow_id: &str,
    poll_interval: Duration,
    timeout_after: Duration,
) -> Result<String, TrellisAuthError> {
    let deadline = tokio::time::Instant::now() + timeout_after;
    loop {
        match fetch_agent_flow_status(trellis_url, flow_id).await? {
            AgentFlowStatusResponse::Redirect { location } => {
                let _ = location;
                return Ok(flow_id.to_string());
            }
            AgentFlowStatusResponse::ChooseProvider | AgentFlowStatusResponse::ApprovalRequired => {
            }
            AgentFlowStatusResponse::ApprovalDenied => {
                return Err(TrellisAuthError::AuthFlowFailed(
                    "approval_denied".to_string(),
                ));
            }
            AgentFlowStatusResponse::InsufficientCapabilities => {
                return Err(TrellisAuthError::AuthFlowFailed(
                    "insufficient_capabilities".to_string(),
                ));
            }
            AgentFlowStatusResponse::Expired => {
                return Err(TrellisAuthError::AuthFlowFailed("expired".to_string()));
            }
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(TrellisAuthError::LoginTimedOut);
        }
        tokio::time::sleep(poll_interval).await;
    }
}

async fn bind_session(
    trellis_url: &str,
    auth: &SessionAuth,
    flow_id: &str,
) -> Result<BoundSession, TrellisAuthError> {
    let client = HttpClient::builder().build()?;
    let bind_url = format!(
        "{}/auth/flow/{}/bind",
        trellis_url.trim_end_matches('/'),
        flow_id
    );
    let sig = auth.sign_sha256_domain("bind-flow", flow_id);
    let response = client
        .post(bind_url)
        .json(&json!({
            "sessionKey": auth.session_key,
            "sig": sig,
        }))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::BindHttpFailure(status.as_u16(), text));
    }

    match serde_json::from_str::<BindResponse>(&text)? {
        BindResponse::Bound(BindResponseBound {
            inbox_prefix,
            expires,
            sentinel,
            transports,
        }) => Ok(BoundSession {
            inbox_prefix,
            expires,
            nats_servers: join_native_nats_servers(&transports)?,
            sentinel,
        }),
        BindResponse::ApprovalRequired { approval } => Err(TrellisAuthError::UnexpectedBindStatus(
            format!("approval_required:{approval}"),
        )),
        BindResponse::ApprovalDenied { approval } => Err(TrellisAuthError::UnexpectedBindStatus(
            format!("approval_denied:{approval}"),
        )),
        BindResponse::InsufficientCapabilities {
            approval,
            missing_capabilities,
        } => Err(TrellisAuthError::UnexpectedBindStatus(format!(
            "insufficient_capabilities:{approval}:{missing_capabilities:?}"
        ))),
    }
}

impl AgentLoginChallenge {
    /// Return the URL the user should open to complete login.
    pub fn login_url(&self) -> &str {
        &self.login_url
    }

    /// Wait for detached portal completion, then bind the session.
    pub async fn complete(self, trellis_url: &str) -> Result<AdminLoginOutcome, TrellisAuthError> {
        let AgentLoginChallenge {
            flow_id,
            login_url: _,
            session_seed,
            contract_digest,
            auth,
        } = self;
        let flow_id = poll_agent_flow_until_ready(
            trellis_url,
            &flow_id,
            DETACHED_LOGIN_POLL_INTERVAL,
            Duration::from_secs(300),
        )
        .await?;
        let bound = bind_session(trellis_url, &auth, &flow_id).await?;
        let state = AdminSessionState {
            trellis_url: trellis_url.to_string(),
            nats_servers: bound.nats_servers.clone(),
            session_seed,
            session_key: auth.session_key.clone(),
            contract_digest,
            sentinel_jwt: bound.sentinel.jwt,
            sentinel_seed: bound.sentinel.seed,
            expires: bound.expires,
        };

        let client = connect_admin_client_async(&state).await?;
        let auth_client = AuthClient::new(&client);
        let user = auth_client.me().await?;
        if !user
            .capabilities
            .iter()
            .any(|capability| capability == "admin")
        {
            return Err(TrellisAuthError::NotAdmin);
        }

        Ok(AdminLoginOutcome { state, user })
    }
}

/// Start the agent login flow against the detached Trellis portal.
pub async fn start_agent_login(
    opts: &StartAgentLoginOpts<'_>,
) -> Result<AgentLoginChallenge, TrellisAuthError> {
    let (session_seed, _session_key) = generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&session_seed)?;
    let redirect_to = detached_login_redirect_to()?;
    let (flow_id, login_url) = match start_auth_request(
        opts.trellis_url,
        &redirect_to,
        &auth,
        opts.contract_json,
    )
    .await?
    {
        AuthStartResponse::FlowStarted { flow_id, login_url } => (flow_id, login_url),
        AuthStartResponse::Bound { .. } => {
            return Err(TrellisAuthError::UnexpectedAuthRequestStatus(
                "bound_without_existing_session".to_string(),
            ));
        }
    };

    Ok(AgentLoginChallenge {
        flow_id,
        login_url,
        session_seed,
        contract_digest: contract_digest(opts.contract_json)?,
        auth,
    })
}

/// Start admin reauthentication for a changed contract using the stored session key.
pub async fn start_admin_reauth(
    state: &AdminSessionState,
    contract_json: &str,
) -> Result<AdminReauthOutcome, TrellisAuthError> {
    let auth = SessionAuth::from_seed_base64url(&state.session_seed)?;
    let redirect_to = detached_login_redirect_to()?;
    match start_auth_request(&state.trellis_url, &redirect_to, &auth, contract_json).await? {
        AuthStartResponse::Bound {
            inbox_prefix: _,
            expires,
            sentinel,
            transports,
        } => {
            let next_state = AdminSessionState {
                trellis_url: state.trellis_url.clone(),
                nats_servers: join_native_nats_servers(&transports)?,
                session_seed: state.session_seed.clone(),
                session_key: auth.session_key.clone(),
                contract_digest: contract_digest(contract_json)?,
                sentinel_jwt: sentinel.jwt,
                sentinel_seed: sentinel.seed,
                expires,
            };
            let client = connect_admin_client_async(&next_state).await?;
            let auth_client = AuthClient::new(&client);
            let user = auth_client.me().await?;
            if !user
                .capabilities
                .iter()
                .any(|capability| capability == "admin")
            {
                return Err(TrellisAuthError::NotAdmin);
            }
            Ok(AdminReauthOutcome::Bound(AdminLoginOutcome {
                state: next_state,
                user,
            }))
        }
        AuthStartResponse::FlowStarted { flow_id, login_url } => {
            Ok(AdminReauthOutcome::Flow(AgentLoginChallenge {
                flow_id,
                login_url,
                session_seed: state.session_seed.clone(),
                contract_digest: contract_digest(contract_json)?,
                auth,
            }))
        }
    }
}
