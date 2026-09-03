use super::super::{AuthorizationContextBundle, AuthorizationContextIssueRequest};
use super::*;
use crate::platform::auth::{DeviceActivationReviewState, DeviceReviewMode};
use ulid::Ulid;

fn device_activation_url(
    portal: &LoginPortalRecord,
    public_origin: &str,
    review_id: &str,
) -> Result<String, HttpError> {
    let entry = portal.entry_url.as_deref().map_or_else(
        || format!("{}/login/device", public_origin.trim_end_matches('/')),
        ToOwned::to_owned,
    );
    let mut url = Url::parse(&entry).map_err(|_| HttpError::internal("portal_entry_invalid"))?;
    url.query_pairs_mut().append_pair("flowId", review_id);
    Ok(url.into())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ServiceBootstrapRequest {
    request_id: String,
    issued_at: i64,
    deployment_id: String,
    instance_id: String,
    provisioned_identity_key_id: String,
    new_session_public_key: String,
    new_session_nkey: String,
    participant_id: String,
    participant_artifact_digest: String,
    participant_needs_digest: String,
    participant_artifact: Option<Value>,
    referenced_api_artifacts: Option<Vec<Value>>,
    proof: Value,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeviceBootstrapRequest {
    request_id: String,
    issued_at: i64,
    deployment_id: String,
    instance_id: String,
    device_identity_key_id: String,
    principal_id: Option<String>,
    identity_public_key: Option<String>,
    provisioning_secret: Option<String>,
    expected_secret_version: Option<u64>,
    new_session_public_key: String,
    new_session_nkey: String,
    participant_id: String,
    participant_artifact_digest: String,
    participant_needs_digest: String,
    participant_artifact: Option<Value>,
    referenced_api_artifacts: Option<Vec<Value>>,
    challenge_digest: Option<String>,
    confirmation_code: Option<String>,
    proof: Value,
}

struct BootstrapInput {
    request_id: String,
    issued_at: i64,
    deployment_id: String,
    instance_id: String,
    identity_key_id: String,
    principal_id: Option<String>,
    identity_public_key: Option<String>,
    provisioning_secret: Option<String>,
    expected_secret_version: Option<u64>,
    new_session_public_key: String,
    new_session_nkey: String,
    participant_id: String,
    participant_artifact_digest: String,
    participant_needs_digest: String,
    participant_artifact: Option<Value>,
    referenced_api_artifacts: Option<Vec<Value>>,
    challenge_digest: Option<String>,
    confirmation_code: Option<String>,
    proof: Value,
    request_digest: String,
    kind: ProvisionedIdentityKind,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BootstrapResponse {
    server_now: i64,
    state: &'static str,
    session: Option<SessionRecord>,
    authorization: Option<BootstrapAuthorization>,
    nats: Option<NatsBootstrapResponse>,
    authorization_context: Option<AuthorizationContextBundle>,
    activation: Option<BootstrapActivation>,
    proposal: Option<BootstrapProposal>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapProposal {
    proposal_id: String,
    proposal_kind: AuthorityProposalKind,
    proposal_digest: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapAuthorization {
    participant_id: String,
    participant_artifact_digest: String,
    participant_needs_digest: String,
    participant_json: String,
    effective_grants: GrantSet,
    resource_bindings: Vec<ResourceBindingEvidence>,
    resource_runtime: ServiceResourceBindings,
    effective_authority_expires_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapActivation {
    state: &'static str,
    review_id: String,
    activation_url: String,
    expires_at: i64,
    /// Suggested device retry delay for the proof-bound bootstrap flow.
    retry_after_ms: u64,
}

pub(super) async fn service_bootstrap<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Json(raw): Json<Value>,
) -> Result<Json<BootstrapResponse>, HttpError>
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
    let request: ServiceBootstrapRequest = serde_json::from_value(raw.clone())
        .map_err(|_| HttpError::bad_request("invalid_service_bootstrap"))?;
    let request_digest = proof_request_digest(&raw)
        .map_err(|_| HttpError::bad_request("invalid_service_bootstrap"))?;
    bootstrap(
        &state,
        BootstrapInput {
            request_id: request.request_id,
            issued_at: request.issued_at,
            deployment_id: request.deployment_id,
            instance_id: request.instance_id,
            identity_key_id: request.provisioned_identity_key_id,
            principal_id: None,
            identity_public_key: None,
            provisioning_secret: None,
            expected_secret_version: None,
            new_session_public_key: request.new_session_public_key,
            new_session_nkey: request.new_session_nkey,
            participant_id: request.participant_id,
            participant_artifact_digest: request.participant_artifact_digest,
            participant_needs_digest: request.participant_needs_digest,
            participant_artifact: request.participant_artifact,
            referenced_api_artifacts: request.referenced_api_artifacts,
            challenge_digest: None,
            confirmation_code: None,
            proof: request.proof,
            request_digest,
            kind: ProvisionedIdentityKind::Service,
        },
    )
    .await
    .map(Json)
}

pub(super) async fn device_bootstrap<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Json(raw): Json<Value>,
) -> Result<Json<BootstrapResponse>, HttpError>
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
    let request: DeviceBootstrapRequest = serde_json::from_value(raw.clone())
        .map_err(|_| HttpError::bad_request("invalid_device_bootstrap"))?;
    let request_digest = proof_request_digest(&raw)
        .map_err(|_| HttpError::bad_request("invalid_device_bootstrap"))?;
    bootstrap(&state, device_bootstrap_input(request, request_digest))
        .await
        .map(Json)
}

fn device_bootstrap_input(
    request: DeviceBootstrapRequest,
    request_digest: String,
) -> BootstrapInput {
    BootstrapInput {
        request_id: request.request_id,
        issued_at: request.issued_at,
        deployment_id: request.deployment_id,
        instance_id: request.instance_id,
        identity_key_id: request.device_identity_key_id,
        principal_id: request.principal_id,
        identity_public_key: request.identity_public_key,
        provisioning_secret: request.provisioning_secret,
        expected_secret_version: request.expected_secret_version,
        new_session_public_key: request.new_session_public_key,
        new_session_nkey: request.new_session_nkey,
        participant_id: request.participant_id,
        participant_artifact_digest: request.participant_artifact_digest,
        participant_needs_digest: request.participant_needs_digest,
        participant_artifact: request.participant_artifact,
        referenced_api_artifacts: request.referenced_api_artifacts,
        challenge_digest: request.challenge_digest,
        confirmation_code: request.confirmation_code,
        proof: request.proof,
        request_digest,
        kind: ProvisionedIdentityKind::Device,
    }
}

async fn bootstrap<R, E>(
    state: &AuthHttpState<R, E>,
    input: BootstrapInput,
) -> Result<BootstrapResponse, HttpError>
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
    let existing_identity = state
        .service
        .repository()
        .get_provisioned_identity(&input.identity_key_id)
        .await?;
    let verifying_public_key = if let Some(identity) = &existing_identity {
        identity.identity_public_key.clone()
    } else if input.kind == ProvisionedIdentityKind::Device {
        let public_key = input
            .identity_public_key
            .clone()
            .ok_or_else(|| HttpError::unauthorized("identity_not_found"))?;
        let derived =
            super::super::domain::validate_ed25519_public_key("identityPublicKey", &public_key)?;
        if derived != input.identity_key_id {
            return Err(HttpError::unauthorized("identity_key_mismatch"));
        }
        public_key
    } else {
        return Err(HttpError::unauthorized("identity_not_found"));
    };
    let proof_input = match input.kind {
        ProvisionedIdentityKind::Service => {
            SessionProofInput::service_bootstrap(ServiceBootstrapSessionProofInput {
                request_id: input.request_id.clone(),
                issued_at: input.issued_at,
                deployment_id: input.deployment_id.clone(),
                instance_id: input.instance_id.clone(),
                provisioned_identity_key_id: input.identity_key_id.clone(),
                new_session_public_key: input.new_session_public_key.clone(),
                new_session_nkey: input.new_session_nkey.clone(),
                participant_id: input.participant_id.clone(),
                participant_digest: input.participant_artifact_digest.clone(),
                request_digest: input.request_digest.clone(),
            })
        }
        ProvisionedIdentityKind::Device => {
            SessionProofInput::device_bootstrap(DeviceBootstrapSessionProofInput {
                request_id: input.request_id.clone(),
                issued_at: input.issued_at,
                deployment_id: input.deployment_id.clone(),
                instance_id: input.instance_id.clone(),
                device_identity_key_id: input.identity_key_id.clone(),
                new_session_public_key: input.new_session_public_key.clone(),
                new_session_nkey: input.new_session_nkey.clone(),
                participant_id: input.participant_id.clone(),
                participant_digest: input.participant_artifact_digest.clone(),
                challenge_digest: input.challenge_digest.clone(),
                request_digest: input.request_digest.clone(),
            })
        }
    }
    .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    let proof =
        parse_session_proof(&input.proof).map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    verify_session_proof(
        &proof_input,
        &proof,
        &verifying_public_key,
        now_ms()?,
        state.proof_policy,
    )
    .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    let proof_signer_key_id = proof_input.signer_key_id().to_owned();
    let proof_request_id = proof_input.request_id().to_owned();
    let now = now_ms()?;
    if existing_identity.is_none() {
        state
            .service
            .enroll_device_identity(EnrollDeviceIdentityInput {
                provisioning_secret: input
                    .provisioning_secret
                    .clone()
                    .ok_or_else(|| HttpError::unauthorized("provisioning_secret_required"))?,
                expected_version: input
                    .expected_secret_version
                    .ok_or_else(|| HttpError::bad_request("expected_secret_version_required"))?,
                principal_id: input
                    .principal_id
                    .clone()
                    .ok_or_else(|| HttpError::bad_request("principal_id_required"))?,
                deployment_id: input.deployment_id.clone(),
                instance_id: input.instance_id.clone(),
                identity_public_key: verifying_public_key,
                consumed_at: now,
                idempotency: idempotency(
                    &input.identity_key_id,
                    "device.identity.enroll",
                    &proof_signer_key_id,
                    &proof_request_id,
                    &input.request_digest,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
    }
    let identity = state
        .service
        .repository()
        .get_provisioned_identity(&input.identity_key_id)
        .await?
        .ok_or_else(|| HttpError::unauthorized("identity_not_found"))?;
    if identity.state != ProvisionedIdentityState::Active
        || identity.kind != input.kind
        || identity.deployment_id != input.deployment_id
        || identity.instance_id != input.instance_id
    {
        return Err(HttpError::unauthorized("identity_mismatch"));
    }
    let instance = state
        .service
        .repository()
        .get_runtime_instance(&input.instance_id)
        .await?
        .ok_or_else(|| HttpError::unauthorized("instance_not_found"))?;
    if instance.principal_id != identity.principal_id
        || instance.deployment_id != input.deployment_id
        || instance.state != RuntimeInstanceState::Active
    {
        return Err(HttpError::unauthorized("instance_mismatch"));
    }
    let binding = state
        .service
        .repository()
        .get_participant_binding(&input.participant_id, &input.participant_artifact_digest)
        .await?;
    let Some(binding) = binding else {
        let proposal = present_bootstrap_authority(
            state,
            &input,
            None,
            &proof_signer_key_id,
            &proof_request_id,
            now,
        )
        .await?;
        return Ok(bootstrap_proposal_state(now, proposal));
    };
    if binding.needs_digest != input.participant_needs_digest {
        return Err(HttpError::conflict("participant_needs_changed"));
    }
    let authority = state
        .service
        .repository()
        .get_deployment_authority(&input.deployment_id, &input.participant_id)
        .await?;
    let Some(authority) = authority else {
        let proposal = present_bootstrap_authority(
            state,
            &input,
            Some(&binding),
            &proof_signer_key_id,
            &proof_request_id,
            now,
        )
        .await?;
        return Ok(bootstrap_proposal_state(now, proposal));
    };
    if authority.participant_artifact_digest != input.participant_artifact_digest
        || authority.accepted_needs_digest != input.participant_needs_digest
    {
        let proposal = present_bootstrap_authority(
            state,
            &input,
            Some(&binding),
            &proof_signer_key_id,
            &proof_request_id,
            now,
        )
        .await?;
        return Ok(bootstrap_proposal_state(now, proposal));
    }
    match authority.state {
        AuthorityState::Accepted => {}
        AuthorityState::Pending => return Ok(bootstrap_state(now, "authority_pending", None)),
        AuthorityState::Rejected | AuthorityState::Revoked => {
            return Ok(bootstrap_state(now, "authority_rejected", None));
        }
        AuthorityState::Stale => return Ok(bootstrap_state(now, "migration_required", None)),
    }
    let deployment = state
        .service
        .repository()
        .get_deployment_evidence(&input.deployment_id)
        .await?
        .ok_or_else(|| HttpError::unauthorized("deployment_not_found"))?;
    if !deployment.active
        || deployment.participant_id != input.participant_id
        || deployment
            .expires_at
            .is_some_and(|expires_at| expires_at <= now)
    {
        return Ok(bootstrap_state(now, "disabled", None));
    }
    let activation = if input.kind == ProvisionedIdentityKind::Device {
        let device = state
            .service
            .repository()
            .get_device(&identity.principal_id, &input.deployment_id)
            .await?
            .ok_or_else(|| HttpError::unauthorized("device_not_found"))?;
        if device.state == DeviceState::Pending {
            let challenge_digest = input
                .challenge_digest
                .clone()
                .ok_or_else(|| HttpError::bad_request("activation_challenge_required"))?;
            let confirmation_code = input
                .confirmation_code
                .as_deref()
                .ok_or_else(|| HttpError::bad_request("activation_confirmation_code_required"))?;
            if confirmation_code.len() != 8
                || !confirmation_code
                    .bytes()
                    .all(|byte| b"0123456789ABCDEFGHJKMNPQRSTVWXYZ".contains(&byte))
            {
                return Err(HttpError::bad_request(
                    "invalid_activation_confirmation_code",
                ));
            }
            let expires_at = now
                .checked_add(crate::platform::auth::DEVICE_ACTIVATION_REVIEW_TTL_MS)
                .ok_or_else(|| HttpError::internal("device_activation_expiry_overflow"))?;
            let profile = state
                .service
                .repository()
                .get_deployment_profile(&input.deployment_id)
                .await?
                .ok_or_else(|| HttpError::unauthorized("deployment_not_found"))?;
            state.service.expire_due_activation_reviews(now).await?;
            let reviews = state.service.repository().list_activation_reviews().await?;
            if reviews.iter().any(|review| {
                review.principal_id == identity.principal_id
                    && review.deployment_id == input.deployment_id
                    && review.instance_id == input.instance_id
                    && review.state == DeviceActivationReviewState::Rejected
            }) {
                return Ok(bootstrap_state(now, "authority_rejected", None));
            }
            let existing_review = reviews.into_iter().find(|review| {
                review.principal_id == identity.principal_id
                    && review.deployment_id == input.deployment_id
                    && review.instance_id == input.instance_id
                    && matches!(
                        review.state,
                        DeviceActivationReviewState::Pending
                            | DeviceActivationReviewState::Approved
                    )
                    && review.expires_at > now
            });
            let (review_id, review_expires_at) = if let Some(review) = existing_review {
                (review.review_id, review.expires_at)
            } else {
                let review_id = format!("dar_{}", Ulid::new());
                let review_requested_action_id =
                    crate::platform::auth::activation_review_event_action_id(
                        &review_id,
                        "review-requested",
                    )?;
                let actions = (profile.review_mode == Some(DeviceReviewMode::Required))
                    .then(|| PostCommitActionRecord {
                        predecessor_action_id: None,
                        action_id: review_requested_action_id,
                        kind: PostCommitActionKind::Event,
                        payload: json!({
                            "eventType": "Auth.DeviceUserAuthorities.ReviewRequested",
                            "eventSubject": format!(
                                "events.v1.Auth.DeviceUserAuthorities.ReviewRequested.{}",
                                input.deployment_id,
                            ),
                            "eventId": format!(
                                "evt_{}",
                                digest_parts(&[&review_id, "review-requested"]),
                            ),
                            "occurredAt": now,
                            "reviewId": review_id,
                            "deploymentId": input.deployment_id,
                            "instanceId": input.instance_id,
                            "requestedAt": now,
                            "expiresAt": expires_at,
                        }),
                        created_at: now,
                        attempts: 0,
                        next_attempt_at: now,
                        claimed_until: None,
                        last_error: None,
                    })
                    .into_iter()
                    .collect();
                let review = state
                    .service
                    .create_activation_review(CreateActivationReviewInput {
                        review_id,
                        principal_id: identity.principal_id.clone(),
                        deployment_id: input.deployment_id.clone(),
                        instance_id: input.instance_id.clone(),
                        request_digest: challenge_digest,
                        payload: json!({
                            "source": "device_bootstrap",
                            "publicIdentityKey": input.identity_public_key.clone(),
                            "participantId": input.participant_id.clone(),
                            "contractDigest": input.participant_artifact_digest.clone(),
                            "confirmationCode": confirmation_code,
                            "expiresAt": expires_at,
                        }),
                        requested_at: now,
                        expires_at,
                        idempotency: idempotency(
                            &input.identity_key_id,
                            "device.activation.request",
                            &proof_signer_key_id,
                            &proof_request_id,
                            &input.request_digest,
                            now,
                        )?,
                        actions,
                    })
                    .await?;
                let review_id = match review {
                    IdempotentOutcome::Applied(review) => review.review_id,
                    IdempotentOutcome::Replayed(value) => value
                        .get("reviewId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| HttpError::internal("invalid_activation_replay"))?
                        .to_owned(),
                };
                (review_id, expires_at)
            };
            let portal = super::browser::select_device_portal(
                state.service.repository(),
                &input.participant_id,
                &input.deployment_id,
            )
            .await?;
            return Ok(BootstrapResponse {
                server_now: now,
                state: "activation_pending",
                session: None,
                authorization: None,
                nats: None,
                authorization_context: None,
                activation: Some(BootstrapActivation {
                    state: "pending",
                    activation_url: device_activation_url(
                        &portal,
                        &state.public_origin,
                        &review_id,
                    )?,
                    review_id,
                    expires_at: review_expires_at,
                    retry_after_ms: 1_000,
                }),
                proposal: None,
            });
        } else if device.state != DeviceState::Active {
            let rejected = state
                .service
                .repository()
                .list_activation_reviews()
                .await?
                .into_iter()
                .any(|review| {
                    review.principal_id == identity.principal_id
                        && review.deployment_id == input.deployment_id
                        && review.instance_id == input.instance_id
                        && review.state == DeviceActivationReviewState::Rejected
                });
            return Ok(bootstrap_state(
                now,
                if rejected {
                    "authority_rejected"
                } else {
                    "disabled"
                },
                None,
            ));
        } else {
            None
        }
    } else {
        None
    };
    let session = state
        .service
        .create_session(CreateSessionInput {
            principal_id: identity.principal_id,
            principal_kind: match input.kind {
                ProvisionedIdentityKind::Service => PrincipalKind::Service,
                ProvisionedIdentityKind::Device => PrincipalKind::Device,
            },
            participant_id: input.participant_id.clone(),
            participant_kind: binding.participant_kind,
            participant_artifact_digest: input.participant_artifact_digest,
            participant_needs_digest: input.participant_needs_digest,
            session_public_key: input.new_session_public_key,
            deployment_id: Some(input.deployment_id.clone()),
            instance_id: Some(input.instance_id),
            desired_authority: None,
            created_at: now,
            idempotency: idempotency(
                &input.identity_key_id,
                match input.kind {
                    ProvisionedIdentityKind::Service => "service.bootstrap",
                    ProvisionedIdentityKind::Device => "device.bootstrap",
                },
                &proof_signer_key_id,
                &proof_request_id,
                &input.request_digest,
                now,
            )?,
            actions: Vec::new(),
        })
        .await?;
    let session = match session {
        IdempotentOutcome::Applied(session) => session,
        IdempotentOutcome::Replayed(value) => {
            let session_id = value
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| HttpError::internal("invalid_session_replay"))?;
            state
                .service
                .repository()
                .get_session(session_id)
                .await?
                .ok_or_else(|| HttpError::internal("session_missing"))?
        }
    };
    state
        .service
        .authorization()
        .reconcile_authority(
            &AuthorityTarget::new(AuthorityKind::Deployment, authority.authority_id)?,
            now,
        )
        .await?;
    let issuance = state
        .service
        .authorization()
        .resolve_issuable_state(&session.session_id, now)
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
    let authorization_context = state
        .authorization_contexts
        .issue(
            AuthorizationContextIssueRequest {
                session_id: session.session_id.clone(),
                request_id: proof_request_id.clone(),
                request_digest: input.request_digest.clone(),
            },
            now / 1_000,
        )
        .await
        .map_err(map_issuance_error)?;
    let route =
        state
            .issuer
            .deny_all_user_jwt(&input.new_session_nkey, expires_at / 1_000, now / 1_000)?;
    Ok(BootstrapResponse {
        server_now: now,
        state: "ready",
        session: Some(session),
        authorization: Some(BootstrapAuthorization {
            participant_id: issuance.participant.id.clone(),
            participant_artifact_digest: issuance.participant.artifact_digest.clone(),
            participant_needs_digest: issuance.participant.needs_digest.clone(),
            participant_json: binding.participant_json.clone(),
            effective_grants: issuance.grant_set.clone(),
            resource_bindings: issuance.resource_bindings.clone(),
            resource_runtime: project_service_resource_bindings(
                &binding.participant_json,
                &issuance.resource_bindings,
                &issuance.participant.id,
            )?,
            effective_authority_expires_at: issuance.effective_authority_expires_at,
        }),
        nats: Some(NatsBootstrapResponse::new(
            route,
            state.native_nats_servers.clone(),
            state.websocket_nats_servers.clone(),
        )),
        authorization_context: Some(authorization_context),
        activation,
        proposal: None,
    })
}

async fn present_bootstrap_authority<R, E>(
    state: &AuthHttpState<R, E>,
    input: &BootstrapInput,
    known_binding: Option<&ParticipantBindingRecord>,
    signer_id: &str,
    request_id: &str,
    now: i64,
) -> Result<AuthorityProposalRecord, HttpError>
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
    if input.participant_artifact.is_some() != input.referenced_api_artifacts.is_some() {
        return Err(HttpError::bad_request(
            "incomplete_participant_presentation",
        ));
    }
    let (participant_artifact, referenced_api_artifacts) = match (
        input.participant_artifact.clone(),
        input.referenced_api_artifacts.clone(),
        known_binding,
    ) {
        (Some(participant), Some(apis), _) => (participant, apis),
        (None, None, Some(binding)) => {
            let participant = serde_json::from_str(&binding.participant_json)
                .map_err(|_| HttpError::internal("stored_participant_invalid"))?;
            let apis: BTreeMap<String, Value> =
                serde_json::from_str(&binding.api_artifacts_json)
                    .map_err(|_| HttpError::internal("stored_participant_invalid"))?;
            (participant, apis.into_values().collect())
        }
        (None, None, None) => return Err(HttpError::conflict("participant_artifacts_required")),
        _ => unreachable!(),
    };
    let outcome = state
        .service
        .present_deployment_authority(PresentDeploymentAuthorityInput {
            deployment_id: input.deployment_id.clone(),
            participant_artifact,
            referenced_api_artifacts,
            created_at: now,
            expires_at: None,
            idempotency: idempotency(
                &input.identity_key_id,
                "bootstrap.authority.plan",
                signer_id,
                request_id,
                &input.request_digest,
                now,
            )?,
            actions: Vec::new(),
        })
        .await?;
    let proposal = match outcome {
        IdempotentOutcome::Applied(proposal) => proposal,
        IdempotentOutcome::Replayed(value) => {
            let proposal_id = value
                .get("proposalId")
                .and_then(Value::as_str)
                .ok_or_else(|| HttpError::internal("invalid_proposal_replay"))?;
            state
                .service
                .repository()
                .get_authority_proposal(proposal_id)
                .await?
                .map(|value| value.0)
                .ok_or_else(|| HttpError::internal("proposal_missing"))?
        }
    };
    if proposal.participant_id != input.participant_id
        || proposal.participant_artifact_digest != input.participant_artifact_digest
        || proposal.participant_needs_digest != input.participant_needs_digest
    {
        return Err(HttpError::conflict("participant_presentation_mismatch"));
    }
    Ok(proposal)
}

fn bootstrap_proposal_state(now: i64, proposal: AuthorityProposalRecord) -> BootstrapResponse {
    let state = match proposal.state {
        AuthorityProposalState::Pending => match proposal.proposal_kind {
            AuthorityProposalKind::Migration => "migration_required",
            AuthorityProposalKind::Initial | AuthorityProposalKind::Update => "authority_pending",
        },
        AuthorityProposalState::Accepted => "dependency_pending",
        AuthorityProposalState::Rejected
        | AuthorityProposalState::Superseded
        | AuthorityProposalState::Expired => "authority_rejected",
    };
    let proposal = BootstrapProposal {
        proposal_id: proposal.proposal_id,
        proposal_kind: proposal.proposal_kind,
        proposal_digest: proposal.proposal_digest,
    };
    bootstrap_state(now, state, Some(proposal))
}

fn bootstrap_state(
    now: i64,
    state: &'static str,
    proposal: Option<BootstrapProposal>,
) -> BootstrapResponse {
    BootstrapResponse {
        server_now: now,
        state,
        session: None,
        authorization: None,
        nats: None,
        authorization_context: None,
        activation: None,
        proposal,
    }
}
