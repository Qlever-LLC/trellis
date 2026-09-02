use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::SigningKey;
use reqwest::Client as HttpClient;
use serde::Deserialize;
use serde_json::{json, Value};
use trellis_protocol::{
    parse_api, parse_authorization_context, parse_participant, resolve_participant,
    session_proof_request_digest, SessionProofInput, UserAuthBindSessionProofInput,
    UserAuthRequestSessionProofInput,
};

use super::client::connect_admin_client_with_context_store_async;
use super::models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, AgentLoginChallenge,
    BindResponseBound, BoundSession, StartAgentLoginOpts,
};
use super::TrellisAuthError;
use crate::client::MemoryAuthorizationContextStore;
use crate::client::{
    decode_trellis_http_error, AuthorizationContextStore, AuthorizationInstallation,
    AuthorizationNativeTransport, AuthorizationRoutingMaterial, AuthorizationRuntimeBinding,
    AuthorizationRuntimeTransports, SessionAuth,
};
use crate::internal_sdk::auth::AuthClient;

pub(crate) const DETACHED_LOGIN_POLL_INTERVAL: Duration = Duration::from_secs(2);

struct CliParticipant {
    id: String,
    digest: String,
    required_grants: trellis_protocol::GrantSet,
}

fn cli_participant() -> Result<CliParticipant, TrellisAuthError> {
    let participant_value: Value =
        serde_json::from_str(include_str!("../../artifacts/trellis.cli.participant.json"))?;
    let participant = parse_participant(&participant_value)?;
    let mut apis = BTreeMap::new();
    for api_json in [
        crate::internal_sdk::auth::api::API_JSON,
        crate::internal_sdk::state::api::API_JSON,
        crate::internal_sdk::jobs::api::API_JSON,
        crate::internal_sdk::health::api::API_JSON,
        crate::internal_sdk::eventlog::api::API_JSON,
    ] {
        let api_value: Value = serde_json::from_str(api_json)?;
        let api = parse_api(&api_value)?;
        apis.insert(api.id().to_owned(), api);
    }
    let resolved = resolve_participant(&participant, &apis)?;
    Ok(CliParticipant {
        id: participant.id().to_owned(),
        digest: participant.digest()?,
        required_grants: resolved.proposal().required().grant_set().clone(),
    })
}

/// Return the exact built-in Trellis CLI participant artifact digest.
pub fn cli_participant_digest() -> Result<String, TrellisAuthError> {
    Ok(cli_participant()?.digest)
}

/// Return the exact required grants declared by the built-in Trellis CLI participant.
pub fn cli_participant_grants() -> Result<trellis_protocol::GrantSet, TrellisAuthError> {
    Ok(cli_participant()?.required_grants)
}

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Compute the semantic digest for one native Trellis API artifact.
#[doc = concat!("Trellis API operation `", stringify!(contract_digest), "`.")]
pub fn contract_digest(api_source_json: &str) -> Result<String, TrellisAuthError> {
    let value = serde_json::from_str(api_source_json)?;
    Ok(trellis_protocol::parse_api(&value)?.digest()?)
}

/// Generate a new base64url-encoded Ed25519 session seed and public key.
#[doc = concat!("Trellis API operation `", stringify!(generate_session_keypair), "`.")]
pub fn generate_session_keypair() -> (String, String) {
    let seed: [u8; 32] = rand::random();
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    (base64url_encode(&seed), base64url_encode(&public_key))
}

#[doc = concat!("Trellis API operation `", stringify!(detached_login_redirect_to), "`.")]
pub fn detached_login_redirect_to() -> Result<String, TrellisAuthError> {
    Ok("/login".to_string())
}

async fn start_auth_request(
    trellis_url: &str,
    redirect_to: &str,
    auth: &SessionAuth,
) -> Result<AuthStartResponse, TrellisAuthError> {
    let participant = cli_participant()?;
    let request_id = ulid::Ulid::new().to_string();
    let issued_at = now_ms()?;
    let session_nkey = auth.nkey_pair()?.public_key();
    let mut request = json!({
        "requestId": request_id,
        "issuedAt": issued_at,
        "sessionPublicKey": auth.session_key,
        "sessionNkey": session_nkey,
        "participantId": participant.id,
        "participantArtifactDigest": participant.digest,
        "participantArtifact": null,
        "referencedApiArtifacts": [],
        "redirectTarget": redirect_to,
        "proof": auth.sign_session_proof(&SessionProofInput::user_auth_request(
            UserAuthRequestSessionProofInput {
                request_id: request_id.clone(),
                issued_at,
                session_public_key: auth.session_key.clone(),
                session_nkey: session_nkey.clone(),
                participant_id: participant.id.clone(),
                participant_digest: participant.digest.clone(),
                redirect_target: redirect_to.to_owned(),
                request_digest: participant.digest.clone(),
            },
        )?)?,
    });
    let request_digest = session_proof_request_digest(&request)?;
    let input = SessionProofInput::user_auth_request(UserAuthRequestSessionProofInput {
        request_id,
        issued_at,
        session_public_key: auth.session_key.clone(),
        session_nkey,
        participant_id: participant.id,
        participant_digest: participant.digest,
        redirect_target: redirect_to.to_owned(),
        request_digest,
    })?;
    request["proof"] = serde_json::to_value(auth.sign_session_proof(&input)?)?;
    let client = HttpClient::builder().build()?;
    let response = client
        .post(format!(
            "{}/auth/requests",
            trellis_url.trim_end_matches('/')
        ))
        .json(&request)
        .send()
        .await?;
    if !response.status().is_success() {
        let error = decode_trellis_http_error(response).await;
        return Err(TrellisAuthError::AuthRequestHttpFailure(
            error.status,
            error.code,
        ));
    }
    Ok(response.json::<AuthStartResponse>().await?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthStartResponse {
    flow_id: String,
    login_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentFlowState {
    ChooseProvider,
    Authenticated,
    ApprovalRequired,
    ApprovalDenied,
    Approved,
    Consumed,
    Expired,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentFlowStatusResponse {
    flow_id: String,
    state: AgentFlowState,
    expires_at: i64,
    providers: Vec<String>,
    registration_enabled: bool,
    federated_registration_enabled: bool,
    consent_view: Value,
    redirect_target: Option<String>,
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
    if !response.status().is_success() {
        let error = decode_trellis_http_error(response).await;
        return Err(TrellisAuthError::AuthRequestHttpFailure(
            error.status,
            error.code,
        ));
    }
    Ok(response.json::<AgentFlowStatusResponse>().await?)
}

#[doc = concat!("Asynchronous Trellis API operation `", stringify!(poll_agent_flow_until_ready), "`.")]
pub async fn poll_agent_flow_until_ready(
    trellis_url: &str,
    flow_id: &str,
    poll_interval: Duration,
    timeout_after: Duration,
) -> Result<String, TrellisAuthError> {
    let deadline = tokio::time::Instant::now() + timeout_after;
    loop {
        match fetch_agent_flow_status(trellis_url, flow_id).await?.state {
            AgentFlowState::Approved | AgentFlowState::Consumed => return Ok(flow_id.to_string()),
            AgentFlowState::ChooseProvider
            | AgentFlowState::Authenticated
            | AgentFlowState::ApprovalRequired => {}
            AgentFlowState::ApprovalDenied => {
                return Err(TrellisAuthError::AuthFlowFailed(
                    "approval_denied".to_string(),
                ));
            }
            AgentFlowState::Expired => {
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
    flow_id: &str,
    auth: &SessionAuth,
) -> Result<BoundSession, TrellisAuthError> {
    let client = HttpClient::builder().build()?;
    let bind_url = format!(
        "{}/auth/flow/{}/bind",
        trellis_url.trim_end_matches('/'),
        flow_id
    );
    let request_id = ulid::Ulid::new().to_string();
    let issued_at = now_ms()?;
    let mut request = json!({
        "requestId": request_id,
        "issuedAt": issued_at,
        "proof": { "format": "trellis.session-proof.v1", "signature": "" },
    });
    let input = SessionProofInput::user_auth_bind(UserAuthBindSessionProofInput {
        request_id,
        issued_at,
        flow_id: flow_id.to_owned(),
        session_public_key: auth.session_key.clone(),
        request_digest: session_proof_request_digest(&request)?,
    })?;
    request["proof"] = serde_json::to_value(auth.sign_session_proof(&input)?)?;
    let response = client
        .post(bind_url)
        .header(reqwest::header::ORIGIN, trellis_url.trim_end_matches('/'))
        .json(&request)
        .send()
        .await?;
    if !response.status().is_success() {
        let error = decode_trellis_http_error(response).await;
        return Err(TrellisAuthError::BindHttpFailure(error.status, error.code));
    }

    let response_received_at = now_ms()?;
    let BindResponseBound {
        server_now,
        session,
        nats,
        authorization_context,
    } = response.json().await?;
    let context = parse_authorization_context(&authorization_context.context)?;
    let native = nats.transports.native.ok_or_else(|| {
        TrellisAuthError::UnexpectedBindStatus("missing_native_transport".to_owned())
    })?;
    Ok(BoundSession {
        expires_at: session.expires_at,
        installation: AuthorizationInstallation {
            context: authorization_context,
            routing: AuthorizationRoutingMaterial {
                bootstrap_jwt: nats.jwt,
                bootstrap_jwt_expires_at: nats.jwt_expires_at,
            },
            runtime: AuthorizationRuntimeBinding {
                session_id: session.session_id,
                participant_id: context.unsigned.participant.id.clone(),
                participant_digest: context.unsigned.participant.artifact_digest.clone(),
                needs_digest: context.unsigned.participant.needs_digest.clone(),
                inbox_prefix: session.inbox_prefix,
                transports: AuthorizationRuntimeTransports {
                    native: AuthorizationNativeTransport {
                        nats_servers: native.nats_servers,
                    },
                },
            },
            server_clock_offset_ms: server_now
                - issued_at
                    .checked_add(response_received_at)
                    .and_then(|sum| sum.checked_div(2))
                    .ok_or_else(|| {
                        TrellisAuthError::UnexpectedBindStatus("server_clock_overflow".to_owned())
                    })?,
        },
    })
}

impl AgentLoginChallenge {
    /// Return the URL the user should open to complete login.
    #[doc = concat!("Trellis API operation `", stringify!(login_url), "`.")]
    pub fn login_url(&self) -> &str {
        &self.login_url
    }

    /// Wait for detached portal completion, then bind the session.
    #[doc = concat!("Asynchronous Trellis API operation `", stringify!(complete), "`.")]
    pub async fn complete(self, trellis_url: &str) -> Result<AdminLoginOutcome, TrellisAuthError> {
        self.complete_with_client(trellis_url, None).await
    }

    /// Complete login with process-local context storage for integration tests.
    #[cfg(feature = "test-support")]
    #[doc(hidden)]
    pub async fn complete_ephemeral(
        self,
        trellis_url: &str,
    ) -> Result<AdminLoginOutcome, TrellisAuthError> {
        self.complete_with_client(
            trellis_url,
            Some(std::sync::Arc::new(
                MemoryAuthorizationContextStore::default(),
            )),
        )
        .await
    }

    /// Complete login with caller-owned authorization storage for live tests.
    #[cfg(feature = "test-support")]
    #[doc(hidden)]
    pub async fn complete_with_context_store(
        self,
        trellis_url: &str,
        store: std::sync::Arc<dyn crate::client::AuthorizationContextStore>,
    ) -> Result<AdminLoginOutcome, TrellisAuthError> {
        self.complete_with_client(trellis_url, Some(store)).await
    }

    async fn complete_with_client(
        self,
        trellis_url: &str,
        store: Option<std::sync::Arc<dyn crate::client::AuthorizationContextStore>>,
    ) -> Result<AdminLoginOutcome, TrellisAuthError> {
        let AgentLoginChallenge {
            flow_id,
            login_url: _,
            session_seed,
            participant_digest: _,
            auth,
        } = self;
        let flow_id = poll_agent_flow_until_ready(
            trellis_url,
            &flow_id,
            DETACHED_LOGIN_POLL_INTERVAL,
            Duration::from_secs(300),
        )
        .await?;
        let bound = bind_session(trellis_url, &flow_id, &auth).await?;
        let expires_at = bound.expires_at;
        let state = AdminSessionState {
            trellis_url: trellis_url.to_string(),
            session_seed,
            expires_at,
        };

        let (binding, target_store): (String, std::sync::Arc<dyn AuthorizationContextStore>) =
            if let Some(store) = store {
                (format!("test-admin:{}", state.trellis_url), store)
            } else {
                (
                    format!("installation:{}", state.trellis_url),
                    std::sync::Arc::new(crate::client::FileAuthorizationContextStore::new(
                        super::session_store::admin_authorization_context_state_path(),
                    )),
                )
            };
        let temporary_store = std::sync::Arc::new(MemoryAuthorizationContextStore::default());
        let client = connect_admin_client_with_context_store_async(
            &state,
            binding,
            temporary_store.clone(),
            Some(bound.installation),
        )
        .await?;
        let auth_client = AuthClient::new(&client);
        let response = auth_client
            .rpc()
            .auth()
            .sessions_me()
            .await
            .map_err(|error| TrellisAuthError::OperationFailed(error.to_string()))?;
        let user = response.user.ok_or_else(|| {
            TrellisAuthError::NotUserSession(response.session.participant_kind.as_str().to_owned())
        })?;
        let user = super::AuthenticatedUser {
            user_id: user
                .get("userId")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            principal_id: user
                .get("identity")
                .and_then(|identity| identity.get("identityId"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            state: if user.get("active").and_then(serde_json::Value::as_bool) == Some(true) {
                "active"
            } else {
                "disabled"
            }
            .to_owned(),
            capabilities: user
                .get("capabilities")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect(),
            email: user
                .get("email")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            image: user
                .get("image")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
            name: user
                .get("name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
        };
        if !user
            .capabilities
            .iter()
            .any(|capability| capability == "trellis.auth::admin")
        {
            return Err(TrellisAuthError::NotAdmin);
        }
        let authorization_state = temporary_store.load()?.ok_or_else(|| {
            TrellisAuthError::OperationFailed(
                "admin authorization context was not installed".to_owned(),
            )
        })?;
        target_store.commit(authorization_state)?;

        Ok(AdminLoginOutcome { state, user })
    }
}

/// Start the agent login flow against the detached Trellis portal.
#[doc = concat!("Asynchronous Trellis API operation `", stringify!(start_agent_login), "`.")]
pub async fn start_agent_login(
    opts: &StartAgentLoginOpts<'_>,
) -> Result<AgentLoginChallenge, TrellisAuthError> {
    let (session_seed, _session_key) = generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&session_seed)?;
    let redirect_to = format!(
        "{}/{}",
        opts.trellis_url.trim_end_matches('/'),
        detached_login_redirect_to()?.trim_start_matches('/')
    );
    let response = start_auth_request(opts.trellis_url, &redirect_to, &auth).await?;
    let participant_digest = cli_participant()?.digest;

    Ok(AgentLoginChallenge {
        flow_id: response.flow_id,
        login_url: response.login_url,
        session_seed,
        participant_digest,
        auth,
    })
}

/// Start admin reauthentication for a changed contract using the stored session key.
#[doc = concat!("Asynchronous Trellis API operation `", stringify!(start_admin_reauth), "`.")]
pub async fn start_admin_reauth(
    state: &AdminSessionState,
) -> Result<AdminReauthOutcome, TrellisAuthError> {
    let auth = SessionAuth::from_seed_base64url(&state.session_seed)?;
    let redirect_to = format!(
        "{}/{}",
        state.trellis_url.trim_end_matches('/'),
        detached_login_redirect_to()?.trim_start_matches('/')
    );
    let response = start_auth_request(&state.trellis_url, &redirect_to, &auth).await?;
    Ok(AdminReauthOutcome::Flow(Box::new(AgentLoginChallenge {
        flow_id: response.flow_id,
        login_url: response.login_url,
        session_seed: state.session_seed.clone(),
        participant_digest: cli_participant()?.digest,
        auth,
    })))
}

fn now_ms() -> Result<i64, TrellisAuthError> {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| TrellisAuthError::InvalidArgument(error.to_string()))?
            .as_millis(),
    )
    .map_err(|_| TrellisAuthError::InvalidArgument("current time exceeds i64 milliseconds".into()))
}
