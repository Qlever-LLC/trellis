use axum::extract::State;
use axum::Json;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use nkeys::{KeyPair, KeyPairType};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use subtle::ConstantTimeEq;
use trellis_protocol::{
    parse_session_proof, session_proof_request_digest, verify_session_proof,
    AuthorizationContextRefreshSessionProofInput, SessionProofInput,
};

use super::super::ephemeral::AuthEphemeralRepository;
use super::super::AuthorizationStateError;
use super::{
    map_issuance_error, now_ms, AccountRepository, AuthHttpState, AuthorityEvidenceRepository,
    AuthorityRepository, ContextRepository, DeploymentRepository, HttpError, OutboxRepository,
    PortalRepository, ProvisioningRepository, SessionRepository,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ContextRefreshRequest {
    request_id: String,
    issued_at: i64,
    session_id: String,
    session_nkey: String,
    current_context_digest: RequiredNullableString,
    expected_participant_digest: Option<String>,
    expected_needs_digest: Option<String>,
    known_root_key_id: String,
    minimum_manifest_generation: i64,
    proof: Value,
}

#[derive(Deserialize, Serialize)]
#[serde(transparent)]
pub(super) struct RequiredNullableString(Option<String>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ContextRefreshResponse {
    server_now: i64,
    session: super::super::SessionRecord,
    nats: super::NatsBootstrapResponse,
    authorization_context: super::super::AuthorizationContextBundle,
}

pub(super) async fn refresh_context<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Json(raw): Json<Value>,
) -> Result<Json<ContextRefreshResponse>, HttpError>
where
    R: AccountRepository
        + AuthorityEvidenceRepository
        + AuthorityRepository
        + ContextRepository
        + DeploymentRepository
        + OutboxRepository
        + PortalRepository
        + ProvisioningRepository
        + SessionRepository
        + Clone
        + Send
        + Sync
        + 'static,
    E: AuthEphemeralRepository + Clone,
{
    let now = now_ms()?;
    let request: ContextRefreshRequest = serde_json::from_value(raw.clone())
        .map_err(|_| HttpError::bad_request("invalid_context_refresh"))?;
    let session = state
        .service
        .repository()
        .get_session(&request.session_id)
        .await?
        .ok_or_else(|| map_issuance_error(AuthorizationStateError::SessionMissing))?;
    let session_nkey = KeyPair::from_public_key(&request.session_nkey)
        .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    let (_, session_nkey_bytes) = nkeys::from_public_key(&request.session_nkey)
        .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    let session_public_key = URL_SAFE_NO_PAD
        .decode(&session.session_public_key)
        .map_err(|_| HttpError::internal("invalid_session_key"))?;
    if session_nkey.key_pair_type() != KeyPairType::User
        || session_nkey_bytes
            .as_slice()
            .ct_eq(&session_public_key)
            .unwrap_u8()
            != 1
    {
        return Err(HttpError::unauthorized("invalid_proof"));
    }
    let request_digest = session_proof_request_digest(&raw)
        .map_err(|_| HttpError::bad_request("invalid_context_refresh"))?;
    let input = SessionProofInput::authorization_context_refresh(
        AuthorizationContextRefreshSessionProofInput {
            request_id: request.request_id.clone(),
            issued_at: request.issued_at,
            session_id: request.session_id.clone(),
            session_key_id: session.session_key_id.clone(),
            current_context_digest: request.current_context_digest.0.clone(),
            expected_participant_digest: request.expected_participant_digest.clone(),
            expected_needs_digest: request.expected_needs_digest.clone(),
            known_root_key_id: request.known_root_key_id.clone(),
            minimum_manifest_generation: request.minimum_manifest_generation,
            request_digest: request_digest.clone(),
        },
    )
    .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    verify_session_proof(
        &input,
        &parse_session_proof(&request.proof)
            .map_err(|_| HttpError::unauthorized("invalid_proof"))?,
        &session.session_public_key,
        now,
        state.proof_policy,
    )
    .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    if request.known_root_key_id != state.authorization_contexts.root_key_id()
        || u64::try_from(request.minimum_manifest_generation)
            .ok()
            .is_none_or(|minimum| minimum > state.authorization_contexts.manifest_generation())
    {
        return Err(HttpError::conflict("context_refresh_mismatch"));
    }
    if request
        .expected_participant_digest
        .as_deref()
        .is_some_and(|expected| expected != session.participant_artifact_digest)
        || request
            .expected_needs_digest
            .as_deref()
            .is_some_and(|expected| expected != session.participant_needs_digest)
    {
        return Err(HttpError::conflict("context_refresh_mismatch"));
    }
    let authorization_context = state
        .authorization_contexts
        .issue(
            super::super::AuthorizationContextIssueRequest {
                session_id: request.session_id.clone(),
                request_id: request.request_id,
                request_digest,
            },
            now / 1_000,
        )
        .await
        .map_err(map_issuance_error)?;
    let signed_context = trellis_protocol::parse_authorization_context(
        &authorization_context.context,
    )
    .map_err(|error| {
        tracing::error!(%error, "issued authorization context is invalid");
        HttpError::internal("internal_error")
    })?;
    let authorization_context_digest = signed_context.digest().map_err(|error| {
        tracing::error!(%error, "issued authorization context digest is invalid");
        HttpError::internal("internal_error")
    })?;
    let issued = state
        .authorization_contexts
        .require_current_context(
            &request.session_id,
            &authorization_context_digest,
            now / 1_000,
        )
        .await
        .map_err(map_issuance_error)?;
    let issued = issued.signed_context().map_err(map_issuance_error)?;
    if request
        .expected_participant_digest
        .as_deref()
        .is_some_and(|expected| expected != issued.unsigned.participant.artifact_digest)
        || request
            .expected_needs_digest
            .as_deref()
            .is_some_and(|expected| expected != issued.unsigned.participant.needs_digest)
    {
        return Err(HttpError::conflict("context_refresh_mismatch"));
    }
    let issuance = state
        .service
        .authorization()
        .resolve_issuable_state(&request.session_id, now)
        .await
        .map_err(map_issuance_error)?;
    let expires_at = [
        issuance.session_expires_at,
        issuance.effective_authority_expires_at,
        issuance.delegation_expires_at,
    ]
    .into_iter()
    .flatten()
    .min()
    .ok_or_else(|| HttpError::internal("credential_expiry_missing"))?;
    let route =
        state
            .issuer
            .deny_all_user_jwt(&request.session_nkey, expires_at / 1_000, now / 1_000)?;
    Ok(Json(ContextRefreshResponse {
        server_now: now,
        session,
        nats: super::NatsBootstrapResponse::new(
            route,
            state.native_nats_servers.clone(),
            state.websocket_nats_servers.clone(),
        ),
        authorization_context,
    }))
}
