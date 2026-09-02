use std::collections::BTreeMap;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};
use trellis_protocol::{
    canonicalize_json, compare_api_replacement, parse_api, parse_participant, resolve_participant,
    ApiArtifact, GrantSet,
};
use ulid::Ulid;

use super::super::*;

/// Service-owned input for an immutable authority proposal.
#[derive(Clone, Debug)]
pub struct CreateAuthorityProposalInput {
    /// Typed authority class.
    pub authority_kind: AuthorityKind,
    /// Stable desired-authority ID being proposed.
    pub authority_id: String,
    /// Deployment owning this lineage; absent for identity authority.
    pub deployment_id: Option<String>,
    /// Proposal intent.
    pub proposal_kind: AuthorityProposalKind,
    /// Exact participant ID.
    pub participant_id: String,
    /// Exact participant artifact digest.
    pub participant_artifact_digest: String,
    /// Exact participant needs digest.
    pub participant_needs_digest: String,
    /// Proposed exact grants.
    pub grant_set: GrantSet,
    /// Proposed canonical platform capabilities.
    pub capabilities: Vec<String>,
    /// Authority version against which this semantic proposal was derived.
    pub base_authority_version: Option<u64>,
    /// Immutable proposal metadata.
    pub payload: Value,
    /// Creation time in Unix milliseconds.
    pub created_at: i64,
    /// Required-nullable proposal expiry.
    pub expires_at: Option<i64>,
    /// Durable proof claim; its result is replaced with the proposal ID.
    pub idempotency: IdempotencyResultRecord,
    /// Deterministic post-commit actions.
    pub actions: Vec<PostCommitActionRecord>,
}

/// Exact participant and API presentation used to plan deployment authority.
#[derive(Clone, Debug)]
pub struct PresentDeploymentAuthorityInput {
    /// Stable deployment receiving the participant binding.
    pub deployment_id: String,
    /// Full `trellis.participant.v1` artifact.
    pub participant_artifact: Value,
    /// Every exact API artifact referenced by the participant.
    pub referenced_api_artifacts: Vec<Value>,
    /// Proposal creation time in Unix milliseconds.
    pub created_at: i64,
    /// Required-nullable administrative proposal expiry.
    pub expires_at: Option<i64>,
    /// Durable request identity.
    pub idempotency: IdempotencyResultRecord,
    /// Deterministic post-commit actions.
    pub actions: Vec<PostCommitActionRecord>,
}

/// Service-owned input for one terminal proposal decision.
#[derive(Clone, Debug)]
pub struct DecideAuthorityProposalInput {
    /// Stable proposal ID.
    pub proposal_id: String,
    /// Expected pending proposal version.
    pub expected_version: u64,
    /// Caller-observed authority version for optimistic acceptance; outer `None` skips the check.
    pub expected_base_authority_version: Option<Option<u64>>,
    /// Accepted or rejected outcome.
    pub outcome: AuthorityDecisionOutcome,
    /// Stable deciding principal or operator.
    pub decided_by: String,
    /// Required-nullable safe reason.
    pub reason: Option<String>,
    /// Exact desired authority for acceptance; absent for rejection.
    pub desired_authority: Option<DesiredAuthorityRecord>,
    /// Portal provenance replacement for identity authority; outer `None` preserves it.
    pub portal_binding: Option<Option<super::super::PortalAuthorityBindingRecord>>,
    /// Exact portal provenance expected before replacement; outer `None` skips the check.
    pub expected_portal_binding: Option<Option<super::super::PortalAuthorityBindingRecord>>,
    /// Exact trusted-portal policy versions that must remain current.
    pub portal_policy_snapshot: Option<PortalPolicySnapshot>,
    /// Decision time in Unix milliseconds.
    pub decided_at: i64,
    /// Durable proof claim; its result is replaced with the terminal decision.
    pub idempotency: IdempotencyResultRecord,
    /// Deterministic post-commit actions.
    pub actions: Vec<PostCommitActionRecord>,
}

/// Portal provenance supplied while applying one identity-authority selection.
#[derive(Clone, Debug)]
pub(crate) struct PortalAuthoritySource {
    pub portal_id: String,
    pub provider_id: String,
    pub roles: Vec<String>,
    pub effective_policy_digest: String,
}

/// Internal version fence for one trusted-portal policy decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PortalPolicySnapshot {
    pub portal_id: String,
    pub portal_version: u64,
    pub portal_fingerprint: String,
    pub login_settings_version: u64,
    pub login_settings_fingerprint: String,
    pub participant_id: String,
    pub policy_version: Option<u64>,
    pub policy_fingerprint: Option<String>,
    pub capability_group_versions: Vec<(String, u64)>,
    pub capability_group_fingerprints: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
pub(crate) enum PortalBindingMutation {
    Set(PortalAuthoritySource),
    Clear,
    CompareAndSet {
        expected: Option<super::super::PortalAuthorityBindingRecord>,
        replacement: Option<PortalAuthoritySource>,
    },
}

/// Service-owned input for applying a browser identity-authority selection.
#[derive(Clone, Debug)]
pub(crate) struct ApplyIdentityAuthoritySelectionInput {
    pub principal_id: String,
    pub participant_id: String,
    pub participant_artifact_digest: String,
    pub participant_needs_digest: String,
    pub grant_set: GrantSet,
    pub capabilities: Vec<String>,
    pub state: AuthorityState,
    pub decided_by: String,
    pub source_payload: Value,
    pub portal_binding: PortalBindingMutation,
    pub portal_policy_snapshot: Option<PortalPolicySnapshot>,
    pub decided_at: i64,
    pub expires_at: Option<i64>,
    pub proposal_idempotency: IdempotencyResultRecord,
    pub decision_idempotency: IdempotencyResultRecord,
}

fn protocol_digest(value: &Value) -> Result<String, AuthorizationStateError> {
    trellis_protocol::digest_json(value).map_err(|error| {
        AuthorizationStateError::InvalidRecord(format!(
            "value cannot be canonically digested: {error}"
        ))
    })
}

fn proposal_semantic_digest(
    input: &CreateAuthorityProposalInput,
    capabilities: &[String],
) -> Result<String, AuthorizationStateError> {
    protocol_digest(&json!({
        "format": "trellis.authority-proposal-semantic.v1",
        "authorityKind": input.authority_kind,
        "authorityId": input.authority_id,
        "proposalKind": input.proposal_kind,
        "participantId": input.participant_id,
        "participantArtifactDigest": input.participant_artifact_digest,
        "participantNeedsDigest": input.participant_needs_digest,
        "grantSet": input.grant_set,
        "capabilities": capabilities,
        "baseAuthorityVersion": input.base_authority_version,
    }))
}

fn binding_apis(
    binding: &ParticipantBindingRecord,
) -> Result<BTreeMap<String, ApiArtifact>, AuthorizationStateError> {
    let values: BTreeMap<String, Value> = serde_json::from_str(&binding.api_artifacts_json)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    values
        .into_iter()
        .map(|(id, value)| {
            let api = parse_api(&value)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
            if api.id() != id {
                return Err(AuthorizationStateError::InvalidRecord(format!(
                    "API artifact map key {id} does not match {}",
                    api.id()
                )));
            }
            Ok((id, api))
        })
        .collect()
}

fn participant_api_update_is_compatible(
    previous: &ParticipantBindingRecord,
    candidate: &ParticipantBindingRecord,
) -> Result<bool, AuthorizationStateError> {
    let previous = binding_apis(previous)?;
    let candidate = binding_apis(candidate)?;
    for (id, candidate) in candidate {
        let Some(previous) = previous.get(&id) else {
            continue;
        };
        if previous
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
            != candidate
                .digest()
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
            && !compare_api_replacement(previous, &candidate)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
                .compatible
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn authority_target(authority: &DesiredAuthorityRecord) -> AuthorityTarget {
    match authority {
        DesiredAuthorityRecord::Identity(authority) => AuthorityTarget {
            kind: AuthorityKind::Identity,
            authority_id: authority.authority_id.clone(),
        },
        DesiredAuthorityRecord::Deployment(authority) => AuthorityTarget {
            kind: AuthorityKind::Deployment,
            authority_id: authority.authority_id.clone(),
        },
    }
}

impl<R> AuthService<R>
where
    R: AuthorityRepository
        + AuthorityEvidenceRepository
        + ContextRepository
        + PortalRepository
        + Clone,
{
    pub(crate) async fn apply_identity_authority_selection(
        &self,
        input: ApplyIdentityAuthoritySelectionInput,
    ) -> Result<IdentityAuthorityRecord, AuthorizationStateError> {
        self.apply_identity_authority_selection_inner(input, true)
            .await
    }

    pub(crate) async fn commit_identity_authority_selection(
        &self,
        input: ApplyIdentityAuthoritySelectionInput,
    ) -> Result<IdentityAuthorityRecord, AuthorizationStateError> {
        self.apply_identity_authority_selection_inner(input, false)
            .await
    }

    async fn apply_identity_authority_selection_inner(
        &self,
        input: ApplyIdentityAuthoritySelectionInput,
        materialize: bool,
    ) -> Result<IdentityAuthorityRecord, AuthorizationStateError> {
        let current = self
            .repository
            .get_identity_authority(&input.principal_id, &input.participant_id)
            .await?;
        let current_portal_binding = self
            .repository
            .list_portal_authority_bindings()
            .await?
            .into_iter()
            .find(|binding| {
                binding.principal_id == input.principal_id
                    && binding.participant_id == input.participant_id
            });
        let authority_id = current.as_ref().map_or_else(
            || {
                format!(
                    "ida_{}",
                    digest_parts(&[&input.principal_id, &input.participant_id])
                )
            },
            |authority| authority.authority_id.clone(),
        );
        let expires_at = input
            .expires_at
            .or_else(|| current.as_ref().and_then(|authority| authority.expires_at));
        let desired = IdentityAuthorityRecord {
            authority_id: authority_id.clone(),
            principal_id: input.principal_id.clone(),
            participant_id: input.participant_id.clone(),
            participant_artifact_digest: input.participant_artifact_digest.clone(),
            accepted_needs_digest: input.participant_needs_digest.clone(),
            desired_grant_set: input.grant_set.clone(),
            desired_capabilities: input.capabilities.clone(),
            state: input.state,
            version: current
                .as_ref()
                .map_or(1, |authority| authority.version + 1),
            created_at: current
                .as_ref()
                .map_or(input.decided_at, |authority| authority.created_at),
            updated_at: input.decided_at,
            expires_at,
            decision: Some(AuthorityDecision {
                decided_at: input.decided_at,
                decided_by: input.decided_by.clone(),
                reason: None,
            }),
        };
        let semantic_noop = current.as_ref().is_some_and(|authority| {
            super::super::authority::identity_enforceability_equal(authority, &desired)
        });
        let base_authority_version = current.as_ref().map(|authority| authority.version);
        let mut payload = input.source_payload;
        payload
            .as_object_mut()
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord(
                    "identity authority source payload must be an object".to_owned(),
                )
            })?
            .insert(
                "baseAuthorityVersion".to_owned(),
                base_authority_version.map_or(Value::Null, Value::from),
            );
        let proposal = self
            .create_authority_proposal(CreateAuthorityProposalInput {
                authority_kind: AuthorityKind::Identity,
                authority_id: authority_id.clone(),
                deployment_id: None,
                proposal_kind: if current.is_some() {
                    AuthorityProposalKind::Update
                } else {
                    AuthorityProposalKind::Initial
                },
                participant_id: input.participant_id.clone(),
                participant_artifact_digest: input.participant_artifact_digest,
                participant_needs_digest: input.participant_needs_digest,
                grant_set: input.grant_set,
                capabilities: input.capabilities,
                base_authority_version,
                payload,
                created_at: input.decided_at,
                expires_at,
                idempotency: input.proposal_idempotency,
                actions: Vec::new(),
            })
            .await?;
        let proposal_id = match proposal {
            IdempotentOutcome::Applied(proposal) => proposal.proposal_id,
            IdempotentOutcome::Replayed(value) => value
                .get("proposalId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    AuthorizationStateError::Storage("invalid proposal replay".to_owned())
                })?
                .to_owned(),
        };
        let (proposal, _) = self
            .repository
            .get_authority_proposal(&proposal_id)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::Storage("authority proposal missing".to_owned())
            })?;
        let portal_record = |source: PortalAuthoritySource| PortalAuthorityBindingRecord {
            principal_id: input.principal_id.clone(),
            participant_id: input.participant_id.clone(),
            authority_id: authority_id.clone(),
            portal_id: source.portal_id,
            provider_id: source.provider_id,
            roles: source.roles,
            effective_policy_digest: source.effective_policy_digest,
            authority_version: if semantic_noop {
                current.as_ref().expect("no-op has current").version
            } else {
                desired.version
            },
            updated_at: input.decided_at,
        };
        let (portal_binding, expected_portal_binding) = match input.portal_binding {
            PortalBindingMutation::Set(source) => (
                Some(Some(portal_record(source))),
                Some(current_portal_binding.clone()),
            ),
            PortalBindingMutation::Clear => (Some(None), Some(current_portal_binding.clone())),
            PortalBindingMutation::CompareAndSet {
                expected,
                replacement,
            } => (Some(replacement.map(portal_record)), Some(expected)),
        };
        let intended_portal_binding = portal_binding.clone();
        let decision = self
            .decide_authority_proposal(DecideAuthorityProposalInput {
                proposal_id,
                expected_version: proposal.version,
                expected_base_authority_version: Some(
                    current.as_ref().map(|authority| authority.version),
                ),
                outcome: AuthorityDecisionOutcome::Accepted,
                decided_by: input.decided_by,
                reason: None,
                desired_authority: Some(DesiredAuthorityRecord::Identity(desired.clone())),
                portal_binding,
                expected_portal_binding,
                portal_policy_snapshot: input.portal_policy_snapshot,
                decided_at: input.decided_at,
                idempotency: input.decision_idempotency,
                actions: Vec::new(),
            })
            .await;
        match decision {
            Ok(_) | Err(AuthorizationStateError::StorageConflict) => {}
            Err(AuthorizationStateError::PortalPolicyChanged) => {
                return Err(AuthorizationStateError::PortalPolicyChanged);
            }
            Err(error) => return Err(error),
        }
        let durable = self
            .repository
            .get_identity_authority(&input.principal_id, &input.participant_id)
            .await?;
        if !durable.as_ref().is_some_and(|authority| {
            super::super::authority::identity_enforceability_equal(authority, &desired)
        }) {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let durable = durable.expect("validated above");
        if let Some(intended) = intended_portal_binding {
            let durable_binding = self
                .repository
                .list_portal_authority_bindings()
                .await?
                .into_iter()
                .find(|binding| {
                    binding.principal_id == input.principal_id
                        && binding.participant_id == input.participant_id
                });
            let postcondition_holds = match (durable_binding.as_ref(), intended.as_ref()) {
                (None, None) => true,
                (Some(durable), Some(intended)) => {
                    durable.principal_id == intended.principal_id
                        && durable.participant_id == intended.participant_id
                        && durable.authority_id == intended.authority_id
                        && durable.portal_id == intended.portal_id
                        && durable.provider_id == intended.provider_id
                        && durable.roles == intended.roles
                        && durable.effective_policy_digest == intended.effective_policy_digest
                        && durable.authority_version == intended.authority_version
                }
                _ => false,
            };
            if !postcondition_holds {
                return Err(AuthorizationStateError::StorageConflict);
            }
        }
        if !materialize {
            return Ok(durable);
        }
        let binding = self
            .repository
            .get_participant_binding(
                &durable.participant_id,
                &durable.participant_artifact_digest,
            )
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord(
                    "identity authority participant binding is missing".to_owned(),
                )
            })?;
        let target = AuthorityTarget::new(AuthorityKind::Identity, durable.authority_id.clone())?;
        let scope = AuthorityEvidenceScope {
            target: target.clone(),
            participant_id: durable.participant_id.clone(),
            participant_artifact_digest: durable.participant_artifact_digest.clone(),
            participant_needs_digest: durable.accepted_needs_digest.clone(),
        };
        ensure_identity_resources(
            &self.repository,
            scope.clone(),
            &binding,
            &durable.principal_id,
            input.decided_at,
        )
        .await?;
        ensure_authority_dependencies(&self.repository, scope, &binding, input.decided_at).await?;
        self.authorization()
            .reconcile_authority(&target, input.decided_at)
            .await?;
        Ok(durable)
    }

    /// Parse, bind, classify, and create or reuse one deployment-authority proposal.
    ///
    /// # Errors
    ///
    /// Returns an invalid-record error when any artifact, digest, or reference is
    /// invalid, and a repository error when the exact binding or proposal cannot
    /// be committed.
    pub(crate) async fn present_deployment_authority(
        &self,
        input: PresentDeploymentAuthorityInput,
    ) -> Result<IdempotentOutcome<AuthorityProposalRecord>, AuthorizationStateError> {
        super::validation::validate_idempotency_and_actions(&input.idempotency, &input.actions)?;
        super::super::domain::require_protocol_timestamp("createdAt", input.created_at)?;
        let participant = parse_participant(&input.participant_artifact)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let mut apis = BTreeMap::<String, ApiArtifact>::new();
        let mut canonical_apis = BTreeMap::new();
        for value in input.referenced_api_artifacts {
            let api = parse_api(&value)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
            let id = api.id().to_owned();
            if let Some(existing) = apis.get(&id) {
                if existing
                    .digest()
                    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
                    != api.digest().map_err(|error| {
                        AuthorizationStateError::InvalidRecord(error.to_string())
                    })?
                {
                    return Err(AuthorizationStateError::InvalidRecord(format!(
                        "conflicting API artifacts are presented for {id}"
                    )));
                }
                continue;
            }
            canonical_apis.insert(
                id.clone(),
                api.normalized_value()
                    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
            );
            apis.insert(id, api);
        }
        let resolved = resolve_participant(&participant, &apis)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let participant_digest = resolved.participant_digest().to_owned();
        let needs_digest = resolved
            .needs()
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let binding = ParticipantBindingRecord {
            participant_id: resolved.participant_id().to_owned(),
            participant_kind: resolved.participant_kind(),
            artifact_digest: participant_digest.clone(),
            needs_digest: needs_digest.clone(),
            participant_json: participant
                .canonical_json()
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
            api_artifacts_json: canonicalize_json(
                &serde_json::to_value(&canonical_apis)
                    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
            )
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
            resolved_at: input.created_at,
            state: ParticipantBindingState::Resolved,
            error: None,
        };
        let current = self
            .repository
            .get_deployment_authority(&input.deployment_id, resolved.participant_id())
            .await?;
        let proposal_kind = if let Some(current) = &current {
            if current.participant_artifact_digest == participant_digest {
                AuthorityProposalKind::Update
            } else {
                let previous = self
                    .repository
                    .get_participant_binding(
                        resolved.participant_id(),
                        &current.participant_artifact_digest,
                    )
                    .await?
                    .ok_or(AuthorizationStateError::ParticipantMissing)?;
                if participant_api_update_is_compatible(&previous, &binding)? {
                    AuthorityProposalKind::Update
                } else {
                    AuthorityProposalKind::Migration
                }
            }
        } else {
            AuthorityProposalKind::Initial
        };
        super::super::builtins::validate_binding_namespace(&binding)?;
        self.repository.put_participant_binding(binding).await?;

        let proposal = resolved.proposal();
        let grant_set = GrantSet::new(
            proposal
                .required()
                .grant_set()
                .permissions()
                .iter()
                .chain(proposal.optional().grant_set().permissions())
                .cloned()
                .collect(),
        );
        let capabilities = proposal
            .required()
            .capabilities()
            .iter()
            .chain(proposal.optional().capabilities())
            .map(|capability| capability.name().to_owned())
            .collect();
        self.create_authority_proposal(CreateAuthorityProposalInput {
            authority_kind: AuthorityKind::Deployment,
            authority_id: super::super::model::deployment_authority_id(
                &input.deployment_id,
                resolved.participant_id(),
            )?,
            deployment_id: Some(input.deployment_id.clone()),
            proposal_kind,
            participant_id: resolved.participant_id().to_owned(),
            participant_artifact_digest: participant_digest,
            participant_needs_digest: needs_digest,
            grant_set,
            capabilities,
            base_authority_version: current.as_ref().map(|authority| authority.version),
            payload: json!({
                "deploymentId": input.deployment_id,
                "subjectId": input.deployment_id,
                "baseAuthorityVersion": current.as_ref().map(|authority| authority.version),
                "reasons": [],
                "resolution": proposal.normalized_value().map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
            }),
            created_at: input.created_at,
            expires_at: input.expires_at,
            idempotency: input.idempotency,
            actions: input.actions,
        })
        .await
    }
}

fn digest_parts(parts: &[&str]) -> String {
    let mut digest = Sha256::new();
    for part in parts {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    URL_SAFE_NO_PAD.encode(digest.finalize())
}

impl<R> AuthService<R>
where
    R: AuthorityRepository + AuthorityEvidenceRepository + ContextRepository + Clone,
{
    /// Create one immutable authority proposal with a service-owned digest.
    ///
    /// # Errors
    ///
    /// Returns an invalid-record error for malformed or non-canonical proposal
    /// input and a repository conflict for duplicate immutable identities.
    pub(crate) async fn create_authority_proposal(
        &self,
        mut input: CreateAuthorityProposalInput,
    ) -> Result<IdempotentOutcome<AuthorityProposalRecord>, AuthorizationStateError> {
        super::validation::validate_idempotency_and_actions(&input.idempotency, &input.actions)?;
        super::super::domain::require_protocol_timestamp("createdAt", input.created_at)?;
        let proposal_id = format!("apr_{}", Ulid::new());
        let capabilities =
            super::super::domain::canonical_capabilities(input.capabilities.clone())?;
        let proposal_digest = proposal_semantic_digest(&input, &capabilities)?;
        let proposal = AuthorityProposalRecord {
            proposal_id: proposal_id.clone(),
            authority_kind: input.authority_kind,
            authority_id: input.authority_id,
            deployment_id: input.deployment_id,
            proposal_kind: input.proposal_kind,
            participant_id: input.participant_id,
            participant_artifact_digest: input.participant_artifact_digest,
            participant_needs_digest: input.participant_needs_digest,
            proposed_grant_set: input.grant_set,
            proposed_capabilities: capabilities,
            proposal_digest,
            payload: input.payload,
            state: AuthorityProposalState::Pending,
            created_at: input.created_at,
            expires_at: input.expires_at,
            superseded_at: None,
            version: 1,
        };
        super::validation::validate_authority_proposal(&proposal)?;
        input.idempotency.result = json!({ "proposalId": proposal_id });
        self.repository
            .create_authority_proposal(AuthorityProposalCreation {
                proposal,
                idempotency: input.idempotency,
                actions: input.actions,
            })
            .await
    }

    /// Commit one terminal proposal decision and reconcile accepted authority.
    ///
    /// A replay retries reconciliation from the durable authority identity in
    /// the result, closing an unknown outcome after a post-commit failure.
    ///
    /// # Errors
    ///
    /// Returns a conflict for stale or terminal proposals and an invalid-record
    /// error when accepted authority does not exactly match the proposal.
    pub(crate) async fn decide_authority_proposal(
        &self,
        mut input: DecideAuthorityProposalInput,
    ) -> Result<IdempotentOutcome<AuthorityProposalRecord>, AuthorizationStateError> {
        super::validation::validate_idempotency_and_actions(&input.idempotency, &input.actions)?;
        super::super::domain::require_protocol_timestamp("decidedAt", input.decided_at)?;
        if let Some(desired) = input.desired_authority.as_mut() {
            super::validation::validate_authority_record(desired)?;
        }
        let proposal_id = input.proposal_id.clone();
        let decision_digest = protocol_digest(&json!({
            "proposalId": input.proposal_id,
            "outcome": input.outcome,
            "decidedBy": input.decided_by,
            "reason": input.reason,
            "decidedAt": input.decided_at,
        }))?;
        let target = input.desired_authority.as_ref().map(authority_target);
        let deployment = match input.desired_authority.as_ref() {
            Some(DesiredAuthorityRecord::Deployment(authority))
                if self
                    .repository
                    .get_deployment_evidence(&authority.deployment_id)
                    .await?
                    .is_none() =>
            {
                Some(DeploymentRecord {
                    deployment_id: authority.deployment_id.clone(),
                    participant_id: authority.participant_id.clone(),
                    participant_kind: authority.participant_kind,
                    active: true,
                    expires_at: authority.expires_at,
                })
            }
            _ => None,
        };
        if let Some(deployment) = &deployment {
            super::super::authority::validate_deployment_evidence(deployment)?;
        }
        input.idempotency.result = match &target {
            Some(target) => json!({
                "proposalId": input.proposal_id,
                "outcome": input.outcome,
                "authorityKind": target.kind,
                "authorityId": target.authority_id,
            }),
            None => json!({
                "proposalId": input.proposal_id,
                "outcome": input.outcome,
                "authorityKind": null,
                "authorityId": null,
            }),
        };
        let outcome = self
            .repository
            .decide_authority_proposal(AuthorityProposalDecision {
                proposal_id: input.proposal_id,
                expected_version: input.expected_version,
                expected_base_authority_version: input.expected_base_authority_version,
                decision: AuthorityDecisionRecord {
                    proposal_id,
                    outcome: input.outcome,
                    decided_by: input.decided_by,
                    reason: input.reason,
                    decided_at: input.decided_at,
                    decision_digest,
                },
                desired_authority: input.desired_authority,
                deployment,
                portal_binding: input.portal_binding,
                expected_portal_binding: input.expected_portal_binding,
                portal_policy_snapshot: input.portal_policy_snapshot,
                idempotency: input.idempotency,
                actions: input.actions,
            })
            .await?;
        let replay_target = match &outcome {
            IdempotentOutcome::Applied(_) => target,
            IdempotentOutcome::Replayed(value) => {
                match (
                    value
                        .get("authorityKind")
                        .and_then(serde_json::Value::as_str),
                    value.get("authorityId").and_then(serde_json::Value::as_str),
                ) {
                    (Some(kind), Some(authority_id)) => Some(AuthorityTarget {
                        kind: match kind {
                            "identity" => AuthorityKind::Identity,
                            "deployment" => AuthorityKind::Deployment,
                            _ => {
                                return Err(AuthorizationStateError::Storage(
                                    "proposal replay has invalid authorityKind".to_owned(),
                                ));
                            }
                        },
                        authority_id: authority_id.to_owned(),
                    }),
                    (None, None) => None,
                    _ => {
                        return Err(AuthorizationStateError::Storage(
                            "proposal replay has incomplete authority identity".to_owned(),
                        ));
                    }
                }
            }
        };
        if let Some(target) = replay_target {
            self.authorization
                .reconcile_authority(&target, input.decided_at)
                .await?;
        }
        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    #[test]
    fn semantic_proposal_digest_ignores_record_metadata_and_tracks_base_version() {
        let mut input = proposal_input(None);
        let capabilities = vec!["read".to_owned()];
        let first = proposal_semantic_digest(&input, &capabilities).unwrap();
        input.created_at += 50;
        input.expires_at = Some(NOW + 9_000);
        input.idempotency.request_id = "another-request".to_owned();
        input.idempotency.request_digest = "another-digest".to_owned();
        assert_eq!(
            proposal_semantic_digest(&input, &capabilities).unwrap(),
            first
        );
        input.base_authority_version = Some(1);
        assert_ne!(
            proposal_semantic_digest(&input, &capabilities).unwrap(),
            first
        );
    }

    fn proposal_input(base_authority_version: Option<u64>) -> CreateAuthorityProposalInput {
        CreateAuthorityProposalInput {
            authority_kind: AuthorityKind::Deployment,
            authority_id: "dau_test".to_owned(),
            deployment_id: Some("dep_test".to_owned()),
            proposal_kind: AuthorityProposalKind::Initial,
            participant_id: "participant.test@v1".to_owned(),
            participant_artifact_digest: "artifact".to_owned(),
            participant_needs_digest: "needs".to_owned(),
            grant_set: GrantSet::new(Vec::new()),
            capabilities: vec!["read".to_owned()],
            base_authority_version,
            payload: serde_json::json!({ "presentation": "ignored" }),
            created_at: NOW,
            expires_at: Some(NOW + 1_000),
            idempotency: IdempotencyResultRecord {
                scope_key: "scope".to_owned(),
                purpose: "proposal".to_owned(),
                signer_id: "signer".to_owned(),
                request_id: "request".to_owned(),
                request_digest: "digest".to_owned(),
                result: serde_json::Value::Null,
                created_at: NOW,
                expires_at: NOW + 1_000,
            },
            actions: Vec::new(),
        }
    }
}
