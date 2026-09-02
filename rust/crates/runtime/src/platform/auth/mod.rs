//! Rust-owned authorization state and deterministic authority materialization.
//!
//! This module is the platform-internal ownership boundary for principals,
//! provider identities, sessions, exact participant bindings, desired identity
//! and deployment authority, runtime evidence, materialized authority, and the
//! unsigned state consumed by later authorization-context issuance.
//!
//! Desired authority records an accepted decision. Materialized authority is a
//! separate fail-closed projection of that decision against authority-scoped
//! participant, dependency, resource, and deployment evidence. Session,
//! instance, and activation eligibility is checked only during issuance. Exact
//! permissions remain [`trellis_protocol::GrantSet`] values; platform
//! capabilities never expand those permissions.
//!
//! Context signing, public auth/bootstrap routes, and transport admission are
//! implemented inside this module and composed by the platform runtime.

mod account;
mod application;
mod authority;
mod builtins;
pub(crate) mod context;
mod domain;
mod ephemeral;
mod http;

pub(crate) const DEVICE_ACTIVATION_REVIEW_TTL_MS: i64 = 15 * 60_000;
pub(super) use builtins::{auth_runtime_participant_binding, cli_participant_binding};
pub(crate) use ephemeral::{
    validate_connection_kick_response, AuthConnectionPresence, AuthEphemeralRepository,
    NatsAuthEphemeralRepository,
};
pub(super) use http::{
    discover_oidc_providers, router as auth_http_router, AuthHttpOptions, NatsBootstrapIssuer,
};
mod issuance;
mod materializer;
mod model;
mod policy;
mod portal_reconciliation;
mod reconciliation;
mod resources;
pub(crate) mod rpc;
mod sqlite;
mod transport;
pub(crate) mod verifier;

pub(super) use resources::{
    ensure_authority_dependencies, ensure_deployment_resources, ensure_identity_resources,
};
#[cfg(test)]
pub(super) use transport::compile_test_transport_permissions;
pub(super) use transport::{compile_transport_permissions, TransportPermissions};

#[cfg(test)]
mod artifact_tests;
#[cfg(test)]
mod tests;

pub(crate) use application::repository::IdempotentOutcome;
pub(crate) use application::repository::{
    AccountCreation, AccountFlowCreation, AccountRepository, ActivationReviewClaim,
    ActivationReviewCreation, ActivationReviewDecision, AuthorityProposalCreation,
    AuthorityProposalDecision, DeploymentProfileCreation, DeploymentProfileMutation,
    DeploymentRepository, DeviceDelegationMutation, DeviceProvisioning,
    DeviceProvisioningSecretConsumption, FirstAdminCompletion, IdentityLinkCompletion,
    LocalLoginAttempt, LoginPortalMutation, OutboxRepository, PasswordChange,
    PasswordResetCompletion, PortalRepository, PortalRouteMutation, PortalRouteRemoval,
    ProviderIdentityUnlink, ProvisionedInstanceMutation, ProvisioningRepository,
    ServiceIdentityProvisioning, SessionCreation, SessionRepository, SessionRevocation,
    UserAccountMutation,
};
pub(crate) use application::validation::validate_login_portal;
pub(crate) use application::{
    ApplyIdentityAuthoritySelectionInput, AuthService, AuthServiceConfig, ChangePasswordInput,
    ClaimActivationReviewInput, CompleteIdentityLinkInput, CompletePasswordResetInput,
    CreateAccountFlowInput, CreateActivationReviewInput, CreateAuthorityProposalInput,
    CreateFederatedUserInput, CreateLocalUserInput, CreateSessionInput, CreateUserInput,
    DecideActivationReviewInput, DecideAuthorityProposalInput, EnrollDeviceIdentityInput,
    FirstAdminAuthorityTarget, FirstAdminFederatedRegistration, FirstAdminRegistration,
    LocalAuthentication, PortalAuthoritySource, PortalBindingMutation, PortalPolicySnapshot,
    PresentDeploymentAuthorityInput, ProvisionDeviceInput, ProvisionServiceIdentityInput,
    UpdateUserInput, UserAccount,
};
pub(crate) use authority::MaterializationReplacement;
pub(crate) use authority::{
    validate_deployment_evidence, validate_principal, validate_resource_evidence,
    validate_runtime_instance,
};
pub(crate) use authority::{
    ActiveProviderEvidence, AuthorityEvidenceRepository, AuthorityRepository, ContextRepository,
};
pub(crate) use context::{
    AuthorizationContextBundle, AuthorizationContextIssueRequest, AuthorizationContextService,
    AuthorizationRegistryBinding,
};
pub use domain::{
    AuthorityDecision, AuthorityEvidenceScope, AuthorityKind, AuthorityState, AuthorityTarget,
    AuthorizationStateError, AuthorizationTransition, AuthorizationTransitionKind,
    AuthorizationTransitionOutboxRecord, DelegationEvidence, DependencyEvidence, DependencyState,
    DeploymentAuthorityRecord, DeploymentRecord, DesiredAuthorityRecord, DeviceDelegationRecord,
    DeviceDelegationState, DeviceEvidence, DeviceRecord, DeviceState, IdentityAuthorityRecord,
    IssuableAuthorizationState, MaterializationState, MaterializedAuthorityRecord, NewSession,
    ParticipantBindingRecord, ParticipantBindingState, PrincipalKind, PrincipalRecord,
    PrincipalState, ProviderIdentityLink, ResourceBindingEvidence, ResourceBindingState,
    ResourceProviderIdentity, RuntimeEvidence, RuntimeInstanceRecord, RuntimeInstanceState,
    ServiceEvidence, SessionRecord, SessionRuntimeBinding, SessionState, MAX_PROTOCOL_INTEGER,
};
pub(crate) use issuance::AuthorizationStateService;
pub(crate) use model::{
    activation_review_event, activation_review_event_action_id, deployment_authority_id,
};
pub use model::{
    AccountFlowKind, AccountFlowRecord, AccountFlowState, AuthorityDecisionOutcome,
    AuthorityDecisionRecord, AuthorityProposalKind, AuthorityProposalRecord,
    AuthorityProposalState, CapabilityGroupRecord, DeploymentProfileRecord, DeploymentProfileState,
    DeviceActivationReviewRecord, DeviceActivationReviewState, DeviceProvisioningSecretRecord,
    DeviceReviewMode, IdempotencyResultRecord, LocalCredentialRecord, LoginPortalRecord,
    LoginSettingsRecord, PortalAuthorityBindingRecord, PortalGrantOverrideRecord,
    PortalRoleMapping, PortalRouteRecord, PostCommitActionKind, PostCommitActionRecord,
    ProvisionedIdentityKind, ProvisionedIdentityRecord, ProvisionedIdentityState,
    ProvisioningSecretState, UserProfileRecord,
};
pub(crate) use policy::{
    browser_consent_proposal, portal_policy_snapshot, resolve_portal_authority_selection,
    ProviderLoginAttributes,
};
pub(crate) use portal_reconciliation::{
    portal_policy_reconciliation, PortalPolicyReconciliationHandle,
};
pub(crate) use reconciliation::authorization_reconciliation_channel;
pub use reconciliation::{AuthorizationReconciliationHandle, ReconciliationCause};
pub use sqlite::SqliteAuthorizationStore;
