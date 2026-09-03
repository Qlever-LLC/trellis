use super::super::*;
use super::local::{portal_flow_response, PortalFlowResponse};
use crate::platform::auth::policy::portal_allows_authenticated_provider;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalRequest {
    approved: bool,
    consent_view_digest: String,
    pub(crate) selected_optional_bundles: Vec<String>,
}

pub(crate) async fn decide_approval<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Path(flow_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<ApprovalRequest>,
) -> Result<Json<PortalFlowResponse>, HttpError>
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
    let mut flow = load_flow(&state.ephemeral, &flow_id).await?;
    let (portal, _) = state
        .service
        .repository()
        .get_login_portal(&flow.portal_id)
        .await?
        .ok_or_else(|| HttpError::gone("portal_unavailable"))?;
    require_selected_portal_origin(&headers, &portal, &state.public_origin)?;
    require_portal_binding(&flow, &headers)?;
    let request_value =
        serde_json::to_value(&request).map_err(|_| HttpError::bad_request("invalid_approval"))?;
    let request_digest = trellis_protocol::digest_json(&request_value)
        .map_err(|_| HttpError::bad_request("invalid_approval"))?;
    if matches!(
        flow.state,
        AuthBrowserFlowState::Approved | AuthBrowserFlowState::Consumed
    ) {
        let signer_id = super::super::super::domain::validate_ed25519_public_key(
            "sessionPublicKey",
            &flow.session_public_key,
        )?;
        let recorded = state
            .service
            .repository()
            .get_idempotency_result("browser.authority.accept", &signer_id, &flow_id)
            .await?;
        if !request.approved
            || request.consent_view_digest != flow.consent.consent_view_digest
            || recorded.as_ref().map(|record| &record.request_digest) != Some(&request_digest)
        {
            return Err(HttpError::conflict("approval_replay_mismatch"));
        }
        return Ok(Json(portal_flow_response(&state, flow).await?));
    }
    if flow.state != AuthBrowserFlowState::ApprovalRequired {
        return Err(HttpError::conflict("flow_not_awaiting_approval"));
    }
    let now = now_ms()?;
    let binding = state
        .service
        .repository()
        .get_participant_binding(&flow.participant_id, &flow.participant_artifact_digest)
        .await?
        .ok_or_else(|| HttpError::internal("participant_binding_missing"))?;
    let current_consent = browser_consent(&binding)?;
    if request.consent_view_digest != flow.consent.consent_view_digest
        || current_consent != flow.consent
    {
        return Err(HttpError::conflict("consent_view_changed"));
    }
    if !request.approved {
        let expected = flow.version;
        flow.state = AuthBrowserFlowState::ApprovalDenied;
        flow.completed_at = Some(now);
        flow.version += 1;
        state
            .ephemeral
            .replace_browser_flow(expected, flow.clone())
            .await?;
        return Ok(Json(portal_flow_response(&state, flow).await?));
    }
    let principal_id = flow
        .principal_id
        .clone()
        .ok_or_else(|| HttpError::conflict("flow_has_no_principal"))?;
    let (grant_set, capabilities, selected_optional_bundles) =
        select_browser_authority(&flow.consent, &request.selected_optional_bundles)?;
    if capabilities
        .iter()
        .any(|capability| capability == "trellis.auth::admin")
    {
        let current = state
            .service
            .repository()
            .get_identity_authority(&principal_id, &flow.participant_id)
            .await?;
        if !current.is_some_and(|authority| {
            authority.state == AuthorityState::Accepted
                && authority
                    .expires_at
                    .is_none_or(|expires_at| expires_at > now)
                && authority
                    .desired_capabilities
                    .iter()
                    .any(|capability| capability == "trellis.auth::admin")
        }) {
            return Err(HttpError::forbidden("administrative_approval_required"));
        }
    }
    let signer_id = super::super::super::domain::validate_ed25519_public_key(
        "sessionPublicKey",
        &flow.session_public_key,
    )?;
    let durable = state
        .service
        .apply_identity_authority_selection(ApplyIdentityAuthoritySelectionInput {
            principal_id: principal_id.clone(),
            participant_id: flow.participant_id.clone(),
            participant_artifact_digest: flow.participant_artifact_digest.clone(),
            participant_needs_digest: flow.participant_needs_digest.clone(),
            grant_set,
            capabilities,
            state: AuthorityState::Accepted,
            decided_by: flow.session_public_key.clone(),
            source_payload: json!({
                "source": "browser_approval", "flowId": flow_id,
                "consentViewDigest": flow.consent.consent_view_digest,
                "proposalDigest": flow.consent.proposal_digest,
                "selectedOptionalBundles": selected_optional_bundles,
            }),
            portal_binding: PortalBindingMutation::Clear,
            portal_policy_snapshot: None,
            decided_at: now,
            expires_at: None,
            proposal_idempotency: idempotency(
                &flow_id,
                "browser.authority.propose",
                &signer_id,
                &flow_id,
                &request_digest,
                now,
            )?,
            decision_idempotency: idempotency(
                &flow_id,
                "browser.authority.accept",
                &signer_id,
                &flow_id,
                &request_digest,
                now,
            )?,
        })
        .await
        .map_err(|error| match error {
            AuthorizationStateError::StorageConflict => HttpError::conflict("authority_changed"),
            error => error.into(),
        })?;
    let durable_record = DesiredAuthorityRecord::Identity(durable);
    let durable_result_digest = trellis_protocol::digest_json(
        &serde_json::to_value(&durable_record)
            .map_err(|_| HttpError::internal("authority_encode"))?,
    )
    .map_err(|_| HttpError::internal("authority_digest"))?;
    let expected = flow.version;
    flow.state = AuthBrowserFlowState::Approved;
    flow.durable_result_digest = Some(durable_result_digest);
    flow.completed_at = Some(now);
    flow.version += 1;
    if let Err(error) = state
        .ephemeral
        .replace_browser_flow(expected, flow.clone())
        .await
    {
        if error != AuthorizationStateError::StorageConflict {
            return Err(error.into());
        }
        let current = load_flow(&state.ephemeral, &flow.flow_id).await?;
        if !matches!(
            current.state,
            AuthBrowserFlowState::Approved | AuthBrowserFlowState::Consumed
        ) || current.durable_result_digest != flow.durable_result_digest
        {
            return Err(HttpError::conflict("approval_completion_conflict"));
        }
        flow = current;
    }
    Ok(Json(portal_flow_response(&state, flow).await?))
}

pub(super) async fn apply_trusted_portal_authority<R, E>(
    state: &AuthHttpState<R, E>,
    mut flow: AuthBrowserFlow,
    attributes: ProviderLoginAttributes,
    now: i64,
) -> Result<Option<AuthBrowserFlow>, HttpError>
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
    let binding = state
        .service
        .repository()
        .get_participant_binding(&flow.participant_id, &flow.participant_artifact_digest)
        .await?
        .ok_or_else(|| HttpError::internal("participant_binding_missing"))?;
    let consent = browser_consent(&binding)?;
    if consent != flow.consent {
        return Err(HttpError::conflict("consent_view_changed"));
    }
    let principal_id = flow
        .principal_id
        .clone()
        .ok_or_else(|| HttpError::conflict("flow_has_no_principal"))?;
    let signer_id = super::super::super::domain::validate_ed25519_public_key(
        "sessionPublicKey",
        &flow.session_public_key,
    )?;
    let durable = 'policy: {
        for attempt in 0..3 {
            let Some((portal, settings)) = state
                .service
                .repository()
                .get_login_portal(&flow.portal_id)
                .await?
            else {
                return Err(HttpError::gone("portal_unavailable"));
            };
            if portal.removed {
                return Err(HttpError::gone("portal_unavailable"));
            }
            if !portal_allows_authenticated_provider(&portal, &settings, &attributes.provider_id) {
                return Err(HttpError::forbidden(if portal.disabled {
                    "portal_disabled"
                } else if attributes.provider_id == "local" && !settings.local_login_enabled {
                    "local_login_disabled"
                } else {
                    "provider_not_allowed"
                }));
            }
            if attributes.provider_id != "local"
                && !state.oidc_providers.contains_key(&attributes.provider_id)
            {
                return Err(HttpError::not_found("provider_not_found"));
            }
            let Some(policy) = state
                .service
                .repository()
                .get_portal_grant_override(&flow.portal_id, &flow.participant_id)
                .await?
            else {
                return Ok(None);
            };
            let groups = state
                .service
                .repository()
                .list_capability_groups()
                .await?
                .into_iter()
                .map(|group| (group.group_key.clone(), group))
                .collect();
            let snapshot = portal_policy_snapshot(
                &portal,
                &settings,
                &flow.participant_id,
                Some(&policy),
                &groups,
            )?;
            let selection =
                resolve_portal_authority_selection(&policy, &groups, &consent, &attributes)?;
            let request_digest = trellis_protocol::digest_json(&json!({
                "flowId": flow.flow_id,
                "portalId": flow.portal_id,
                "portalVersion": snapshot.portal_version,
                "loginSettingsVersion": snapshot.login_settings_version,
                "participantId": flow.participant_id,
                "policyVersion": snapshot.policy_version,
                "capabilityGroupVersions": snapshot.capability_group_versions,
                "providerId": attributes.provider_id,
                "roles": attributes.roles,
                "effectivePolicyDigest": selection.effective_policy_digest,
            }))
            .map_err(|_| HttpError::internal("portal_policy_digest"))?;
            let policy_idempotency_key = format!("{}:{request_digest}", flow.flow_id);
            let result = state
                .service
                .apply_identity_authority_selection(ApplyIdentityAuthoritySelectionInput {
                    principal_id: principal_id.clone(),
                    participant_id: flow.participant_id.clone(),
                    participant_artifact_digest: flow.participant_artifact_digest.clone(),
                    participant_needs_digest: flow.participant_needs_digest.clone(),
                    grant_set: selection.grant_set,
                    capabilities: selection.capabilities,
                    state: AuthorityState::Accepted,
                    decided_by: flow.session_public_key.clone(),
                    source_payload: json!({
                        "source": "trusted_portal", "flowId": flow.flow_id,
                        "portalId": flow.portal_id, "providerId": attributes.provider_id,
                        "effectivePolicyDigest": selection.effective_policy_digest,
                    }),
                    portal_binding: PortalBindingMutation::Set(PortalAuthoritySource {
                        portal_id: flow.portal_id.clone(),
                        provider_id: attributes.provider_id.clone(),
                        roles: attributes.roles.clone(),
                        effective_policy_digest: selection.effective_policy_digest,
                    }),
                    portal_policy_snapshot: Some(snapshot),
                    decided_at: now,
                    expires_at: None,
                    proposal_idempotency: idempotency(
                        &policy_idempotency_key,
                        "portal.authority.propose",
                        &signer_id,
                        &policy_idempotency_key,
                        &request_digest,
                        now,
                    )?,
                    decision_idempotency: idempotency(
                        &flow.flow_id,
                        "portal.authority.accept",
                        &signer_id,
                        &flow.flow_id,
                        &request_digest,
                        now,
                    )?,
                })
                .await;
            match result {
                Ok(durable) => break 'policy durable,
                Err(AuthorizationStateError::PortalPolicyChanged) if attempt < 2 => continue,
                Err(AuthorizationStateError::PortalPolicyChanged) => {
                    return Err(HttpError::conflict("portal_policy_changed"));
                }
                Err(AuthorizationStateError::StorageConflict) if attempt < 2 => {
                    continue;
                }
                Err(error) => return Err(error.into()),
            }
        }
        unreachable!("bounded portal policy retries return or break")
    };
    let durable_record = DesiredAuthorityRecord::Identity(durable);
    flow.state = AuthBrowserFlowState::Approved;
    flow.durable_result_digest = Some(
        trellis_protocol::digest_json(
            &serde_json::to_value(durable_record)
                .map_err(|_| HttpError::internal("authority_encode"))?,
        )
        .map_err(|_| HttpError::internal("authority_digest"))?,
    );
    flow.completed_at = Some(now);
    Ok(Some(flow))
}

pub(super) async fn complete_authenticated_flow<R, E>(
    state: &AuthHttpState<R, E>,
    mut flow: AuthBrowserFlow,
    principal_id: String,
    attributes: ProviderLoginAttributes,
    portal_binding_digest: String,
    require_explicit_approval: bool,
    now: i64,
) -> Result<AuthBrowserFlow, HttpError>
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
    if flow.state == AuthBrowserFlowState::ChooseProvider {
        let expected = flow.version;
        flow.state = AuthBrowserFlowState::Authenticated;
        flow.principal_id = Some(principal_id.clone());
        flow.authenticated_provider_id = Some(attributes.provider_id.clone());
        flow.authenticated_roles = attributes.roles.clone();
        flow.portal_binding_digest = Some(portal_binding_digest.clone());
        flow.version += 1;
        match state
            .ephemeral
            .replace_browser_flow(expected, flow.clone())
            .await
        {
            Ok(()) => {}
            Err(AuthorizationStateError::StorageConflict) => {
                flow = load_flow(&state.ephemeral, &flow.flow_id).await?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    if flow.principal_id.as_deref() != Some(&principal_id)
        || flow.authenticated_provider_id.as_deref() != Some(&attributes.provider_id)
        || flow.authenticated_roles != attributes.roles
        || flow.portal_binding_digest.as_deref() != Some(&portal_binding_digest)
    {
        return Err(HttpError::conflict("flow_authentication_conflict"));
    }
    if matches!(
        flow.state,
        AuthBrowserFlowState::ApprovalRequired
            | AuthBrowserFlowState::Approved
            | AuthBrowserFlowState::Consumed
    ) {
        return Ok(flow);
    }
    if flow.state != AuthBrowserFlowState::Authenticated {
        return Err(HttpError::conflict("flow_not_pending"));
    }
    let expected = flow.version;
    let allow_automatic_approval = automatic_approval_allowed(require_explicit_approval);
    // A portal policy governs this login even when an accepted authority
    // exists, so reconcile through policy instead of the fast path.
    let policy_governs = allow_automatic_approval
        && state
            .service
            .repository()
            .get_portal_grant_override(&flow.portal_id, &flow.participant_id)
            .await?
            .is_some();
    let existing_authority = if !allow_automatic_approval || policy_governs {
        None
    } else {
        state
            .service
            .repository()
            .get_identity_authority(&principal_id, &flow.participant_id)
            .await?
            .filter(|authority| {
                authority.state == AuthorityState::Accepted
                    && authority.participant_artifact_digest == flow.participant_artifact_digest
                    && authority.accepted_needs_digest == flow.participant_needs_digest
                    && authority
                        .expires_at
                        .is_none_or(|expires_at| expires_at > now)
            })
    };
    let mut completed = if let Some(authority) = existing_authority {
        flow.state = AuthBrowserFlowState::Approved;
        flow.durable_result_digest = Some(
            trellis_protocol::digest_json(
                &serde_json::to_value(DesiredAuthorityRecord::Identity(authority))
                    .map_err(|_| HttpError::internal("authority_encode"))?,
            )
            .map_err(|_| HttpError::internal("authority_digest"))?,
        );
        flow.completed_at = Some(now);
        flow
    } else if !allow_automatic_approval {
        flow.state = AuthBrowserFlowState::ApprovalRequired;
        flow
    } else if let Some(approved) =
        apply_trusted_portal_authority(state, flow.clone(), attributes, now).await?
    {
        approved
    } else {
        flow.state = AuthBrowserFlowState::ApprovalRequired;
        flow
    };
    completed.version += 1;
    match state
        .ephemeral
        .replace_browser_flow(expected, completed.clone())
        .await
    {
        Ok(()) => Ok(completed),
        Err(AuthorizationStateError::StorageConflict) => {
            let current = load_flow(&state.ephemeral, &completed.flow_id).await?;
            let converged = current.principal_id == completed.principal_id
                && (current.state == completed.state
                    || matches!(
                        (completed.state, current.state),
                        (
                            AuthBrowserFlowState::ApprovalRequired,
                            AuthBrowserFlowState::Approved | AuthBrowserFlowState::Consumed
                        ) | (
                            AuthBrowserFlowState::Approved,
                            AuthBrowserFlowState::Consumed
                        )
                    ))
                && completed
                    .durable_result_digest
                    .as_ref()
                    .is_none_or(|digest| current.durable_result_digest.as_ref() == Some(digest));
            if converged {
                Ok(current)
            } else {
                Err(HttpError::conflict("flow_completion_conflict"))
            }
        }
        Err(error) => Err(error.into()),
    }
}

fn automatic_approval_allowed(require_explicit_approval: bool) -> bool {
    !require_explicit_approval
}

#[cfg(test)]
mod tests {
    #[test]
    fn administrator_account_continuation_requires_explicit_approval() {
        assert!(!super::automatic_approval_allowed(true));
        assert!(super::automatic_approval_allowed(false));
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindRequest {
    request_id: String,
    issued_at: i64,
    proof: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserSessionBundle {
    server_now: i64,
    session: SessionRecord,
    nats: NatsBootstrapResponse,
    authorization_context: super::super::super::AuthorizationContextBundle,
}

pub(crate) async fn bind_flow<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Path(flow_id): Path<String>,
    headers: HeaderMap,
    Json(raw): Json<Value>,
) -> Result<Json<BrowserSessionBundle>, HttpError>
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
    let flow = load_flow(&state.ephemeral, &flow_id).await?;
    let redirect_target = flow
        .redirect_target
        .as_deref()
        .ok_or_else(|| HttpError::bad_request("missing_redirect_target"))?;
    require_portal_origin(&headers, redirect_target)?;
    if !matches!(
        flow.state,
        AuthBrowserFlowState::Approved | AuthBrowserFlowState::Consumed
    ) {
        return Err(HttpError::conflict("flow_not_approved"));
    }
    let request_digest =
        proof_request_digest(&raw).map_err(|_| HttpError::bad_request("invalid_bind_request"))?;
    let request: BindRequest =
        serde_json::from_value(raw).map_err(|_| HttpError::bad_request("invalid_bind_request"))?;
    if ulid::Ulid::from_string(&request.request_id)
        .map(|request_id| request_id.to_string() != request.request_id)
        .unwrap_or(true)
    {
        return Err(HttpError::bad_request("invalid_bind_request_id"));
    }
    let input =
        SessionProofInput::user_auth_bind(trellis_protocol::UserAuthBindSessionProofInput {
            request_id: request.request_id,
            issued_at: request.issued_at,
            flow_id,
            session_public_key: flow.session_public_key.clone(),
            request_digest,
        })
        .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    verify_session_proof(
        &input,
        &parse_session_proof(&request.proof)
            .map_err(|_| HttpError::unauthorized("invalid_proof"))?,
        &flow.session_public_key,
        now_ms()?,
        state.proof_policy,
    )
    .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    let flow = complete_flow(&state, flow, now_ms()?).await?;
    Ok(Json(session_bundle(&state, &flow).await?))
}

async fn complete_flow<R, E>(
    state: &AuthHttpState<R, E>,
    mut flow: AuthBrowserFlow,
    now: i64,
) -> Result<AuthBrowserFlow, HttpError>
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
    if flow.state == AuthBrowserFlowState::Consumed {
        let session_id = flow
            .claim_owner
            .as_deref()
            .ok_or_else(|| HttpError::internal("flow_session_missing"))?;
        let session = state
            .service
            .repository()
            .get_session(session_id)
            .await?
            .ok_or_else(|| HttpError::internal("flow_session_missing"))?;
        if session.principal_id != flow.principal_id.as_deref().unwrap_or_default()
            || session.participant_id != flow.participant_id
            || session.participant_artifact_digest != flow.participant_artifact_digest
            || session.participant_needs_digest != flow.participant_needs_digest
            || session.session_public_key != flow.session_public_key
        {
            return Err(HttpError::internal("flow_session_mismatch"));
        }
        return Ok(flow);
    }
    if flow.state != AuthBrowserFlowState::Approved {
        return Err(HttpError::conflict("flow_not_approved"));
    }
    let binding = state
        .service
        .repository()
        .get_participant_binding(&flow.participant_id, &flow.participant_artifact_digest)
        .await?
        .ok_or_else(|| HttpError::conflict("participant_unavailable"))?;
    if binding.needs_digest != flow.participant_needs_digest {
        return Err(HttpError::conflict("participant_needs_changed"));
    }
    let principal_id = flow
        .principal_id
        .clone()
        .ok_or_else(|| HttpError::conflict("flow_has_no_principal"))?;
    let signer_id = super::super::super::domain::validate_ed25519_public_key(
        "sessionPublicKey",
        &flow.session_public_key,
    )?;
    let digest = digest_parts(&["browser.session.complete", &flow.flow_id]);
    let outcome = state
        .service
        .create_session(CreateSessionInput {
            principal_id,
            principal_kind: PrincipalKind::User,
            participant_id: flow.participant_id.clone(),
            participant_kind: binding.participant_kind,
            participant_artifact_digest: flow.participant_artifact_digest.clone(),
            participant_needs_digest: flow.participant_needs_digest.clone(),
            session_public_key: flow.session_public_key.clone(),
            deployment_id: None,
            instance_id: None,
            desired_authority: None,
            created_at: now,
            idempotency: idempotency(
                &flow.flow_id,
                "browser.session.complete",
                &signer_id,
                &flow.flow_id,
                &digest,
                now,
            )?,
            actions: Vec::new(),
        })
        .await?;
    let session = match outcome {
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
    let expected = flow.version;
    flow.state = AuthBrowserFlowState::Consumed;
    flow.claim_owner = Some(session.session_id.clone());
    flow.claimed_at = Some(now);
    flow.version += 1;
    match state
        .ephemeral
        .replace_browser_flow(expected, flow.clone())
        .await
    {
        Ok(()) => Ok(flow),
        Err(AuthorizationStateError::StorageConflict) => {
            let current = load_flow(&state.ephemeral, &flow.flow_id).await?;
            if current.state == AuthBrowserFlowState::Consumed
                && current.claim_owner.as_deref() == Some(session.session_id.as_str())
            {
                Ok(current)
            } else {
                Err(HttpError::conflict("flow_completion_conflict"))
            }
        }
        Err(error) => Err(error.into()),
    }
}

async fn session_bundle<R, E>(
    state: &AuthHttpState<R, E>,
    flow: &AuthBrowserFlow,
) -> Result<BrowserSessionBundle, HttpError>
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
    if flow.state != AuthBrowserFlowState::Consumed {
        return Err(HttpError::conflict("flow_not_consumed"));
    }
    let now = now_ms()?;
    let session = state
        .service
        .repository()
        .get_session(
            flow.claim_owner
                .as_deref()
                .ok_or_else(|| HttpError::internal("flow_session_missing"))?,
        )
        .await?
        .ok_or_else(|| HttpError::internal("flow_session_missing"))?;
    let issuance = state
        .service
        .authorization()
        .resolve_issuable_state(&session.session_id, now)
        .await
        .map_err(map_issuance_error)?;
    let expires_at = [
        issuance.session_expires_at,
        issuance.effective_authority_expires_at,
    ]
    .into_iter()
    .flatten()
    .min()
    .ok_or_else(|| HttpError::internal("credential_expiry_missing"))?;
    let route =
        state
            .issuer
            .deny_all_user_jwt(&flow.session_nkey, expires_at / 1_000, now / 1_000)?;
    let authorization_context = state
        .authorization_contexts
        .issue(
            super::super::super::AuthorizationContextIssueRequest {
                session_id: session.session_id.clone(),
                request_id: flow.flow_id.clone(),
                request_digest: digest_parts(&["browser.session.bundle", &flow.flow_id]),
            },
            now / 1_000,
        )
        .await
        .map_err(map_issuance_error)?;
    Ok(BrowserSessionBundle {
        server_now: now,
        session,
        nats: NatsBootstrapResponse::new(
            route,
            state.native_nats_servers.clone(),
            state.websocket_nats_servers.clone(),
        ),
        authorization_context,
    })
}
