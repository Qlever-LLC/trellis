//! Thin server-side helpers for `trellis.auth@v1`.

use trellis_server::{EventPublisher, HandlerResult, RequestContext, Router, ServerError};

/// Register a handler for `Auth.GetInstalledContract`.
pub fn register_auth_get_installed_contract<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthGetInstalledContractRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthGetInstalledContractResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthGetInstalledContractRpc, _, _>(handler);
}

/// Register a handler for `Auth.Health`.
pub fn register_auth_health<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthHealthResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthHealthRpc, _, _>(handler);
}

/// Register a handler for `Auth.InstallService`.
pub fn register_auth_install_service<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthInstallServiceRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthInstallServiceResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthInstallServiceRpc, _, _>(handler);
}

/// Register a handler for `Auth.KickConnection`.
pub fn register_auth_kick_connection<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthKickConnectionRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthKickConnectionResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthKickConnectionRpc, _, _>(handler);
}

/// Register a handler for `Auth.ListApprovals`.
pub fn register_auth_list_approvals<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthListApprovalsRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthListApprovalsResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthListApprovalsRpc, _, _>(handler);
}

/// Register a handler for `Auth.ListConnections`.
pub fn register_auth_list_connections<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthListConnectionsRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthListConnectionsResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthListConnectionsRpc, _, _>(handler);
}

/// Register a handler for `Auth.ListInstalledContracts`.
pub fn register_auth_list_installed_contracts<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthListInstalledContractsRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthListInstalledContractsResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthListInstalledContractsRpc, _, _>(handler);
}

/// Register a handler for `Auth.ListServices`.
pub fn register_auth_list_services<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthListServicesResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthListServicesRpc, _, _>(handler);
}

/// Register a handler for `Auth.ListSessions`.
pub fn register_auth_list_sessions<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthListSessionsRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthListSessionsResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthListSessionsRpc, _, _>(handler);
}

/// Register a handler for `Auth.ListUsers`.
pub fn register_auth_list_users<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthListUsersResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthListUsersRpc, _, _>(handler);
}

/// Register a handler for `Auth.Logout`.
pub fn register_auth_logout<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthLogoutResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthLogoutRpc, _, _>(handler);
}

/// Register a handler for `Auth.Me`.
pub fn register_auth_me<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthMeResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthMeRpc, _, _>(handler);
}

/// Register a handler for `Auth.RenewBindingToken`.
pub fn register_auth_renew_binding_token<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthRenewBindingTokenResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthRenewBindingTokenRpc, _, _>(handler);
}

/// Register a handler for `Auth.RevokeApproval`.
pub fn register_auth_revoke_approval<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthRevokeApprovalRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthRevokeApprovalResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthRevokeApprovalRpc, _, _>(handler);
}

/// Register a handler for `Auth.RevokeSession`.
pub fn register_auth_revoke_session<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthRevokeSessionRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthRevokeSessionResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthRevokeSessionRpc, _, _>(handler);
}

/// Register a handler for `Auth.UpdateUser`.
pub fn register_auth_update_user<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthUpdateUserRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthUpdateUserResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthUpdateUserRpc, _, _>(handler);
}

/// Register a handler for `Auth.UpgradeServiceContract`.
pub fn register_auth_upgrade_service_contract<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthUpgradeServiceContractRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthUpgradeServiceContractResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthUpgradeServiceContractRpc, _, _>(handler);
}

/// Register a handler for `Auth.ValidateRequest`.
pub fn register_auth_validate_request<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::AuthValidateRequestRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::AuthValidateRequestResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::AuthValidateRequestRpc, _, _>(handler);
}

/// Publish `Auth.Connect` from a service handler.
pub async fn publish_auth_connect(publisher: &EventPublisher, event: &crate::types::AuthConnectEvent) -> Result<(), ServerError> {
    publisher.publish::<crate::events::AuthConnectEventDescriptor>(event).await
}

/// Publish `Auth.ConnectionKicked` from a service handler.
pub async fn publish_auth_connection_kicked(publisher: &EventPublisher, event: &crate::types::AuthConnectionKickedEvent) -> Result<(), ServerError> {
    publisher.publish::<crate::events::AuthConnectionKickedEventDescriptor>(event).await
}

/// Publish `Auth.Disconnect` from a service handler.
pub async fn publish_auth_disconnect(publisher: &EventPublisher, event: &crate::types::AuthDisconnectEvent) -> Result<(), ServerError> {
    publisher.publish::<crate::events::AuthDisconnectEventDescriptor>(event).await
}

/// Publish `Auth.SessionRevoked` from a service handler.
pub async fn publish_auth_session_revoked(publisher: &EventPublisher, event: &crate::types::AuthSessionRevokedEvent) -> Result<(), ServerError> {
    publisher.publish::<crate::events::AuthSessionRevokedEventDescriptor>(event).await
}

