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

## Design

This document defines the normative Rust public API surface for Trellis auth.

It covers:

- service and CLI session-key helpers
- bind and reconnect helpers
- auth/admin client surfaces

The Rust surface follows the same auth model as the browser helpers, but it leans into Rust-native `Result` return types and keeps the token envelope and signature-domain strings inside the helper functions.

Rust returns `Result` directly rather than exception-oriented helpers.

Service and CLI auth use the same underlying session-key proof protocol as browser clients.

Public Rust APIs hide signature domain strings and token-envelope formatting.

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
pub trait AuthClient {
    async fn me(&self) -> Result<AuthMeResponse, AuthError>;
    async fn logout(&self) -> Result<SuccessResponse, AuthError>;
    async fn renew_binding_token(&self) -> Result<RenewBindingTokenResponse, AuthError>;
}

pub trait AuthAdminClient {
    async fn list_approvals(&self, input: ListApprovalsRequest) -> Result<ListApprovalsResponse, AuthError>;
    async fn revoke_approval(&self, input: RevokeApprovalRequest) -> Result<SuccessResponse, AuthError>;
    async fn list_sessions(&self, input: ListSessionsRequest) -> Result<ListSessionsResponse, AuthError>;
    async fn revoke_session(&self, input: RevokeSessionRequest) -> Result<SuccessResponse, AuthError>;
    async fn list_connections(&self, input: ListConnectionsRequest) -> Result<ListConnectionsResponse, AuthError>;
    async fn kick_connection(&self, input: KickConnectionRequest) -> Result<SuccessResponse, AuthError>;
    async fn create_device_profile(&self, input: CreateDeviceProfileRequest) -> Result<CreateDeviceProfileResponse, AuthError>;
    async fn list_device_profiles(&self, input: ListDeviceProfilesRequest) -> Result<ListDeviceProfilesResponse, AuthError>;
    async fn get_device_profile(&self, input: GetDeviceProfileRequest) -> Result<GetDeviceProfileResponse, AuthError>;
    async fn disable_device_profile(&self, input: DisableDeviceProfileRequest) -> Result<SuccessResponse, AuthError>;
    async fn set_device_profile_preferred_digest(&self, input: SetDeviceProfilePreferredDigestRequest) -> Result<UpdateDeviceProfileResponse, AuthError>;
    async fn add_device_profile_digest(&self, input: AddDeviceProfileDigestRequest) -> Result<UpdateDeviceProfileResponse, AuthError>;
    async fn remove_device_profile_digest(&self, input: RemoveDeviceProfileDigestRequest) -> Result<UpdateDeviceProfileResponse, AuthError>;
    async fn activate_device(&self, input: ActivateDeviceRequest) -> Result<SuccessResponse, AuthError>;
    async fn list_device_activations(&self, input: ListDeviceActivationsRequest) -> Result<ListDeviceActivationsResponse, AuthError>;
    async fn revoke_device_activation(&self, input: RevokeDeviceActivationRequest) -> Result<SuccessResponse, AuthError>;
}
```

The device profile and device activation request, response, and event shapes are defined in [device-activation.md](./device-activation.md).

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
