use crate::{
    save_admin_session, AdminSessionState, ApprovalEntryRecord, AuthInstallServiceRequest,
    AuthUpgradeServiceContractRequest, AuthenticatedUser, BoundSession, ListApprovalsRequest,
    RenewBindingTokenResponse, RevokeApprovalRequest, ServiceListEntry, TrellisAuthError,
};
use serde::{de::DeserializeOwned, Serialize};
use trellis_client::{TrellisClient, UserConnectOptions};

use crate::protocol::{
    AuthInstallServiceResponse, AuthUpgradeServiceContractResponse, ListApprovalsResponse,
    ListServicesResponse, LogoutResponse, MeResponse, RevokeApprovalResponse,
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
    inner: &'a TrellisClient,
}

impl<'a> AuthClient<'a> {
    /// Wrap an already-connected low-level Trellis client.
    pub fn new(inner: &'a TrellisClient) -> Self {
        Self { inner }
    }

    async fn call<Input, Output>(
        &self,
        subject: &str,
        input: &Input,
    ) -> Result<Output, TrellisAuthError>
    where
        Input: Serialize,
        Output: DeserializeOwned,
    {
        let request = serde_json::to_value(input)?;
        let response = self.inner.request_json_value(subject, &request).await?;
        Ok(serde_json::from_value(response)?)
    }

    /// Return the currently authenticated user.
    pub async fn me(&self) -> Result<AuthenticatedUser, TrellisAuthError> {
        Ok(self
            .call::<_, MeResponse>("rpc.v1.Auth.Me", &Empty {})
            .await?
            .user)
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
        Ok(self
            .call::<_, ListApprovalsResponse>("rpc.v1.Auth.ListApprovals", &request)
            .await?
            .approvals)
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
        Ok(self
            .call::<_, RevokeApprovalResponse>("rpc.v1.Auth.RevokeApproval", &request)
            .await?
            .success)
    }

    /// Install one service contract remotely.
    pub async fn install_service(
        &self,
        input: &AuthInstallServiceRequest,
    ) -> Result<AuthInstallServiceResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.InstallService", input).await
    }

    /// Upgrade one installed service contract remotely.
    pub async fn upgrade_service_contract(
        &self,
        input: &AuthUpgradeServiceContractRequest,
    ) -> Result<AuthUpgradeServiceContractResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.UpgradeServiceContract", input).await
    }

    /// List installed services.
    pub async fn list_services(&self) -> Result<Vec<ServiceListEntry>, TrellisAuthError> {
        Ok(self
            .call::<_, ListServicesResponse>("rpc.v1.Auth.ListServices", &Empty {})
            .await?
            .services)
    }

    /// Log out the current admin session remotely.
    pub async fn logout(&self) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, LogoutResponse>("rpc.v1.Auth.Logout", &Empty {})
            .await?
            .success)
    }

    /// Mint and persist a fresh binding token for the current session.
    pub async fn renew_binding_token(
        &self,
        state: &mut AdminSessionState,
    ) -> Result<(), TrellisAuthError> {
        persist_renewed_admin_session(
            state,
            self.call("rpc.v1.Auth.RenewBindingToken", &Empty {})
                .await?,
        )
    }
}

#[derive(Debug, Serialize)]
struct Empty {}
