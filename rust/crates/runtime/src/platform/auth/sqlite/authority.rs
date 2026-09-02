use std::collections::BTreeMap;

use async_trait::async_trait;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use serde_json::Value;

use super::super::application::repository::{
    AuthorityProposalCreation, AuthorityProposalDecision, IdempotentOutcome,
};
use super::super::authority::{
    deployment_enforceability_equal, identity_enforceability_equal, AuthorityRepository,
};
use super::super::context::{
    revoke_sql_contexts, AuthorizationContextRevocationReason, AuthorizationContextSelector,
};
use super::super::{
    AuthorityDecision, AuthorityDecisionOutcome, AuthorityDecisionRecord, AuthorityKind,
    AuthorityProposalRecord, AuthorityProposalState, AuthorizationStateError,
    DeploymentAuthorityRecord, DesiredAuthorityRecord, IdentityAuthorityRecord,
    ParticipantBindingRecord, PrincipalKind,
};
use super::common::{
    decode_enum, decode_failure, decode_json, encode_enum, encode_json, from_sql_version,
    map_write_error, sql_error, to_sql_version,
};
use super::evidence::{
    decode_participant_binding, load_deployment, load_participant_binding,
    put_sql_deployment_evidence,
};
use super::outbox::{insert_sql_idempotency_and_actions, sqlite_idempotency_replay};
use super::policy::decode_portal_authority_binding;
use super::principals::load_principal;
use super::validation::{next_version, validate_proposal_desired_authority};
use super::SqliteAuthorizationStore;

#[async_trait]
impl AuthorityRepository for SqliteAuthorizationStore {
    async fn list_authority_proposals(
        &self,
    ) -> Result<
        Vec<(AuthorityProposalRecord, Option<AuthorityDecisionRecord>)>,
        AuthorizationStateError,
    > {
        self.run_read(move |connection| {
            let mut statement = connection
                .prepare("SELECT proposal_id FROM auth_authority_proposals ORDER BY proposal_id")
                .map_err(sql_error)?;
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(sql_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(sql_error)?;
            ids.into_iter()
                .map(|proposal_id| {
                    load_authority_proposal(connection, &proposal_id)?
                        .ok_or(AuthorizationStateError::StorageConflict)
                })
                .collect()
        })
        .await
    }

    async fn create_authority_proposal(
        &self,
        mut command: AuthorityProposalCreation,
    ) -> Result<IdempotentOutcome<AuthorityProposalRecord>, AuthorizationStateError> {
        self.run(move |connection| {
            let transaction = connection.transaction().map_err(sql_error)?;
            let expired_overflow = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM auth_authority_proposals
                 WHERE authority_kind = ?1 AND authority_id = ?2 AND state = 'pending'
                   AND expires_at IS NOT NULL AND expires_at <= ?3 AND version >= ?4)",
                    params![
                        encode_enum(command.proposal.authority_kind)?,
                        command.proposal.authority_id,
                        command.proposal.created_at,
                        super::super::MAX_PROTOCOL_INTEGER as i64,
                    ],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(sql_error)?;
            if expired_overflow {
                return Err(AuthorizationStateError::InvalidRecord(
                    "expired proposal version overflow".to_owned(),
                ));
            }
            transaction
                .execute(
                    "UPDATE auth_authority_proposals
                 SET state = 'expired', version = version + 1
                 WHERE authority_kind = ?1 AND authority_id = ?2 AND state = 'pending'
                   AND expires_at IS NOT NULL AND expires_at <= ?3",
                    params![
                        encode_enum(command.proposal.authority_kind)?,
                        command.proposal.authority_id,
                        command.proposal.created_at,
                    ],
                )
                .map_err(map_write_error)?;
            if let Some(result) = sqlite_idempotency_replay(&transaction, &command.idempotency)? {
                transaction.commit().map_err(sql_error)?;
                return Ok(IdempotentOutcome::Replayed(result));
            }
            if let Some(deployment_id) = &command.proposal.deployment_id {
                let current_version = transaction
                    .query_row(
                        "SELECT version FROM auth_deployment_authorities WHERE deployment_id = ?1 AND participant_id = ?2",
                        params![deployment_id, command.proposal.participant_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()
                    .map_err(sql_error)?;
                let base_version = command
                    .proposal
                    .payload
                    .get("baseAuthorityVersion")
                    .and_then(Value::as_i64);
                if current_version != base_version {
                    return Err(AuthorizationStateError::StorageConflict);
                }
            }
            let existing = transaction
                .query_row(
                    "SELECT proposal_id, authority_kind, authority_id, deployment_id, proposal_kind,
                            participant_id, participant_artifact_digest,
                            participant_needs_digest, proposed_grant_set_json,
                            proposed_capabilities_json, proposal_digest, payload_json, state,
                            created_at, expires_at, superseded_at, version
                     FROM auth_authority_proposals
                     WHERE authority_kind = ?1 AND authority_id = ?2
                       AND proposal_digest = ?3 AND state = 'pending'",
                    params![
                        encode_enum(command.proposal.authority_kind)?,
                        command.proposal.authority_id,
                        command.proposal.proposal_digest,
                    ],
                    decode_authority_proposal,
                )
                .optional()
                .map_err(sql_error)?;
            if let Some(existing) = existing {
                command.idempotency.result = json!({ "proposalId": existing.proposal_id });
                let result = command.idempotency.result.clone();
                insert_sql_idempotency_and_actions(&transaction, &command.idempotency, &[])?;
                transaction.commit().map_err(sql_error)?;
                return Ok(IdempotentOutcome::Replayed(result));
            }
            let binding = load_participant_binding(
                &transaction,
                &command.proposal.participant_id,
                &command.proposal.participant_artifact_digest,
            )?;
            if binding
                .is_none_or(|value| value.needs_digest != command.proposal.participant_needs_digest)
            {
                return Err(AuthorizationStateError::StorageConflict);
            }
            let overflow = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM auth_authority_proposals
                     WHERE authority_kind = ?1 AND authority_id = ?2 AND state = 'pending'
                       AND version >= ?3)",
                    params![
                        encode_enum(command.proposal.authority_kind)?,
                        command.proposal.authority_id,
                        super::super::MAX_PROTOCOL_INTEGER as i64,
                    ],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(sql_error)?;
            if overflow {
                return Err(AuthorizationStateError::InvalidRecord(
                    "authority proposal version overflow".to_owned(),
                ));
            }
            transaction
                .execute(
                    "UPDATE auth_authority_proposals
                     SET state = 'superseded', superseded_at = ?3, version = version + 1
                     WHERE authority_kind = ?1 AND authority_id = ?2 AND state = 'pending'",
                    params![
                        encode_enum(command.proposal.authority_kind)?,
                        command.proposal.authority_id,
                        command.proposal.created_at,
                    ],
                )
                .map_err(map_write_error)?;
            transaction
                .execute(
                    "INSERT INTO auth_authority_proposals (proposal_id, authority_kind, authority_id, deployment_id, proposal_kind, participant_id, participant_artifact_digest, participant_needs_digest, proposed_grant_set_json, proposed_capabilities_json, proposal_digest, payload_json, state, created_at, expires_at, superseded_at, version)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                    params![
                        command.proposal.proposal_id,
                        encode_enum(command.proposal.authority_kind)?,
                        command.proposal.authority_id,
                        command.proposal.deployment_id,
                        encode_enum(command.proposal.proposal_kind)?,
                        command.proposal.participant_id,
                        command.proposal.participant_artifact_digest,
                        command.proposal.participant_needs_digest,
                        encode_json(&command.proposal.proposed_grant_set)?,
                        encode_json(&command.proposal.proposed_capabilities)?,
                        command.proposal.proposal_digest,
                        encode_json(&command.proposal.payload)?,
                        encode_enum(command.proposal.state)?,
                        command.proposal.created_at,
                        command.proposal.expires_at,
                        command.proposal.superseded_at,
                        to_sql_version(command.proposal.version)?
                    ],
                )
                .map_err(map_write_error)?;
            insert_sql_idempotency_and_actions(
                &transaction,
                &command.idempotency,
                &command.actions,
            )?;
            transaction.commit().map_err(sql_error)?;
            Ok(IdempotentOutcome::Applied(command.proposal))
        })
        .await
    }

    async fn get_authority_proposal(
        &self,
        proposal_id: &str,
    ) -> Result<
        Option<(AuthorityProposalRecord, Option<AuthorityDecisionRecord>)>,
        AuthorizationStateError,
    > {
        let proposal_id = proposal_id.to_owned();
        self.run_read(move |connection| load_authority_proposal(connection, &proposal_id))
            .await
    }

    async fn decide_authority_proposal(
        &self,
        command: AuthorityProposalDecision,
    ) -> Result<IdempotentOutcome<AuthorityProposalRecord>, AuthorizationStateError> {
        self.run(move |connection| {
            let transaction = connection.transaction().map_err(sql_error)?;
            if let Some(result) = sqlite_idempotency_replay(&transaction, &command.idempotency)? {
                return Ok(IdempotentOutcome::Replayed(result));
            }
            if let Some(snapshot) = command.portal_policy_snapshot.as_ref() {
                let Some(DesiredAuthorityRecord::Identity(desired)) =
                    command.desired_authority.as_ref()
                else {
                    return Err(AuthorizationStateError::InvalidRecord(
                        "portal policy snapshot requires identity authority".to_owned(),
                    ));
                };
                if desired.participant_id != snapshot.participant_id {
                    return Err(AuthorizationStateError::InvalidRecord(
                        "portal policy snapshot participant does not match authority".to_owned(),
                    ));
                }
                verify_portal_policy_snapshot(&transaction, snapshot)?;
            }
            let Some(current) = load_authority_proposal(&transaction, &command.proposal_id)?
                .map(|value| value.0)
            else {
                tracing::warn!(
                    proposal_id = %command.proposal_id,
                    "authority proposal missing during decision"
                );
                return Err(AuthorizationStateError::StorageConflict);
            };
            if current.version != command.expected_version
                || current.state != AuthorityProposalState::Pending
                || current
                    .expires_at
                    .is_some_and(|expires| command.decision.decided_at >= expires)
                || command.decision.decided_at < current.created_at
            {
                tracing::warn!(
                    proposal_id = %command.proposal_id,
                    expected_version = command.expected_version,
                    actual_version = current.version,
                    state = ?current.state,
                    "authority proposal decision conflict"
                );
                return Err(AuthorizationStateError::StorageConflict);
            }
            let accepted_noop = if command.decision.outcome == AuthorityDecisionOutcome::Accepted {
                match command.desired_authority.as_ref() {
                    Some(desired) => {
                        desired_authority_enforceability_equal(&transaction, desired)?
                    }
                    None => false,
                }
            } else {
                false
            };
            if command.decision.outcome == AuthorityDecisionOutcome::Accepted {
                if let Some(expected_base_authority_version) = command.expected_base_authority_version
                {
                    if expected_base_authority_version
                        != super::validation::proposal_base_authority_version(
                            &current,
                        )?
                    {
                        return Err(AuthorizationStateError::StorageConflict);
                    }
                }
                let table = match current.authority_kind {
                    AuthorityKind::Identity => "auth_identity_authorities",
                    AuthorityKind::Deployment => "auth_deployment_authorities",
                };
                let current_authority_version = transaction
                    .query_row(
                        &format!("SELECT version FROM {table} WHERE authority_id = ?1"),
                        [&current.authority_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()
                    .map_err(sql_error)?
                    .map(from_sql_version)
                    .transpose()
                    .map_err(sql_error)?;
                if super::validation::proposal_base_authority_version(&current)?
                    != current_authority_version
                    && !accepted_noop
                {
                    tracing::warn!(
                        proposal_id = %command.proposal_id,
                    proposal_base_version = ?super::validation::proposal_base_authority_version(&current)?,
                        current_authority_version = ?current_authority_version,
                        "authority proposal base conflict"
                    );
                    return Err(AuthorizationStateError::StorageConflict);
                }
            }
            validate_proposal_desired_authority(
                &current,
                command.decision.outcome,
                command.desired_authority.as_ref(),
            )?;
            if let Some(deployment) = command.deployment {
                put_sql_deployment_evidence(&transaction, deployment)?;
            }
            if let Some(desired) = command.desired_authority.as_ref().filter(|_| !accepted_noop) {
                put_sql_desired_authority(&transaction, desired.clone())?;
            }
            if let Some(portal_binding) = &command.portal_binding {
                let Some(DesiredAuthorityRecord::Identity(authority)) = command.desired_authority.as_ref() else {
                    return Err(AuthorizationStateError::InvalidRecord(
                        "portal authority provenance requires accepted identity authority".to_owned(),
                    ));
                };
                if let Some(expected) = &command.expected_portal_binding {
                    let actual = transaction
                        .query_row(
                            "SELECT principal_id, participant_id, authority_id, portal_id,
                                    provider_id, roles_json, effective_policy_digest,
                                    authority_version, updated_at
                             FROM auth_portal_authority_bindings
                             WHERE principal_id = ?1 AND participant_id = ?2",
                            params![authority.principal_id, authority.participant_id],
                            decode_portal_authority_binding,
                        )
                        .optional()
                        .map_err(sql_error)?;
                    if &actual != expected {
                        return Err(AuthorizationStateError::StorageConflict);
                    }
                }
                transaction.execute(
                    "DELETE FROM auth_portal_authority_bindings WHERE principal_id = ?1 AND participant_id = ?2",
                    params![authority.principal_id, authority.participant_id],
                ).map_err(map_write_error)?;
                if let Some(binding) = portal_binding {
                    if binding.principal_id != authority.principal_id
                        || binding.participant_id != authority.participant_id
                        || binding.authority_id != authority.authority_id
                        || binding.authority_version != if accepted_noop {
                            authority.version.saturating_sub(1)
                        } else {
                            authority.version
                        }
                    {
                        return Err(AuthorizationStateError::InvalidRecord(
                            "portal authority provenance does not match identity authority".to_owned(),
                        ));
                    }
                    transaction.execute(
                        "INSERT INTO auth_portal_authority_bindings (
                            principal_id, participant_id, authority_id, portal_id, provider_id,
                            roles_json, effective_policy_digest, authority_version, updated_at
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            binding.principal_id, binding.participant_id, binding.authority_id,
                            binding.portal_id, binding.provider_id, encode_json(&binding.roles)?,
                            binding.effective_policy_digest, to_sql_version(binding.authority_version)?,
                            binding.updated_at,
                        ],
                    ).map_err(map_write_error)?;
                }
            }
            transaction
                .execute(
                    "INSERT INTO auth_authority_decisions (proposal_id, outcome, decided_by, reason, decided_at, decision_digest)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        command.decision.proposal_id,
                        encode_enum(command.decision.outcome)?,
                        command.decision.decided_by,
                        command.decision.reason,
                        command.decision.decided_at,
                        command.decision.decision_digest
                    ],
                )
                .map_err(map_write_error)?;
            let superseded_version_overflow = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM auth_authority_proposals
                 WHERE proposal_id != ?1 AND authority_kind = ?2 AND authority_id = ?3
                   AND state = 'pending' AND version >= ?4)",
                    params![
                        command.proposal_id,
                        encode_enum(current.authority_kind)?,
                        current.authority_id,
                        super::super::MAX_PROTOCOL_INTEGER as i64
                    ],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(sql_error)?;
            if superseded_version_overflow {
                return Err(AuthorizationStateError::InvalidRecord(
                    "superseded proposal version overflow".to_owned(),
                ));
            }
            transaction
                .execute(
                    "UPDATE auth_authority_proposals SET state = 'superseded', superseded_at = ?1, version = version + 1
                 WHERE proposal_id != ?2 AND authority_kind = ?3 AND authority_id = ?4 AND state = 'pending'",
                    params![
                        command.decision.decided_at,
                        command.proposal_id,
                        encode_enum(current.authority_kind)?,
                        current.authority_id
                    ],
                )
                .map_err(map_write_error)?;
            let state = match command.decision.outcome {
                AuthorityDecisionOutcome::Accepted => "accepted",
                AuthorityDecisionOutcome::Rejected => "rejected",
            };
            let next = next_version(command.expected_version)?;
            let changed = transaction
                .execute(
                    "UPDATE auth_authority_proposals SET state = ?1, version = ?2
                  WHERE proposal_id = ?3 AND version = ?4 AND state = 'pending'",
                    params![
                        state,
                        to_sql_version(next)?,
                        command.proposal_id,
                        to_sql_version(command.expected_version)?
                    ],
                )
                .map_err(map_write_error)?;
            if changed != 1 {
                return Err(AuthorizationStateError::StorageConflict);
            }
            let result = load_authority_proposal(&transaction, &command.proposal_id)?
                .map(|value| value.0)
                .ok_or(AuthorizationStateError::StorageConflict)?;
            if command.decision.outcome == AuthorityDecisionOutcome::Accepted && !accepted_noop {
                revoke_sql_contexts(
                    &transaction,
                    &AuthorizationContextSelector::Authority(
                        current.authority_kind,
                        current.authority_id.clone(),
                    ),
                    AuthorizationContextRevocationReason::AuthorityChanged,
                    command.decision.decided_at.div_euclid(1_000),
                )?;
            }
            insert_sql_idempotency_and_actions(
                &transaction,
                &command.idempotency,
                &command.actions,
            )?;
            transaction.commit().map_err(sql_error)?;
            Ok(IdempotentOutcome::Applied(result))
        })
        .await
    }

    async fn list_identity_authorities(
        &self,
    ) -> Result<Vec<IdentityAuthorityRecord>, AuthorizationStateError> {
        self.run_read(move |connection| {
            let mut statement = connection
                .prepare(
                    "SELECT authority_id, principal_id, participant_id,
                            participant_artifact_digest, accepted_needs_digest,
                            desired_grant_set_json, desired_capabilities_json, state, version,
                            created_at, updated_at, expires_at, decision_at, decision_by,
                            decision_reason
                     FROM auth_identity_authorities
                     ORDER BY authority_id",
                )
                .map_err(sql_error)?;
            let records = statement
                .query_map([], decode_identity_authority)
                .map_err(sql_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(sql_error)?;
            Ok(records)
        })
        .await
    }

    async fn get_identity_authority(
        &self,
        principal_id: &str,
        participant_id: &str,
    ) -> Result<Option<IdentityAuthorityRecord>, AuthorizationStateError> {
        let principal_id = principal_id.to_owned();
        let participant_id = participant_id.to_owned();
        self.run_read(move |connection| {
            load_identity_authority(connection, &principal_id, &participant_id)
        })
        .await
    }

    async fn list_deployment_authorities(
        &self,
    ) -> Result<Vec<DeploymentAuthorityRecord>, AuthorizationStateError> {
        self.run_read(move |connection| {
            let mut statement = connection
                .prepare(
                    "SELECT authority_id, deployment_id, participant_id, participant_kind,
                            participant_artifact_digest, accepted_needs_digest,
                            desired_grant_set_json, desired_capabilities_json, state, version,
                            created_at, updated_at, expires_at, decision_at, decision_by,
                            decision_reason
                     FROM auth_deployment_authorities
                     ORDER BY authority_id",
                )
                .map_err(sql_error)?;
            let records = statement
                .query_map([], decode_deployment_authority)
                .map_err(sql_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(sql_error)?;
            Ok(records)
        })
        .await
    }

    async fn get_deployment_authority(
        &self,
        deployment_id: &str,
        participant_id: &str,
    ) -> Result<Option<DeploymentAuthorityRecord>, AuthorizationStateError> {
        let deployment_id = deployment_id.to_owned();
        let participant_id = participant_id.to_owned();
        self.run_read(move |connection| {
            load_deployment_authority(connection, &deployment_id, &participant_id)
        })
        .await
    }

    async fn put_deployment_authority(
        &self,
        mut record: DeploymentAuthorityRecord,
        expected_version: Option<u64>,
    ) -> Result<DeploymentAuthorityRecord, AuthorizationStateError> {
        self.run(move |connection| {
            let transaction = connection.transaction().map_err(sql_error)?;
            let previous = load_deployment_authority(
                &transaction,
                &record.deployment_id,
                &record.participant_id,
            )?;
            put_deployment_authority(&transaction, &mut record, expected_version)?;
            if previous
                .as_ref()
                .is_some_and(|value| !deployment_enforceability_equal(value, &record))
            {
                revoke_sql_contexts(
                    &transaction,
                    &AuthorizationContextSelector::Authority(
                        AuthorityKind::Deployment,
                        record.authority_id.clone(),
                    ),
                    AuthorizationContextRevocationReason::AuthorityChanged,
                    record.updated_at.div_euclid(1_000),
                )?;
            }
            transaction.commit().map_err(sql_error)?;
            Ok(record)
        })
        .await
    }

    async fn get_participant_binding(
        &self,
        participant_id: &str,
        artifact_digest: &str,
    ) -> Result<Option<ParticipantBindingRecord>, AuthorizationStateError> {
        let participant_id = participant_id.to_owned();
        let artifact_digest = artifact_digest.to_owned();
        self.run_read(move |connection| {
            connection
                .query_row(
                    "SELECT participant_id, participant_kind, artifact_digest, needs_digest,
                            participant_json, api_artifacts_json, resolved_at, state, error
                     FROM auth_participant_bindings
                     WHERE participant_id = ?1 AND artifact_digest = ?2",
                    params![participant_id, artifact_digest],
                    decode_participant_binding,
                )
                .optional()
                .map_err(sql_error)
                .and_then(|value| {
                    value.map_or(Ok(None), |value| {
                        value.resolve()?;
                        Ok(Some(value))
                    })
                })
        })
        .await
    }

    async fn put_participant_binding(
        &self,
        binding: ParticipantBindingRecord,
    ) -> Result<(), AuthorizationStateError> {
        super::super::domain::require_protocol_timestamp("resolvedAt", binding.resolved_at)?;
        binding.resolve()?;
        self.run(move |connection| {
            connection
                .execute(
                    "INSERT INTO auth_participant_bindings (
                        participant_id, participant_kind, artifact_digest, needs_digest,
                        participant_json, api_artifacts_json, resolved_at, state, error
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(participant_id, artifact_digest) DO UPDATE SET
                        participant_kind = excluded.participant_kind,
                        needs_digest = excluded.needs_digest,
                        participant_json = excluded.participant_json,
                        api_artifacts_json = excluded.api_artifacts_json,
                        resolved_at = excluded.resolved_at,
                        state = excluded.state,
                        error = excluded.error",
                    params![
                        binding.participant_id,
                        encode_enum(binding.participant_kind)?,
                        binding.artifact_digest,
                        binding.needs_digest,
                        binding.participant_json,
                        binding.api_artifacts_json,
                        binding.resolved_at,
                        encode_enum(binding.state)?,
                        binding.error,
                    ],
                )
                .map_err(map_write_error)?;
            Ok(())
        })
        .await
    }
}

fn verify_portal_policy_snapshot(
    connection: &Connection,
    snapshot: &super::super::PortalPolicySnapshot,
) -> Result<(), AuthorizationStateError> {
    if snapshot.portal_id.is_empty()
        || snapshot.participant_id.is_empty()
        || snapshot.policy_version.is_some() != snapshot.policy_fingerprint.is_some()
        || snapshot.capability_group_versions.len() != snapshot.capability_group_fingerprints.len()
    {
        return Err(AuthorizationStateError::InvalidRecord(
            "portal policy snapshot is malformed".to_owned(),
        ));
    }
    let group_fingerprints = snapshot
        .capability_group_fingerprints
        .iter()
        .cloned()
        .collect::<BTreeMap<_, _>>();
    if group_fingerprints.len() != snapshot.capability_group_fingerprints.len()
        || snapshot
            .capability_group_versions
            .windows(2)
            .any(|pair| pair[0].0 >= pair[1].0)
        || snapshot
            .capability_group_fingerprints
            .windows(2)
            .any(|pair| pair[0].0 >= pair[1].0)
        || group_fingerprints.keys().ne(snapshot
            .capability_group_versions
            .iter()
            .map(|(group_key, _)| group_key))
    {
        return Err(AuthorizationStateError::InvalidRecord(
            "portal policy snapshot capability-group evidence is malformed".to_owned(),
        ));
    }
    let Some((portal, settings)) =
        super::accounts::load_login_portal(connection, &snapshot.portal_id)?
    else {
        return Err(AuthorizationStateError::PortalPolicyChanged);
    };
    if portal.version != snapshot.portal_version
        || super::super::policy::policy_record_fingerprint(&portal)? != snapshot.portal_fingerprint
        || settings.version != snapshot.login_settings_version
        || super::super::policy::policy_record_fingerprint(&settings)?
            != snapshot.login_settings_fingerprint
    {
        return Err(AuthorizationStateError::PortalPolicyChanged);
    }
    let policy = super::policy::load_portal_grant_overrides(
        connection,
        Some(&snapshot.portal_id),
        Some(&snapshot.participant_id),
    )?
    .into_iter()
    .next();
    match (
        policy.as_ref(),
        snapshot.policy_version,
        snapshot.policy_fingerprint.as_ref(),
    ) {
        (None, None, None) => {}
        (Some(policy), Some(version), Some(fingerprint))
            if policy.version == version
                && super::super::policy::policy_record_fingerprint(policy)? == *fingerprint => {}
        _ => return Err(AuthorizationStateError::PortalPolicyChanged),
    }
    for (group_key, version) in &snapshot.capability_group_versions {
        let Some(group) = super::policy::load_capability_group(connection, group_key)? else {
            return Err(AuthorizationStateError::PortalPolicyChanged);
        };
        if group.version != *version
            || super::super::policy::policy_record_fingerprint(&group)?
                != group_fingerprints[group_key]
        {
            return Err(AuthorizationStateError::PortalPolicyChanged);
        }
    }
    Ok(())
}

fn desired_authority_enforceability_equal(
    connection: &Connection,
    desired: &DesiredAuthorityRecord,
) -> Result<bool, AuthorizationStateError> {
    match desired {
        DesiredAuthorityRecord::Identity(desired) => Ok(load_identity_authority(
            connection,
            &desired.principal_id,
            &desired.participant_id,
        )?
        .is_some_and(|current| identity_enforceability_equal(&current, desired))),
        DesiredAuthorityRecord::Deployment(desired) => Ok(load_deployment_authority(
            connection,
            &desired.deployment_id,
            &desired.participant_id,
        )?
        .is_some_and(|current| deployment_enforceability_equal(&current, desired))),
    }
}

pub(in crate::platform::auth) fn put_sql_desired_authority(
    connection: &Connection,
    desired: DesiredAuthorityRecord,
) -> Result<(), AuthorizationStateError> {
    match desired {
        DesiredAuthorityRecord::Identity(mut record) => {
            let expected =
                load_identity_authority(connection, &record.principal_id, &record.participant_id)?
                    .map(|current| current.version);
            put_identity_authority(connection, &mut record, expected)?;
        }
        DesiredAuthorityRecord::Deployment(mut record) => {
            if load_deployment(connection, &record.deployment_id)?.is_none_or(|deployment| {
                deployment.participant_id != record.participant_id
                    || deployment.participant_kind != record.participant_kind
            }) {
                return Err(AuthorizationStateError::InvalidRecord(
                    "deployment authority target does not match its deployment".to_owned(),
                ));
            }
            let expected = load_deployment_authority(
                connection,
                &record.deployment_id,
                &record.participant_id,
            )?
            .map(|current| current.version);
            put_deployment_authority(connection, &mut record, expected)?;
        }
    }
    Ok(())
}

pub(in crate::platform::auth) fn decode_authority_proposal(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<AuthorityProposalRecord> {
    Ok(AuthorityProposalRecord {
        proposal_id: row.get(0)?,
        authority_kind: decode_enum(row.get::<_, String>(1)?)?,
        authority_id: row.get(2)?,
        deployment_id: row.get(3)?,
        proposal_kind: decode_enum(row.get(4)?)?,
        participant_id: row.get(5)?,
        participant_artifact_digest: row.get(6)?,
        participant_needs_digest: row.get(7)?,
        proposed_grant_set: decode_json(row.get(8)?)?,
        proposed_capabilities: decode_json(row.get(9)?)?,
        proposal_digest: row.get(10)?,
        payload: decode_json(row.get(11)?)?,
        state: decode_enum(row.get(12)?)?,
        created_at: row.get(13)?,
        expires_at: row.get(14)?,
        superseded_at: row.get(15)?,
        version: from_sql_version(row.get(16)?)?,
    })
}

pub(in crate::platform::auth) fn load_authority_proposal(
    connection: &Connection,
    proposal_id: &str,
) -> Result<
    Option<(AuthorityProposalRecord, Option<AuthorityDecisionRecord>)>,
    AuthorizationStateError,
> {
    let proposal = connection
    .query_row(
        "SELECT proposal_id, authority_kind, authority_id, deployment_id, proposal_kind, participant_id, participant_artifact_digest, participant_needs_digest, proposed_grant_set_json, proposed_capabilities_json, proposal_digest, payload_json, state, created_at, expires_at, superseded_at, version FROM auth_authority_proposals WHERE proposal_id = ?1",
        [proposal_id],
        decode_authority_proposal,
    )
    .optional()
    .map_err(sql_error)?;
    let Some(proposal) = proposal else {
        return Ok(None);
    };
    let decision = connection
    .query_row(
        "SELECT proposal_id, outcome, decided_by, reason, decided_at, decision_digest FROM auth_authority_decisions WHERE proposal_id = ?1",
        [proposal_id],
        |row| {
            Ok(AuthorityDecisionRecord {
                proposal_id: row.get(0)?,
                outcome: decode_enum(row.get(1)?)?,
                decided_by: row.get(2)?,
                reason: row.get(3)?,
                decided_at: row.get(4)?,
                decision_digest: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(sql_error)?;
    Ok(Some((proposal, decision)))
}

pub(in crate::platform::auth) fn load_identity_authority(
    connection: &Connection,
    principal_id: &str,
    participant_id: &str,
) -> Result<Option<IdentityAuthorityRecord>, AuthorizationStateError> {
    connection
        .query_row(
            "SELECT authority_id, principal_id, participant_id,
                participant_artifact_digest, accepted_needs_digest,
                desired_grant_set_json, desired_capabilities_json, state, version,
                created_at, updated_at, expires_at, decision_at, decision_by,
                decision_reason
         FROM auth_identity_authorities
         WHERE principal_id = ?1 AND participant_id = ?2",
            params![principal_id, participant_id],
            decode_identity_authority,
        )
        .optional()
        .map_err(sql_error)
}

pub(in crate::platform::auth) fn decode_identity_authority(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<IdentityAuthorityRecord> {
    Ok(IdentityAuthorityRecord {
        authority_id: row.get(0)?,
        principal_id: row.get(1)?,
        participant_id: row.get(2)?,
        participant_artifact_digest: row.get(3)?,
        accepted_needs_digest: row.get(4)?,
        desired_grant_set: decode_json(row.get::<_, String>(5)?)?,
        desired_capabilities: decode_json(row.get::<_, String>(6)?)?,
        state: decode_enum(row.get::<_, String>(7)?)?,
        version: from_sql_version(row.get(8)?)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        expires_at: row.get(11)?,
        decision: decode_decision(row, 12, 13, 14)?,
    })
}

pub(in crate::platform::auth) fn put_identity_authority(
    connection: &Connection,
    record: &mut IdentityAuthorityRecord,
    expected_version: Option<u64>,
) -> Result<(), AuthorizationStateError> {
    let principal = load_principal(connection, &record.principal_id)?
        .ok_or(AuthorizationStateError::PrincipalMissing)?;
    if principal.kind != PrincipalKind::User {
        return Err(AuthorizationStateError::PrincipalMissing);
    }
    let binding = load_participant_binding(
        connection,
        &record.participant_id,
        &record.participant_artifact_digest,
    )?
    .ok_or(AuthorizationStateError::ParticipantMissing)?;
    super::super::domain::validate_principal_participant(
        PrincipalKind::User,
        binding.participant_kind,
    )?;
    if binding.needs_digest != record.accepted_needs_digest {
        return Err(AuthorizationStateError::NeedsDigestMismatch);
    }
    if let Some(expected) = expected_version {
        let current =
            load_identity_authority(connection, &record.principal_id, &record.participant_id)?
                .ok_or(AuthorizationStateError::StorageConflict)?;
        if current.version != expected || current.authority_id != record.authority_id {
            return Err(AuthorizationStateError::StorageConflict);
        }
        if identity_enforceability_equal(&current, record) {
            record.version = expected;
        } else if record.version
            != expected.checked_add(1).ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("authority version overflow".to_owned())
            })?
        {
            return Err(AuthorizationStateError::StorageConflict);
        }
    }
    let grant_set = encode_json(&record.desired_grant_set)?;
    let capabilities = encode_json(&record.desired_capabilities)?;
    let (decision_at, decision_by, decision_reason) = encode_decision(&record.decision);
    match expected_version {
        None if record.version == 1 => {
            connection
                .execute(
                    "INSERT INTO auth_identity_authorities (
                authority_id, principal_id, participant_id, participant_artifact_digest,
                accepted_needs_digest, desired_grant_set_json,
                desired_capabilities_json, state, version, created_at, updated_at,
                expires_at, decision_at, decision_by, decision_reason
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                    params![
                        record.authority_id,
                        record.principal_id,
                        record.participant_id,
                        record.participant_artifact_digest,
                        record.accepted_needs_digest,
                        grant_set,
                        capabilities,
                        encode_enum(record.state)?,
                        to_sql_version(record.version)?,
                        record.created_at,
                        record.updated_at,
                        record.expires_at,
                        decision_at,
                        decision_by,
                        decision_reason,
                    ],
                )
                .map_err(map_write_error)?;
        }
        Some(expected) => {
            let changed = connection
                .execute(
                    "UPDATE auth_identity_authorities SET
                participant_artifact_digest = ?1, accepted_needs_digest = ?2,
                desired_grant_set_json = ?3, desired_capabilities_json = ?4,
                state = ?5, version = ?6, updated_at = ?7, expires_at = ?8,
                decision_at = ?9, decision_by = ?10, decision_reason = ?11
             WHERE principal_id = ?12 AND participant_id = ?13
               AND authority_id = ?14 AND version = ?15",
                    params![
                        record.participant_artifact_digest,
                        record.accepted_needs_digest,
                        grant_set,
                        capabilities,
                        encode_enum(record.state)?,
                        to_sql_version(record.version)?,
                        record.updated_at,
                        record.expires_at,
                        decision_at,
                        decision_by,
                        decision_reason,
                        record.principal_id,
                        record.participant_id,
                        record.authority_id,
                        to_sql_version(expected)?,
                    ],
                )
                .map_err(map_write_error)?;
            if changed != 1 {
                return Err(AuthorizationStateError::StorageConflict);
            }
        }
        _ => return Err(AuthorizationStateError::StorageConflict),
    }
    Ok(())
}

pub(in crate::platform::auth) fn load_deployment_authority(
    connection: &Connection,
    deployment_id: &str,
    participant_id: &str,
) -> Result<Option<DeploymentAuthorityRecord>, AuthorizationStateError> {
    connection
        .query_row(
            "SELECT authority_id, deployment_id, participant_id, participant_kind,
                participant_artifact_digest, accepted_needs_digest,
                desired_grant_set_json, desired_capabilities_json, state, version,
                created_at, updated_at, expires_at, decision_at, decision_by,
                decision_reason
         FROM auth_deployment_authorities
         WHERE deployment_id = ?1 AND participant_id = ?2",
            params![deployment_id, participant_id],
            decode_deployment_authority,
        )
        .optional()
        .map_err(sql_error)
}

pub(in crate::platform::auth) fn decode_deployment_authority(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<DeploymentAuthorityRecord> {
    Ok(DeploymentAuthorityRecord {
        authority_id: row.get(0)?,
        deployment_id: row.get(1)?,
        participant_id: row.get(2)?,
        participant_kind: decode_enum(row.get::<_, String>(3)?)?,
        participant_artifact_digest: row.get(4)?,
        accepted_needs_digest: row.get(5)?,
        desired_grant_set: decode_json(row.get::<_, String>(6)?)?,
        desired_capabilities: decode_json(row.get::<_, String>(7)?)?,
        state: decode_enum(row.get::<_, String>(8)?)?,
        version: from_sql_version(row.get(9)?)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        expires_at: row.get(12)?,
        decision: decode_decision(row, 13, 14, 15)?,
    })
}

pub(in crate::platform::auth) fn put_deployment_authority(
    connection: &Connection,
    record: &mut DeploymentAuthorityRecord,
    expected_version: Option<u64>,
) -> Result<(), AuthorizationStateError> {
    let binding = load_participant_binding(
        connection,
        &record.participant_id,
        &record.participant_artifact_digest,
    )?
    .ok_or(AuthorizationStateError::ParticipantMissing)?;
    if binding.participant_kind != record.participant_kind {
        return Err(AuthorizationStateError::InvalidRecord(
            "deployment authority participant kind does not match binding".to_owned(),
        ));
    }
    if binding.needs_digest != record.accepted_needs_digest {
        return Err(AuthorizationStateError::NeedsDigestMismatch);
    }
    if let Some(expected) = expected_version {
        let current =
            load_deployment_authority(connection, &record.deployment_id, &record.participant_id)?
                .ok_or(AuthorizationStateError::StorageConflict)?;
        if current.version != expected || current.authority_id != record.authority_id {
            return Err(AuthorizationStateError::StorageConflict);
        }
        if deployment_enforceability_equal(&current, record) {
            record.version = expected;
        } else if record.version
            != expected.checked_add(1).ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("authority version overflow".to_owned())
            })?
        {
            return Err(AuthorizationStateError::StorageConflict);
        }
    }
    let grant_set = encode_json(&record.desired_grant_set)?;
    let capabilities = encode_json(&record.desired_capabilities)?;
    let (decision_at, decision_by, decision_reason) = encode_decision(&record.decision);
    match expected_version {
        None if record.version == 1 => {
            connection
                .execute(
                    "INSERT INTO auth_deployment_authorities (
                authority_id, deployment_id, participant_id, participant_kind,
                participant_artifact_digest, accepted_needs_digest,
                desired_grant_set_json, desired_capabilities_json, state, version,
                created_at, updated_at, expires_at, decision_at, decision_by,
                decision_reason
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                    params![
                        record.authority_id,
                        record.deployment_id,
                        record.participant_id,
                        encode_enum(record.participant_kind)?,
                        record.participant_artifact_digest,
                        record.accepted_needs_digest,
                        grant_set,
                        capabilities,
                        encode_enum(record.state)?,
                        to_sql_version(record.version)?,
                        record.created_at,
                        record.updated_at,
                        record.expires_at,
                        decision_at,
                        decision_by,
                        decision_reason,
                    ],
                )
                .map_err(map_write_error)?;
        }
        Some(expected) => {
            let changed = connection
                .execute(
                    "UPDATE auth_deployment_authorities SET
                participant_kind = ?1, participant_artifact_digest = ?2,
                accepted_needs_digest = ?3, desired_grant_set_json = ?4,
                desired_capabilities_json = ?5, state = ?6, version = ?7,
                updated_at = ?8, expires_at = ?9, decision_at = ?10,
                decision_by = ?11, decision_reason = ?12
             WHERE deployment_id = ?13 AND participant_id = ?14
               AND authority_id = ?15 AND version = ?16",
                    params![
                        encode_enum(record.participant_kind)?,
                        record.participant_artifact_digest,
                        record.accepted_needs_digest,
                        grant_set,
                        capabilities,
                        encode_enum(record.state)?,
                        to_sql_version(record.version)?,
                        record.updated_at,
                        record.expires_at,
                        decision_at,
                        decision_by,
                        decision_reason,
                        record.deployment_id,
                        record.participant_id,
                        record.authority_id,
                        to_sql_version(expected)?,
                    ],
                )
                .map_err(map_write_error)?;
            if changed != 1 {
                return Err(AuthorizationStateError::StorageConflict);
            }
        }
        _ => return Err(AuthorizationStateError::StorageConflict),
    }
    Ok(())
}

pub(in crate::platform::auth) fn encode_decision(
    decision: &Option<AuthorityDecision>,
) -> (Option<i64>, Option<&str>, Option<&str>) {
    decision.as_ref().map_or((None, None, None), |value| {
        (
            Some(value.decided_at),
            Some(value.decided_by.as_str()),
            value.reason.as_deref(),
        )
    })
}

pub(in crate::platform::auth) fn decode_decision(
    row: &rusqlite::Row<'_>,
    at: usize,
    by: usize,
    reason: usize,
) -> rusqlite::Result<Option<AuthorityDecision>> {
    let decided_at: Option<i64> = row.get(at)?;
    let decided_by: Option<String> = row.get(by)?;
    match (decided_at, decided_by) {
        (None, None) => Ok(None),
        (Some(decided_at), Some(decided_by)) => Ok(Some(AuthorityDecision {
            decided_at,
            decided_by,
            reason: row.get(reason)?,
        })),
        _ => Err(decode_failure("paired authority decision columns disagree")),
    }
}

#[cfg(test)]
mod portal_policy_snapshot_tests {
    use std::collections::BTreeMap;

    use serde_json::{json, Value};

    use super::verify_portal_policy_snapshot;
    use crate::platform::auth::application::repository::{LoginPortalMutation, PortalRepository};
    use crate::platform::auth::policy::portal_policy_snapshot;
    use crate::platform::auth::{
        AuthorizationStateError, CapabilityGroupRecord, IdempotencyResultRecord, LoginPortalRecord,
        LoginSettingsRecord, PortalGrantOverrideRecord, SqliteAuthorizationStore,
    };

    fn idempotency(request_id: &str) -> IdempotencyResultRecord {
        IdempotencyResultRecord {
            scope_key: trellis_protocol::digest_json(&json!(["portal-snapshot", request_id]))
                .unwrap(),
            purpose: "test.portal-snapshot".to_owned(),
            signer_id: "test".to_owned(),
            request_id: request_id.to_owned(),
            request_digest: trellis_protocol::digest_json(&Value::String(request_id.to_owned()))
                .unwrap(),
            result: Value::Null,
            created_at: 1,
            expires_at: 100,
        }
    }

    async fn verify_snapshot(
        store: &SqliteAuthorizationStore,
        snapshot: crate::platform::auth::PortalPolicySnapshot,
    ) -> Result<(), AuthorizationStateError> {
        store
            .run(move |connection| verify_portal_policy_snapshot(connection, &snapshot))
            .await
    }

    #[tokio::test]
    async fn stale_portal_policy_snapshots_fail_at_the_sqlite_transaction_boundary() {
        let store = SqliteAuthorizationStore::open_in_memory().unwrap();
        let portal = LoginPortalRecord {
            portal_id: "portal".to_owned(),
            display_name: "Portal".to_owned(),
            entry_url: None,
            builtin: false,
            disabled: false,
            removed: false,
            local_registration_enabled: true,
            provider_ids: vec!["local".to_owned()],
            created_at: 1,
            updated_at: 1,
            version: 1,
        };
        let settings = LoginSettingsRecord {
            portal_id: portal.portal_id.clone(),
            default_provider_id: Some("local".to_owned()),
            local_login_enabled: true,
            federated_registration_enabled: false,
            provider_selection_enabled: false,
            updated_at: 1,
            version: 1,
        };
        store
            .put_login_portal(LoginPortalMutation {
                portal: portal.clone(),
                settings: settings.clone(),
                expected_version: None,
                idempotency: idempotency("portal-1"),
                actions: Vec::new(),
            })
            .await
            .unwrap();
        let group = CapabilityGroupRecord {
            group_key: "readers".to_owned(),
            display_name: "Readers".to_owned(),
            description: "Read access".to_owned(),
            capabilities: vec!["app::read".to_owned()],
            included_groups: Vec::new(),
            created_at: 1,
            updated_at: 1,
            version: 1,
        };
        store
            .put_capability_group(group.clone(), None, idempotency("group-1"))
            .await
            .unwrap();
        let policy = PortalGrantOverrideRecord {
            portal_id: portal.portal_id.clone(),
            participant_id: "app".to_owned(),
            direct_capabilities: Vec::new(),
            capability_group_keys: vec![group.group_key.clone()],
            role_mappings: Vec::new(),
            created_at: 1,
            updated_at: 1,
            version: 1,
        };
        store
            .put_portal_grant_override(policy.clone(), None, idempotency("policy-1"))
            .await
            .unwrap();
        let groups = BTreeMap::from([(group.group_key.clone(), group.clone())]);
        let snapshot =
            portal_policy_snapshot(&portal, &settings, "app", Some(&policy), &groups).unwrap();
        verify_snapshot(&store, snapshot.clone()).await.unwrap();

        let mut changed_portal = portal.clone();
        changed_portal.display_name = "Changed".to_owned();
        changed_portal.updated_at = 2;
        changed_portal.version = 2;
        let mut changed_settings = settings.clone();
        changed_settings.updated_at = 2;
        changed_settings.version = 2;
        store
            .put_login_portal(LoginPortalMutation {
                portal: changed_portal.clone(),
                settings: changed_settings.clone(),
                expected_version: Some(1),
                idempotency: idempotency("portal-2"),
                actions: Vec::new(),
            })
            .await
            .unwrap();
        assert_eq!(
            verify_snapshot(&store, snapshot).await,
            Err(AuthorizationStateError::PortalPolicyChanged)
        );

        let snapshot = portal_policy_snapshot(
            &changed_portal,
            &changed_settings,
            "app",
            Some(&policy),
            &groups,
        )
        .unwrap();
        let mut changed_group = group.clone();
        changed_group.capabilities = Vec::new();
        changed_group.updated_at = 2;
        changed_group.version = 2;
        store
            .put_capability_group(changed_group.clone(), Some(1), idempotency("group-2"))
            .await
            .unwrap();
        assert_eq!(
            verify_snapshot(&store, snapshot).await,
            Err(AuthorizationStateError::PortalPolicyChanged)
        );

        let changed_groups = BTreeMap::from([(changed_group.group_key.clone(), changed_group)]);
        let snapshot = portal_policy_snapshot(
            &changed_portal,
            &changed_settings,
            "app",
            Some(&policy),
            &changed_groups,
        )
        .unwrap();
        let mut changed_policy = policy;
        changed_policy.capability_group_keys.clear();
        changed_policy.updated_at = 2;
        changed_policy.version = 2;
        store
            .put_portal_grant_override(changed_policy, Some(1), idempotency("policy-2"))
            .await
            .unwrap();
        assert_eq!(
            verify_snapshot(&store, snapshot).await,
            Err(AuthorizationStateError::PortalPolicyChanged)
        );
    }
}
