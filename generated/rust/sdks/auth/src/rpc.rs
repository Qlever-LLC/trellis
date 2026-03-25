//! Typed RPC descriptors for `trellis.auth@v1`.

use serde::{Deserialize, Serialize};

use trellis_client::RpcDescriptor;
use trellis_server::RpcDescriptor as ServerRpcDescriptor;

/// Empty request or response payload used by zero-argument RPCs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Empty {}

/// Descriptor for `Auth.GetInstalledContract`.
pub struct AuthGetInstalledContractRpc;

impl RpcDescriptor for AuthGetInstalledContractRpc {
    type Input = crate::types::AuthGetInstalledContractRequest;
    type Output = crate::types::AuthGetInstalledContractResponse;
    const KEY: &'static str = "Auth.GetInstalledContract";
    const SUBJECT: &'static str = "rpc.v1.Auth.GetInstalledContract";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthGetInstalledContractRpc {
    type Input = crate::types::AuthGetInstalledContractRequest;
    type Output = crate::types::AuthGetInstalledContractResponse;
    const KEY: &'static str = "Auth.GetInstalledContract";
    const SUBJECT: &'static str = "rpc.v1.Auth.GetInstalledContract";
}

/// Descriptor for `Auth.Health`.
pub struct AuthHealthRpc;

impl RpcDescriptor for AuthHealthRpc {
    type Input = Empty;
    type Output = crate::types::AuthHealthResponse;
    const KEY: &'static str = "Auth.Health";
    const SUBJECT: &'static str = "rpc.v1.Auth.Health";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

impl ServerRpcDescriptor for AuthHealthRpc {
    type Input = Empty;
    type Output = crate::types::AuthHealthResponse;
    const KEY: &'static str = "Auth.Health";
    const SUBJECT: &'static str = "rpc.v1.Auth.Health";
}

/// Descriptor for `Auth.InstallService`.
pub struct AuthInstallServiceRpc;

impl RpcDescriptor for AuthInstallServiceRpc {
    type Input = crate::types::AuthInstallServiceRequest;
    type Output = crate::types::AuthInstallServiceResponse;
    const KEY: &'static str = "Auth.InstallService";
    const SUBJECT: &'static str = "rpc.v1.Auth.InstallService";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthInstallServiceRpc {
    type Input = crate::types::AuthInstallServiceRequest;
    type Output = crate::types::AuthInstallServiceResponse;
    const KEY: &'static str = "Auth.InstallService";
    const SUBJECT: &'static str = "rpc.v1.Auth.InstallService";
}

/// Descriptor for `Auth.KickConnection`.
pub struct AuthKickConnectionRpc;

impl RpcDescriptor for AuthKickConnectionRpc {
    type Input = crate::types::AuthKickConnectionRequest;
    type Output = crate::types::AuthKickConnectionResponse;
    const KEY: &'static str = "Auth.KickConnection";
    const SUBJECT: &'static str = "rpc.v1.Auth.KickConnection";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthKickConnectionRpc {
    type Input = crate::types::AuthKickConnectionRequest;
    type Output = crate::types::AuthKickConnectionResponse;
    const KEY: &'static str = "Auth.KickConnection";
    const SUBJECT: &'static str = "rpc.v1.Auth.KickConnection";
}

/// Descriptor for `Auth.ListApprovals`.
pub struct AuthListApprovalsRpc;

impl RpcDescriptor for AuthListApprovalsRpc {
    type Input = crate::types::AuthListApprovalsRequest;
    type Output = crate::types::AuthListApprovalsResponse;
    const KEY: &'static str = "Auth.ListApprovals";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListApprovals";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthListApprovalsRpc {
    type Input = crate::types::AuthListApprovalsRequest;
    type Output = crate::types::AuthListApprovalsResponse;
    const KEY: &'static str = "Auth.ListApprovals";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListApprovals";
}

/// Descriptor for `Auth.ListConnections`.
pub struct AuthListConnectionsRpc;

impl RpcDescriptor for AuthListConnectionsRpc {
    type Input = crate::types::AuthListConnectionsRequest;
    type Output = crate::types::AuthListConnectionsResponse;
    const KEY: &'static str = "Auth.ListConnections";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListConnections";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthListConnectionsRpc {
    type Input = crate::types::AuthListConnectionsRequest;
    type Output = crate::types::AuthListConnectionsResponse;
    const KEY: &'static str = "Auth.ListConnections";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListConnections";
}

/// Descriptor for `Auth.ListInstalledContracts`.
pub struct AuthListInstalledContractsRpc;

impl RpcDescriptor for AuthListInstalledContractsRpc {
    type Input = crate::types::AuthListInstalledContractsRequest;
    type Output = crate::types::AuthListInstalledContractsResponse;
    const KEY: &'static str = "Auth.ListInstalledContracts";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListInstalledContracts";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthListInstalledContractsRpc {
    type Input = crate::types::AuthListInstalledContractsRequest;
    type Output = crate::types::AuthListInstalledContractsResponse;
    const KEY: &'static str = "Auth.ListInstalledContracts";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListInstalledContracts";
}

/// Descriptor for `Auth.ListServices`.
pub struct AuthListServicesRpc;

impl RpcDescriptor for AuthListServicesRpc {
    type Input = Empty;
    type Output = crate::types::AuthListServicesResponse;
    const KEY: &'static str = "Auth.ListServices";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListServices";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthListServicesRpc {
    type Input = Empty;
    type Output = crate::types::AuthListServicesResponse;
    const KEY: &'static str = "Auth.ListServices";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListServices";
}

/// Descriptor for `Auth.ListSessions`.
pub struct AuthListSessionsRpc;

impl RpcDescriptor for AuthListSessionsRpc {
    type Input = crate::types::AuthListSessionsRequest;
    type Output = crate::types::AuthListSessionsResponse;
    const KEY: &'static str = "Auth.ListSessions";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListSessions";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthListSessionsRpc {
    type Input = crate::types::AuthListSessionsRequest;
    type Output = crate::types::AuthListSessionsResponse;
    const KEY: &'static str = "Auth.ListSessions";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListSessions";
}

/// Descriptor for `Auth.ListUsers`.
pub struct AuthListUsersRpc;

impl RpcDescriptor for AuthListUsersRpc {
    type Input = Empty;
    type Output = crate::types::AuthListUsersResponse;
    const KEY: &'static str = "Auth.ListUsers";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListUsers";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthListUsersRpc {
    type Input = Empty;
    type Output = crate::types::AuthListUsersResponse;
    const KEY: &'static str = "Auth.ListUsers";
    const SUBJECT: &'static str = "rpc.v1.Auth.ListUsers";
}

/// Descriptor for `Auth.Logout`.
pub struct AuthLogoutRpc;

impl RpcDescriptor for AuthLogoutRpc {
    type Input = Empty;
    type Output = crate::types::AuthLogoutResponse;
    const KEY: &'static str = "Auth.Logout";
    const SUBJECT: &'static str = "rpc.v1.Auth.Logout";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthLogoutRpc {
    type Input = Empty;
    type Output = crate::types::AuthLogoutResponse;
    const KEY: &'static str = "Auth.Logout";
    const SUBJECT: &'static str = "rpc.v1.Auth.Logout";
}

/// Descriptor for `Auth.Me`.
pub struct AuthMeRpc;

impl RpcDescriptor for AuthMeRpc {
    type Input = Empty;
    type Output = crate::types::AuthMeResponse;
    const KEY: &'static str = "Auth.Me";
    const SUBJECT: &'static str = "rpc.v1.Auth.Me";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthMeRpc {
    type Input = Empty;
    type Output = crate::types::AuthMeResponse;
    const KEY: &'static str = "Auth.Me";
    const SUBJECT: &'static str = "rpc.v1.Auth.Me";
}

/// Descriptor for `Auth.RenewBindingToken`.
pub struct AuthRenewBindingTokenRpc;

impl RpcDescriptor for AuthRenewBindingTokenRpc {
    type Input = Empty;
    type Output = crate::types::AuthRenewBindingTokenResponse;
    const KEY: &'static str = "Auth.RenewBindingToken";
    const SUBJECT: &'static str = "rpc.v1.Auth.RenewBindingToken";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthRenewBindingTokenRpc {
    type Input = Empty;
    type Output = crate::types::AuthRenewBindingTokenResponse;
    const KEY: &'static str = "Auth.RenewBindingToken";
    const SUBJECT: &'static str = "rpc.v1.Auth.RenewBindingToken";
}

/// Descriptor for `Auth.RevokeApproval`.
pub struct AuthRevokeApprovalRpc;

impl RpcDescriptor for AuthRevokeApprovalRpc {
    type Input = crate::types::AuthRevokeApprovalRequest;
    type Output = crate::types::AuthRevokeApprovalResponse;
    const KEY: &'static str = "Auth.RevokeApproval";
    const SUBJECT: &'static str = "rpc.v1.Auth.RevokeApproval";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthRevokeApprovalRpc {
    type Input = crate::types::AuthRevokeApprovalRequest;
    type Output = crate::types::AuthRevokeApprovalResponse;
    const KEY: &'static str = "Auth.RevokeApproval";
    const SUBJECT: &'static str = "rpc.v1.Auth.RevokeApproval";
}

/// Descriptor for `Auth.RevokeSession`.
pub struct AuthRevokeSessionRpc;

impl RpcDescriptor for AuthRevokeSessionRpc {
    type Input = crate::types::AuthRevokeSessionRequest;
    type Output = crate::types::AuthRevokeSessionResponse;
    const KEY: &'static str = "Auth.RevokeSession";
    const SUBJECT: &'static str = "rpc.v1.Auth.RevokeSession";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthRevokeSessionRpc {
    type Input = crate::types::AuthRevokeSessionRequest;
    type Output = crate::types::AuthRevokeSessionResponse;
    const KEY: &'static str = "Auth.RevokeSession";
    const SUBJECT: &'static str = "rpc.v1.Auth.RevokeSession";
}

/// Descriptor for `Auth.UpdateUser`.
pub struct AuthUpdateUserRpc;

impl RpcDescriptor for AuthUpdateUserRpc {
    type Input = crate::types::AuthUpdateUserRequest;
    type Output = crate::types::AuthUpdateUserResponse;
    const KEY: &'static str = "Auth.UpdateUser";
    const SUBJECT: &'static str = "rpc.v1.Auth.UpdateUser";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthUpdateUserRpc {
    type Input = crate::types::AuthUpdateUserRequest;
    type Output = crate::types::AuthUpdateUserResponse;
    const KEY: &'static str = "Auth.UpdateUser";
    const SUBJECT: &'static str = "rpc.v1.Auth.UpdateUser";
}

/// Descriptor for `Auth.UpgradeServiceContract`.
pub struct AuthUpgradeServiceContractRpc;

impl RpcDescriptor for AuthUpgradeServiceContractRpc {
    type Input = crate::types::AuthUpgradeServiceContractRequest;
    type Output = crate::types::AuthUpgradeServiceContractResponse;
    const KEY: &'static str = "Auth.UpgradeServiceContract";
    const SUBJECT: &'static str = "rpc.v1.Auth.UpgradeServiceContract";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthUpgradeServiceContractRpc {
    type Input = crate::types::AuthUpgradeServiceContractRequest;
    type Output = crate::types::AuthUpgradeServiceContractResponse;
    const KEY: &'static str = "Auth.UpgradeServiceContract";
    const SUBJECT: &'static str = "rpc.v1.Auth.UpgradeServiceContract";
}

/// Descriptor for `Auth.ValidateRequest`.
pub struct AuthValidateRequestRpc;

impl RpcDescriptor for AuthValidateRequestRpc {
    type Input = crate::types::AuthValidateRequestRequest;
    type Output = crate::types::AuthValidateRequestResponse;
    const KEY: &'static str = "Auth.ValidateRequest";
    const SUBJECT: &'static str = "rpc.v1.Auth.ValidateRequest";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["service"];
    const ERRORS: &'static [&'static str] = &["AuthError", "ValidationError", "UnexpectedError"];
}

impl ServerRpcDescriptor for AuthValidateRequestRpc {
    type Input = crate::types::AuthValidateRequestRequest;
    type Output = crate::types::AuthValidateRequestResponse;
    const KEY: &'static str = "Auth.ValidateRequest";
    const SUBJECT: &'static str = "rpc.v1.Auth.ValidateRequest";
}

