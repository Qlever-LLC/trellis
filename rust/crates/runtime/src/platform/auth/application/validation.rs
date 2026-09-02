use serde_json::Value;

use super::super::authority::{
    validate_deployment_authority, validate_device_delegation, validate_identity_authority,
    validate_principal, validate_provider_identity, validate_runtime_instance,
};
use super::super::domain::{
    canonical_capabilities, require_digest, require_nonempty, require_positive,
    require_protocol_timestamp,
};
use super::super::{
    AccountFlowKind, AccountFlowRecord, AccountFlowState, AuthorityKind, AuthorityProposalRecord,
    AuthorityProposalState, AuthorityState, DeviceActivationReviewRecord,
    DeviceActivationReviewState, IdempotencyResultRecord, IdentityAuthorityRecord,
    LocalCredentialRecord, LoginPortalRecord, LoginSettingsRecord, PostCommitActionKind,
    PostCommitActionRecord, PrincipalKind, PrincipalRecord, PrincipalState,
    ProvisionedIdentityKind, ProvisioningSecretState, UserProfileRecord, MAX_PROTOCOL_INTEGER,
};
use super::repository::LocalLoginAttempt;

pub(crate) use super::super::model::{
    validate_provisioned_identity, validate_user_account_replacement,
};

pub(crate) fn validate_session_revocation_actions(
    actions: &[PostCommitActionRecord],
) -> Result<(), super::super::AuthorizationStateError> {
    if !actions
        .iter()
        .any(|action| action.kind == PostCommitActionKind::Event)
        || !actions
            .iter()
            .any(|action| action.kind == PostCommitActionKind::Kick)
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "session revocation requires deterministic event and kick actions".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_session_desired_authority(
    session: &super::super::SessionRecord,
    desired: &super::super::DesiredAuthorityRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    let super::super::DesiredAuthorityRecord::Identity(authority) = desired else {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "user session desired authority must be identity kind".to_owned(),
        ));
    };
    if session.principal_kind != PrincipalKind::User
        || authority.principal_id != session.principal_id
        || authority.participant_id != session.participant_id
        || authority.participant_artifact_digest != session.participant_artifact_digest
        || authority.accepted_needs_digest != session.participant_needs_digest
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "session desired authority does not match the session exactly".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_local_login_attempt(
    attempt: &LocalLoginAttempt,
) -> Result<(), super::super::AuthorizationStateError> {
    require_nonempty("principalId", &attempt.principal_id)?;
    require_protocol_timestamp("attemptedAt", attempt.attempted_at)?;
    require_positive("maximumFailures", u64::from(attempt.maximum_failures))?;
    require_positive("lockDurationMs", attempt.lock_duration_ms)
}

pub(crate) fn validate_new_user_account(
    principal: &PrincipalRecord,
    profile: &UserProfileRecord,
    credential: Option<&LocalCredentialRecord>,
    identity: Option<&super::super::ProviderIdentityLink>,
) -> Result<(), super::super::AuthorizationStateError> {
    validate_principal(principal)?;
    if principal.kind != PrincipalKind::User || profile.principal_id != principal.principal_id {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "account records do not identify one user principal".to_owned(),
        ));
    }
    if let Some(display_name) = &profile.display_name {
        require_nonempty("displayName", display_name)?;
    }
    require_protocol_timestamp("profile.createdAt", profile.created_at)?;
    require_protocol_timestamp("profile.updatedAt", profile.updated_at)?;
    if profile.version != 1 || profile.updated_at < profile.created_at {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "new account profile version or timestamps are invalid".to_owned(),
        ));
    }
    match (credential, identity) {
        (None, None) => {}
        (Some(credential), Some(identity)) => {
            validate_provider_identity(identity)?;
            validate_local_credential(credential)?;
            if credential.principal_id != principal.principal_id
                || identity.principal_id != principal.principal_id
                || identity.provider != "local"
                || identity.provider_subject != credential.normalized_username
                || credential.version != 1
                || credential.updated_at < credential.password_changed_at
            {
                return Err(super::super::AuthorizationStateError::InvalidRecord(
                    "local credential and identity do not match the user account".to_owned(),
                ));
            }
        }
        (None, Some(identity)) => {
            validate_provider_identity(identity)?;
            if identity.principal_id != principal.principal_id || identity.provider == "local" {
                return Err(super::super::AuthorizationStateError::InvalidRecord(
                    "federated identity does not match the user account".to_owned(),
                ));
            }
        }
        (Some(_), None) => {
            return Err(super::super::AuthorizationStateError::InvalidRecord(
                "local credential requires a matching local identity".to_owned(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_first_admin_authority(
    authority: &IdentityAuthorityRecord,
    principal: &PrincipalRecord,
    completed_at: i64,
) -> Result<(), super::super::AuthorizationStateError> {
    let mut validated = authority.clone();
    validate_identity_authority(&mut validated)?;
    if validated != *authority
        || authority.principal_id != principal.principal_id
        || authority.state != AuthorityState::Accepted
        || !authority
            .desired_capabilities
            .iter()
            .any(|value| value == "trellis.auth::admin")
        || !authority
            .desired_capabilities
            .iter()
            .any(|value| value == "trellis.auth::capabilities.delegate")
        || authority
            .expires_at
            .is_some_and(|expires_at| expires_at <= completed_at)
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "bootstrap authority must be accepted, exact, active, and delegating".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_account_list(
    cursor: Option<&str>,
    limit: usize,
) -> Result<(), super::super::AuthorizationStateError> {
    if let Some(cursor) = cursor {
        require_nonempty("cursor", cursor)?;
    }
    // RPC pagination reads one extra row to determine whether a next page exists.
    if limit > 101 {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "user account list limit exceeds internal maximum 101".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_local_credential(
    credential: &LocalCredentialRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_nonempty("principalId", &credential.principal_id)?;
    require_nonempty("normalizedUsername", &credential.normalized_username)?;
    require_nonempty("passwordHash", &credential.password_hash)?;
    require_positive("hashProfile", u64::from(credential.hash_profile))?;
    require_positive("version", credential.version)?;
    require_protocol_timestamp("passwordChangedAt", credential.password_changed_at)?;
    require_protocol_timestamp("credential.updatedAt", credential.updated_at)?;
    if let Some(locked_until) = credential.locked_until {
        require_protocol_timestamp("lockedUntil", locked_until)?;
    }
    if credential.updated_at < credential.password_changed_at {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "credential updatedAt precedes passwordChangedAt".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_replacement_credential(
    current: &LocalCredentialRecord,
    replacement: &LocalCredentialRecord,
    principal_id: &str,
) -> Result<(), super::super::AuthorizationStateError> {
    validate_local_credential(replacement)?;
    let replacement_version = current.version.checked_add(1).ok_or_else(|| {
        super::super::AuthorizationStateError::InvalidRecord("version overflow".to_owned())
    })?;
    if replacement.principal_id != principal_id
        || current.principal_id != principal_id
        || replacement.normalized_username != current.normalized_username
        || replacement.version != replacement_version
        || replacement.updated_at < current.updated_at
        || replacement.password_changed_at < current.password_changed_at
    {
        return Err(super::super::AuthorizationStateError::StorageConflict);
    }
    Ok(())
}

pub(crate) fn validate_login_portal(
    portal: &LoginPortalRecord,
    settings: &LoginSettingsRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_nonempty("portalId", &portal.portal_id)?;
    require_nonempty("displayName", &portal.display_name)?;
    if let Some(entry_url) = &portal.entry_url {
        let parsed = url::Url::parse(entry_url).map_err(|_| {
            super::super::AuthorizationStateError::InvalidRecord(
                "portal entryUrl is invalid".to_owned(),
            )
        })?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(super::super::AuthorizationStateError::InvalidRecord(
                "portal entryUrl must use HTTP or HTTPS".to_owned(),
            ));
        }
    }
    require_positive("portal.version", portal.version)?;
    require_positive("settings.version", settings.version)?;
    require_protocol_timestamp("portal.createdAt", portal.created_at)?;
    require_protocol_timestamp("portal.updatedAt", portal.updated_at)?;
    require_protocol_timestamp("settings.updatedAt", settings.updated_at)?;
    if settings.portal_id != portal.portal_id
        || portal.updated_at < portal.created_at
        || settings.updated_at < portal.created_at
        || settings
            .default_provider_id
            .as_ref()
            .is_some_and(|id| !portal.provider_ids.contains(id))
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "login portal settings do not match the portal".to_owned(),
        ));
    }
    for (index, provider) in portal.provider_ids.iter().enumerate() {
        require_nonempty("providerId", provider)?;
        if portal.provider_ids[..index].contains(provider) {
            return Err(super::super::AuthorizationStateError::InvalidRecord(
                "providerIds must be unique".to_owned(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_account_flow(
    flow: &AccountFlowRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_nonempty("flowId", &flow.flow_id)?;
    require_digest("tokenHash", &flow.token_hash)?;
    require_protocol_timestamp("createdAt", flow.created_at)?;
    require_protocol_timestamp("expiresAt", flow.expires_at)?;
    for (field, value) in [
        ("targetPrincipalId", flow.target_principal_id.as_deref()),
        ("targetProviderId", flow.target_provider_id.as_deref()),
        ("returnLocation", flow.return_location.as_deref()),
    ] {
        if let Some(value) = value {
            require_nonempty(field, value)?;
        }
    }
    if flow.state != AccountFlowState::Pending
        || flow.consumed_at.is_some()
        || flow.version != 1
        || flow.expires_at <= flow.created_at
        || !matches!(
            (
                flow.kind,
                flow.target_principal_id.is_some(),
                flow.target_provider_id.is_some()
            ),
            (AccountFlowKind::AdminAccount, false, false)
                | (AccountFlowKind::PasswordReset, true, false)
                | (AccountFlowKind::IdentityLink, true, false)
                | (AccountFlowKind::IdentityLink, true, true)
        )
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "new account flow must be pending, typed, unconsumed, version one, and unexpired"
                .to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_authority_proposal(
    proposal: &AuthorityProposalRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_nonempty("proposalId", &proposal.proposal_id)?;
    require_nonempty("authorityId", &proposal.authority_id)?;
    require_nonempty("participantId", &proposal.participant_id)?;
    require_digest(
        "participantArtifactDigest",
        &proposal.participant_artifact_digest,
    )?;
    require_digest("participantNeedsDigest", &proposal.participant_needs_digest)?;
    require_digest("proposalDigest", &proposal.proposal_digest)?;
    match proposal.authority_kind {
        AuthorityKind::Deployment => {
            let deployment_id = proposal.deployment_id.as_deref().ok_or_else(|| {
                super::super::AuthorizationStateError::InvalidRecord(
                    "deployment proposal is missing deploymentId".to_owned(),
                )
            })?;
            if proposal.authority_id
                != super::super::model::deployment_authority_id(
                    deployment_id,
                    &proposal.participant_id,
                )?
                || proposal.payload.get("deploymentId").and_then(Value::as_str)
                    != Some(deployment_id)
                || proposal
                    .payload
                    .get("subjectId")
                    .and_then(Value::as_str)
                    .is_some_and(|subject_id| subject_id != deployment_id)
            {
                return Err(super::super::AuthorizationStateError::InvalidRecord(
                    "deployment proposal lineage is inconsistent".to_owned(),
                ));
            }
        }
        AuthorityKind::Identity if proposal.deployment_id.is_some() => {
            return Err(super::super::AuthorizationStateError::InvalidRecord(
                "identity proposal cannot name a deployment".to_owned(),
            ));
        }
        AuthorityKind::Identity => {}
    }
    require_protocol_timestamp("createdAt", proposal.created_at)?;
    if let Some(expires_at) = proposal.expires_at {
        require_protocol_timestamp("expiresAt", expires_at)?;
    }
    if proposal.state != AuthorityProposalState::Pending
        || proposal.superseded_at.is_some()
        || proposal.version != 1
        || proposal
            .expires_at
            .is_some_and(|expires| expires <= proposal.created_at)
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "new authority proposal lifecycle is invalid".to_owned(),
        ));
    }
    if canonical_capabilities(proposal.proposed_capabilities.clone())?
        != proposal.proposed_capabilities
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "proposedCapabilities must be canonical".to_owned(),
        ));
    }
    match proposal.payload.get("baseAuthorityVersion") {
        Some(Value::Null) | Some(Value::Number(_)) => Ok(()),
        _ => Err(super::super::AuthorizationStateError::InvalidRecord(
            "proposal payload is missing baseAuthorityVersion".to_owned(),
        )),
    }
}

pub(crate) fn validate_provisioning_aggregate(
    principal: &PrincipalRecord,
    instance: &super::super::RuntimeInstanceRecord,
    kind: ProvisionedIdentityKind,
) -> Result<(), super::super::AuthorizationStateError> {
    validate_principal(principal)?;
    validate_runtime_instance(instance)?;
    let principal_kind = match kind {
        ProvisionedIdentityKind::Service => PrincipalKind::Service,
        ProvisionedIdentityKind::Device => PrincipalKind::Device,
    };
    if principal.kind != principal_kind
        || principal.state != PrincipalState::Active
        || instance.principal_id != principal.principal_id
        || instance.state != super::super::RuntimeInstanceState::Active
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "provisioned principal and instance do not match exactly".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_activation_decision_changes(
    command: &super::super::application::repository::ActivationReviewDecision,
) -> Result<(), super::super::AuthorizationStateError> {
    match command.state {
        DeviceActivationReviewState::Approved => {}
        DeviceActivationReviewState::Rejected
            if command.delegation.is_none() && !command.activate_device =>
        {
            return Ok(());
        }
        _ => {
            return Err(super::super::AuthorizationStateError::InvalidRecord(
                "activation rejection forbids delegation changes".to_owned(),
            ));
        }
    }
    if let Some(delegation) = &command.delegation {
        validate_device_delegation(delegation)?;
    }
    Ok(())
}

pub(crate) fn validate_provisioning_secret(
    secret: &super::super::DeviceProvisioningSecretRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_nonempty("secretId", &secret.secret_id)?;
    require_nonempty("instanceId", &secret.instance_id)?;
    require_digest("secretHash", &secret.secret_hash)?;
    require_protocol_timestamp("createdAt", secret.created_at)?;
    require_protocol_timestamp("expiresAt", secret.expires_at)?;
    if !matches!(
        (secret.state, secret.consumed_at),
        (ProvisioningSecretState::Pending, None) | (ProvisioningSecretState::Consumed, Some(_))
    ) || secret.version != 1
        || secret.expires_at < secret.created_at
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "new provisioning secret lifecycle is invalid".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_activation_review(
    review: &DeviceActivationReviewRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_nonempty("reviewId", &review.review_id)?;
    require_nonempty("principalId", &review.principal_id)?;
    require_nonempty("deploymentId", &review.deployment_id)?;
    require_nonempty("instanceId", &review.instance_id)?;
    require_digest("requestDigest", &review.request_digest)?;
    require_protocol_timestamp("requestedAt", review.requested_at)?;
    require_protocol_timestamp("expiresAt", review.expires_at)?;
    if review.expires_at < review.requested_at {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "activation review expiry precedes its request".to_owned(),
        ));
    }
    if review.state != DeviceActivationReviewState::Pending
        || review.activated_by_user_principal_id.is_some()
        || review.decided_at.is_some()
        || review.decided_by.is_some()
        || review.reason.is_some()
        || review.version != 1
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "new activation review lifecycle is invalid".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_activation_decision(
    state: DeviceActivationReviewState,
    decided_at: i64,
    decided_by: &str,
) -> Result<(), super::super::AuthorizationStateError> {
    if !matches!(
        state,
        DeviceActivationReviewState::Approved | DeviceActivationReviewState::Rejected
    ) {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "activation decision must approve or reject".to_owned(),
        ));
    }
    require_protocol_timestamp("decidedAt", decided_at)?;
    require_nonempty("decidedBy", decided_by)
}

pub(crate) fn validate_idempotency_result(
    result: &IdempotencyResultRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_digest("scopeKey", &result.scope_key)?;
    require_nonempty("purpose", &result.purpose)?;
    require_nonempty("signerId", &result.signer_id)?;
    require_nonempty("requestId", &result.request_id)?;
    require_digest("requestDigest", &result.request_digest)?;
    require_protocol_timestamp("createdAt", result.created_at)?;
    require_protocol_timestamp("expiresAt", result.expires_at)?;
    if result.expires_at <= result.created_at {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "idempotency expiry precedes creation".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_post_commit_action(
    action: &PostCommitActionRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    require_digest("actionId", &action.action_id)?;
    if let Some(predecessor_action_id) = &action.predecessor_action_id {
        require_digest("predecessorActionId", predecessor_action_id)?;
        if predecessor_action_id == &action.action_id {
            return Err(super::super::AuthorizationStateError::InvalidRecord(
                "post-commit action cannot depend on itself".to_owned(),
            ));
        }
    }
    require_protocol_timestamp("createdAt", action.created_at)?;
    require_protocol_timestamp("nextAttemptAt", action.next_attempt_at)?;
    if let Some(claimed_until) = action.claimed_until {
        require_protocol_timestamp("claimedUntil", claimed_until)?;
    }
    if u64::from(action.attempts) > MAX_PROTOCOL_INTEGER {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "attempts exceeds protocol integer range".to_owned(),
        ));
    }
    if action.attempts != 0
        || action.claimed_until.is_some()
        || action.last_error.is_some()
        || action.next_attempt_at < action.created_at
    {
        return Err(super::super::AuthorizationStateError::InvalidRecord(
            "new post-commit action must be unclaimed, unattempted, and scheduled after creation"
                .to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_idempotency_and_actions(
    idempotency: &IdempotencyResultRecord,
    actions: &[PostCommitActionRecord],
) -> Result<(), super::super::AuthorizationStateError> {
    validate_idempotency_result(idempotency)?;
    for action in actions {
        validate_post_commit_action(action)?;
    }
    Ok(())
}

pub(crate) fn validate_authority_record(
    authority: &mut super::super::DesiredAuthorityRecord,
) -> Result<(), super::super::AuthorizationStateError> {
    match authority {
        super::super::DesiredAuthorityRecord::Identity(record) => {
            validate_identity_authority(record)
        }
        super::super::DesiredAuthorityRecord::Deployment(record) => {
            validate_deployment_authority(record)
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn account_list_allows_one_row_of_pagination_lookahead() {
        assert!(super::validate_account_list(None, 101).is_ok());
        assert!(super::validate_account_list(None, 102).is_err());
    }
}
