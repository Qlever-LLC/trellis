---
title: Auth Rust API
description: Rust service and CLI auth helpers for session keys, bind flows, reconnect, and auth clients.
order: 50
---

# Design: Auth Rust API

## Prerequisites

- [trellis-auth.md](./trellis-auth.md) - auth architecture and flow model
- [auth-protocol.md](./auth-protocol.md) - proof and connect token rules
- [auth-api.md](./auth-api.md) - public HTTP and RPC endpoints
- [../core/type-system-patterns.md](./../core/type-system-patterns.md) - Result and error-model guidance

## Scope

This document defines the normative Rust public API surface for Trellis auth.

It covers:

- service and CLI session-key helpers
- bind and reconnect helpers
- device activation helpers
- auth/admin client surfaces

## Design Rules

- Rust returns `Result` directly rather than exception-oriented helpers
- service and CLI auth use the same underlying session-key proof protocol as browser clients
- public Rust APIs hide signature domain strings and token-envelope formatting

## Session Key Surface

```rust
pub trait SessionKeyHandle {
    fn public_key(&self) -> &str;
}

pub async fn load_session_key_from_seed(
    seed: &str,
) -> Result<impl SessionKeyHandle, AuthError>;
```

## Bind And Connect Helpers

```rust
pub struct BindSessionOptions {
    pub auth_url: String,
}

pub struct BindSessionResult {
    pub binding_token: String,
    pub inbox_prefix: String,
    pub expires: String,
    pub sentinel: SentinelCreds,
    pub nats_servers: Vec<String>,
}

pub struct NatsConnectOptions {
    pub token: String,
    pub inbox_prefix: String,
}

pub async fn bind_session(
    options: &BindSessionOptions,
    handle: &impl SessionKeyHandle,
    auth_token: &str,
) -> Result<BindSessionResult, AuthError>;

pub async fn nats_connect_sig_for_binding_token(
    handle: &impl SessionKeyHandle,
    binding_token: &str,
) -> Result<String, AuthError>;

pub async fn nats_connect_options_for_service(
    handle: &impl SessionKeyHandle,
) -> Result<NatsConnectOptions, AuthError>;
```

## Auth Client Surface

```rust
pub struct RequestDeviceActivationInput {
    pub handoff_id: String,
    pub requested_profile_id: Option<String>,
}

pub struct RequestDeviceActivationProgress {
    pub stage: String,
}

pub struct RequestDeviceActivationOutput {
    pub request_id: String,
    pub profile_id: String,
    pub confirmation_code: String,
}

pub struct WaitForDeviceActivationCodeInput {
    pub device_id: String,
    pub runtime_public_key: String,
    pub nonce: String,
}

pub trait DeviceRuntimeKeyHandle {
    fn public_key(&self) -> &str;
    async fn sign(&self, input: &[u8]) -> Result<String, AuthError>;
}

pub enum WaitForDeviceActivationCodeResponse {
    Approved {
        request_id: String,
        profile_id: String,
        confirmation_code: String,
    },
    Rejected {
        request_id: String,
        reason: Option<String>,
    },
    Pending,
}

pub trait AuthClient {
    async fn me(&self) -> Result<AuthMeResponse, AuthError>;
    async fn logout(&self) -> Result<SuccessResponse, AuthError>;
    async fn renew_binding_token(&self) -> Result<RenewBindingTokenResponse, AuthError>;
    async fn request_device_activation(
        &self,
        input: RequestDeviceActivationInput,
    ) -> Result<OperationRef<RequestDeviceActivationProgress, RequestDeviceActivationOutput>, AuthError>;
}

pub trait AuthAdminClient {
    async fn review_device_activation(&self, input: ReviewDeviceActivationRequest) -> Result<ReviewDeviceActivationResponse, AuthError>;
    async fn create_device_onboarding_handler(&self, input: CreateDeviceOnboardingHandlerRequest) -> Result<CreateDeviceOnboardingHandlerResponse, AuthError>;
    async fn list_device_onboarding_handlers(&self, input: ListDeviceOnboardingHandlersRequest) -> Result<ListDeviceOnboardingHandlersResponse, AuthError>;
    async fn disable_device_onboarding_handler(&self, input: DisableDeviceOnboardingHandlerRequest) -> Result<SuccessResponse, AuthError>;
    async fn create_device_profile(&self, input: CreateDeviceProfileRequest) -> Result<CreateDeviceProfileResponse, AuthError>;
    async fn list_device_profiles(&self, input: ListDeviceProfilesRequest) -> Result<ListDeviceProfilesResponse, AuthError>;
    async fn get_device_profile(&self, input: GetDeviceProfileRequest) -> Result<GetDeviceProfileResponse, AuthError>;
    async fn disable_device_profile(&self, input: DisableDeviceProfileRequest) -> Result<SuccessResponse, AuthError>;
    async fn list_device_activations(&self, input: ListDeviceActivationsRequest) -> Result<ListDeviceActivationsResponse, AuthError>;
    async fn revoke_device_activation(&self, input: RevokeDeviceActivationRequest) -> Result<SuccessResponse, AuthError>;
    async fn list_approvals(&self, input: ListApprovalsRequest) -> Result<ListApprovalsResponse, AuthError>;
    async fn revoke_approval(&self, input: RevokeApprovalRequest) -> Result<SuccessResponse, AuthError>;
    async fn list_sessions(&self, input: ListSessionsRequest) -> Result<ListSessionsResponse, AuthError>;
    async fn revoke_session(&self, input: RevokeSessionRequest) -> Result<SuccessResponse, AuthError>;
    async fn list_connections(&self, input: ListConnectionsRequest) -> Result<ListConnectionsResponse, AuthError>;
    async fn kick_connection(&self, input: KickConnectionRequest) -> Result<SuccessResponse, AuthError>;
}

pub trait DeviceActivationClient {
    async fn wait_for_device_activation_code(
        &self,
        input: WaitForDeviceActivationCodeInput,
        handle: &impl DeviceRuntimeKeyHandle,
    ) -> Result<WaitForDeviceActivationCodeResponse, AuthError>;
}
```

Shared request and response type names such as `ReviewDeviceActivationRequest`, `ReviewDeviceActivationResponse`, `RequestDeviceActivationOutput`, `WaitForDeviceActivationCodeResponse`, the onboarding handler request/response types, and the device profile request/response types are defined canonically in [auth-api.md](./auth-api.md).

Rules:

- `request_device_activation(...)` starts `operations.v1.Auth.RequestDeviceActivation` and returns an `OperationRef`
- `wait_for_device_activation_code(...)` targets `POST /auth/device/activate/wait` and signs with the device runtime key rather than a user session key
- public Rust APIs SHOULD expose typed request and response structs or enums rather than `serde_json::Value` in normal flows

## Service Helper Surface

```rust
pub struct AuthHandle {
    // opaque
}

impl AuthHandle {
    pub async fn nats_connect_options(&self) -> Result<NatsConnectOptions, AuthError>;
}

pub async fn create_auth(session_key_seed: &str) -> Result<AuthHandle, AuthError>;
```

Example:

```rust
let auth = create_auth(&config.session_key_seed).await?;
let connect = auth.nats_connect_options().await?;

let nc = nats::ConnectOptions::with_token(connect.token)
    .inbox_prefix(connect.inbox_prefix)
    .connect(&config.nats_servers)
    .await?;
```

## Non-Goals

- redefining HTTP or RPC payload schemas
- defining TypeScript APIs
- deployment/runbook guidance
