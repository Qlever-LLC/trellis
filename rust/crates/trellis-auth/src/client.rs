use trellis_client::{TrellisClient, UserConnectOptions};
use trellis_sdk_auth::{
    AuthClient as AuthApiClient, ListApprovalsRequest, RenewBindingTokenResponse,
    RevokeApprovalRequest,
};
use crate::{
    save_admin_session, AdminSessionState, ApprovalEntryRecord, AuthenticatedUser,
    BoundSession, ServiceListEntry, TrellisAuthError,
};

/// Connect an authenticated admin client from the stored session state.
pub async fn connect_admin_client_async(
    state: &AdminSessionState,
) -> Result<TrellisClient, TrellisAuthError> {
    Ok(TrellisClient::connect_user(UserConnectOptions {
        servers: &state.nats_servers,
        sentinel_jwt: &state.sentinel_jwt,
        sentinel_seed: &state.sentinel_seed,
        session_key_seed_base64url: &state.session_seed,
        binding_token: &state.binding_token,
        timeout_ms: 5_000,
    })
    .await?)
}

/// Persist a renewed binding token and sentinel credentials into the admin session state.
pub fn persist_renewed_admin_session(
    state: &mut AdminSessionState,
    renewed: RenewBindingTokenResponse,
) -> Result<(), TrellisAuthError> {
    let renewed = BoundSession {
        binding_token: renewed.binding_token,
        inbox_prefix: renewed.inbox_prefix,
        expires: renewed.expires,
        sentinel: renewed.sentinel,
    };

    state.binding_token = renewed.binding_token;
    state.expires = renewed.expires;
    state.sentinel_jwt = renewed.sentinel.jwt;
    state.sentinel_seed = renewed.sentinel.seed;
    save_admin_session(state)
}

/// Thin typed client for Trellis auth/admin RPCs used by the CLI.
pub struct AuthClient<'a> {
    inner: AuthApiClient<'a>,
}

impl<'a> AuthClient<'a> {
    /// Wrap an already-connected low-level Trellis client.
    pub fn new(inner: &'a TrellisClient) -> Self {
        Self {
            inner: AuthApiClient::new(inner),
        }
    }

    /// Return the currently authenticated user.
    pub async fn me(&self) -> Result<AuthenticatedUser, TrellisAuthError> {
        Ok(self.inner.auth_me().await?.user)
    }

    /// List stored app approval decisions.
    pub async fn list_approvals(
        &self,
        user: Option<&str>,
        digest: Option<&str>,
    ) -> Result<Vec<ApprovalEntryRecord>, TrellisAuthError> {
        let request = ListApprovalsRequest {
            user: user.map(ToOwned::to_owned),
            digest: digest.map(ToOwned::to_owned),
        };
        Ok(self.inner.auth_list_approvals(&request).await?.approvals)
    }

    /// Revoke one stored approval decision.
    pub async fn revoke_approval(
        &self,
        digest: &str,
        user: Option<&str>,
    ) -> Result<bool, TrellisAuthError> {
        let request = RevokeApprovalRequest {
            contract_digest: digest.to_string(),
            user: user.map(ToOwned::to_owned),
        };
        Ok(self.inner.auth_revoke_approval(&request).await?.success)
    }

    /// List installed services.
    pub async fn list_services(&self) -> Result<Vec<ServiceListEntry>, TrellisAuthError> {
        Ok(self.inner.auth_list_services().await?.services)
    }

    /// Log out the current admin session remotely.
    pub async fn logout(&self) -> Result<bool, TrellisAuthError> {
        Ok(self.inner.auth_logout().await?.success)
    }

    /// Mint and persist a fresh binding token for the current session.
    pub async fn renew_binding_token(
        &self,
        state: &mut AdminSessionState,
    ) -> Result<(), TrellisAuthError> {
        persist_renewed_admin_session(state, self.inner.auth_renew_binding_token().await?)
    }
}
