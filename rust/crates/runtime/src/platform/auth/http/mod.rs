use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, PathBuf};
use std::sync::Arc;

use axum::extract::Query;
use axum::extract::{Path, State};
use axum::http::header::{CONTENT_TYPE, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use nats_jwt_rs::types::{Permission, Permissions};
use nats_jwt_rs::user::User;
use nats_jwt_rs::Claims;
use nkeys::{KeyPair, KeyPairType};
use openidconnect::core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata};
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce,
    OAuth2TokenResponse, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};
use trellis_protocol::{
    canonicalize_json, parse_api, parse_participant, parse_session_proof, resolve_participant,
    session_proof_request_digest, verify_session_proof, DeviceBootstrapSessionProofInput, GrantSet,
    ServiceBootstrapSessionProofInput, SessionProofInput, SessionProofPolicy,
    UserAuthRequestSessionProofInput,
};
use trellis_rs::service::{
    EventConsumerOrdering, EventConsumerReplay, EventConsumerResourceBinding,
    JobsQueueResourceBinding, JobsResourceBinding, JobsSchemaRef, KvResourceBinding,
    ServiceResourceBindings, StoreResourceBinding,
};

mod bootstrap;
mod browser;
mod error;
mod router;
mod security;
mod well_known;
use browser::BrowserFlowResponse;
use error::{map_issuance_error, HttpError};
pub(crate) use router::router;
use security::{
    canonical_origin, oauth_cookie_header, oauth_cookie_name, oidc_portal_policy_digest,
    require_oauth_browser_binding, require_portal_binding, require_portal_origin,
    require_selected_portal_origin, validate_portal_binding_digest, validate_redirect,
};

const EMBEDDED_WEB_ASSETS: &[(&str, &[u8])] = include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));
const MAX_AUTH_REQUEST_BODY_BYTES: usize = 4 * 1024 * 1024;
use url::Url;

use super::ephemeral::{
    claim_oauth_state, AuthBrowserFlow, AuthBrowserFlowKind, AuthBrowserFlowState,
    AuthEphemeralRepository, AuthOAuthKind, AuthOAuthState, AuthOAuthStatus,
    BrowserConsentProposal, BROWSER_FLOW_FORMAT,
};
use super::{
    portal_policy_snapshot, resolve_portal_authority_selection, AccountFlowState,
    AccountRepository, ApplyIdentityAuthoritySelectionInput, AuthService,
    AuthorityEvidenceRepository, AuthorityKind, AuthorityProposalKind, AuthorityProposalRecord,
    AuthorityProposalState, AuthorityRepository, AuthorityState, AuthorityTarget,
    AuthorizationStateError, CompleteIdentityLinkInput, CompletePasswordResetInput,
    ContextRepository, CreateActivationReviewInput, CreateFederatedUserInput, CreateLocalUserInput,
    CreateSessionInput, DeploymentRepository, DesiredAuthorityRecord, DeviceState,
    EnrollDeviceIdentityInput, FirstAdminFederatedRegistration, FirstAdminRegistration,
    IdempotencyResultRecord, IdempotentOutcome, LocalAuthentication, LoginPortalRecord,
    LoginSettingsRecord, OutboxRepository, ParticipantBindingRecord, ParticipantBindingState,
    PortalAuthoritySource, PortalBindingMutation, PortalRepository, PostCommitActionKind,
    PostCommitActionRecord, PresentDeploymentAuthorityInput, PrincipalKind,
    ProviderLoginAttributes, ProvisionedIdentityKind, ProvisionedIdentityState,
    ProvisioningRepository, ResourceBindingEvidence, ResourceProviderIdentity,
    RuntimeInstanceState, SessionRecord, SessionRepository,
};

const FLOW_TTL_MS: i64 = 15 * 60_000;
const IDEMPOTENCY_TTL_MS: i64 = 24 * 60 * 60_000;

#[derive(Clone)]
pub(crate) struct OidcProvider {
    metadata: CoreProviderMetadata,
    client_id: ClientId,
    client_secret: Option<ClientSecret>,
    redirect_uri: RedirectUrl,
    scopes: Vec<Scope>,
    role_claims: Vec<String>,
}

pub(crate) async fn discover_oidc_providers(
    config: Option<&crate::config::OAuthConfig>,
    public_origin: &str,
) -> Result<BTreeMap<String, OidcProvider>, AuthorizationStateError> {
    let Some(config) = config else {
        return Ok(BTreeMap::new());
    };
    let redirect_base = config.redirect_base.as_deref().unwrap_or(public_origin);
    let http_client = openidconnect::reqwest::ClientBuilder::new()
        .redirect(openidconnect::reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| {
            AuthorizationStateError::Storage(format!("failed to build OIDC HTTP client: {error}"))
        })?;
    let mut providers = BTreeMap::new();
    for (provider_id, provider) in &config.providers {
        if provider.provider_type != "oidc" {
            return Err(AuthorizationStateError::InvalidRecord(format!(
                "OAuth provider {provider_id} type must be oidc"
            )));
        }
        if provider
            .role_claims
            .iter()
            .any(|pointer| !valid_json_pointer(pointer))
        {
            return Err(AuthorizationStateError::InvalidRecord(format!(
                "OAuth provider {provider_id} has an invalid role_claims JSON Pointer"
            )));
        }
        let issuer = provider.issuer.clone().ok_or_else(|| {
            AuthorizationStateError::InvalidRecord(format!(
                "OAuth provider {provider_id} has no issuer"
            ))
        })?;
        let metadata = CoreProviderMetadata::discover_async(
            IssuerUrl::new(issuer).map_err(|_| {
                AuthorizationStateError::InvalidRecord(format!(
                    "OAuth provider {provider_id} issuer is invalid"
                ))
            })?,
            &http_client,
        )
        .await
        .map_err(|error| {
            AuthorizationStateError::Storage(format!(
                "OIDC discovery failed for {provider_id}: {error}"
            ))
        })?;
        let client_id = ClientId::new(provider.client_id.clone().ok_or_else(|| {
            AuthorizationStateError::InvalidRecord(format!(
                "OAuth provider {provider_id} has no client_id"
            ))
        })?);
        let secret = match (&provider.client_secret, &provider.client_secret_file) {
            (Some(secret), None) => Some(secret.clone()),
            (None, Some(path)) => Some(fs::read_to_string(path).map_err(|error| {
                AuthorizationStateError::Storage(format!(
                    "failed to read OAuth provider {provider_id} secret: {error}"
                ))
            })?),
            (None, None) => None,
            (Some(_), Some(_)) => {
                return Err(AuthorizationStateError::InvalidRecord(format!(
                    "OAuth provider {provider_id} has two client secrets"
                )))
            }
        };
        let redirect_uri = RedirectUrl::new(format!(
            "{}/{provider_id}",
            redirect_base.trim_end_matches('/')
        ))
        .map_err(|_| {
            AuthorizationStateError::InvalidRecord(format!(
                "OAuth provider {provider_id} redirect URI is invalid"
            ))
        })?;
        providers.insert(
            provider_id.clone(),
            OidcProvider {
                metadata,
                client_id,
                client_secret: secret.map(|secret| ClientSecret::new(secret.trim().to_owned())),
                redirect_uri,
                scopes: provider
                    .scopes
                    .clone()
                    .unwrap_or_else(|| {
                        vec![
                            "openid".to_owned(),
                            "profile".to_owned(),
                            "email".to_owned(),
                        ]
                    })
                    .into_iter()
                    .map(Scope::new)
                    .collect(),
                role_claims: provider.role_claims.clone(),
            },
        );
    }
    Ok(providers)
}

fn valid_json_pointer(pointer: &str) -> bool {
    pointer.starts_with('/')
        && !pointer.as_bytes().iter().enumerate().any(|(index, byte)| {
            *byte == b'~' && !matches!(pointer.as_bytes().get(index + 1), Some(b'0' | b'1'))
        })
}

#[derive(Clone)]
pub(super) struct AuthHttpState<R, E> {
    service: AuthService<R>,
    ephemeral: E,
    issuer: NatsBootstrapIssuer,
    authorization_contexts: super::AuthorizationContextService,
    public_origin: String,
    allowed_redirect_origins: Vec<String>,
    native_nats_servers: Vec<String>,
    websocket_nats_servers: Vec<String>,
    oidc_providers: BTreeMap<String, OidcProvider>,
    proof_policy: SessionProofPolicy,
    web_source: WebSource,
    portal_source: WebSource,
    console_source: WebSource,
    console_source_is_override: bool,
}

#[derive(Clone)]
enum WebSource {
    Embedded,
    Directory(PathBuf),
    Proxy(axum::Router),
}

pub(crate) struct AuthHttpOptions<R, E> {
    pub service: AuthService<R>,
    pub ephemeral: E,
    pub issuer: NatsBootstrapIssuer,
    pub authorization_contexts: super::AuthorizationContextService,
    pub public_origin: String,
    pub allowed_origins: Vec<String>,
    pub native_nats_servers: Vec<String>,
    pub websocket_nats_servers: Vec<String>,
    pub oidc_providers: BTreeMap<String, OidcProvider>,
    pub rate_limit_max: u32,
    pub rate_limit_window_ms: u64,
    pub web_source: Option<crate::config::WebSourceConfig>,
    pub portal_source: Option<crate::config::WebSourceConfig>,
    pub console_source: Option<crate::config::WebSourceConfig>,
}

#[derive(Clone)]
pub(crate) struct NatsBootstrapIssuer {
    signing_key: Arc<KeyPair>,
    auth_account: String,
    maximum_lifetime_seconds: i64,
}

impl NatsBootstrapIssuer {
    pub(crate) fn from_files(
        signing_seed_file: &std::path::Path,
        auth_user_creds_file: &std::path::Path,
        maximum_lifetime_seconds: u64,
    ) -> Result<Self, AuthorizationStateError> {
        let seed = fs::read_to_string(signing_seed_file).map_err(|error| {
            AuthorizationStateError::Storage(format!(
                "failed to read auth issuer signing seed: {error}"
            ))
        })?;
        let signing_key = KeyPair::from_seed(seed.trim()).map_err(|error| {
            AuthorizationStateError::Storage(format!("invalid auth issuer signing seed: {error}"))
        })?;
        if signing_key.key_pair_type() != KeyPairType::Account {
            return Err(AuthorizationStateError::InvalidRecord(
                "auth issuer signing seed must be an account NKey".to_owned(),
            ));
        }
        let credentials = fs::read_to_string(auth_user_creds_file).map_err(|error| {
            AuthorizationStateError::Storage(format!("failed to read auth user creds: {error}"))
        })?;
        let jwt = credentials
            .lines()
            .skip_while(|line| *line != "-----BEGIN NATS USER JWT-----")
            .skip(1)
            .find(|line| !line.trim().is_empty())
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord(
                    "auth user creds contain no user JWT".to_owned(),
                )
            })?;
        let claims = Claims::<User>::decode(jwt).map_err(|error| {
            AuthorizationStateError::InvalidRecord(format!("auth user JWT is invalid: {error}"))
        })?;
        let auth_account = claims
            .payload()
            .issuer_account
            .clone()
            .unwrap_or_else(|| claims.iss.clone());
        Ok(Self {
            signing_key: Arc::new(signing_key),
            auth_account,
            maximum_lifetime_seconds: i64::try_from(maximum_lifetime_seconds).map_err(|_| {
                AuthorizationStateError::InvalidRecord(
                    "maximum bootstrap JWT lifetime is too large".to_owned(),
                )
            })?,
        })
    }

    fn deny_all_user_jwt(
        &self,
        session_nkey: &str,
        expires_at_seconds: i64,
        now_seconds: i64,
    ) -> Result<IssuedBootstrapJwt, AuthorizationStateError> {
        let (kind, _) = nkeys::from_public_key(session_nkey).map_err(|_| {
            AuthorizationStateError::InvalidRecord(
                "sessionNkey is not a canonical NATS public key".to_owned(),
            )
        })?;
        if KeyPairType::from(kind) != KeyPairType::User {
            return Err(AuthorizationStateError::InvalidRecord(
                "sessionNkey must be a NATS User NKey".to_owned(),
            ));
        }
        let deny = Permission {
            allow: Vec::new(),
            deny: vec![">".to_owned()],
        };
        let mut claims = User::new_claims("trellis-session".to_owned(), session_nkey.to_owned());
        let expires_at = expires_at_seconds.min(
            now_seconds
                .checked_add(self.maximum_lifetime_seconds)
                .ok_or_else(|| {
                    AuthorizationStateError::InvalidRecord(
                        "bootstrap JWT expiry overflows".to_owned(),
                    )
                })?,
        );
        claims.exp = Some(expires_at);
        let user = claims.payload_mut();
        user.issuer_account = Some(self.auth_account.clone());
        user.permissions.permissions = Permissions {
            publish: deny.clone(),
            subscribe: deny,
            resp: None,
        };
        let jwt = claims.encode(&self.signing_key).map_err(|error| {
            AuthorizationStateError::Storage(format!(
                "failed to sign session bootstrap JWT: {error}"
            ))
        })?;
        Ok(IssuedBootstrapJwt { jwt, expires_at })
    }
}

struct IssuedBootstrapJwt {
    jwt: String,
    expires_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NatsBootstrapResponse {
    jwt: String,
    jwt_expires_at: i64,
    transports: NatsTransports,
}

impl NatsBootstrapResponse {
    fn new(
        route: IssuedBootstrapJwt,
        native_nats_servers: Vec<String>,
        websocket_nats_servers: Vec<String>,
    ) -> Self {
        Self {
            jwt: route.jwt,
            jwt_expires_at: route.expires_at,
            transports: NatsTransports {
                native: (!native_nats_servers.is_empty()).then_some(NatsTransportRoute {
                    nats_servers: native_nats_servers,
                }),
                websocket: (!websocket_nats_servers.is_empty()).then_some(NatsTransportRoute {
                    nats_servers: websocket_nats_servers,
                }),
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NatsTransports {
    #[serde(skip_serializing_if = "Option::is_none")]
    native: Option<NatsTransportRoute>,
    #[serde(skip_serializing_if = "Option::is_none")]
    websocket: Option<NatsTransportRoute>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NatsTransportRoute {
    nats_servers: Vec<String>,
}

fn flow_response(flow: AuthBrowserFlow) -> BrowserFlowResponse {
    BrowserFlowResponse {
        flow_id: flow.flow_id,
        state: flow.state,
        expires_at: flow.expires_at,
        providers: Vec::new(),
        registration_enabled: false,
        federated_registration_enabled: false,
        consent_view: flow.consent.consent_view,
        redirect_target: flow.redirect_target,
    }
}

fn browser_consent(
    binding: &ParticipantBindingRecord,
) -> Result<BrowserConsentProposal, HttpError> {
    super::browser_consent_proposal(binding).map_err(Into::into)
}

fn select_browser_authority(
    consent: &BrowserConsentProposal,
    selected_optional_bundles: &[String],
) -> Result<(GrantSet, Vec<String>, BTreeSet<String>), HttpError> {
    let selected = selected_optional_bundles
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if selected.len() != selected_optional_bundles.len() {
        return Err(HttpError::bad_request("duplicate_optional_bundle"));
    }
    let mut permissions = consent.required_grant_set.permissions().to_vec();
    for bundle_id in &selected {
        let bundle = consent
            .optional_grant_bundles
            .get(bundle_id)
            .ok_or_else(|| HttpError::bad_request("unknown_optional_bundle"))?;
        permissions.extend_from_slice(bundle.permissions());
    }
    let grant_set = GrantSet::new(permissions);
    let mut capabilities = consent.required_capabilities.clone();
    for (qualified_name, definition) in &consent.optional_capability_definitions {
        if definition
            .permissions()
            .iter()
            .all(|permission| grant_set.permissions().contains(permission))
        {
            capabilities.push(qualified_name.clone());
        }
    }
    capabilities.sort();
    capabilities.dedup();
    Ok((grant_set, capabilities, selected))
}

async fn load_flow(
    repository: &impl AuthEphemeralRepository,
    flow_id: &str,
) -> Result<AuthBrowserFlow, HttpError> {
    let flow = repository
        .get_browser_flow(flow_id)
        .await?
        .ok_or_else(|| HttpError::not_found("flow_not_found"))?;
    if flow.expires_at < now_ms()? && flow.state != AuthBrowserFlowState::Expired {
        let expected = flow.version;
        let mut expired = flow;
        expired.state = AuthBrowserFlowState::Expired;
        expired.completed_at = Some(now_ms()?);
        expired.version += 1;
        repository.replace_browser_flow(expected, expired).await?;
        return Err(HttpError::gone("flow_expired"));
    }
    Ok(flow)
}

fn idempotency(
    scope: &str,
    purpose: &str,
    signer_id: &str,
    request_id: &str,
    request_digest: &str,
    now: i64,
) -> Result<IdempotencyResultRecord, HttpError> {
    Ok(IdempotencyResultRecord {
        scope_key: digest_parts(&[scope, purpose, signer_id, request_id]),
        purpose: purpose.to_owned(),
        signer_id: signer_id.to_owned(),
        request_id: request_id.to_owned(),
        request_digest: request_digest.to_owned(),
        result: json!({}),
        created_at: now,
        expires_at: checked_add(now, IDEMPOTENCY_TTL_MS)?,
    })
}

fn now_ms() -> Result<i64, HttpError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| HttpError::internal("clock_before_epoch"))?
        .as_millis()
        .try_into()
        .map_err(|_| HttpError::internal("clock_overflow"))
}

fn checked_add(value: i64, duration: i64) -> Result<i64, HttpError> {
    value
        .checked_add(duration)
        .filter(|value| *value <= super::MAX_PROTOCOL_INTEGER as i64)
        .ok_or_else(|| HttpError::internal("timestamp_overflow"))
}

fn digest_parts(parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    URL_SAFE_NO_PAD.encode(digest.finalize())
}

fn session_revocation_actions(
    scope: &str,
    request_id: &str,
    now: i64,
    payload: Value,
) -> Vec<PostCommitActionRecord> {
    [
        (PostCommitActionKind::Event, "event"),
        (PostCommitActionKind::Kick, "kick"),
    ]
    .into_iter()
    .map(|(kind, suffix)| PostCommitActionRecord {
        predecessor_action_id: None,
        action_id: digest_parts(&[scope, request_id, suffix]),
        kind,
        payload: payload.clone(),
        created_at: now,
        attempts: 0,
        next_attempt_at: now,
        claimed_until: None,
        last_error: None,
    })
    .collect()
}

fn proof_request_digest(raw: &Value) -> Result<String, trellis_protocol::ProtocolError> {
    session_proof_request_digest(raw)
}

fn first_admin_token_hash(token: &str) -> Result<String, HttpError> {
    let decoded = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| HttpError::bad_request("invalid_account_flow"))?;
    if decoded.len() != 32 || URL_SAFE_NO_PAD.encode(&decoded) != token {
        return Err(HttpError::bad_request("invalid_account_flow"));
    }
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(decoded)))
}

async fn load_account_flow_by_token(
    repository: &impl AccountRepository,
    token: &str,
) -> Result<Option<(String, super::AccountFlowRecord)>, HttpError> {
    let mut hashes = vec![URL_SAFE_NO_PAD.encode(Sha256::digest(token.as_bytes()))];
    if let Ok(hash) = first_admin_token_hash(token) {
        hashes.insert(0, hash);
    }
    for hash in hashes {
        if let Some(flow) = repository.get_account_flow_by_hash(&hash).await? {
            return Ok(Some((hash, flow)));
        }
    }
    Ok(None)
}

fn getrandom_bytes() -> Result<[u8; 16], HttpError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| HttpError::internal("entropy_unavailable"))?;
    Ok(bytes)
}

fn project_service_resource_bindings(
    participant_json: &str,
    evidence: &[ResourceBindingEvidence],
    participant_id: &str,
) -> Result<ServiceResourceBindings, HttpError> {
    let participant: Value = serde_json::from_str(participant_json)
        .map_err(|_| HttpError::internal("participant_artifact_invalid"))?;
    let mut resources = ServiceResourceBindings::default();
    let mut job_queues = BTreeMap::new();
    let mut jobs_namespace = None;
    let mut jobs_work_stream = None;

    for binding in evidence {
        match &binding.provider_identity {
            ResourceProviderIdentity::Kv { bucket } => {
                let config = participant_resource(&participant, "kv", &binding.local_name)?;
                resources.kv.insert(
                    binding.local_name.clone(),
                    KvResourceBinding {
                        bucket: bucket.clone(),
                        history: config.get("history").and_then(Value::as_i64).unwrap_or(1),
                        max_value_bytes: optional_i64(config, "maxValueBytes")?,
                        ttl_ms: config.get("ttlMs").and_then(Value::as_i64).unwrap_or(0),
                    },
                );
            }
            ResourceProviderIdentity::Store { bucket } => {
                let config = participant_resource(&participant, "store", &binding.local_name)?;
                resources.store.insert(
                    binding.local_name.clone(),
                    StoreResourceBinding {
                        name: bucket.clone(),
                        max_object_bytes: optional_i64(config, "maxObjectBytes")?,
                        max_total_bytes: optional_i64(config, "maxTotalBytes")?,
                        ttl_ms: config.get("ttlMs").and_then(Value::as_i64).unwrap_or(0),
                    },
                );
            }
            ResourceProviderIdentity::State { .. } => {}
            ResourceProviderIdentity::JobQueue {
                namespace,
                work_stream,
                publish_prefix,
                updates_prefix,
                work_subject,
                consumer,
            } => {
                let config = participant
                    .get("jobQueues")
                    .and_then(Value::as_object)
                    .and_then(|queues| queues.get(&binding.local_name))
                    .ok_or_else(|| HttpError::internal("job_queue_binding_invalid"))?;
                if jobs_namespace
                    .as_ref()
                    .is_some_and(|current| current != namespace)
                    || jobs_work_stream
                        .as_ref()
                        .is_some_and(|current| current != work_stream)
                {
                    return Err(HttpError::internal("job_resource_identity_mismatch"));
                }
                jobs_namespace = Some(namespace.clone());
                jobs_work_stream = Some(work_stream.clone());
                job_queues.insert(
                    binding.local_name.clone(),
                    JobsQueueResourceBinding {
                        queue_type: binding.local_name.clone(),
                        publish_prefix: publish_prefix.clone(),
                        updates_prefix: updates_prefix.clone(),
                        work_subject: work_subject.clone(),
                        consumer_name: consumer.clone(),
                        payload: required_schema_ref(config, "payload")?,
                        update: optional_schema_ref(config, "update")?,
                        result: optional_schema_ref(config, "result")?,
                        max_deliver: config
                            .get("maxDeliver")
                            .and_then(Value::as_i64)
                            .unwrap_or(5),
                        backoff_ms: config
                            .get("backoffMs")
                            .map(|_| required_i64_array(config, "backoffMs"))
                            .transpose()?
                            .unwrap_or_else(|| vec![5_000, 30_000, 120_000, 600_000]),
                        ack_wait_ms: config
                            .get("ackWaitMs")
                            .and_then(Value::as_i64)
                            .unwrap_or(300_000),
                        default_deadline_ms: optional_i64(config, "defaultDeadlineMs")?,
                        progress: config
                            .get("progress")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        logs: config.get("logs").and_then(Value::as_bool).unwrap_or(false),
                        dlq: config.get("dlq").and_then(Value::as_bool).unwrap_or(false),
                        key_concurrency: optional_policy(config, "keyConcurrency")?,
                        queue: optional_policy(config, "queue")?,
                    },
                );
            }
            ResourceProviderIdentity::EventConsumer {
                stream,
                consumer,
                filter_subjects,
            } => {
                let config = participant
                    .get("eventConsumers")
                    .and_then(Value::as_object)
                    .and_then(|consumers| consumers.get(&binding.local_name))
                    .ok_or_else(|| HttpError::internal("event_consumer_binding_invalid"))?;
                let max_deliver = config
                    .get("maxDeliver")
                    .and_then(Value::as_i64)
                    .unwrap_or(6);
                let backoff_ms = config
                    .get("backoffMs")
                    .map(|_| required_i64_array(config, "backoffMs"))
                    .transpose()?
                    .unwrap_or_else(|| {
                        [5_000, 30_000, 120_000, 600_000, 1_800_000]
                            .into_iter()
                            .take(max_deliver.saturating_sub(1) as usize)
                            .collect()
                    });
                resources.event_consumers.insert(
                    binding.local_name.clone(),
                    EventConsumerResourceBinding {
                        stream: stream.clone(),
                        consumer_name: consumer.clone(),
                        filter_subjects: filter_subjects.clone(),
                        replay: match config
                            .get("replay")
                            .and_then(Value::as_str)
                            .unwrap_or("new")
                        {
                            "new" => EventConsumerReplay::New,
                            "all" => EventConsumerReplay::All,
                            _ => EventConsumerReplay::Unknown,
                        },
                        ordering: match config
                            .get("ordering")
                            .and_then(Value::as_str)
                            .unwrap_or("strict")
                        {
                            "strict" => EventConsumerOrdering::Strict,
                            "parallel" => EventConsumerOrdering::Parallel,
                            _ => EventConsumerOrdering::Unknown,
                        },
                        ack_wait_ms: config
                            .get("ackWaitMs")
                            .and_then(Value::as_i64)
                            .unwrap_or(300_000),
                        max_deliver,
                        backoff_ms,
                    },
                );
            }
        }
    }
    if !job_queues.is_empty() {
        resources.jobs = Some(JobsResourceBinding {
            service_name: participant_id.to_owned(),
            namespace: jobs_namespace
                .ok_or_else(|| HttpError::internal("job_namespace_missing"))?,
            work_stream: jobs_work_stream,
            queues: job_queues,
        });
    }
    Ok(resources)
}

fn participant_resource<'a>(
    participant: &'a Value,
    family: &str,
    local_name: &str,
) -> Result<&'a Value, HttpError> {
    participant
        .get("resources")
        .and_then(Value::as_object)
        .and_then(|resources| resources.get(family))
        .and_then(Value::as_object)
        .and_then(|resources| resources.get(local_name))
        .ok_or_else(|| HttpError::internal("resource_binding_invalid"))
}

fn optional_i64(value: &Value, field: &str) -> Result<Option<i64>, HttpError> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or_else(|| HttpError::internal("resource_policy_invalid")),
    }
}

fn required_i64_array(value: &Value, field: &str) -> Result<Vec<i64>, HttpError> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| HttpError::internal("resource_policy_invalid"))?
        .iter()
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| HttpError::internal("resource_policy_invalid"))
        })
        .collect()
}

fn required_schema_ref(value: &Value, field: &str) -> Result<JobsSchemaRef, HttpError> {
    optional_schema_ref(value, field)?
        .ok_or_else(|| HttpError::internal("job_schema_reference_missing"))
}

fn optional_schema_ref(value: &Value, field: &str) -> Result<Option<JobsSchemaRef>, HttpError> {
    let Some(value) = value.get(field) else {
        return Ok(None);
    };
    let schema = value
        .get("schema")
        .and_then(Value::as_str)
        .ok_or_else(|| HttpError::internal("job_schema_reference_invalid"))?;
    Ok(Some(JobsSchemaRef {
        schema: schema.to_owned(),
    }))
}

fn optional_policy<T: serde::de::DeserializeOwned>(
    value: &Value,
    field: &str,
) -> Result<Option<T>, HttpError> {
    let mut policy = value.get(field).cloned();
    if let Some(object) = policy.as_mut().and_then(Value::as_object_mut) {
        if field == "keyConcurrency" {
            object.entry("maxActive").or_insert(json!(1));
            object.entry("heartbeatIntervalMs").or_insert(json!(30_000));
            object.entry("heartbeatTtlMs").or_insert(json!(120_000));
            object.entry("stalePolicy").or_insert(json!("fail-stale"));
        } else if field == "queue" {
            object.entry("maxQueuedPerKey").or_insert(json!(0));
            object.entry("whenFull").or_insert(json!("reject"));
        }
    }
    policy
        .map(serde_json::from_value)
        .transpose()
        .map_err(|_| HttpError::internal("job_policy_invalid"))
}

#[cfg(test)]
mod tests;
