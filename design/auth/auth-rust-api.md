---
title: Auth Rust API
description: Rust CLI and client auth helpers for browser login, admin sessions, typed auth/admin RPC access, and device activation.
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
- device activation helpers
- portal and selection invariants

## Design Rules

- Rust returns `Result` directly rather than exception-oriented helpers
- public Rust APIs hide proof-string construction and token-envelope formatting
- browser login helpers may run a local callback listener, but normal callers do not deal with callback HTTP parsing directly

## Exported Surface

```rust
pub fn generate_session_keypair() -> (String, String);

pub async fn start_admin_reauth(
    state: &AdminSessionState,
    listen: &str,
    contract_json: &str,
) -> Result<AdminReauthOutcome, TrellisAuthError>;

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
    renewed: RenewBindingTokenBoundResponse,
) -> Result<(), TrellisAuthError>;

pub fn save_admin_session(state: &AdminSessionState) -> Result<(), TrellisAuthError>;
pub fn load_admin_session() -> Result<AdminSessionState, TrellisAuthError>;
pub fn clear_admin_session() -> Result<bool, TrellisAuthError>;

pub struct AuthClient<'a> { /* opaque */ }
```

The crate also re-exports the typed request and response structs from `protocol.rs` and the public session/login models from `models.rs`.

## Browser Login Flow

The Rust browser-login flow uses the same auth-owned `flowId` continuation model as
the TypeScript browser helpers. Device activation now uses the same public
`flowId` concept with `kind: "device_activation"` auth flows and is documented
in the device-activation surfaces rather than in this browser-login flow.

Flow summary:

1. `start_browser_login(...)` generates a session keypair, signs the login init proof, and starts a local callback listener.
2. `start_browser_login(...)` starts the auth request through `POST /auth/requests` and returns a `BrowserLoginChallenge` when browser interaction is required.
3. `BrowserLoginChallenge::login_url()` returns the auth login URL to open in a browser.
4. The callback returns `flowId` or `authError` to the local listener.
5. `BrowserLoginChallenge::complete()` binds that flow through the auth-owned flow endpoint and returns an `AdminLoginOutcome`.

`start_admin_reauth(...)` reuses the stored session key for contract-changed
reauth. It returns `AdminReauthOutcome::Bound(...)` when auth can auto-approve
the new contract immediately, or `AdminReauthOutcome::Flow(...)` when the CLI
must continue through the normal browser flow.

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

    pub async fn get_device_portal_default(&self) -> Result<AuthGetDevicePortalDefaultResponseDefaultPortal, TrellisAuthError>;
    pub async fn set_device_portal_default(
        &self,
        portal_id: Option<&str>,
    ) -> Result<AuthSetDevicePortalDefaultResponseDefaultPortal, TrellisAuthError>;

    pub async fn list_device_portal_selections(&self) -> Result<Vec<AuthListDevicePortalSelectionsResponseSelectionsItem>, TrellisAuthError>;
    pub async fn set_device_portal_selection(
        &self,
        profile_id: &str,
        portal_id: Option<&str>,
    ) -> Result<AuthSetDevicePortalSelectionResponseSelection, TrellisAuthError>;
    pub async fn clear_device_portal_selection(&self, profile_id: &str) -> Result<bool, TrellisAuthError>;

    pub async fn list_device_profiles(
        &self,
        contract_id: Option<&str>,
        disabled: bool,
    ) -> Result<Vec<AuthListDeviceProfilesResponseProfilesItem>, TrellisAuthError>;
    pub async fn create_device_profile(
        &self,
        profile_id: &str,
        contract_id: &str,
        allow_digests: &[String],
        review_mode: Option<&str>,
    ) -> Result<AuthCreateDeviceProfileResponseProfile, TrellisAuthError>;
    pub async fn disable_device_profile(
        &self,
        profile_id: &str,
    ) -> Result<bool, TrellisAuthError>;

    pub async fn provision_device_instance(
        &self,
        profile_id: &str,
        public_identity_key: &str,
        activation_key: &str,
        metadata: Option<BTreeMap<String, String>>,
    ) -> Result<AuthProvisionDeviceInstanceResponseInstance, TrellisAuthError>;
    pub async fn list_device_instances(
        &self,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<AuthListDeviceInstancesResponseInstancesItem>, TrellisAuthError>;
    pub async fn disable_device_instance(&self, instance_id: &str) -> Result<bool, TrellisAuthError>;

    pub async fn activate_device(
        &self,
        flow_id: &str,
    ) -> Result<trellis_sdk_auth::AuthActivateDeviceResponse, TrellisAuthError>;
    pub async fn get_device_activation_status(
        &self,
        flow_id: &str,
    ) -> Result<trellis_sdk_auth::AuthGetDeviceActivationStatusResponse, TrellisAuthError>;
    pub async fn list_device_activations(
        &self,
        instance_id: Option<&str>,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceActivationsResponseActivationsItem>, TrellisAuthError>;
    pub async fn revoke_device_activation(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError>;
    pub async fn list_device_activation_reviews(
        &self,
        instance_id: Option<&str>,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceActivationReviewsResponseReviewsItem>, TrellisAuthError>;
    pub async fn decide_device_activation_review(
        &self,
        review_id: &str,
        decision: &str,
        reason: Option<&str>,
    ) -> Result<trellis_sdk_auth::AuthDecideDeviceActivationReviewResponse, TrellisAuthError>;

    pub async fn list_service_profiles(
        &self,
    ) -> Result<Vec<trellis_sdk_auth::AuthListServiceProfilesResponseProfilesItem>, TrellisAuthError>;
    pub async fn create_service_profile(
        &self,
        request: &trellis_sdk_auth::AuthCreateServiceProfileRequest,
    ) -> Result<trellis_sdk_auth::AuthCreateServiceProfileResponse, TrellisAuthError>;
    pub async fn apply_service_profile_contract(
        &self,
        request: &trellis_sdk_auth::AuthApplyServiceProfileContractRequest,
    ) -> Result<trellis_sdk_auth::AuthApplyServiceProfileContractResponse, TrellisAuthError>;
    pub async fn unapply_service_profile_contract(
        &self,
        request: &trellis_sdk_auth::AuthUnapplyServiceProfileContractRequest,
    ) -> Result<trellis_sdk_auth::AuthUnapplyServiceProfileContractResponse, TrellisAuthError>;
    pub async fn disable_service_profile(
        &self,
        profile_id: &str,
    ) -> Result<trellis_sdk_auth::AuthDisableServiceProfileResponse, TrellisAuthError>;
    pub async fn enable_service_profile(
        &self,
        profile_id: &str,
    ) -> Result<trellis_sdk_auth::AuthEnableServiceProfileResponse, TrellisAuthError>;
    pub async fn remove_service_profile(
        &self,
        profile_id: &str,
    ) -> Result<bool, TrellisAuthError>;
    pub async fn list_service_instances(
        &self,
        instance_id: Option<&str>,
        profile_id: Option<&str>,
        disabled: Option<bool>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListServiceInstancesResponseInstancesItem>, TrellisAuthError>;
    pub async fn provision_service_instance(
        &self,
        request: &trellis_sdk_auth::AuthProvisionServiceInstanceRequest,
    ) -> Result<trellis_sdk_auth::AuthProvisionServiceInstanceResponse, TrellisAuthError>;
    pub async fn disable_service_instance(
        &self,
        instance_id: &str,
    ) -> Result<trellis_sdk_auth::AuthDisableServiceInstanceResponse, TrellisAuthError>;
    pub async fn enable_service_instance(
        &self,
        instance_id: &str,
    ) -> Result<trellis_sdk_auth::AuthEnableServiceInstanceResponse, TrellisAuthError>;
    pub async fn remove_service_instance(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError>;
    pub async fn get_installed_contract(
        &self,
        digest: &str,
    ) -> Result<AuthGetInstalledContractResponse, TrellisAuthError>;

    pub async fn logout(&self) -> Result<bool, TrellisAuthError>;
    pub async fn renew_binding_token(
        &self,
        state: &mut AdminSessionState,
        contract_digest: &str,
    ) -> Result<RenewBindingTokenResponse, TrellisAuthError>;
    pub async fn validate_request(
        &self,
        request: &AuthValidateRequestRequest,
    ) -> Result<AuthValidateRequestResponse, TrellisAuthError>;
}

## Device Activation Helpers

```rust
pub fn derive_device_identity(device_root_secret: &[u8]) -> Result<DeviceIdentity, TrellisAuthError>;

pub fn build_device_activation_payload(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
) -> Result<DeviceActivationPayload, TrellisAuthError>;

pub fn build_device_activation_url(
    trellis_url: &str,
    payload: &DeviceActivationPayload,
) -> Result<String, TrellisAuthError>;

pub fn sign_device_wait_request(
    public_identity_key: &str,
    nonce: &str,
    identity_seed_base64url: &str,
    iat: u64,
) -> Result<DeviceActivationWaitRequest, TrellisAuthError>;

pub async fn wait_for_device_activation(
    trellis_url: &str,
    request: &DeviceActivationWaitRequest,
) -> Result<WaitForDeviceActivationResponse, TrellisAuthError>;

pub async fn get_device_connect_info(
    opts: GetDeviceConnectInfoOpts<'_>,
) -> Result<GetDeviceConnectInfoResponse, TrellisAuthError>;

pub fn verify_device_confirmation_code(
    activation_key_base64url: &str,
    public_identity_key: &str,
    nonce: &str,
    confirmation_code: &str,
) -> Result<bool, TrellisAuthError>;
```

Rules:

- Rust activated-device code SHOULD use these helpers instead of hand-written HKDF, HMAC, wait-proof, and connect-info logic
- `AuthClient` SHOULD expose small typed device-activation convenience methods in addition to the lower-level generated SDK surfaces
- a future Rust device runtime helper SHOULD follow the same service-style `connect(...)` pattern as the TypeScript device runtime helper rather than exposing a docs-only activation facade
- these helpers remain thin wrappers over the same public auth HTTP and RPC
  surfaces defined elsewhere

## Portal And Selection Invariants

The built-in Trellis portal is implicit and always available. The crate only manages custom portal records plus login/device portal selection policy.

Rules enforced by the crate:

- custom portals may include `app_contract_id`, but they do not require one unless they later call Trellis as the logged-in user
- login portal selections are keyed by `contract_id`
- device portal selections are keyed by `profile_id`
- selection records may use `portal_id = null` to force the built-in Trellis portal for that scope
- selection records that name a custom portal must reference an existing enabled portal

## Non-Goals

- redefining HTTP or RPC payload schemas
- deployment/runbook guidance
