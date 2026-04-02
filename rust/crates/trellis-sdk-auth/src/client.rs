//! Thin typed client helpers for `trellis.auth@v1`.

use trellis_client::TrellisClientError;

/// Typed API wrapper for the `trellis.auth@v1` contract.
pub struct AuthClient<'a> {
    inner: &'a trellis_client::TrellisClient,
}

impl<'a> AuthClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a trellis_client::TrellisClient) -> Self {
        Self { inner }
    }

    /// Call `Auth.GetInstalledContract`.
    pub async fn auth_get_installed_contract(
        &self,
        input: &crate::types::AuthGetInstalledContractRequest,
    ) -> Result<crate::types::AuthGetInstalledContractResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthGetInstalledContractRpc>(input)
            .await
    }

    /// Call `Auth.Health`.
    pub async fn auth_health(
        &self,
    ) -> Result<crate::types::AuthHealthResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthHealthRpc>(&crate::rpc::Empty {})
            .await
    }

    /// Call `Auth.InstallService`.
    pub async fn auth_install_service(
        &self,
        input: &crate::types::AuthInstallServiceRequest,
    ) -> Result<crate::types::AuthInstallServiceResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthInstallServiceRpc>(input)
            .await
    }

    /// Call `Auth.KickConnection`.
    pub async fn auth_kick_connection(
        &self,
        input: &crate::types::AuthKickConnectionRequest,
    ) -> Result<crate::types::AuthKickConnectionResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthKickConnectionRpc>(input)
            .await
    }

    /// Call `Auth.ListApprovals`.
    pub async fn auth_list_approvals(
        &self,
        input: &crate::types::AuthListApprovalsRequest,
    ) -> Result<crate::types::AuthListApprovalsResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthListApprovalsRpc>(input)
            .await
    }

    /// Call `Auth.ListConnections`.
    pub async fn auth_list_connections(
        &self,
        input: &crate::types::AuthListConnectionsRequest,
    ) -> Result<crate::types::AuthListConnectionsResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthListConnectionsRpc>(input)
            .await
    }

    /// Call `Auth.ListInstalledContracts`.
    pub async fn auth_list_installed_contracts(
        &self,
        input: &crate::types::AuthListInstalledContractsRequest,
    ) -> Result<crate::types::AuthListInstalledContractsResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthListInstalledContractsRpc>(input)
            .await
    }

    /// Call `Auth.ListServices`.
    pub async fn auth_list_services(
        &self,
    ) -> Result<crate::types::AuthListServicesResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthListServicesRpc>(&crate::rpc::Empty {})
            .await
    }

    /// Call `Auth.ListSessions`.
    pub async fn auth_list_sessions(
        &self,
        input: &crate::types::AuthListSessionsRequest,
    ) -> Result<crate::types::AuthListSessionsResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthListSessionsRpc>(input)
            .await
    }

    /// Call `Auth.ListUsers`.
    pub async fn auth_list_users(
        &self,
    ) -> Result<crate::types::AuthListUsersResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthListUsersRpc>(&crate::rpc::Empty {})
            .await
    }

    /// Call `Auth.Logout`.
    pub async fn auth_logout(
        &self,
    ) -> Result<crate::types::AuthLogoutResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthLogoutRpc>(&crate::rpc::Empty {})
            .await
    }

    /// Call `Auth.Me`.
    pub async fn auth_me(&self) -> Result<crate::types::AuthMeResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthMeRpc>(&crate::rpc::Empty {})
            .await
    }

    /// Call `Auth.RenewBindingToken`.
    pub async fn auth_renew_binding_token(
        &self,
    ) -> Result<crate::types::AuthRenewBindingTokenResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthRenewBindingTokenRpc>(&crate::rpc::Empty {})
            .await
    }

    /// Call `Auth.RevokeApproval`.
    pub async fn auth_revoke_approval(
        &self,
        input: &crate::types::AuthRevokeApprovalRequest,
    ) -> Result<crate::types::AuthRevokeApprovalResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthRevokeApprovalRpc>(input)
            .await
    }

    /// Call `Auth.RevokeSession`.
    pub async fn auth_revoke_session(
        &self,
        input: &crate::types::AuthRevokeSessionRequest,
    ) -> Result<crate::types::AuthRevokeSessionResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthRevokeSessionRpc>(input)
            .await
    }

    /// Call `Auth.UpdateUser`.
    pub async fn auth_update_user(
        &self,
        input: &crate::types::AuthUpdateUserRequest,
    ) -> Result<crate::types::AuthUpdateUserResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthUpdateUserRpc>(input)
            .await
    }

    /// Call `Auth.UpgradeServiceContract`.
    pub async fn auth_upgrade_service_contract(
        &self,
        input: &crate::types::AuthUpgradeServiceContractRequest,
    ) -> Result<crate::types::AuthUpgradeServiceContractResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthUpgradeServiceContractRpc>(input)
            .await
    }

    /// Call `Auth.ValidateRequest`.
    pub async fn auth_validate_request(
        &self,
        input: &crate::types::AuthValidateRequestRequest,
    ) -> Result<crate::types::AuthValidateRequestResponse, TrellisClientError> {
        self.inner
            .call::<crate::rpc::AuthValidateRequestRpc>(input)
            .await
    }

    /// Publish `Auth.Connect`.
    pub async fn publish_auth_connect(
        &self,
        event: &crate::types::AuthConnectEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<crate::events::AuthConnectEventDescriptor>(event)
            .await
    }

    /// Publish `Auth.ConnectionKicked`.
    pub async fn publish_auth_connection_kicked(
        &self,
        event: &crate::types::AuthConnectionKickedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<crate::events::AuthConnectionKickedEventDescriptor>(event)
            .await
    }

    /// Publish `Auth.Disconnect`.
    pub async fn publish_auth_disconnect(
        &self,
        event: &crate::types::AuthDisconnectEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<crate::events::AuthDisconnectEventDescriptor>(event)
            .await
    }

    /// Publish `Auth.SessionRevoked`.
    pub async fn publish_auth_session_revoked(
        &self,
        event: &crate::types::AuthSessionRevokedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<crate::events::AuthSessionRevokedEventDescriptor>(event)
            .await
    }
}
