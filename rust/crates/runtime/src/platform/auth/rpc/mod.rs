//! Exact Auth RPC routing and workflow dispatch.

mod error;
mod router;
mod workflows;

use error::public_rpc_error;

use async_nats::header::HeaderMap;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use bytes::Bytes;
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use trellis_protocol::{
    parse_session_proof, session_proof_request_digest, verify_session_proof,
    AuthorizationPrincipalKind, DeviceBootstrapSessionProofInput, SessionProofInput,
    SessionProofPolicy,
};
use trellis_rs::service::Router;
#[cfg(test)]
use trellis_runtime_apis::auth as trellis_sdk_auth;
use ulid::Ulid;

use super::{
    activation_review_event_action_id, ensure_authority_dependencies, ensure_deployment_resources,
    validate_connection_kick_response, AccountFlowKind, AccountRepository, AuthConnectionPresence,
    AuthEphemeralRepository, AuthService, AuthorityDecision, AuthorityDecisionOutcome,
    AuthorityDecisionRecord, AuthorityEvidenceRepository, AuthorityKind, AuthorityProposalKind,
    AuthorityProposalRecord, AuthorityProposalState, AuthorityRepository, AuthorityState,
    AuthorityTarget, AuthorizationStateError, CapabilityGroupRecord, ChangePasswordInput,
    ContextRepository, CreateAccountFlowInput, CreateAuthorityProposalInput, CreateUserInput,
    DecideActivationReviewInput, DecideAuthorityProposalInput, DeploymentAuthorityRecord,
    DeploymentProfileCreation, DeploymentProfileMutation, DeploymentProfileRecord,
    DeploymentProfileState, DeploymentRepository, DesiredAuthorityRecord,
    DeviceActivationReviewRecord, DeviceActivationReviewState, DeviceDelegationMutation,
    DeviceDelegationRecord, DeviceDelegationState, DeviceReviewMode, IdempotencyResultRecord,
    IdempotentOutcome, IdentityAuthorityRecord, LoginPortalMutation, LoginPortalRecord,
    LoginSettingsRecord, NatsAuthEphemeralRepository, OutboxRepository, PortalGrantOverrideRecord,
    PortalPolicyReconciliationHandle, PortalRepository, PortalRoleMapping, PortalRouteMutation,
    PortalRouteRecord, PortalRouteRemoval, PostCommitActionKind, PostCommitActionRecord,
    PrincipalKind, PrincipalState, ProviderIdentityUnlink, ProvisionDeviceInput,
    ProvisionServiceIdentityInput, ProvisionedIdentityKind, ProvisionedIdentityRecord,
    ProvisionedIdentityState, ProvisionedInstanceMutation, ProvisioningRepository,
    RuntimeInstanceState, SessionRecord, SessionRepository, SqliteAuthorizationStore,
    UpdateUserInput, UserAccount,
};
use crate::shutdown::StopHandle;
use crate::supervisor::RuntimeError;

const MAX_CONCURRENT_REQUESTS: usize = 64;

pub(crate) struct AuthRpcRuntime {
    subscriber: async_nats::Subscriber,
    processor: AuthRpcProcessor,
}

#[derive(Clone)]
pub(crate) struct AuthRpcProcessor {
    pub(crate) client: async_nats::Client,
    pub(crate) system_client: async_nats::Client,
    pub(crate) service: AuthService<SqliteAuthorizationStore>,
    pub(crate) ephemeral: NatsAuthEphemeralRepository,
    pub(crate) public_origin: String,
    pub(crate) native_nats_servers: Vec<String>,
    pub(crate) websocket_nats_servers: Vec<String>,
    pub(crate) verifier: crate::platform::auth::verifier::RuntimeAuthVerifier,
    pub(crate) routes: Arc<Router>,
    pub(crate) portal_reconciliation: PortalPolicyReconciliationHandle,
}

struct ValidatedRequest {
    principal_id: String,
    principal_kind: PrincipalKind,
    session_id: String,
    session_public_key: String,
    capabilities: Vec<String>,
}

impl AuthRpcRuntime {
    pub(crate) async fn start(
        processor: AuthRpcProcessor,
    ) -> Result<Self, AuthorizationStateError> {
        let subscriber = processor
            .client
            .queue_subscribe("rpc.v1.Auth.>", "trellis-auth-rpc".to_owned())
            .await
            .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?;
        Ok(Self {
            subscriber,
            processor,
        })
    }

    pub(crate) async fn run(mut self, stop: StopHandle) -> Result<(), RuntimeError> {
        let mut requests = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                () = stop.stopped() => break,
                result = requests.join_next(), if !requests.is_empty() => {
                    if let Some(result) = result {
                        result.map_err(|error| RuntimeError::Platform(error.to_string()))??;
                    }
                }
                message = self.subscriber.next(), if requests.len() < MAX_CONCURRENT_REQUESTS => {
                    let Some(message) = message else {
                        return Err(RuntimeError::Platform("Auth RPC subscription closed".to_owned()));
                    };
                    let processor = self.processor.clone();
                    requests.spawn(async move { processor.process(message).await });
                }
            }
        }
        requests.abort_all();
        Ok(())
    }
}

impl AuthRpcProcessor {
    async fn deployment_authority_plan(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = required_string(&input, "deploymentId")?;
        let participant_artifact = input
            .get("participantArtifact")
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("participantArtifact is required".to_owned())
            })?
            .clone();
        let referenced_api_artifacts = input
            .get("referencedApiArtifacts")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord(
                    "referencedApiArtifacts is required".to_owned(),
                )
            })?
            .clone();
        let now = now_millis()?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let outcome = self
            .service
            .present_deployment_authority(super::PresentDeploymentAuthorityInput {
                deployment_id: deployment_id.to_owned(),
                participant_artifact,
                referenced_api_artifacts,
                created_at: now,
                expires_at: input.get("expiresAt").and_then(Value::as_i64),
                idempotency: rpc_idempotency(
                    "Auth.DeploymentAuthority.Plan",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
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
                    .ok_or(AuthorizationStateError::StorageConflict)?;
                self.service
                    .repository()
                    .get_authority_proposal(proposal_id)
                    .await?
                    .map(|value| value.0)
                    .ok_or(AuthorizationStateError::StorageConflict)?
            }
        };
        Ok(json!({ "proposal": proposal_value(proposal, None) }))
    }

    async fn process(&self, message: async_nats::Message) -> Result<(), RuntimeError> {
        tracing::debug!(subject = %message.subject, reply = ?message.reply, "processing Auth RPC request");
        let Some(reply) = message.reply.clone() else {
            return Ok(());
        };
        let subject = message.subject.as_str();
        let dispatch_started = Instant::now();
        let result = self.dispatch(subject, &message).await;
        let dispatch_elapsed = dispatch_started.elapsed();
        if dispatch_elapsed >= Duration::from_secs(1) {
            tracing::warn!(
                subject,
                duration_ms = dispatch_elapsed.as_millis(),
                "Auth RPC dispatch exceeded one second"
            );
        }
        tracing::debug!(
            subject,
            success = result.is_ok(),
            "finished Auth RPC dispatch"
        );
        let (headers, payload) = match result {
            Ok(value) => (HeaderMap::new(), serde_json::to_vec(&value)),
            Err(error) => {
                tracing::warn!(subject, %error, "Auth RPC request failed");
                let mut headers = HeaderMap::new();
                headers.insert("status", "error");
                let error = public_rpc_error(subject, &error);
                (headers, serde_json::to_vec(&error))
            }
        };
        let payload = payload.map_err(|error| RuntimeError::Platform(error.to_string()))?;
        let publish_started = Instant::now();
        self.client
            .publish_with_headers(reply, headers, Bytes::from(payload))
            .await
            .map_err(|error| RuntimeError::Platform(error.to_string()))?;
        let publish_elapsed = publish_started.elapsed();
        if publish_elapsed >= Duration::from_secs(1) {
            tracing::warn!(
                subject,
                duration_ms = publish_elapsed.as_millis(),
                "Auth RPC reply publish exceeded one second"
            );
        }
        tracing::debug!(subject, "published Auth RPC response");
        Ok(())
    }

    async fn dispatch(
        &self,
        subject: &str,
        message: &async_nats::Message,
    ) -> Result<Value, AuthorizationStateError> {
        router::dispatch(self, subject, message).await
    }

    async fn deployments_create(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let kind = match required_string(&input, "kind")? {
            "service" => PrincipalKind::Service,
            "device" => PrincipalKind::Device,
            _ => {
                return Err(AuthorizationStateError::InvalidRecord(
                    "deployment kind is invalid".to_owned(),
                ));
            }
        };
        let review_mode = match (kind, nullable_string(&input, "reviewMode")?.as_deref()) {
            (PrincipalKind::Device, Some("none")) => Some(DeviceReviewMode::None),
            (PrincipalKind::Device, Some("required")) => Some(DeviceReviewMode::Required),
            (PrincipalKind::Service, None) => None,
            (PrincipalKind::Device, _) => {
                return Err(AuthorizationStateError::InvalidRecord(
                    "device deployment reviewMode must be none or required".to_owned(),
                ));
            }
            (PrincipalKind::Service, _) => {
                return Err(AuthorizationStateError::InvalidRecord(
                    "service deployment reviewMode must be null".to_owned(),
                ));
            }
            (PrincipalKind::User, _) => unreachable!("deployment kind excludes users"),
        };
        let now = now_millis()?;
        let deployment_id = format!("dep_{}", Ulid::new());
        let profile = DeploymentProfileRecord {
            deployment_id: deployment_id.clone(),
            kind,
            display_name: required_string(&input, "displayName")?.to_owned(),
            participant_id: nullable_string(&input, "participantId")?,
            portal_id: nullable_string(&input, "portalId")?,
            review_mode,
            requires_device_delegation: required_bool(&input, "requiresDeviceDelegation")?,
            expires_at: input.get("expiresAt").and_then(Value::as_i64),
            state: DeploymentProfileState::Active,
            created_at: now,
            updated_at: now,
            version: 1,
        };
        self.service
            .repository()
            .create_deployment_profile(DeploymentProfileCreation {
                principal: super::PrincipalRecord {
                    principal_id: deployment_id.clone(),
                    kind,
                    state: PrincipalState::Active,
                    created_at: now,
                    updated_at: now,
                    version: 1,
                    disabled_at: None,
                    revoked_at: None,
                },
                profile: profile.clone(),
                idempotency: rpc_idempotency(
                    "Auth.Deployments.Create",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        Ok(json!({ "deployment": self.deployment_value(profile).await? }))
    }

    async fn deployments_list(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let kind = input.get("kind").and_then(Value::as_str);
        let state = input.get("state").and_then(Value::as_str);
        let mut entries = Vec::new();
        for profile in self.service.repository().list_deployment_profiles().await? {
            if kind.is_some_and(|value| enum_string(profile.kind) != value)
                || state.is_some_and(|value| deployment_state_wire(profile.state) != value)
            {
                continue;
            }
            entries.push(self.deployment_value(profile).await?);
        }
        Ok(paginate_values(entries, &input))
    }

    async fn deployments_set_state(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
        state: DeploymentProfileState,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = required_string(&input, "deploymentId")?;
        let expected_version = required_u64(&input, "expectedVersion")?;
        let mut profile = self
            .service
            .repository()
            .get_deployment_profile(deployment_id)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("deployment not found".to_owned())
            })?;
        if profile.version != expected_version {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let now = now_millis()?;
        profile.state = state;
        profile.updated_at = now;
        profile.version = profile
            .version
            .checked_add(1)
            .ok_or_else(|| AuthorizationStateError::Storage("version overflow".to_owned()))?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let actions = (state != DeploymentProfileState::Active)
            .then(|| PostCommitActionRecord {
                predecessor_action_id: None,
                action_id: digest_parts(&[deployment_id, idempotency_key, "kick"]),
                kind: PostCommitActionKind::Kick,
                payload: json!({ "deploymentId": deployment_id }),
                created_at: now,
                attempts: 0,
                next_attempt_at: now,
                claimed_until: None,
                last_error: None,
            })
            .into_iter()
            .collect();
        self.service
            .repository()
            .put_deployment_profile(DeploymentProfileMutation {
                profile: profile.clone(),
                expected_version,
                idempotency: rpc_idempotency(
                    "Auth.Deployments.State",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions,
            })
            .await?;
        Ok(json!({
            "deployment": self.deployment_value(profile.clone()).await?,
            "mutation": {
                "resourceId": deployment_id,
                "state": deployment_state_wire(state),
                "version": profile.version,
                "changed": true,
            }
        }))
    }

    async fn deployment_value(
        &self,
        profile: DeploymentProfileRecord,
    ) -> Result<Value, AuthorizationStateError> {
        let principal = self
            .service
            .repository()
            .get_principal(&profile.deployment_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        let mut value = json!({
            "deploymentId": profile.deployment_id,
            "kind": profile.kind,
            "displayName": profile.display_name,
            "state": deployment_state_wire(profile.state),
            "participantId": profile.participant_id,
            "expiresAt": profile.expires_at,
            "reviewMode": profile.review_mode,
            "requiresDeviceDelegation": profile.requires_device_delegation,
            "portalId": profile.portal_id,
            "createdAt": profile.created_at,
            "updatedAt": profile.updated_at,
            "disabledAt": principal.disabled_at,
            "revokedAt": principal.revoked_at,
            "version": profile.version,
            "disabled": profile.state != DeploymentProfileState::Active,
        });
        if profile.kind == PrincipalKind::Service {
            value["namespaces"] = json!([]);
        }
        Ok(value)
    }

    async fn bind_deployment_participant(
        &self,
        deployment_id: &str,
        mut requested_participant_id: Option<String>,
        expected_kind: PrincipalKind,
        input: &Value,
        caller: &ValidatedRequest,
        now: i64,
    ) -> Result<DeploymentProfileRecord, AuthorizationStateError> {
        let mut profile = self
            .service
            .repository()
            .get_deployment_profile(deployment_id)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("deployment not found".to_owned())
            })?;
        if profile.kind != expected_kind || profile.state != DeploymentProfileState::Active {
            return Err(AuthorizationStateError::StorageConflict);
        }
        if requested_participant_id.is_none() && profile.participant_id.is_none() {
            requested_participant_id = self
                .service
                .repository()
                .list_deployment_authorities()
                .await?
                .into_iter()
                .find(|authority| authority.deployment_id == deployment_id)
                .map(|authority| authority.participant_id);
        }
        if profile
            .participant_id
            .as_ref()
            .zip(requested_participant_id.as_ref())
            .is_some_and(|(current, requested)| current != requested)
        {
            return Err(AuthorizationStateError::StorageConflict);
        }
        if profile.participant_id.is_none() {
            profile.participant_id = requested_participant_id.or_else(|| {
                input
                    .get("participantArtifact")
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            });
            if profile.participant_id.is_none() {
                profile.participant_id = self
                    .service
                    .repository()
                    .list_deployment_authorities()
                    .await?
                    .into_iter()
                    .find(|authority| authority.deployment_id == deployment_id)
                    .map(|authority| authority.participant_id);
            }
            if profile.participant_id.is_none() {
                return Err(AuthorizationStateError::InvalidRecord(
                    "participantId is required before provisioning".to_owned(),
                ));
            }
            let expected_version = profile.version;
            profile.version = profile
                .version
                .checked_add(1)
                .ok_or_else(|| AuthorizationStateError::Storage("version overflow".to_owned()))?;
            profile.updated_at = now;
            self.service
                .repository()
                .put_deployment_profile(DeploymentProfileMutation {
                    profile: profile.clone(),
                    expected_version,
                    idempotency: rpc_idempotency(
                        "Auth.Deployments.BindParticipant",
                        &caller.principal_id,
                        input
                            .get("idempotencyKey")
                            .and_then(Value::as_str)
                            .unwrap_or(deployment_id),
                        input,
                        now,
                    )?,
                    actions: Vec::new(),
                })
                .await?;
        }
        Ok(profile)
    }

    async fn service_instances_provision(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = required_string(&input, "deploymentId")?;
        let now = now_millis()?;
        let profile = self
            .bind_deployment_participant(
                deployment_id,
                nullable_string(&input, "participantId")?,
                PrincipalKind::Service,
                &input,
                caller,
                now,
            )
            .await?;
        let outcome = self
            .service
            .provision_service_identity(ProvisionServiceIdentityInput {
                deployment_id: deployment_id.to_owned(),
                instance_id: nullable_string(&input, "instanceId")?,
                identity_public_key: required_string(&input, "identityPublicKey")?.to_owned(),
                created_at: now,
                idempotency: rpc_idempotency(
                    "Auth.ServiceInstances.Provision",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        let identity = match outcome {
            IdempotentOutcome::Applied(identity) => identity,
            IdempotentOutcome::Replayed(value) => {
                let identity_key_id = value
                    .get("identityKeyId")
                    .and_then(Value::as_str)
                    .ok_or(AuthorizationStateError::StorageConflict)?;
                self.service
                    .repository()
                    .get_provisioned_identity(identity_key_id)
                    .await?
                    .ok_or(AuthorizationStateError::StorageConflict)?
            }
        };
        let instance = self
            .service
            .repository()
            .get_runtime_instance(&identity.instance_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        Ok(json!({
            "instance": service_instance_value(instance, identity, &profile),
        }))
    }

    async fn service_instances_list(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let identities = self
            .service
            .repository()
            .list_provisioned_identities()
            .await?;
        let mut entries = Vec::new();
        for identity in identities
            .into_iter()
            .filter(|identity| identity.kind == ProvisionedIdentityKind::Service)
        {
            if input
                .get("deploymentId")
                .and_then(Value::as_str)
                .is_some_and(|value| identity.deployment_id != value)
            {
                continue;
            }
            let Some(instance) = self
                .service
                .repository()
                .get_runtime_instance(&identity.instance_id)
                .await?
            else {
                continue;
            };
            if input
                .get("state")
                .and_then(Value::as_str)
                .is_some_and(|value| enum_string(instance.state) != value)
            {
                continue;
            }
            let profile = self
                .service
                .repository()
                .get_deployment_profile(&identity.deployment_id)
                .await?
                .ok_or(AuthorizationStateError::StorageConflict)?;
            entries.push(service_instance_value(instance, identity, &profile));
        }
        Ok(paginate_values(entries, &input))
    }

    async fn devices_provision(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = required_string(&input, "deploymentId")?;
        let now = now_millis()?;
        let profile = self
            .bind_deployment_participant(
                deployment_id,
                nullable_string(&input, "participantId")?,
                PrincipalKind::Device,
                &input,
                caller,
                now,
            )
            .await?;
        let outcome = self
            .service
            .provision_device(ProvisionDeviceInput {
                deployment_id: deployment_id.to_owned(),
                instance_id: nullable_string(&input, "instanceId")?,
                identity_public_key: nullable_string(&input, "identityPublicKey")?,
                created_at: now,
                idempotency: rpc_idempotency(
                    "Auth.Devices.Provision",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        let (principal_id, instance_id, provisioning_secret) = match outcome {
            IdempotentOutcome::Applied(device) => (
                device.principal_id,
                device.instance_id,
                device.provisioning_secret,
            ),
            IdempotentOutcome::Replayed(value) => (
                required_string(&value, "principalId")?.to_owned(),
                required_string(&value, "instanceId")?.to_owned(),
                None,
            ),
        };
        Ok(json!({
            "device": self.device_value(&principal_id, &instance_id, &profile).await?,
            "provisioningSecret": provisioning_secret,
        }))
    }

    async fn devices_connect_info(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = required_string(&input, "deploymentId")?;
        let instance_id = required_string(&input, "instanceId")?;
        let identity_key_id = required_string(&input, "deviceIdentityKeyId")?;
        let identity = self
            .service
            .repository()
            .get_provisioned_identity(identity_key_id)
            .await?
            .filter(|identity| {
                identity.kind == ProvisionedIdentityKind::Device
                    && identity.state == ProvisionedIdentityState::Active
                    && identity.deployment_id == deployment_id
                    && identity.instance_id == instance_id
            })
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("device identity is not active".to_owned())
            })?;
        self.service
            .repository()
            .get_device(&identity.principal_id, deployment_id)
            .await?
            .filter(|device| device.state == crate::platform::auth::DeviceState::Active)
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("device is not active".to_owned())
            })?;
        let participant_id = required_string(&input, "participantId")?;
        let participant_digest = required_string(&input, "participantDigest")?;
        let mut proof_request = input.clone();
        proof_request
            .as_object_mut()
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("request must be an object".to_owned())
            })?
            .insert("proof".to_owned(), Value::Null);
        let request_digest = session_proof_request_digest(&proof_request)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let proof_input = SessionProofInput::device_bootstrap(DeviceBootstrapSessionProofInput {
            request_id: required_string(&input, "requestId")?.to_owned(),
            issued_at: required_i64(&input, "issuedAt")?,
            deployment_id: deployment_id.to_owned(),
            instance_id: instance_id.to_owned(),
            device_identity_key_id: identity_key_id.to_owned(),
            new_session_public_key: required_string(&input, "newSessionPublicKey")?.to_owned(),
            new_session_nkey: required_string(&input, "newSessionNkey")?.to_owned(),
            participant_id: participant_id.to_owned(),
            participant_digest: participant_digest.to_owned(),
            challenge_digest: Some(required_string(&input, "challengeDigest")?.to_owned()),
            request_digest,
        })
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let now = now_millis()?;
        verify_session_proof(
            &proof_input,
            &parse_session_proof(input.get("proof").ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("proof is required".to_owned())
            })?)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
            &identity.identity_public_key,
            now,
            SessionProofPolicy::default(),
        )
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let delegation_required = self
            .service
            .repository()
            .get_deployment_profile(deployment_id)
            .await?
            .is_some_and(|profile| profile.requires_device_delegation);
        if delegation_required {
            self.service
                .repository()
                .get_device_delegation(&identity.principal_id, deployment_id)
                .await?
                .filter(|delegation| {
                    delegation.state == DeviceDelegationState::Active
                        && delegation
                            .expires_at
                            .is_none_or(|expires_at| expires_at > now)
                })
                .ok_or_else(|| {
                    AuthorizationStateError::InvalidRecord(
                        "device delegation is not active".to_owned(),
                    )
                })?;
        }
        Ok(json!({
            "deploymentId": deployment_id,
            "instanceId": instance_id,
            "participantId": participant_id,
            "endpoints": {
                "native": self.native_nats_servers,
                "websocket": self.websocket_nats_servers,
                "authMode": "session_nkey",
                "authorityMode": "server_issued",
                "maximumClockSkewMs": 5_000,
            },
        }))
    }

    async fn devices_list(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let instances = self.service.repository().list_runtime_instances().await?;
        let mut entries = Vec::new();
        for device in self.service.repository().list_devices().await? {
            if input
                .get("deploymentId")
                .and_then(Value::as_str)
                .is_some_and(|value| device.deployment_id != value)
            {
                continue;
            }
            let Some(instance) = instances
                .iter()
                .find(|instance| instance.principal_id == device.principal_id)
            else {
                continue;
            };
            let profile = self
                .service
                .repository()
                .get_deployment_profile(&device.deployment_id)
                .await?
                .ok_or(AuthorizationStateError::StorageConflict)?;
            let value = self
                .device_value(&device.principal_id, &instance.instance_id, &profile)
                .await?;
            if input
                .get("state")
                .and_then(Value::as_str)
                .is_some_and(|state| value.get("state").and_then(Value::as_str) != Some(state))
            {
                continue;
            }
            entries.push(value);
        }
        Ok(paginate_values(entries, &input))
    }

    async fn provisioned_instance_set_state(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
        kind: ProvisionedIdentityKind,
        target: RuntimeInstanceState,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let instance_id = required_string(&input, "instanceId")?;
        let expected_version = required_u64(&input, "expectedVersion")?;
        let mut instance = self
            .service
            .repository()
            .get_runtime_instance(instance_id)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("instance not found".to_owned())
            })?;
        let mut identity = self
            .service
            .repository()
            .list_provisioned_identities()
            .await?
            .into_iter()
            .find(|identity| identity.instance_id == instance_id && identity.kind == kind);
        if kind == ProvisionedIdentityKind::Service && identity.is_none() {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let now = now_millis()?;
        let device = if kind == ProvisionedIdentityKind::Device {
            let mut device = self
                .service
                .repository()
                .get_device(&instance.principal_id, &instance.deployment_id)
                .await?
                .ok_or(AuthorizationStateError::StorageConflict)?;
            if device.version != expected_version
                || (device.state == crate::platform::auth::DeviceState::Pending
                    && target == RuntimeInstanceState::Active)
            {
                return Err(AuthorizationStateError::StorageConflict);
            }
            device.state = match target {
                RuntimeInstanceState::Active => crate::platform::auth::DeviceState::Active,
                RuntimeInstanceState::Disabled | RuntimeInstanceState::Stale => {
                    crate::platform::auth::DeviceState::Disabled
                }
                RuntimeInstanceState::Revoked => crate::platform::auth::DeviceState::Revoked,
            };
            device.updated_at = now;
            device.version += 1;
            Some(device)
        } else {
            if instance.version != expected_version {
                return Err(AuthorizationStateError::StorageConflict);
            }
            None
        };
        instance.state = target;
        instance.updated_at = now;
        instance.version += 1;
        if let Some(identity) = identity.as_mut() {
            identity.state = match target {
                RuntimeInstanceState::Active => ProvisionedIdentityState::Active,
                RuntimeInstanceState::Disabled | RuntimeInstanceState::Stale => {
                    ProvisionedIdentityState::Active
                }
                RuntimeInstanceState::Revoked => ProvisionedIdentityState::Revoked,
            };
            identity.revoked_at = (target == RuntimeInstanceState::Revoked).then_some(now);
        }
        let action_kind = match kind {
            ProvisionedIdentityKind::Service => "ServiceInstances",
            ProvisionedIdentityKind::Device => "Devices",
        };
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        self.service
            .repository()
            .mutate_provisioned_instance(ProvisionedInstanceMutation {
                instance: instance.clone(),
                device: device.clone(),
                identity,
                expected_version,
                idempotency: rpc_idempotency(
                    &format!("Auth.{action_kind}.State"),
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions: (target != RuntimeInstanceState::Active)
                    .then(|| PostCommitActionRecord {
                        predecessor_action_id: None,
                        action_id: digest_parts(&[instance_id, idempotency_key, "kick"]),
                        kind: PostCommitActionKind::Kick,
                        payload: json!({ "principalId": instance.principal_id }),
                        created_at: now,
                        attempts: 0,
                        next_attempt_at: now,
                        claimed_until: None,
                        last_error: None,
                    })
                    .into_iter()
                    .collect(),
            })
            .await?;
        let profile = self
            .service
            .repository()
            .get_deployment_profile(&instance.deployment_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        let mutation = json!({
            "resourceId": instance_id,
            "state": target,
            "version": device.as_ref().map_or(instance.version, |device| device.version),
            "changed": true,
        });
        match kind {
            ProvisionedIdentityKind::Service => {
                let identity = self
                    .service
                    .repository()
                    .list_provisioned_identities()
                    .await?
                    .into_iter()
                    .find(|identity| identity.instance_id == instance_id)
                    .ok_or(AuthorizationStateError::StorageConflict)?;
                Ok(json!({
                    "instance": service_instance_value(instance, identity, &profile),
                    "mutation": mutation,
                }))
            }
            ProvisionedIdentityKind::Device => Ok(json!({
                "device": self.device_value(
                    &instance.principal_id,
                    instance_id,
                    &profile,
                ).await?,
                "mutation": mutation,
            })),
        }
    }

    async fn device_value(
        &self,
        principal_id: &str,
        instance_id: &str,
        profile: &DeploymentProfileRecord,
    ) -> Result<Value, AuthorizationStateError> {
        let device = self
            .service
            .repository()
            .get_device(principal_id, &profile.deployment_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        let identity = self
            .service
            .repository()
            .list_provisioned_identities()
            .await?
            .into_iter()
            .find(|identity| {
                identity.principal_id == principal_id && identity.instance_id == instance_id
            });
        let delegation = self
            .service
            .repository()
            .get_device_delegation(principal_id, &profile.deployment_id)
            .await?;
        let state = match device.state {
            crate::platform::auth::DeviceState::Pending => "pending",
            crate::platform::auth::DeviceState::Active => "active",
            crate::platform::auth::DeviceState::Disabled => "disabled",
            crate::platform::auth::DeviceState::Revoked => "revoked",
        };
        Ok(json!({
            "instanceId": instance_id,
            "deploymentId": profile.deployment_id,
            "principalId": principal_id,
            "identityPublicKey": identity.as_ref().map(|value| value.identity_public_key.clone()),
            "identityKeyId": identity.as_ref().map(|value| value.identity_key_id.clone()),
            "participantId": profile.participant_id,
            "state": state,
            "administrativeApproval": match device.state {
                super::DeviceState::Pending => "pending",
                super::DeviceState::Active => "approved",
                super::DeviceState::Disabled => "approved",
                super::DeviceState::Revoked => "revoked",
            },
            "delegationRequired": profile.requires_device_delegation,
            "delegationState": delegation.as_ref().map_or(
                if profile.requires_device_delegation { "missing" } else { "active" },
                |value| match value.state {
                    super::DeviceDelegationState::Active => "active",
                    super::DeviceDelegationState::Missing => "missing",
                    super::DeviceDelegationState::Revoked => "revoked",
                },
            ),
            "delegationExpiresAt": delegation.and_then(|value| value.expires_at),
            "createdAt": device.created_at,
            "updatedAt": device.updated_at,
            "version": device.version,
        }))
    }

    async fn device_user_authorities_list(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = input.get("deploymentId").and_then(Value::as_str);
        let principal_id = input.get("principalId").and_then(Value::as_str);
        let identities = self
            .service
            .repository()
            .list_provisioned_identities()
            .await?;
        let mut entries = Vec::new();
        for device in self.service.repository().list_devices().await? {
            if deployment_id.is_some_and(|value| device.deployment_id != value)
                || principal_id.is_some_and(|value| device.principal_id != value)
            {
                continue;
            }
            let profile = self
                .service
                .repository()
                .get_deployment_profile(&device.deployment_id)
                .await?
                .ok_or(AuthorizationStateError::StorageConflict)?;
            let identity = identities.iter().find(|identity| {
                identity.kind == ProvisionedIdentityKind::Device
                    && identity.principal_id == device.principal_id
                    && identity.deployment_id == device.deployment_id
            });
            let instance_id = identity
                .map(|identity| identity.instance_id.as_str())
                .ok_or(AuthorizationStateError::StorageConflict)?;
            entries.push(json!({
                "device": self.device_value(&device.principal_id, instance_id, &profile).await?,
                "authority": null,
            }));
        }
        Ok(paginate_values(entries, &input))
    }

    async fn device_user_authorities_revoke(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = required_string(&input, "deploymentId")?;
        let principal_id = required_string(&input, "devicePrincipalId")?;
        let mut device = self
            .service
            .repository()
            .get_device(principal_id, deployment_id)
            .await?
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("device not found".to_owned()))?;
        let mut delegation = self
            .service
            .repository()
            .get_device_delegation(principal_id, deployment_id)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("device delegation not found".to_owned())
            })?;
        let expected_version = device.version;
        let now = now_millis()?;
        device.updated_at = now;
        device.version += 1;
        delegation.state = DeviceDelegationState::Revoked;
        let identity = self
            .service
            .repository()
            .list_provisioned_identities()
            .await?
            .into_iter()
            .find(|identity| {
                identity.kind == ProvisionedIdentityKind::Device
                    && identity.principal_id == principal_id
                    && identity.deployment_id == deployment_id
            })
            .ok_or(AuthorizationStateError::StorageConflict)?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let action = |kind, suffix: &str, payload| PostCommitActionRecord {
            predecessor_action_id: None,
            action_id: digest_parts(&[
                "Auth.DeviceUserAuthorities.Revoke",
                idempotency_key,
                suffix,
            ]),
            kind,
            payload,
            created_at: now,
            attempts: 0,
            next_attempt_at: now,
            claimed_until: None,
            last_error: None,
        };
        self.service
            .repository()
            .mutate_device_delegation(DeviceDelegationMutation {
                device: device.clone(),
                delegation: delegation.clone(),
                expected_version,
                idempotency: rpc_idempotency(
                    "Auth.DeviceUserAuthorities.Revoke",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions: vec![
                    action(
                        PostCommitActionKind::Event,
                        "event",
                        json!({
                            "eventType": "Auth.DeviceUserAuthorities.Resolved",
                            "eventSubject": format!(
                                "events.v1.Auth.DeviceUserAuthorities.Resolved.{deployment_id}"
                            ),
                            "eventId": format!(
                                "evt_{}",
                                digest_parts(&[principal_id, deployment_id, idempotency_key])
                            ),
                            "occurredAt": now,
                            "deploymentId": deployment_id,
                            "instanceId": identity.instance_id.clone(),
                            "state": "revoked",
                        }),
                    ),
                    action(
                        PostCommitActionKind::Kick,
                        "kick",
                        json!({ "principalId": principal_id }),
                    ),
                ],
            })
            .await?;
        let profile = self
            .service
            .repository()
            .get_deployment_profile(deployment_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        let kicked_session_count = self
            .service
            .repository()
            .list_sessions()
            .await?
            .into_iter()
            .filter(|session| {
                session.principal_id == principal_id
                    && session.state == crate::platform::auth::SessionState::Active
            })
            .count();
        Ok(json!({
            "device": self.device_value(&device.principal_id, &identity.instance_id, &profile).await?,
            "kickedSessionCount": kicked_session_count,
        }))
    }

    async fn activation_reviews_list(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        self.service
            .expire_due_activation_reviews(now_millis()?)
            .await?;
        let entries = self
            .service
            .repository()
            .list_activation_reviews()
            .await?
            .into_iter()
            .filter(|review| {
                input
                    .get("deploymentId")
                    .and_then(Value::as_str)
                    .is_none_or(|value| review.deployment_id == value)
                    && input
                        .get("state")
                        .and_then(Value::as_str)
                        .is_none_or(|value| enum_string(review.state) == value)
            })
            .map(activation_review_value)
            .collect();
        Ok(paginate_values(entries, &input))
    }

    async fn activation_reviews_decide(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        if !caller
            .capabilities
            .iter()
            .any(|value| value == "trellis.auth::devices.review")
        {
            return Err(AuthorizationStateError::InvalidRecord(
                "caller lacks administrative review authority".to_owned(),
            ));
        }
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let now = now_millis()?;
        self.service.expire_due_activation_reviews(now).await?;
        let review_id = required_string(&input, "reviewId")?;
        let review = self
            .service
            .repository()
            .get_activation_review(review_id)
            .await?
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("review not found".to_owned()))?;
        let state = match required_string(&input, "decision")? {
            "approve" => DeviceActivationReviewState::Approved,
            "reject" => DeviceActivationReviewState::Rejected,
            _ => {
                return Err(AuthorizationStateError::InvalidRecord(
                    "activation decision is invalid".to_owned(),
                ));
            }
        };
        let profile = self
            .service
            .repository()
            .get_deployment_profile(&review.deployment_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        if profile.review_mode != Some(DeviceReviewMode::Required) {
            return Err(AuthorizationStateError::InvalidRecord(
                "deployment does not require administrative device review".to_owned(),
            ));
        }
        let event_suffix = if state == DeviceActivationReviewState::Approved {
            "approved"
        } else {
            "resolved"
        };
        let event_payload = if state == DeviceActivationReviewState::Approved {
            json!({
                "eventType": "Auth.DeviceUserAuthorities.Approved",
                "eventSubject": format!(
                    "events.v1.Auth.DeviceUserAuthorities.Approved.{}",
                    review.deployment_id,
                ),
                "eventId": format!("evt_{}", digest_parts(&[review_id, event_suffix])),
                "occurredAt": now,
                "deploymentId": review.deployment_id,
                "instanceId": review.instance_id,
                "approvedBy": caller.principal_id,
                "approvedAt": now,
            })
        } else {
            json!({
                "eventType": "Auth.DeviceUserAuthorities.Resolved",
                "eventSubject": format!(
                    "events.v1.Auth.DeviceUserAuthorities.Resolved.{}",
                    review.deployment_id,
                ),
                "eventId": format!("evt_{}", digest_parts(&[review_id, event_suffix])),
                "occurredAt": now,
                "deploymentId": review.deployment_id,
                "instanceId": review.instance_id,
                "state": "rejected",
            })
        };
        let mut actions = vec![PostCommitActionRecord {
            predecessor_action_id: Some(activation_review_event_action_id(
                review_id,
                if review.activated_by_user_principal_id.is_some() {
                    "requested"
                } else {
                    "review-requested"
                },
            )?),
            action_id: activation_review_event_action_id(review_id, event_suffix)?,
            kind: PostCommitActionKind::Event,
            payload: event_payload,
            created_at: now,
            attempts: 0,
            next_attempt_at: now,
            claimed_until: None,
            last_error: None,
        }];
        let activation_ready = state == DeviceActivationReviewState::Approved
            && (!profile.requires_device_delegation
                || review.activated_by_user_principal_id.is_some());
        if activation_ready {
            actions.push(PostCommitActionRecord {
                predecessor_action_id: Some(activation_review_event_action_id(
                    review_id,
                    event_suffix,
                )?),
                action_id: activation_review_event_action_id(review_id, "resolved")?,
                kind: PostCommitActionKind::Event,
                payload: json!({
                    "eventType": "Auth.DeviceUserAuthorities.Resolved",
                    "eventSubject": format!(
                        "events.v1.Auth.DeviceUserAuthorities.Resolved.{}",
                        review.deployment_id,
                    ),
                    "eventId": format!("evt_{}", digest_parts(&[review_id, "resolved"])),
                    "occurredAt": now,
                    "deploymentId": review.deployment_id,
                    "instanceId": review.instance_id,
                    "state": "active",
                }),
                created_at: now,
                attempts: 0,
                next_attempt_at: now,
                claimed_until: None,
                last_error: None,
            });
        }
        let outcome = self
            .service
            .decide_activation_review(DecideActivationReviewInput {
                review_id: review_id.to_owned(),
                expected_version: required_u64(&input, "expectedVersion")?,
                state,
                decided_by: caller.principal_id.clone(),
                reason: nullable_string(&input, "reason")?,
                delegation: (state == DeviceActivationReviewState::Approved
                    && profile.requires_device_delegation
                    && review.activated_by_user_principal_id.is_some())
                .then(|| DeviceDelegationRecord {
                    principal_id: review.principal_id.clone(),
                    deployment_id: review.deployment_id.clone(),
                    required: true,
                    state: DeviceDelegationState::Active,
                    expires_at: None,
                }),
                activate_device: activation_ready,
                decided_at: now,
                idempotency: rpc_idempotency(
                    "Auth.DeviceUserAuthorities.Reviews.Decide",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions,
            })
            .await?;
        let review = match outcome {
            IdempotentOutcome::Applied(review) => review,
            IdempotentOutcome::Replayed(value) => {
                let review_id = required_string(&value, "reviewId")?;
                self.service
                    .repository()
                    .get_activation_review(review_id)
                    .await?
                    .ok_or(AuthorizationStateError::StorageConflict)?
            }
        };
        Ok(json!({ "review": activation_review_value(review) }))
    }

    async fn identity_authority_list(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let mut entries = self
            .service
            .repository()
            .list_identity_authorities()
            .await?;
        entries.retain(|authority| {
            input
                .get("principalId")
                .and_then(Value::as_str)
                .is_none_or(|value| authority.principal_id == value)
                && input
                    .get("participantId")
                    .and_then(Value::as_str)
                    .is_none_or(|value| authority.participant_id == value)
                && input
                    .get("state")
                    .and_then(Value::as_str)
                    .is_none_or(|value| enum_string(authority.state) == value)
        });
        Ok(paginate_values(
            entries.into_iter().map(identity_authority_value).collect(),
            &input,
        ))
    }

    async fn capability_groups_list(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let entries = self
            .service
            .repository()
            .list_capability_groups()
            .await?
            .into_iter()
            .map(|group| serde_json::to_value(group).expect("group serializes"))
            .collect();
        Ok(offset_page(entries, &input))
    }

    async fn capability_groups_get(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let group = self
            .service
            .repository()
            .get_capability_group(required_string(&input, "groupKey")?)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("capability group not found".to_owned())
            })?;
        Ok(json!({ "group": group }))
    }

    async fn capability_groups_put(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let key = required_string(&input, "groupKey")?;
        let now = now_millis()?;
        let current = self.service.repository().get_capability_group(key).await?;
        let expected_version = input.get("expectedVersion").and_then(Value::as_u64);
        let mut capabilities = optional_string_array(&input, "capabilities")?.unwrap_or_default();
        capabilities.sort();
        capabilities.dedup();
        let mut included_groups =
            optional_string_array(&input, "includedGroups")?.unwrap_or_default();
        included_groups.sort();
        included_groups.dedup();
        for included_group in &included_groups {
            if included_group == key
                || self
                    .service
                    .repository()
                    .get_capability_group(included_group)
                    .await?
                    .is_none()
            {
                return Err(AuthorizationStateError::InvalidRecord(format!(
                    "unknown included capability group '{included_group}'"
                )));
            }
        }
        let semantic_changed = current.as_ref().is_none_or(|group| {
            group.capabilities != capabilities || group.included_groups != included_groups
        });
        let group = CapabilityGroupRecord {
            group_key: key.to_owned(),
            display_name: required_string(&input, "displayName")?.to_owned(),
            description: required_string(&input, "description")?.to_owned(),
            capabilities,
            included_groups,
            created_at: current.as_ref().map_or(now, |group| group.created_at),
            updated_at: now,
            version: expected_version.map_or(1, |version| version + 1),
        };
        let outcome = self
            .service
            .repository()
            .put_capability_group(
                group,
                expected_version,
                rpc_idempotency(
                    "Auth.CapabilityGroups.Put",
                    &caller.session_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
            )
            .await?;
        if semantic_changed {
            self.portal_reconciliation.notify_all();
        }
        let group = match outcome {
            IdempotentOutcome::Applied(group) => serde_json::to_value(group),
            IdempotentOutcome::Replayed(group) => Ok(group),
        }
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        Ok(json!({ "group": group }))
    }

    async fn capability_groups_delete(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let key = required_string(&input, "groupKey")?;
        let now = now_millis()?;
        let outcome = self
            .service
            .repository()
            .delete_capability_group(
                key,
                required_u64(&input, "expectedVersion")?,
                rpc_idempotency(
                    "Auth.CapabilityGroups.Delete",
                    &caller.session_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
            )
            .await?;
        self.portal_reconciliation.notify_all();
        let success = match outcome {
            IdempotentOutcome::Applied(success) => success,
            IdempotentOutcome::Replayed(success) => success.as_bool().ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("invalid delete replay".to_owned())
            })?,
        };
        Ok(json!({ "success": success }))
    }

    async fn identity_grants_list(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let principal_id = input
            .get("user")
            .and_then(Value::as_str)
            .unwrap_or(&caller.principal_id);
        if principal_id != caller.principal_id
            && !caller
                .capabilities
                .iter()
                .any(|value| value == "trellis.auth::admin")
        {
            return Err(AuthorizationStateError::InvalidRecord(
                "identity grants belong to another user".to_owned(),
            ));
        }
        let mut entries = Vec::new();
        for authority in self
            .service
            .repository()
            .list_identity_authorities()
            .await?
        {
            if authority.principal_id != principal_id || authority.state != AuthorityState::Accepted
            {
                continue;
            }
            let binding = self
                .service
                .repository()
                .get_participant_binding(
                    &authority.participant_id,
                    &authority.participant_artifact_digest,
                )
                .await?
                .ok_or(AuthorizationStateError::ParticipantMissing)?;
            entries.push(identity_grant_value(authority, &binding.participant_json)?);
        }
        Ok(offset_page(entries, &input))
    }

    async fn identity_grants_revoke(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let authority_id = required_string(&input, "identityGrantId")?;
        let authority = self
            .service
            .repository()
            .list_identity_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == authority_id);
        let Some(authority) = authority else {
            return Ok(json!({ "success": false }));
        };
        let target = input
            .get("user")
            .and_then(Value::as_str)
            .unwrap_or(&caller.principal_id);
        if authority.principal_id != target
            || (target != caller.principal_id
                && !caller
                    .capabilities
                    .iter()
                    .any(|value| value == "trellis.auth::admin"))
        {
            return Err(AuthorizationStateError::InvalidRecord(
                "identity grant belongs to another user".to_owned(),
            ));
        }
        let mut revoke = json!({
            "authorityId": authority.authority_id,
            "expectedVersion": authority.version,
            "idempotencyKey": format!("identity-grant-revoke:{}:{}", caller.session_id, authority_id),
        });
        if let Some(reason) = input.get("reason") {
            revoke["reason"] = reason.clone();
        }
        self.identity_authority_revoke(
            &serde_json::to_vec(&revoke)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
            caller,
        )
        .await?;
        Ok(json!({ "success": true }))
    }

    async fn portal_grant_overrides_list(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let entries = self
            .service
            .repository()
            .list_portal_grant_overrides(
                input.get("portalId").and_then(Value::as_str),
                input.get("participantId").and_then(Value::as_str),
            )
            .await?
            .into_iter()
            .map(|entry| serde_json::to_value(entry).expect("policy serializes"))
            .collect();
        Ok(offset_page(entries, &input))
    }

    async fn portal_grant_overrides_put(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        require_admin(caller)?;
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let portal_id = required_string(&input, "portalId")?;
        let participant_id = required_string(&input, "participantId")?;
        let expected_version = input.get("expectedVersion").and_then(Value::as_u64);
        let current = self
            .service
            .repository()
            .get_portal_grant_override(portal_id, participant_id)
            .await?;
        let mut direct_capabilities =
            optional_string_array(&input, "directCapabilities")?.unwrap_or_default();
        direct_capabilities.sort();
        direct_capabilities.dedup();
        let mut capability_group_keys =
            optional_string_array(&input, "capabilityGroupKeys")?.unwrap_or_default();
        capability_group_keys.sort();
        capability_group_keys.dedup();
        let mut role_mappings = input
            .get("roleMappings")
            .cloned()
            .map(serde_json::from_value::<Vec<PortalRoleMapping>>)
            .transpose()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
            .unwrap_or_default();
        for mapping in &mut role_mappings {
            mapping.direct_capabilities.sort();
            mapping.direct_capabilities.dedup();
            mapping.capability_group_keys.sort();
            mapping.capability_group_keys.dedup();
        }
        sort_and_validate_role_mappings(&mut role_mappings)?;
        let now = now_millis()?;
        let policy = PortalGrantOverrideRecord {
            portal_id: portal_id.to_owned(),
            participant_id: participant_id.to_owned(),
            direct_capabilities,
            capability_group_keys,
            role_mappings,
            created_at: current.as_ref().map_or(now, |policy| policy.created_at),
            updated_at: now,
            version: expected_version.map_or(1, |version| version + 1),
        };
        let outcome = self
            .service
            .repository()
            .put_portal_grant_override(
                policy,
                expected_version,
                rpc_idempotency(
                    "Auth.Portals.GrantOverrides.Put",
                    &caller.session_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
            )
            .await?;
        self.portal_reconciliation.notify_portal(portal_id).await;
        let policy = match outcome {
            IdempotentOutcome::Applied(policy) => serde_json::to_value(policy),
            IdempotentOutcome::Replayed(policy) => Ok(policy),
        }
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        Ok(json!({ "policy": policy }))
    }

    async fn portal_grant_overrides_remove(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        require_admin(caller)?;
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let now = now_millis()?;
        let outcome = self
            .service
            .repository()
            .remove_portal_grant_override(
                required_string(&input, "portalId")?,
                required_string(&input, "participantId")?,
                required_u64(&input, "expectedVersion")?,
                rpc_idempotency(
                    "Auth.Portals.GrantOverrides.Remove",
                    &caller.session_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
            )
            .await?;
        self.portal_reconciliation
            .notify_portal(required_string(&input, "portalId")?)
            .await;
        let removed: Option<super::PortalGrantOverrideRecord> = match outcome {
            IdempotentOutcome::Applied(policy) => policy,
            IdempotentOutcome::Replayed(policy) => serde_json::from_value(policy)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        };
        Ok(removed.map_or_else(|| json!({}), |removed| json!({ "removed": removed })))
    }

    async fn identity_authority_get(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let authority_id = input
            .get("authorityId")
            .or_else(|| input.get("deploymentId"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("deploymentId is required".to_owned())
            })?;
        self.service
            .repository()
            .list_identity_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == authority_id)
            .map(|authority| json!({ "authority": identity_authority_value(authority) }))
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("authority not found".to_owned()))
    }

    async fn identity_authority_revoke(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let authority_id = input
            .get("authorityId")
            .or_else(|| input.get("deploymentId"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("deploymentId is required".to_owned())
            })?;
        let authority = self
            .service
            .repository()
            .list_identity_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == authority_id)
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("authority not found".to_owned())
            })?;
        if authority.principal_id != caller.principal_id {
            require_admin(caller)?;
        }
        if input
            .get("expectedVersion")
            .and_then(Value::as_u64)
            .is_some_and(|expected| expected != authority.version)
        {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let now = now_millis()?;
        let proposal_outcome = self
            .service
            .create_authority_proposal(CreateAuthorityProposalInput {
                authority_kind: crate::platform::auth::AuthorityKind::Identity,
                authority_id: authority.authority_id.clone(),
                deployment_id: None,
                proposal_kind: AuthorityProposalKind::Update,
                participant_id: authority.participant_id.clone(),
                participant_artifact_digest: authority.participant_artifact_digest.clone(),
                participant_needs_digest: authority.accepted_needs_digest.clone(),
                grant_set: authority.desired_grant_set.clone(),
                capabilities: authority.desired_capabilities.clone(),
                base_authority_version: Some(authority.version),
                payload: json!({
                    "principalId": authority.principal_id,
                    "baseAuthorityVersion": authority.version,
                    "reason": input.get("reason"),
                }),
                created_at: now,
                expires_at: None,
                idempotency: rpc_idempotency(
                    "Auth.IdentityAuthority.Revoke.Proposal",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        let proposal = match proposal_outcome {
            IdempotentOutcome::Applied(proposal) => proposal,
            IdempotentOutcome::Replayed(value) => self
                .service
                .repository()
                .get_authority_proposal(required_string(&value, "proposalId")?)
                .await?
                .map(|value| value.0)
                .ok_or(AuthorizationStateError::StorageConflict)?,
        };
        let reason = input
            .get("reason")
            .map(|_| nullable_string(&input, "reason"))
            .transpose()?
            .flatten();
        let revoked = IdentityAuthorityRecord {
            state: AuthorityState::Revoked,
            version: authority.version + 1,
            updated_at: now,
            decision: Some(AuthorityDecision {
                decided_at: now,
                decided_by: caller.principal_id.clone(),
                reason: reason.clone(),
            }),
            ..authority
        };
        self.service
            .decide_authority_proposal(DecideAuthorityProposalInput {
                proposal_id: proposal.proposal_id,
                expected_version: proposal.version,
                expected_base_authority_version: None,
                outcome: AuthorityDecisionOutcome::Accepted,
                decided_by: caller.principal_id.clone(),
                reason,
                desired_authority: Some(DesiredAuthorityRecord::Identity(revoked)),
                decided_at: now,
                idempotency: rpc_idempotency(
                    "Auth.IdentityAuthority.Revoke.Decision",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                portal_binding: Some(None),
                expected_portal_binding: None,
                portal_policy_snapshot: None,
                actions: Vec::new(),
            })
            .await?;
        let authority = self
            .service
            .repository()
            .list_identity_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == authority_id)
            .ok_or(AuthorizationStateError::StorageConflict)?;
        Ok(json!({ "authority": identity_authority_value(authority) }))
    }

    async fn deployment_authority_list(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let mut entries = self
            .service
            .repository()
            .list_deployment_authorities()
            .await?;
        entries.retain(|authority| {
            input
                .get("deploymentId")
                .and_then(Value::as_str)
                .is_none_or(|value| authority.deployment_id == value)
                && input
                    .get("participantId")
                    .and_then(Value::as_str)
                    .is_none_or(|value| authority.participant_id == value)
                && input
                    .get("state")
                    .and_then(Value::as_str)
                    .is_none_or(|value| enum_string(authority.state) == value)
        });
        Ok(paginate_values(
            entries.into_iter().map(authority_value).collect(),
            &input,
        ))
    }

    async fn deployment_authority_get(
        &self,
        payload: &[u8],
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let authority_id = required_string(&input, "authorityId")?;
        let authority = self
            .service
            .repository()
            .list_deployment_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == authority_id)
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("authority not found".to_owned())
            })?;
        let mut value = authority_value(authority);
        value["materialization"] = serde_json::to_value(
            self.service
                .repository()
                .get_materialized_authority(AuthorityKind::Deployment, authority_id)
                .await?
                .map(|replacement| replacement.authority),
        )
        .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?;
        Ok(json!({ "authority": value }))
    }

    async fn deployment_authority_reconcile(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let authority_id = required_string(&input, "authorityId")?;
        let authority = self
            .service
            .repository()
            .list_deployment_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == authority_id)
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("authority not found".to_owned())
            })?;
        if input
            .get("expectedVersion")
            .and_then(Value::as_u64)
            .is_some_and(|expected| expected != authority.version)
        {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let now = now_millis()?;
        let target = AuthorityTarget::new(
            crate::platform::auth::AuthorityKind::Deployment,
            authority.authority_id.clone(),
        )?;
        let binding = self
            .service
            .repository()
            .get_participant_binding(
                &authority.participant_id,
                &authority.participant_artifact_digest,
            )
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("participant binding not found".to_owned())
            })?;
        let scope = super::AuthorityEvidenceScope {
            target: target.clone(),
            participant_id: binding.participant_id.clone(),
            participant_artifact_digest: binding.artifact_digest.clone(),
            participant_needs_digest: binding.needs_digest.clone(),
        };
        ensure_deployment_resources(
            &self.client,
            self.service.repository(),
            scope.clone(),
            &binding,
            &authority.deployment_id,
            now,
        )
        .await?;
        ensure_authority_dependencies(self.service.repository(), scope, &binding, now).await?;
        self.service
            .authorization()
            .reconcile_authority(&target, now)
            .await?;
        let authority = self
            .service
            .repository()
            .list_deployment_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == authority_id)
            .ok_or(AuthorizationStateError::StorageConflict)?;
        let result = json!({ "authority": authority_value(authority) });
        let mut idempotency = rpc_idempotency(
            "Auth.DeploymentAuthority.Reconcile",
            &caller.principal_id,
            required_string(&input, "idempotencyKey")?,
            &input,
            now,
        )?;
        idempotency.result = result.clone();
        match self
            .service
            .repository()
            .record_idempotency_result(idempotency)
            .await?
        {
            IdempotentOutcome::Applied(value) | IdempotentOutcome::Replayed(value) => Ok(value),
        }
    }

    async fn authority_plans_list(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let deployment_id = input.get("deploymentId").and_then(Value::as_str);
        let state = input.get("state").and_then(Value::as_str);
        let now = now_millis()?;
        let entries = self
            .service
            .repository()
            .list_authority_proposals()
            .await?
            .into_iter()
            .map(|(proposal, decision)| (effective_proposal(proposal, now), decision))
            .filter(|(proposal, _)| authority_plan_matches(proposal, deployment_id, state))
            .map(|(proposal, decision)| proposal_value(proposal, decision))
            .collect();
        Ok(paginate_values(entries, &input))
    }

    async fn authority_plans_get(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let proposal_id = required_string(&input, "proposalId")?;
        let now = now_millis()?;
        self.service
            .repository()
            .get_authority_proposal(proposal_id)
            .await?
            .map(|(proposal, decision)| {
                json!({ "proposal": proposal_value(effective_proposal(proposal, now), decision) })
            })
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("proposal not found".to_owned()))
    }

    async fn authority_accept(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
        expected_kind: AuthorityProposalKind,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let proposal_id = plan_id(&input)?;
        let idempotency_key = input
            .get("idempotencyKey")
            .and_then(Value::as_str)
            .unwrap_or(proposal_id);
        let (proposal, _) = self
            .service
            .repository()
            .get_authority_proposal(proposal_id)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("proposal not found".to_owned())
            })?;
        if proposal.authority_kind != crate::platform::auth::AuthorityKind::Deployment {
            return Err(AuthorizationStateError::InvalidRecord(
                "proposal is not deployment authority".to_owned(),
            ));
        }
        let classification_matches = match expected_kind {
            AuthorityProposalKind::Update => matches!(
                proposal.proposal_kind,
                AuthorityProposalKind::Initial | AuthorityProposalKind::Update
            ),
            AuthorityProposalKind::Migration => {
                proposal.proposal_kind == AuthorityProposalKind::Migration
            }
            AuthorityProposalKind::Initial => false,
        };
        if !classification_matches {
            return Err(AuthorizationStateError::InvalidRecord(format!(
                "proposal classification is {}, expected {}",
                enum_string(proposal.proposal_kind),
                enum_string(expected_kind)
            )));
        }
        let current = self
            .service
            .repository()
            .list_deployment_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == proposal.authority_id);
        let deployment_id = proposal.deployment_id.clone().ok_or_else(|| {
            AuthorizationStateError::InvalidRecord("proposal deploymentId is missing".to_owned())
        })?;
        if proposal.authority_id
            != crate::platform::auth::deployment_authority_id(
                &deployment_id,
                &proposal.participant_id,
            )?
        {
            tracing::warn!(
                proposal_id = %proposal.proposal_id,
                authority_id = %proposal.authority_id,
                deployment_id = %deployment_id,
                participant_id = %proposal.participant_id,
                "authority proposal identity conflict"
            );
            return Err(AuthorizationStateError::StorageConflict);
        }
        let binding = self
            .service
            .repository()
            .get_participant_binding(
                &proposal.participant_id,
                &proposal.participant_artifact_digest,
            )
            .await?
            .filter(|binding| binding.needs_digest == proposal.participant_needs_digest)
            .ok_or(AuthorizationStateError::ParticipantMissing)?;
        let participant_kind = binding.participant_kind;
        let now = now_millis()?;
        let reason = input
            .get("reason")
            .map(|_| nullable_string(&input, "reason"))
            .transpose()?
            .flatten();
        let desired = DesiredAuthorityRecord::Deployment(DeploymentAuthorityRecord {
            authority_id: proposal.authority_id.clone(),
            deployment_id: deployment_id.clone(),
            participant_id: proposal.participant_id.clone(),
            participant_kind,
            participant_artifact_digest: proposal.participant_artifact_digest.clone(),
            accepted_needs_digest: proposal.participant_needs_digest.clone(),
            desired_grant_set: proposal.proposed_grant_set.clone(),
            desired_capabilities: proposal.proposed_capabilities.clone(),
            state: AuthorityState::Accepted,
            version: current
                .as_ref()
                .map_or(1, |authority| authority.version + 1),
            created_at: current
                .as_ref()
                .map_or(now, |authority| authority.created_at),
            updated_at: now,
            expires_at: current.as_ref().and_then(|authority| authority.expires_at),
            decision: Some(AuthorityDecision {
                decided_at: now,
                decided_by: caller.principal_id.clone(),
                reason: reason.clone(),
            }),
        });
        self.service
            .decide_authority_proposal(DecideAuthorityProposalInput {
                proposal_id: proposal_id.to_owned(),
                expected_version: proposal.version,
                expected_base_authority_version: Some(
                    match input
                        .get("expectedBaseAuthorityVersion")
                        .or_else(|| input.get("expectedDesiredVersion"))
                    {
                        Some(Value::Null) => None,
                        Some(value) => Some(value.as_u64().ok_or_else(|| {
                            AuthorizationStateError::InvalidRecord(
                        "expectedBaseAuthorityVersion must be a non-negative integer or null"
                            .to_owned(),
                    )
                        })?),
                        None => proposal
                            .payload
                            .get("baseAuthorityVersion")
                            .and_then(Value::as_u64),
                    },
                ),
                outcome: AuthorityDecisionOutcome::Accepted,
                decided_by: caller.principal_id.clone(),
                reason,
                desired_authority: Some(desired),
                decided_at: now,
                idempotency: rpc_idempotency(
                    "Auth.DeploymentAuthority.Accept",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                portal_binding: None,
                expected_portal_binding: None,
                portal_policy_snapshot: None,
                actions: Vec::new(),
            })
            .await?;
        let target = AuthorityTarget::new(AuthorityKind::Deployment, &proposal.authority_id)?;
        ensure_deployment_resources(
            &self.client,
            self.service.repository(),
            super::AuthorityEvidenceScope {
                target: target.clone(),
                participant_id: binding.participant_id.clone(),
                participant_artifact_digest: binding.artifact_digest.clone(),
                participant_needs_digest: binding.needs_digest.clone(),
            },
            &binding,
            &deployment_id,
            now,
        )
        .await?;
        ensure_authority_dependencies(
            self.service.repository(),
            super::AuthorityEvidenceScope {
                target: target.clone(),
                participant_id: binding.participant_id.clone(),
                participant_artifact_digest: binding.artifact_digest.clone(),
                participant_needs_digest: binding.needs_digest.clone(),
            },
            &binding,
            now,
        )
        .await?;
        self.service
            .authorization()
            .reconcile_authority(&target, now)
            .await?;
        let (proposal, decision) = self
            .service
            .repository()
            .get_authority_proposal(proposal_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        let authority = self
            .service
            .repository()
            .list_deployment_authorities()
            .await?
            .into_iter()
            .find(|authority| authority.authority_id == proposal.authority_id)
            .ok_or(AuthorizationStateError::StorageConflict)?;
        Ok(json!({
            "proposal": proposal_value(proposal, decision),
            "authority": authority_value(authority),
        }))
    }

    async fn authority_reject(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let proposal_id = required_string(&input, "proposalId")?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let (proposal, _) = self
            .service
            .repository()
            .get_authority_proposal(proposal_id)
            .await?
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("proposal not found".to_owned())
            })?;
        let now = now_millis()?;
        self.service
            .decide_authority_proposal(DecideAuthorityProposalInput {
                proposal_id: proposal_id.to_owned(),
                expected_version: proposal.version,
                expected_base_authority_version: None,
                outcome: AuthorityDecisionOutcome::Rejected,
                decided_by: caller.principal_id.clone(),
                reason: nullable_string(&input, "reason")?,
                desired_authority: None,
                decided_at: now,
                idempotency: rpc_idempotency(
                    "Auth.DeploymentAuthority.Reject",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                portal_binding: None,
                expected_portal_binding: None,
                portal_policy_snapshot: None,
                actions: Vec::new(),
            })
            .await?;
        let (proposal, decision) = self
            .service
            .repository()
            .get_authority_proposal(proposal_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        Ok(json!({ "proposal": proposal_value(proposal, decision) }))
    }

    async fn sessions_me(
        &self,
        validated: ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let session = self
            .service
            .repository()
            .get_session_by_public_key(&validated.session_public_key)
            .await?
            .ok_or(AuthorizationStateError::SessionMissing)?;
        let user = if validated.principal_kind == PrincipalKind::User {
            let (principal, profile) = self
                .service
                .repository()
                .get_user_account(&validated.principal_id)
                .await?
                .ok_or(AuthorizationStateError::PrincipalMissing)?;
            if principal.state != PrincipalState::Active {
                return Err(AuthorizationStateError::PrincipalInactive);
            }
            let mut value = user_value(UserAccount { principal, profile });
            value["capabilities"] = json!(validated.capabilities);
            Some(value)
        } else {
            None
        };
        let binding = self
            .service
            .repository()
            .get_session_runtime_binding(&validated.session_id)
            .await?;
        Ok(json!({
            "session": session,
            "user": user,
            "deploymentId": binding.as_ref().map(|binding| &binding.deployment_id),
            "instanceId": binding.as_ref().map(|binding| &binding.instance_id),
        }))
    }

    async fn connections_list(
        &self,
        payload: &[u8],
        _validated: ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let session_id = input.get("sessionId").and_then(Value::as_str);
        let mut entries = self.ephemeral.list_connection_presence(session_id).await?;
        entries.sort_by(|left, right| left.connection_id.cmp(&right.connection_id));
        let limit = input
            .get("limit")
            .and_then(Value::as_i64)
            .unwrap_or(100)
            .clamp(1, 500) as usize;
        let offset = input
            .get("cursor")
            .and_then(Value::as_str)
            .and_then(|cursor| cursor.parse::<usize>().ok())
            .unwrap_or(0);
        let next_cursor = (offset + limit < entries.len()).then(|| (offset + limit).to_string());
        let entries = entries
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(connection_value)
            .collect::<Vec<_>>();
        Ok(json!({ "entries": entries, "nextCursor": next_cursor }))
    }

    async fn portals_list(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let mut entries = Vec::new();
        for portal in self.service.repository().list_login_portals().await? {
            if portal.removed {
                continue;
            }
            let (_, settings) = self
                .service
                .repository()
                .get_login_portal(&portal.portal_id)
                .await?
                .ok_or(AuthorizationStateError::StorageConflict)?;
            entries.push(portal_value(portal, settings));
        }
        Ok(paginate_values(entries, &input))
    }

    async fn portals_get(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let portal_id = required_string(&input, "portalId")?;
        let (portal, settings) = self
            .service
            .repository()
            .get_login_portal(portal_id)
            .await?
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("portal not found".to_owned()))?;
        if portal.removed {
            return Err(AuthorizationStateError::InvalidRecord(
                "portal not found".to_owned(),
            ));
        }
        let routes = self
            .service
            .repository()
            .list_portal_routes()
            .await?
            .into_iter()
            .filter(|route| route.portal_id == portal_id)
            .collect::<Vec<_>>();
        Ok(json!({ "portal": portal_value(portal, settings), "routes": routes }))
    }

    async fn portals_put(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let portal_id = required_string(&input, "portalId")?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let current = self
            .service
            .repository()
            .get_login_portal(portal_id)
            .await?;
        let expected_version = input.get("expectedVersion").and_then(Value::as_u64);
        if current.as_ref().map(|value| value.0.version) != expected_version {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let now = now_millis()?;
        let settings_value = input.get("loginSettings").ok_or_else(|| {
            AuthorizationStateError::InvalidRecord("loginSettings is required".to_owned())
        })?;
        let provider_ids =
            optional_string_array(settings_value, "providers")?.unwrap_or_else(|| {
                current
                    .as_ref()
                    .map_or_else(Vec::new, |value| value.0.provider_ids.clone())
            });
        let version = expected_version.map_or(1, |version| version + 1);
        let portal = LoginPortalRecord {
            portal_id: portal_id.to_owned(),
            display_name: required_string(&input, "displayName")?.to_owned(),
            entry_url: nullable_string(&input, "entryUrl")?,
            builtin: current.as_ref().is_some_and(|value| value.0.builtin),
            disabled: required_bool(&input, "disabled")?,
            removed: false,
            local_registration_enabled: required_bool(settings_value, "localRegistration")?,
            provider_ids: provider_ids.clone(),
            created_at: current.as_ref().map_or(now, |value| value.0.created_at),
            updated_at: now,
            version,
        };
        let settings =
            login_settings_from_value(portal_id, settings_value, provider_ids, now, version)?;
        self.service
            .repository()
            .put_login_portal(LoginPortalMutation {
                portal,
                settings,
                expected_version,
                idempotency: rpc_idempotency(
                    "Auth.Portals.Put",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        self.portal_reconciliation.notify_portal(portal_id).await;
        let (portal, settings) = self
            .service
            .repository()
            .get_login_portal(portal_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        Ok(json!({ "portal": portal_value(portal, settings) }))
    }

    async fn portals_remove(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let portal_id = required_string(&input, "portalId")?;
        let (mut portal, settings) = self
            .service
            .repository()
            .get_login_portal(portal_id)
            .await?
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("portal not found".to_owned()))?;
        if portal.builtin {
            return Err(AuthorizationStateError::InvalidRecord(
                "the built-in portal cannot be removed".to_owned(),
            ));
        }
        let expected_version = required_u64(&input, "expectedVersion")?;
        if portal.version != expected_version {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let now = now_millis()?;
        portal.removed = true;
        portal.updated_at = now;
        portal.version += 1;
        self.service
            .repository()
            .put_login_portal(LoginPortalMutation {
                portal,
                expected_version: Some(expected_version),
                settings,
                idempotency: rpc_idempotency(
                    "Auth.Portals.Remove",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        self.portal_reconciliation.notify_portal(portal_id).await;
        Ok(json!({ "removed": true }))
    }

    async fn capabilities_list(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let source_api = input.get("sourceApi").and_then(Value::as_str);
        let artifact: Value = serde_json::from_str(include_str!("../../../../trellis.api.json"))
            .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?;
        let entries = if source_api.is_none_or(|value| value == "trellis.auth@v1") {
            artifact
                .get("capabilities")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|capabilities| capabilities.iter())
                .map(|(capability, definition)| {
                    json!({
                        "capability": capability,
                        "displayName": capability,
                        "description": format!("trellis.auth@v1 {capability} capability"),
                        "allows": definition.get("allows").cloned().unwrap_or_else(|| json!([])),
                        "sourceApi": "trellis.auth@v1",
                    })
                })
                .collect()
        } else {
            Vec::new()
        };
        Ok(paginate_values(entries, &input))
    }

    async fn portal_settings_get(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let portal_id = required_string(&input, "portalId")?;
        let (portal, settings) = self
            .service
            .repository()
            .get_login_portal(portal_id)
            .await?
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("portal not found".to_owned()))?;
        Ok(json!({
            "portal": {
                "portalId": portal.portal_id,
                "displayName": portal.display_name,
                "entryUrl": portal.entry_url,
                "builtIn": portal.builtin,
                "disabled": portal.disabled,
                "createdAt": millis_rfc3339(portal.created_at)?,
                "updatedAt": millis_rfc3339(portal.updated_at)?,
            },
            "settings": {
                "portalId": portal_id,
                "localRegistrationEnabled": portal.local_registration_enabled,
                "federatedRegistrationEnabled": settings.federated_registration_enabled,
                "allowedFederatedProviders": portal.provider_ids,
                "selfRegisteredAccountActive": true,
                "updatedAt": millis_rfc3339(settings.updated_at)?,
            },
            "defaultCapabilities": [],
            "defaultCapabilityGroups": [],
            "federatedProviders": [],
        }))
    }

    async fn portal_settings_update(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let portal_id = required_string(&input, "portalId")?;
        let expected_version = required_u64(&input, "expectedVersion")?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let (mut portal, current_settings) = self
            .service
            .repository()
            .get_login_portal(portal_id)
            .await?
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("portal not found".to_owned()))?;
        if portal.version != expected_version || current_settings.version != expected_version {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let settings_value = input.get("settings").ok_or_else(|| {
            AuthorizationStateError::InvalidRecord("settings is required".to_owned())
        })?;
        let provider_ids = optional_string_array(settings_value, "providers")?
            .unwrap_or_else(|| portal.provider_ids.clone());
        let now = now_millis()?;
        let version = expected_version + 1;
        portal.provider_ids = provider_ids.clone();
        portal.local_registration_enabled = required_bool(settings_value, "localRegistration")?;
        portal.updated_at = now;
        portal.version = version;
        let settings =
            login_settings_from_value(portal_id, settings_value, provider_ids, now, version)?;
        self.service
            .repository()
            .put_login_portal(LoginPortalMutation {
                portal,
                settings,
                expected_version: Some(expected_version),
                idempotency: rpc_idempotency(
                    "Auth.Portals.LoginSettings.Update",
                    &caller.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        self.portal_reconciliation.notify_portal(portal_id).await;
        let (portal, settings) = self
            .service
            .repository()
            .get_login_portal(portal_id)
            .await?
            .ok_or(AuthorizationStateError::StorageConflict)?;
        Ok(json!({
            "portalId": portal_id,
            "settings": login_settings_value(&portal, &settings),
            "version": settings.version,
        }))
    }

    async fn portal_route_put(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let expected_version = input.get("expectedVersion").and_then(Value::as_u64);
        let route_id = input
            .get("routeId")
            .and_then(Value::as_str)
            .map_or_else(|| format!("ptr_{}", Ulid::new()), str::to_owned);
        let routes = self.service.repository().list_portal_routes().await?;
        let current = routes
            .iter()
            .find(|route| route.route_id == route_id)
            .cloned();
        if current.as_ref().map(|route| route.version) != expected_version {
            return Err(AuthorizationStateError::StorageConflict);
        }
        let now = now_millis()?;
        let route = PortalRouteRecord {
            route_id: route_id.clone(),
            portal_id: required_string(&input, "portalId")?.to_owned(),
            participant_id: nullable_string(&input, "participantId")?,
            origin: nullable_string(&input, "origin")?,
            deployment_id: nullable_string(&input, "deploymentId")?,
            priority: required_i64(&input, "priority")?,
            created_at: current.as_ref().map_or(now, |route| route.created_at),
            updated_at: now,
            version: expected_version.map_or(1, |version| version + 1),
        };
        if routes.iter().any(|existing| {
            existing.route_id != route.route_id
                && existing.participant_id == route.participant_id
                && existing.origin == route.origin
                && existing.deployment_id == route.deployment_id
                && existing.priority == route.priority
        }) {
            return Err(AuthorizationStateError::StorageConflict);
        }
        self.service
            .repository()
            .put_portal_route(PortalRouteMutation {
                route: route.clone(),
                expected_version,
                idempotency: rpc_idempotency(
                    "Auth.Portals.Routes.Put",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        Ok(json!({ "route": route }))
    }

    async fn portal_route_remove(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let route_id = required_string(&input, "routeId")?;
        let now = now_millis()?;
        self.service
            .repository()
            .remove_portal_route(PortalRouteRemoval {
                route_id: route_id.to_owned(),
                expected_version: required_u64(&input, "expectedVersion")?,
                idempotency: rpc_idempotency(
                    "Auth.Portals.Routes.Remove",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        Ok(json!({ "routeId": route_id, "removed": true }))
    }

    async fn sessions_list(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let mut entries = self.service.repository().list_sessions().await?;
        entries.retain(|session| {
            input
                .get("principalId")
                .and_then(Value::as_str)
                .is_none_or(|value| session.principal_id == value)
                && input
                    .get("participantId")
                    .and_then(Value::as_str)
                    .is_none_or(|value| session.participant_id == value)
                && input
                    .get("state")
                    .and_then(Value::as_str)
                    .is_none_or(|value| {
                        serde_json::to_value(session.state)
                            .ok()
                            .and_then(|state| state.as_str().map(str::to_owned))
                            .as_deref()
                            == Some(value)
                    })
        });
        if let Some(deployment_id) = input.get("deploymentId").and_then(Value::as_str) {
            let mut deployed = Vec::new();
            for session in entries {
                if self
                    .service
                    .repository()
                    .get_session_runtime_binding(&session.session_id)
                    .await?
                    .is_some_and(|binding| binding.deployment_id == deployment_id)
                {
                    deployed.push(session);
                }
            }
            entries = deployed;
        }
        entries.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        Ok(paginate_sessions(entries, &input))
    }

    async fn sessions_logout(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        if input.as_object().is_none_or(|input| !input.is_empty()) {
            return Err(AuthorizationStateError::InvalidRecord(
                "logout request must be an empty object".to_owned(),
            ));
        }
        let input = json!({
            "sessionId": caller.session_id,
            "expectedVersion": null,
            "idempotencyKey": "logout",
            "reason": null,
        });
        self.sessions_revoke(
            &serde_json::to_vec(&input)
                .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?,
            Some(caller),
        )
        .await
    }

    async fn sessions_revoke(
        &self,
        payload: &[u8],
        caller: Option<&ValidatedRequest>,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let session_id = required_string(&input, "sessionId")?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let session = self
            .service
            .repository()
            .get_session(session_id)
            .await?
            .ok_or(AuthorizationStateError::SessionMissing)?;
        let expected_version = input
            .get("expectedVersion")
            .and_then(Value::as_i64)
            .map(u64::try_from)
            .transpose()
            .map_err(|_| AuthorizationStateError::StorageConflict)?
            .unwrap_or(session.version);
        let now = now_millis()?;
        let request_digest = trellis_protocol::digest_json(&input)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let action = |kind, suffix: &str, payload| PostCommitActionRecord {
            predecessor_action_id: None,
            action_id: digest_parts(&[session_id, idempotency_key, suffix]),
            kind,
            payload,
            created_at: now,
            attempts: 0,
            next_attempt_at: now,
            claimed_until: None,
            last_error: None,
        };
        let outcome = self
            .service
            .revoke_session(
                session_id.to_owned(),
                expected_version,
                now,
                IdempotencyResultRecord {
                    scope_key: digest_parts(&["Auth.Sessions.Revoke", session_id]),
                    purpose: "Auth.Sessions.Revoke".to_owned(),
                    signer_id: caller
                        .map(|caller| caller.principal_id.clone())
                        .unwrap_or_else(|| "rpc".to_owned()),
                    request_id: idempotency_key.to_owned(),
                    request_digest,
                    result: Value::Null,
                    created_at: now,
                    expires_at: now.saturating_add(86_400_000),
                },
                vec![
                    action(
                        PostCommitActionKind::Event,
                        "event",
                        json!({
                            "eventType": "Auth.Sessions.Revoked",
                            "eventId": format!(
                                "evt_{}",
                            digest_parts(&[session_id, idempotency_key])
                            ),
                            "occurredAt": now,
                            "sessionId": session_id,
                            "principalId": session.principal_id.clone(),
                            "participantId": session.participant_id.clone(),
                            "reason": input.get("reason"),
                            "revokedBy": caller.map(|caller| &caller.principal_id),
                        }),
                    ),
                    action(
                        PostCommitActionKind::Kick,
                        "kick",
                        json!({ "sessionId": session_id }),
                    ),
                ],
            )
            .await?;
        let session = match outcome {
            IdempotentOutcome::Applied(session) => session,
            IdempotentOutcome::Replayed(_) => self
                .service
                .repository()
                .get_session(session_id)
                .await?
                .ok_or(AuthorizationStateError::SessionMissing)?,
        };
        let kicked_connections = self.kick_session_connections(session_id).await;
        Ok(json!({
            "session": session,
            "kickedConnections": kicked_connections,
        }))
    }

    async fn connections_kick(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let connection_id = required_string(&input, "connectionId")?;
        let connection = self
            .ephemeral
            .list_connection_presence(None)
            .await?
            .into_iter()
            .find(|connection| connection.connection_id == connection_id)
            .ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("connection not found".to_owned())
            })?;
        self.kick_connection(&connection).await?;
        Ok(json!({ "connectionId": connection_id, "kicked": true }))
    }

    async fn kick_session_connections(&self, session_id: &str) -> usize {
        let Ok(connections) = self
            .ephemeral
            .list_connection_presence(Some(session_id))
            .await
        else {
            return 0;
        };
        let mut kicked = 0;
        for connection in connections {
            if self.kick_connection(&connection).await.is_ok() {
                kicked += 1;
            }
        }
        kicked
    }

    async fn kick_connection(
        &self,
        connection: &AuthConnectionPresence,
    ) -> Result<(), AuthorizationStateError> {
        let client_id = connection
            .client_id
            .parse::<u64>()
            .map_err(|_| AuthorizationStateError::InvalidRecord("invalid client id".to_owned()))?;
        let response = self
            .system_client
            .request(
                format!("$SYS.REQ.SERVER.{}.KICK", connection.server_id),
                Bytes::from(
                    serde_json::to_vec(&json!({ "cid": client_id }))
                        .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?,
                ),
            )
            .await
            .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?;
        validate_connection_kick_response(&response.payload)
    }

    async fn users_create(
        &self,
        payload: &[u8],
        validated: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let now = now_millis()?;
        let outcome = self
            .service
            .create_user(CreateUserInput {
                name: nullable_string(&input, "name")?,
                email: nullable_string(&input, "email")?,
                image: nullable_string(&input, "image")?,
                created_at: now,
                idempotency: rpc_idempotency(
                    "Auth.Users.Create",
                    &validated.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        let account = match outcome {
            IdempotentOutcome::Applied(account) => account,
            IdempotentOutcome::Replayed(result) => {
                let principal_id = required_string(&result, "principalId")?;
                self.service
                    .user(principal_id)
                    .await?
                    .ok_or(AuthorizationStateError::PrincipalMissing)?
            }
        };
        Ok(json!({ "user": user_value(account) }))
    }

    async fn password_change(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let now = now_millis()?;
        let action = PostCommitActionRecord {
            predecessor_action_id: None,
            action_id: digest_parts(&[
                "Auth.Users.Password.Change",
                &caller.principal_id,
                required_string(&input, "idempotencyKey")?,
            ]),
            kind: PostCommitActionKind::Kick,
            payload: json!({
                "principalId": caller.principal_id,
                "exceptSessionId": caller.session_id,
            }),
            created_at: now,
            attempts: 0,
            next_attempt_at: now,
            claimed_until: None,
            last_error: None,
        };
        match self
            .service
            .change_password(ChangePasswordInput {
                principal_id: caller.principal_id.clone(),
                current_session_id: caller.session_id.clone(),
                current_password: required_string(&input, "currentPassword")?.to_owned(),
                new_password: required_string(&input, "newPassword")?.to_owned(),
                changed_at: now,
                idempotency: rpc_idempotency(
                    "Auth.Users.Password.Change",
                    &caller.principal_id,
                    required_string(&input, "idempotencyKey")?,
                    &input,
                    now,
                )?,
                actions: vec![action],
            })
            .await?
        {
            IdempotentOutcome::Applied(revoked) => Ok(json!({
                "changedAt": now,
                "revokedSessionCount": revoked,
            })),
            IdempotentOutcome::Replayed(value) => Ok(value),
        }
    }

    async fn password_reset_create(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let principal_id = required_string(&input, "userId")?;
        self.service
            .user(principal_id)
            .await?
            .ok_or_else(|| AuthorizationStateError::InvalidRecord("user not found".to_owned()))?;
        self.create_rpc_account_flow(
            &input,
            caller,
            AccountFlowKind::PasswordReset,
            principal_id,
            Vec::new(),
            "Auth.Users.PasswordReset.Create",
        )
        .await
    }

    async fn identity_link_create(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let allowed_providers = required_string_array(&input, "allowedProviders")?;
        self.create_rpc_account_flow(
            &input,
            caller,
            AccountFlowKind::IdentityLink,
            &caller.principal_id,
            allowed_providers,
            "Auth.Users.IdentityLink.Create",
        )
        .await
    }

    async fn create_rpc_account_flow(
        &self,
        input: &Value,
        caller: &ValidatedRequest,
        kind: AccountFlowKind,
        principal_id: &str,
        allowed_providers: Vec<String>,
        purpose: &str,
    ) -> Result<Value, AuthorizationStateError> {
        let now = now_millis()?;
        let admin_target = if kind == AccountFlowKind::PasswordReset {
            self.require_admin_for_admin_target(caller, principal_id)
                .await?
        } else {
            false
        };
        let return_target = nullable_string(input, "returnTarget")?;
        let outcome = self
            .service
            .create_account_flow(CreateAccountFlowInput {
                kind,
                target_principal_id: Some(principal_id.to_owned()),
                target_provider_id: None,
                return_location: return_target.clone(),
                payload: json!({
                    "allowedProviders": allowed_providers,
                    "adminTarget": admin_target,
                    "requestedByPrincipalId": caller.principal_id,
                }),
                created_at: now,
                expires_at: now.saturating_add(15 * 60_000),
                idempotency: rpc_idempotency(
                    purpose,
                    &caller.principal_id,
                    required_string(input, "idempotencyKey")?,
                    input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        let flow = match outcome {
            IdempotentOutcome::Applied(flow) => flow,
            IdempotentOutcome::Replayed(_) => {
                return Err(AuthorizationStateError::StorageConflict);
            }
        };
        let kind = match kind {
            AccountFlowKind::PasswordReset => "password_reset",
            AccountFlowKind::IdentityLink => "identity_link",
            _ => {
                return Err(AuthorizationStateError::InvalidRecord(
                    "unsupported RPC account flow".to_owned(),
                ));
            }
        };
        Ok(json!({
            "flow": {
                "flowId": flow.flow_id,
                "kind": kind,
                "targetPrincipalId": principal_id,
                "allowedProviders": allowed_providers,
                "returnTarget": return_target,
                "createdAt": now,
                "expiresAt": flow.expires_at,
                "consumedAt": null,
                "version": 1,
                "completionUrl": format!(
                    "{}/auth/account-flow/{}",
                    self.public_origin.trim_end_matches('/'),
                    flow.token
                ),
            }
        }))
    }

    async fn user_identities_list(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let provider = input.get("providerId").and_then(Value::as_str);
        let entries = self
            .service
            .repository()
            .list_provider_identities(&caller.principal_id)
            .await?
            .into_iter()
            .filter(|identity| provider.is_none_or(|value| identity.provider == value))
            .map(|identity| {
                json!({
                    "providerId": identity.provider,
                    "subject": identity.provider_subject,
                    "principalId": identity.principal_id,
                    "username": null,
                    "observedName": null,
                    "observedEmail": null,
                    "createdAt": identity.linked_at,
                    "lastSeenAt": identity.last_seen_at,
                })
            })
            .collect();
        Ok(paginate_values(entries, &input))
    }

    async fn user_identities_unlink(
        &self,
        payload: &[u8],
        caller: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let now = now_millis()?;
        let mut idempotency = rpc_idempotency(
            "Auth.UserIdentities.Unlink",
            &caller.principal_id,
            required_string(&input, "idempotencyKey")?,
            &input,
            now,
        )?;
        idempotency.result = json!({ "unlinked": true });
        let outcome = self
            .service
            .repository()
            .unlink_provider_identity(ProviderIdentityUnlink {
                provider: required_string(&input, "providerId")?.to_owned(),
                provider_subject: required_string(&input, "subject")?.to_owned(),
                principal_id: caller.principal_id.clone(),
                idempotency,
                actions: Vec::new(),
            })
            .await?;
        match outcome {
            IdempotentOutcome::Applied(unlinked) => Ok(json!({ "unlinked": unlinked })),
            IdempotentOutcome::Replayed(value) => Ok(value),
        }
    }

    async fn users_get(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let account = self
            .service
            .user(required_string(&input, "userId")?)
            .await?
            .ok_or(AuthorizationStateError::PrincipalMissing)?;
        Ok(json!({ "user": user_value(account) }))
    }

    async fn users_resolve(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let selector = input.get("selector").ok_or_else(|| {
            AuthorizationStateError::InvalidRecord("selector is required".to_owned())
        })?;
        let principal_id = match selector.get("kind").and_then(Value::as_str) {
            Some("user") => required_string(selector, "userId")?.to_owned(),
            Some("provider") => self
                .service
                .repository()
                .get_provider_identity(
                    required_string(selector, "providerId")?,
                    required_string(selector, "providerSubject")?,
                )
                .await?
                .map(|identity| identity.principal_id)
                .ok_or_else(|| {
                    AuthorizationStateError::InvalidRecord("user not found".to_owned())
                })?,
            _ => {
                return Err(AuthorizationStateError::InvalidRecord(
                    "selector kind is invalid".to_owned(),
                ));
            }
        };
        let account =
            self.service.user(&principal_id).await?.ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("user not found".to_owned())
            })?;
        Ok(json!({ "user": user_value(account) }))
    }

    async fn users_list(&self, payload: &[u8]) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let limit = input
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(100)
            .clamp(1, 100) as usize;
        let state = input.get("state").and_then(Value::as_str);
        let mut accounts = self
            .service
            .users(input.get("cursor").and_then(Value::as_str), limit + 1)
            .await?;
        if let Some(state) = state {
            accounts.retain(|account| principal_state(&account.principal) == state);
        }
        let next_cursor =
            (accounts.len() > limit).then(|| accounts[limit - 1].principal.principal_id.clone());
        accounts.truncate(limit);
        Ok(json!({
            "entries": accounts.into_iter().map(user_value).collect::<Vec<_>>(),
            "nextCursor": next_cursor,
        }))
    }

    async fn users_update(
        &self,
        payload: &[u8],
        validated: &ValidatedRequest,
    ) -> Result<Value, AuthorizationStateError> {
        let input: Value = serde_json::from_slice(payload)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let principal_id = required_string(&input, "userId")?;
        let idempotency_key = required_string(&input, "idempotencyKey")?;
        let expected_version = required_u64(&input, "expectedVersion")?;
        let state = match required_string(&input, "state")? {
            "active" => PrincipalState::Active,
            "disabled" => PrincipalState::Disabled,
            _ => {
                return Err(AuthorizationStateError::InvalidRecord(
                    "user state must be active or disabled".to_owned(),
                ));
            }
        };
        let now = now_millis()?;
        let outcome = self
            .service
            .update_user(UpdateUserInput {
                principal_id: principal_id.to_owned(),
                expected_version,
                name: nullable_string(&input, "name")?,
                email: nullable_string(&input, "email")?,
                image: nullable_string(&input, "image")?,
                state,
                allow_admin_target: caller_is_admin(validated),
                updated_at: now,
                idempotency: rpc_idempotency(
                    "Auth.Users.Update",
                    &validated.principal_id,
                    idempotency_key,
                    &input,
                    now,
                )?,
                actions: Vec::new(),
            })
            .await?;
        let account = match outcome {
            IdempotentOutcome::Applied(account) => account,
            IdempotentOutcome::Replayed(_) => self
                .service
                .user(principal_id)
                .await?
                .ok_or(AuthorizationStateError::PrincipalMissing)?,
        };
        Ok(json!({ "user": user_value(account) }))
    }

    async fn require_admin_for_admin_target(
        &self,
        caller: &ValidatedRequest,
        principal_id: &str,
    ) -> Result<bool, AuthorizationStateError> {
        let now = now_millis()?;
        let admin_target = self
            .service
            .repository()
            .list_identity_authorities()
            .await?
            .iter()
            .any(|authority| authority_is_current_admin(authority, principal_id, now));
        if admin_target && !caller_is_admin(caller) {
            require_admin(caller)?;
        }
        Ok(admin_target)
    }
}

fn connection_value(connection: AuthConnectionPresence) -> Value {
    json!({
        "connectionId": connection.connection_id,
        "sessionId": connection.session_id,
        "serverId": connection.server_id,
        "clientId": connection.client_id,
        "userNkey": connection.user_nkey,
        "remoteAddress": connection.remote_address,
        "connectedAt": connection.connected_at,
        "lastSeenAt": connection.last_seen_at,
    })
}

fn authority_value(authority: DeploymentAuthorityRecord) -> Value {
    json!({
        "authorityId": authority.authority_id,
        "participantId": authority.participant_id,
        "participantArtifactDigest": authority.participant_artifact_digest,
        "acceptedNeedsDigest": authority.accepted_needs_digest,
        "desiredGrantSet": authority.desired_grant_set,
        "desiredCapabilities": authority.desired_capabilities,
        "state": authority.state,
        "version": authority.version,
        "createdAt": authority.created_at,
        "updatedAt": authority.updated_at,
        "expiresAt": authority.expires_at,
        "decision": authority.decision,
        "materialization": null,
        "kind": "deployment",
        "deploymentId": authority.deployment_id,
        "participantKind": authority.participant_kind,
    })
}

fn identity_authority_value(authority: IdentityAuthorityRecord) -> Value {
    json!({
        "authorityId": authority.authority_id,
        "participantId": authority.participant_id,
        "participantArtifactDigest": authority.participant_artifact_digest,
        "acceptedNeedsDigest": authority.accepted_needs_digest,
        "desiredGrantSet": authority.desired_grant_set,
        "desiredCapabilities": authority.desired_capabilities,
        "state": authority.state,
        "version": authority.version,
        "createdAt": authority.created_at,
        "updatedAt": authority.updated_at,
        "expiresAt": authority.expires_at,
        "decision": authority.decision,
        "materialization": null,
        "kind": "identity",
        "principalId": authority.principal_id,
    })
}

fn identity_grant_value(
    authority: IdentityAuthorityRecord,
    participant_json: &str,
) -> Result<Value, AuthorizationStateError> {
    let participant: Value = serde_json::from_str(participant_json)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let kind = participant["kind"].as_str().unwrap_or("app");
    let anchor = match kind {
        "app" => json!({
            "kind": "web",
            "contractId": authority.participant_id,
            "origin": "unknown",
        }),
        _ => json!({
            "kind": "native",
            "contractId": authority.participant_id,
            "sessionPublicKey": authority.authority_id,
        }),
    };
    Ok(json!({
        "identityGrantId": authority.authority_id,
        "identityAnchor": anchor,
        "contractEvidence": {
            "contractId": authority.participant_id,
            "contractDigest": authority.participant_artifact_digest,
        },
        "displayName": participant["displayName"].as_str().unwrap_or(&authority.participant_id),
        "description": participant["description"].as_str().unwrap_or("Trellis participant authority"),
        "participantKind": kind,
        "capabilities": authority.desired_capabilities,
        "grantedAt": millis_rfc3339(authority.created_at)?,
        "updatedAt": millis_rfc3339(authority.updated_at)?,
    }))
}

fn service_instance_value(
    instance: super::RuntimeInstanceRecord,
    identity: ProvisionedIdentityRecord,
    profile: &DeploymentProfileRecord,
) -> Value {
    json!({
        "instanceId": instance.instance_id,
        "deploymentId": instance.deployment_id,
        "principalId": instance.principal_id,
        "identityPublicKey": identity.identity_public_key,
        "identityKeyId": identity.identity_key_id,
        "participantId": profile.participant_id,
        "state": instance.state,
        "createdAt": instance.created_at,
        "updatedAt": instance.updated_at,
        "version": instance.version,
    })
}

fn activation_review_value(review: DeviceActivationReviewRecord) -> Value {
    json!({
        "reviewId": review.review_id,
        "deploymentId": review.deployment_id,
        "instanceId": review.instance_id,
        "devicePrincipalId": review.principal_id,
        "activatedByUserPrincipalId": review.activated_by_user_principal_id,
        "state": review.state,
        "confirmationCode": review.payload.get("confirmationCode"),
        "requestedAt": review.requested_at,
        "expiresAt": review.expires_at,
        "decidedAt": review.decided_at,
        "decidedBy": review.decided_by,
        "reason": review.reason,
        "version": review.version,
    })
}

fn proposal_value(
    proposal: AuthorityProposalRecord,
    decision: Option<AuthorityDecisionRecord>,
) -> Value {
    let subject_id = proposal
        .deployment_id
        .clone()
        .or_else(|| {
            proposal
                .payload
                .get("subjectId")
                .or_else(|| proposal.payload.get("deploymentId"))
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or_else(|| proposal.authority_id.clone());
    let reasons = proposal
        .payload
        .get("reasons")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let base_authority_version = proposal.payload.get("baseAuthorityVersion").cloned();
    json!({
        "proposalId": proposal.proposal_id,
        "authorityKind": proposal.authority_kind,
        "subjectId": subject_id,
        "participantId": proposal.participant_id,
        "participantArtifactDigest": proposal.participant_artifact_digest,
        "participantNeedsDigest": proposal.participant_needs_digest,
        "proposedGrantSet": proposal.proposed_grant_set,
        "proposedCapabilities": proposal.proposed_capabilities,
        "classification": proposal.proposal_kind,
        "state": proposal.state,
        "reasons": reasons,
        "createdAt": proposal.created_at,
        "expiresAt": proposal.expires_at,
        "decisionAt": decision.as_ref().map(|value| value.decided_at),
        "decisionBy": decision.as_ref().map(|value| value.decided_by.clone()),
        "decisionReason": decision.and_then(|value| value.reason),
        "baseAuthorityVersion": base_authority_version,
    })
}

#[cfg(test)]
mod response_tests {
    use super::*;

    #[test]
    fn accept_update_response_round_trips_through_generated_type() {
        let value = json!({
            "authority": {
                "acceptedNeedsDigest": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                "authorityId": "dpa_test",
                "createdAt": 1,
                "decision": null,
                "deploymentId": "dep_test",
                "desiredCapabilities": ["publishEvents"],
                "desiredGrantSet": { "format": "trellis.grant-set.v1", "permissions": [] },
                "expiresAt": null,
                "kind": "deployment",
                "materialization": null,
                "participantArtifactDigest": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "participantId": "test@v1",
                "participantKind": "service",
                "state": "accepted",
                "updatedAt": 2,
                "version": 1
            },
            "proposal": {
                "proposalId": "apr_test",
                "authorityKind": "deployment",
                "subjectId": "dep_test",
                "participantId": "test@v1",
                "participantArtifactDigest": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "participantNeedsDigest": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
                "proposedGrantSet": { "format": "trellis.grant-set.v1", "permissions": [] },
                "proposedCapabilities": ["publishEvents"],
                "classification": "initial",
                "state": "accepted",
                "reasons": [],
                "createdAt": 1,
                "expiresAt": null,
                "decisionAt": 2,
                "decisionBy": "usr_test",
                "decisionReason": null,
                "baseAuthorityVersion": null
            }
        });
        serde_json::from_value::<
            trellis_runtime_apis::auth::types::AuthDeploymentAuthorityAcceptUpdateResponse,
        >(value)
        .unwrap();
    }
}

fn effective_proposal(mut proposal: AuthorityProposalRecord, now: i64) -> AuthorityProposalRecord {
    if proposal.state == AuthorityProposalState::Pending
        && proposal
            .expires_at
            .is_some_and(|expires_at| expires_at <= now)
    {
        proposal.state = AuthorityProposalState::Expired;
    }
    proposal
}

fn authority_plan_matches(
    proposal: &AuthorityProposalRecord,
    deployment_id: Option<&str>,
    state: Option<&str>,
) -> bool {
    proposal.authority_kind == AuthorityKind::Deployment
        && deployment_id.is_none_or(|id| proposal.deployment_id.as_deref() == Some(id))
        && state.is_none_or(|value| enum_string(proposal.state) == value)
}

fn enum_string(value: impl serde::Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn deployment_state_wire(state: DeploymentProfileState) -> &'static str {
    match state {
        DeploymentProfileState::Active => "active",
        DeploymentProfileState::Disabled => "disabled",
        DeploymentProfileState::Removed => "revoked",
    }
}

fn paginate_values(entries: Vec<Value>, input: &Value) -> Value {
    let limit = input
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(100)
        .clamp(1, 500) as usize;
    let offset = input
        .get("cursor")
        .and_then(Value::as_str)
        .and_then(|cursor| cursor.parse::<usize>().ok())
        .unwrap_or(0);
    let next_cursor = (offset + limit < entries.len()).then(|| (offset + limit).to_string());
    json!({
        "entries": entries.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),
        "nextCursor": next_cursor,
    })
}

fn offset_page(entries: Vec<Value>, input: &Value) -> Value {
    let limit = input
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(100)
        .min(500) as usize;
    let offset = input.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let count = entries.len();
    let mut page = json!({
        "entries": entries.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),
        "count": count,
        "offset": offset,
        "limit": limit,
    });
    if offset + limit < count {
        page["nextOffset"] = json!(offset + limit);
    }
    page
}

fn paginate_sessions(entries: Vec<SessionRecord>, input: &Value) -> Value {
    let limit = input
        .get("limit")
        .and_then(Value::as_i64)
        .unwrap_or(100)
        .clamp(1, 500) as usize;
    let offset = input
        .get("cursor")
        .and_then(Value::as_str)
        .and_then(|cursor| cursor.parse::<usize>().ok())
        .unwrap_or(0);
    let next_cursor = (offset + limit < entries.len()).then(|| (offset + limit).to_string());
    json!({
        "entries": entries.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),
        "nextCursor": next_cursor,
    })
}

fn require_admin(caller: &ValidatedRequest) -> Result<(), AuthorizationStateError> {
    if caller_is_admin(caller) {
        Ok(())
    } else {
        Err(AuthorizationStateError::InvalidRecord(
            "trellis.auth::admin capability is required".to_owned(),
        ))
    }
}

fn caller_is_admin(caller: &ValidatedRequest) -> bool {
    caller
        .capabilities
        .iter()
        .any(|capability| capability == "trellis.auth::admin")
}

fn authority_is_current_admin(
    authority: &IdentityAuthorityRecord,
    principal_id: &str,
    now: i64,
) -> bool {
    authority.principal_id == principal_id
        && authority.state == AuthorityState::Accepted
        && authority
            .expires_at
            .is_none_or(|expires_at| expires_at > now)
        && authority
            .desired_capabilities
            .iter()
            .any(|capability| capability == "trellis.auth::admin")
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AuthorizationStateError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AuthorizationStateError::InvalidRecord(format!("{key} is required")))
}

fn plan_id(value: &Value) -> Result<&str, AuthorizationStateError> {
    value
        .get("planId")
        .or_else(|| value.get("proposalId"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AuthorizationStateError::InvalidRecord("planId is required".to_owned()))
}

fn millis_rfc3339(value: i64) -> Result<String, AuthorizationStateError> {
    time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(value) * 1_000_000)
        .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| AuthorizationStateError::Storage(error.to_string()))
}

fn nullable_string(value: &Value, key: &str) -> Result<Option<String>, AuthorizationStateError> {
    match value.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(AuthorizationStateError::InvalidRecord(format!(
            "{key} must be a string or null"
        ))),
    }
}

fn required_u64(value: &Value, key: &str) -> Result<u64, AuthorizationStateError> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| AuthorizationStateError::InvalidRecord(format!("{key} is required")))
}

fn required_i64(value: &Value, key: &str) -> Result<i64, AuthorizationStateError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| AuthorizationStateError::InvalidRecord(format!("{key} is required")))
}

fn required_bool(value: &Value, key: &str) -> Result<bool, AuthorizationStateError> {
    value
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| AuthorizationStateError::InvalidRecord(format!("{key} is required")))
}

fn optional_string_array(
    value: &Value,
    key: &str,
) -> Result<Option<Vec<String>>, AuthorizationStateError> {
    match value.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_owned).ok_or_else(|| {
                    AuthorizationStateError::InvalidRecord(format!("{key} must contain strings"))
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        _ => Err(AuthorizationStateError::InvalidRecord(format!(
            "{key} must be an array or null"
        ))),
    }
}

fn required_string_array(value: &Value, key: &str) -> Result<Vec<String>, AuthorizationStateError> {
    optional_string_array(value, key)?
        .ok_or_else(|| AuthorizationStateError::InvalidRecord(format!("{key} is required")))
}

fn sort_and_validate_role_mappings(
    role_mappings: &mut [PortalRoleMapping],
) -> Result<(), AuthorizationStateError> {
    role_mappings.sort_by(|left, right| {
        (&left.provider_id, &left.role).cmp(&(&right.provider_id, &right.role))
    });
    if role_mappings
        .windows(2)
        .any(|pair| pair[0].provider_id == pair[1].provider_id && pair[0].role == pair[1].role)
    {
        return Err(AuthorizationStateError::InvalidRecord(
            "roleMappings contains a duplicate providerId and role".to_owned(),
        ));
    }
    Ok(())
}

fn login_settings_from_value(
    portal_id: &str,
    value: &Value,
    provider_ids: Vec<String>,
    now: i64,
    version: u64,
) -> Result<LoginSettingsRecord, AuthorizationStateError> {
    Ok(LoginSettingsRecord {
        portal_id: portal_id.to_owned(),
        default_provider_id: (provider_ids.len() == 1).then(|| provider_ids[0].clone()),
        local_login_enabled: required_bool(value, "localLogin")?,
        federated_registration_enabled: required_bool(value, "federatedRegistration")?,
        provider_selection_enabled: provider_ids.len() > 1,
        updated_at: now,
        version,
    })
}

fn login_settings_value(portal: &LoginPortalRecord, settings: &LoginSettingsRecord) -> Value {
    json!({
        "providers": portal.provider_ids,
        "localLogin": settings.local_login_enabled,
        "localRegistration": portal.local_registration_enabled,
        "federatedRegistration": settings.federated_registration_enabled,
    })
}

fn portal_value(portal: LoginPortalRecord, settings: LoginSettingsRecord) -> Value {
    json!({
        "portalId": portal.portal_id,
        "displayName": portal.display_name,
        "entryUrl": portal.entry_url,
        "builtIn": portal.builtin,
        "disabled": portal.disabled,
        "loginSettings": login_settings_value(&portal, &settings),
        "createdAt": portal.created_at,
        "updatedAt": portal.updated_at,
        "version": portal.version,
    })
}

fn rpc_idempotency(
    purpose: &str,
    signer_id: &str,
    request_id: &str,
    input: &Value,
    now: i64,
) -> Result<IdempotencyResultRecord, AuthorizationStateError> {
    Ok(IdempotencyResultRecord {
        scope_key: digest_parts(&[purpose, signer_id, request_id]),
        purpose: purpose.to_owned(),
        signer_id: signer_id.to_owned(),
        request_id: request_id.to_owned(),
        request_digest: trellis_protocol::digest_json(input)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        result: Value::Null,
        created_at: now,
        expires_at: now.saturating_add(86_400_000),
    })
}

fn principal_state(principal: &super::PrincipalRecord) -> &'static str {
    match principal.state {
        PrincipalState::Active => "active",
        PrincipalState::Disabled => "disabled",
        PrincipalState::Revoked => "revoked",
    }
}

fn user_value(account: UserAccount) -> Value {
    json!({
        "userId": account.principal.principal_id,
        "principalId": account.profile.principal_id,
        "state": principal_state(&account.principal),
        "name": account.profile.display_name,
        "email": account.profile.email,
        "image": account.profile.image_url,
        "createdAt": account.principal.created_at,
        "updatedAt": account.profile.updated_at,
        "disabledAt": account.principal.disabled_at,
        "revokedAt": account.principal.revoked_at,
        "version": account.principal.version,
    })
}

fn digest_parts(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u32).to_be_bytes());
        hash.update(part.as_bytes());
    }
    URL_SAFE_NO_PAD.encode(hash.finalize())
}

fn now_millis() -> Result<i64, AuthorizationStateError> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?
        .as_millis()
        .try_into()
        .map_err(|_| AuthorizationStateError::Storage("current time overflow".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use trellis_protocol::{
        ApiSurfaceKind, GrantSet, PermissionAction, PermissionAtom, PermissionTarget,
    };

    #[test]
    fn offset_page_omits_exhausted_next_offset() {
        let page = offset_page(vec![json!({ "id": 1 })], &json!({ "limit": 1 }));
        assert_eq!(page.get("nextOffset"), None);
    }

    #[test]
    fn administrator_context_requires_admin_marker() {
        let mut caller = ValidatedRequest {
            principal_id: "prn_user".to_owned(),
            principal_kind: PrincipalKind::User,
            session_id: "ses_user".to_owned(),
            session_public_key: "UAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                .to_owned(),
            capabilities: vec!["trellis.auth::authorities.mutate".to_owned()],
        };
        assert!(matches!(
            require_admin(&caller),
            Err(AuthorizationStateError::InvalidRecord(_))
        ));
        caller.capabilities.push("trellis.auth::admin".to_owned());
        assert!(require_admin(&caller).is_ok());
    }

    #[test]
    fn duplicate_portal_role_mapping_is_rejected() {
        let mut mappings = vec![
            PortalRoleMapping {
                provider_id: "oidc".to_owned(),
                role: "operator".to_owned(),
                direct_capabilities: vec!["example::read".to_owned()],
                capability_group_keys: Vec::new(),
            },
            PortalRoleMapping {
                provider_id: "oidc".to_owned(),
                role: "operator".to_owned(),
                direct_capabilities: vec!["example::write".to_owned()],
                capability_group_keys: Vec::new(),
            },
        ];
        assert!(matches!(
            sort_and_validate_role_mappings(&mut mappings),
            Err(AuthorizationStateError::InvalidRecord(_))
        ));
    }

    #[test]
    fn initial_authority_plan_filters_without_an_accepted_authority() {
        let proposal = AuthorityProposalRecord {
            proposal_id: "apr_01".to_owned(),
            authority_kind: AuthorityKind::Deployment,
            authority_id: "dau_test".to_owned(),
            deployment_id: Some("dep_test".to_owned()),
            proposal_kind: AuthorityProposalKind::Initial,
            participant_id: "participant.test@v1".to_owned(),
            participant_artifact_digest: "A".repeat(43),
            participant_needs_digest: "B".repeat(43),
            proposed_grant_set: GrantSet::new(Vec::new()),
            proposed_capabilities: Vec::new(),
            proposal_digest: "C".repeat(43),
            payload: json!({
                "deploymentId": "dep_test",
                "subjectId": "dep_test",
                "baseAuthorityVersion": null,
            }),
            state: AuthorityProposalState::Pending,
            created_at: 100,
            expires_at: Some(200),
            superseded_at: None,
            version: 1,
        };
        assert!(authority_plan_matches(
            &proposal,
            Some("dep_test"),
            Some("pending")
        ));
        assert!(!authority_plan_matches(&proposal, Some("dep_other"), None));
        let expired = effective_proposal(proposal.clone(), 200);
        assert_eq!(expired.state, AuthorityProposalState::Expired);
        assert!(authority_plan_matches(
            &expired,
            Some("dep_test"),
            Some("expired")
        ));
        assert_eq!(proposal_value(proposal, None)["subjectId"], "dep_test");
    }

    #[test]
    fn every_auth_rpc_subject_has_an_explicit_handler() {
        let artifact: Value =
            serde_json::from_str(include_str!("../../../../trellis.api.json")).unwrap();
        let sources = [
            include_str!("workflows/authority.rs"),
            include_str!("workflows/deployments.rs"),
            include_str!("workflows/devices.rs"),
            include_str!("workflows/portals.rs"),
            include_str!("workflows/sessions.rs"),
            include_str!("workflows/users.rs"),
        ];
        let rpc = artifact.get("rpc").and_then(Value::as_object).unwrap();
        for (name, descriptor) in rpc {
            let version = descriptor.get("version").and_then(Value::as_str).unwrap();
            let subject = format!("\"rpc.{version}.{name}\"");
            assert!(
                sources.iter().any(|source| source.contains(&subject)),
                "missing Auth RPC handler for {name}"
            );
        }
    }

    #[test]
    fn authored_event_ownership_is_explicit_required_authority() {
        let binding = crate::platform::auth::auth_runtime_participant_binding(1).unwrap();
        let grants = binding
            .resolve()
            .unwrap()
            .proposal()
            .required()
            .grant_set()
            .clone();
        for event in [
            "Auth.Sessions.Revoked",
            "Auth.DeviceUserAuthorities.Resolved",
        ] {
            assert!(grants.permissions().contains(
                &PermissionAtom::new(
                    PermissionTarget::api_surface("trellis.auth@v1", ApiSurfaceKind::Event, event,)
                        .unwrap(),
                    PermissionAction::Publish,
                )
                .unwrap()
            ));
        }
    }

    #[test]
    fn generated_router_resolves_every_auth_rpc_subject_exactly() {
        let mut routes = Router::new();
        trellis_sdk_auth::api::register_rpc_metadata(&mut routes);
        let artifact: Value =
            serde_json::from_str(include_str!("../../../../trellis.api.json")).unwrap();
        let rpc = artifact.get("rpc").and_then(Value::as_object).unwrap();
        for (name, descriptor) in rpc {
            let version = descriptor.get("version").and_then(Value::as_str).unwrap();
            let subject = format!("rpc.{version}.{name}");
            assert!(
                routes
                    .required_permission(&subject, b"{}")
                    .unwrap()
                    .is_some(),
                "missing exact route permission for {name}"
            );
        }
        // Unknown subjects never resolve, without any registry or SQLite lookup.
        assert!(routes.required_permission("$JS.API.INFO", b"{}").is_err());
        assert!(routes
            .required_permission("rpc.v1.Unknown.Surface", b"{}")
            .is_err());
    }

    #[test]
    fn operation_control_permissions_remain_exact() {
        let mut routes = Router::new();
        trellis_sdk_auth::api::register_rpc_metadata(&mut routes);
        let invoke = routes
            .required_permission("operations.v1.Auth.DeviceUserAuthorities.Resolve", b"{}")
            .unwrap()
            .expect("operation invoke route");
        let invoke = invoke.permission_atom().unwrap();
        assert_eq!(invoke.action(), PermissionAction::Invoke);
        assert_eq!(
            invoke.target(),
            &PermissionTarget::api_surface(
                "trellis.auth@v1",
                ApiSurfaceKind::Operation,
                "Auth.DeviceUserAuthorities.Resolve",
            )
            .unwrap()
        );
        let control = routes
            .required_permission(
                "operations.v1.Auth.DeviceUserAuthorities.Resolve.control",
                br#"{"action":"get","operationId":"op_test"}"#,
            )
            .unwrap()
            .expect("operation control route");
        let control = control.permission_atom().unwrap();
        assert_eq!(control.action(), PermissionAction::Observe);
        assert_eq!(control.target(), invoke.target());
    }

    #[test]
    fn public_rpc_errors_never_serialize_internal_causes() {
        let secret = "postgres://admin:secret@internal/auth";
        let payload = public_rpc_error(
            "rpc.v1.Auth.Users.List",
            &AuthorizationStateError::Storage(secret.to_owned()),
        );
        let encoded = serde_json::to_string(&payload).unwrap();
        assert!(!encoded.contains(secret));
        assert_eq!(payload["type"], "UnexpectedError");
        assert_eq!(payload["context"]["code"], "internal_error");
        let invalid = public_rpc_error(
            "rpc.v1.Auth.DeploymentAuthority.Plan",
            &AuthorizationStateError::InvalidRecord(secret.to_owned()),
        );
        assert_eq!(invalid["type"], "AuthError");
        assert_eq!(invalid["reason"], "invalid_request");
        assert!(!serde_json::to_string(&invalid).unwrap().contains(secret));
    }
}
