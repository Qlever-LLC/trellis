---
title: Auth Rust API
description: Rust CLI and client auth helpers for browser login, admin sessions, typed auth/admin RPC access, and workload activation.
order: 50
---

# Design: Auth Rust API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and flow model
- [auth-protocol.md](./auth-protocol.md) - proof and connect token rules
- [auth-api.md](./auth-api.md) - public HTTP and RPC endpoints
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result and error-model guidance

## Scope

This document defines the normative Rust public API surface for the `trellis-auth` crate.

It covers:

- browser-login helpers used by the CLI
- persisted admin session helpers
- typed auth/admin RPC access through `AuthClient`
- workload activation helpers
- portal and selection invariants

## Design Rules

- Rust returns `Result` directly rather than exception-oriented helpers
- public Rust APIs hide proof-string construction and token-envelope formatting
- browser login helpers may run a local callback listener, but normal callers do not deal with callback HTTP parsing directly

## Exported Surface

```rust
pub fn generate_session_keypair() -> (String, String);

pub fn build_auth_login_url(
    auth_url: &str,
    redirect_to: &str,
    auth: &SessionAuth,
    contract_json: &str,
) -> Result<String, TrellisAuthError>;

pub async fn start_browser_login(
    opts: StartBrowserLoginOpts<'_>,
) -> Result<BrowserLoginChallenge, TrellisAuthError>;

impl BrowserLoginChallenge {
    pub fn login_url(&self) -> &str;
    pub async fn complete(self) -> Result<AdminLoginOutcome, TrellisAuthError>;
}

pub async fn connect_admin_client_async(
    state: &AdminSessionState,
) -> Result<TrellisClient, TrellisAuthError>;

pub fn persist_renewed_admin_session(
    state: &mut AdminSessionState,
    renewed: RenewBindingTokenResponse,
) -> Result<(), TrellisAuthError>;

pub fn save_admin_session(state: &AdminSessionState) -> Result<(), TrellisAuthError>;
pub fn load_admin_session() -> Result<AdminSessionState, TrellisAuthError>;
pub fn clear_admin_session() -> Result<bool, TrellisAuthError>;

pub struct AuthClient<'a> { /* opaque */ }
```

The crate also re-exports the typed request and response structs from `protocol.rs` and the public session/login models from `models.rs`.

## Browser Login Flow

The Rust browser-login flow uses the same auth-owned `flowId` continuation model as
the TypeScript browser helpers.

Flow summary:

1. `start_browser_login(...)` generates a session keypair, signs the login init proof, and starts a local callback listener.
2. `BrowserLoginChallenge::login_url()` returns the auth login URL to open in a browser.
3. The callback returns `flowId` or `authError` to the local listener.
4. `BrowserLoginChallenge::complete()` binds that flow through the auth-owned flow endpoint and returns an `AdminLoginOutcome`.

## Admin RPC Surface

```rust
impl<'a> AuthClient<'a> {
    pub fn new(inner: &'a TrellisClient) -> Self;

    pub async fn me(&self) -> Result<AuthenticatedUser, TrellisAuthError>;
    pub async fn list_approvals(
        &self,
        user: Option<&str>,
        digest: Option<&str>,
    ) -> Result<Vec<ApprovalEntryRecord>, TrellisAuthError>;
    pub async fn revoke_approval(
        &self,
        digest: &str,
        user: Option<&str>,
    ) -> Result<bool, TrellisAuthError>;

    pub async fn list_portals(&self) -> Result<Vec<AuthListPortalsResponsePortalsItem>, TrellisAuthError>;
    pub async fn create_portal(
        &self,
        portal_id: &str,
        app_contract_id: Option<&str>,
        entry_url: &str,
    ) -> Result<AuthCreatePortalResponsePortal, TrellisAuthError>;
    pub async fn disable_portal(&self, portal_id: &str) -> Result<bool, TrellisAuthError>;

    pub async fn get_login_portal_default(&self) -> Result<AuthGetLoginPortalDefaultResponseDefaultPortal, TrellisAuthError>;
    pub async fn set_login_portal_default(
        &self,
        portal_id: Option<&str>,
    ) -> Result<AuthSetLoginPortalDefaultResponseDefaultPortal, TrellisAuthError>;

    pub async fn list_login_portal_selections(&self) -> Result<Vec<AuthListLoginPortalSelectionsResponseSelectionsItem>, TrellisAuthError>;
    pub async fn set_login_portal_selection(
        &self,
        contract_id: &str,
        portal_id: Option<&str>,
    ) -> Result<AuthSetLoginPortalSelectionResponseSelection, TrellisAuthError>;
    pub async fn clear_login_portal_selection(&self, contract_id: &str) -> Result<bool, TrellisAuthError>;

    pub async fn get_workload_portal_default(&self) -> Result<AuthGetWorkloadPortalDefaultResponseDefaultPortal, TrellisAuthError>;
    pub async fn set_workload_portal_default(
        &self,
        portal_id: Option<&str>,
    ) -> Result<AuthSetWorkloadPortalDefaultResponseDefaultPortal, TrellisAuthError>;

    pub async fn list_workload_portal_selections(&self) -> Result<Vec<AuthListWorkloadPortalSelectionsResponseSelectionsItem>, TrellisAuthError>;
    pub async fn set_workload_portal_selection(
        &self,
        profile_id: &str,
        portal_id: Option<&str>,
    ) -> Result<AuthSetWorkloadPortalSelectionResponseSelection, TrellisAuthError>;
    pub async fn clear_workload_portal_selection(&self, profile_id: &str) -> Result<bool, TrellisAuthError>;

    pub async fn list_workload_profiles(
        &self,
        contract_id: Option<&str>,
        disabled: bool,
    ) -> Result<Vec<AuthListWorkloadProfilesResponseProfilesItem>, TrellisAuthError>;
    pub async fn create_workload_profile(
        &self,
        profile_id: &str,
        contract_id: &str,
        allow_digests: &[String],
        review_mode: Option<&str>,
    ) -> Result<AuthCreateWorkloadProfileResponseProfile, TrellisAuthError>;
    pub async fn disable_workload_profile(
        &self,
        profile_id: &str,
    ) -> Result<bool, TrellisAuthError>;

    pub async fn provision_workload_instance(
        &self,
        profile_id: &str,
        public_identity_key: &str,
        activation_key: &str,
    ) -> Result<AuthProvisionWorkloadInstanceResponseInstance, TrellisAuthError>;
    pub async fn list_workload_instances(
        &self,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<AuthListWorkloadInstancesResponseInstancesItem>, TrellisAuthError>;
    pub async fn disable_workload_instance(&self, instance_id: &str) -> Result<bool, TrellisAuthError>;

    pub async fn activate_workload(
        &self,
        handoff_id: &str,
    ) -> Result<trellis_sdk_auth::AuthActivateWorkloadResponse, TrellisAuthError>;
    pub async fn get_workload_activation_status(
        &self,
        handoff_id: &str,
    ) -> Result<trellis_sdk_auth::AuthGetWorkloadActivationStatusResponse, TrellisAuthError>;
    pub async fn list_workload_activations(
        &self,
        instance_id: Option<&str>,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListWorkloadActivationsResponseActivationsItem>, TrellisAuthError>;
    pub async fn revoke_workload_activation(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError>;
    pub async fn list_workload_activation_reviews(
        &self,
        instance_id: Option<&str>,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListWorkloadActivationReviewsResponseReviewsItem>, TrellisAuthError>;
    pub async fn decide_workload_activation_review(
        &self,
        review_id: &str,
        decision: &str,
        reason: Option<&str>,
    ) -> Result<trellis_sdk_auth::AuthDecideWorkloadActivationReviewResponse, TrellisAuthError>;

    pub async fn list_services(&self) -> Result<Vec<ServiceListEntry>, TrellisAuthError>;
    pub async fn install_service(
        &self,
        request: &AuthInstallServiceRequest,
    ) -> Result<AuthInstallServiceResponse, TrellisAuthError>;
    pub async fn upgrade_service_contract(
        &self,
        request: &AuthUpgradeServiceContractRequest,
    ) -> Result<AuthUpgradeServiceContractResponse, TrellisAuthError>;
    pub async fn get_installed_contract(
        &self,
        digest: &str,
    ) -> Result<AuthGetInstalledContractResponse, TrellisAuthError>;

    pub async fn logout(&self) -> Result<bool, TrellisAuthError>;
    pub async fn renew_binding_token(
        &self,
        state: &mut AdminSessionState,
    ) -> Result<(), TrellisAuthError>;
    pub async fn validate_request(
        &self,
        request: &AuthValidateRequestRequest,
    ) -> Result<AuthValidateRequestResponse, TrellisAuthError>;
}

## Workload Activation Helpers

```rust
pub fn derive_workload_identity(workload_root_secret: &[u8]) -> Result<WorkloadIdentity, TrellisAuthError>;

pub fn build_workload_activation_payload(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
) -> Result<WorkloadActivationPayload, TrellisAuthError>;

pub fn build_workload_activation_url(
    trellis_url: &str,
    payload: &WorkloadActivationPayload,
) -> Result<String, TrellisAuthError>;

pub fn sign_workload_wait_request(
    public_identity_key: &str,
    nonce: &str,
    identity_seed_base64url: &str,
    iat: u64,
) -> Result<WorkloadActivationWaitRequest, TrellisAuthError>;

pub async fn wait_for_workload_activation(
    trellis_url: &str,
    request: &WorkloadActivationWaitRequest,
) -> Result<WaitForWorkloadActivationResponse, TrellisAuthError>;

pub async fn get_workload_connect_info(
    opts: GetWorkloadConnectInfoOpts<'_>,
) -> Result<GetWorkloadConnectInfoResponse, TrellisAuthError>;

pub fn verify_workload_confirmation_code(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
    confirmation_code: &str,
) -> Result<bool, TrellisAuthError>;
```

Rules:

- Rust activated-workload code SHOULD use these helpers instead of hand-written HKDF, HMAC, wait-proof, and connect-info logic
- `AuthClient` SHOULD expose small typed workload-activation convenience methods in addition to the lower-level generated SDK surfaces
- a future Rust workload runtime helper SHOULD follow the same service-style `connect(...)` pattern as the TypeScript workload runtime helper rather than exposing a docs-only activation facade
- these helpers remain thin wrappers over the same public auth HTTP and RPC
  surfaces defined elsewhere

## Portal And Selection Invariants

The built-in Trellis portal is implicit and always available. The crate only manages custom portal records plus login/workload portal selection policy.

Rules enforced by the crate:

- custom portals may include `app_contract_id`, but they do not require one unless they later call Trellis as the logged-in user
- login portal selections are keyed by `contract_id`
- workload portal selections are keyed by `profile_id`
- selection records may use `portal_id = null` to force the built-in Trellis portal for that scope
- selection records that name a custom portal must reference an existing enabled portal

## Non-Goals

- redefining HTTP or RPC payload schemas
- deployment/runbook guidance
