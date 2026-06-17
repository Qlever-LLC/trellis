//! Typed RPC descriptors for `trellis.auth@v1`.
use crate::client::RpcDescriptor;
use serde::{Deserialize, Serialize};
/// Empty request or response payload used by zero-argument RPCs.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Empty {}
/// Descriptor for `Auth.Capabilities.List`.
pub struct AuthCapabilitiesListRpc;
impl RpcDescriptor for AuthCapabilitiesListRpc {
    type Input = super::types::AuthCapabilitiesListRequest;
    type Output = super::types::AuthCapabilitiesListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITIES_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITIES_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Capabilities.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Capabilities.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.CapabilityGroups.Delete`.
pub struct AuthCapabilityGroupsDeleteRpc;
impl RpcDescriptor for AuthCapabilityGroupsDeleteRpc {
    type Input = super::types::AuthCapabilityGroupsDeleteRequest;
    type Output = super::types::AuthCapabilityGroupsDeleteResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_DELETE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_DELETE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.CapabilityGroups.Delete";
    const SUBJECT: &'static str = "rpc.v1.Auth.CapabilityGroups.Delete";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.CapabilityGroups.Get`.
pub struct AuthCapabilityGroupsGetRpc;
impl RpcDescriptor for AuthCapabilityGroupsGetRpc {
    type Input = super::types::AuthCapabilityGroupsGetRequest;
    type Output = super::types::AuthCapabilityGroupsGetResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.CapabilityGroups.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.CapabilityGroups.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.CapabilityGroups.List`.
pub struct AuthCapabilityGroupsListRpc;
impl RpcDescriptor for AuthCapabilityGroupsListRpc {
    type Input = super::types::AuthCapabilityGroupsListRequest;
    type Output = super::types::AuthCapabilityGroupsListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.CapabilityGroups.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.CapabilityGroups.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.CapabilityGroups.Put`.
pub struct AuthCapabilityGroupsPutRpc;
impl RpcDescriptor for AuthCapabilityGroupsPutRpc {
    type Input = super::types::AuthCapabilityGroupsPutRequest;
    type Output = super::types::AuthCapabilityGroupsPutResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_PUT_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CAPABILITY_GROUPS_PUT_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.CapabilityGroups.Put";
    const SUBJECT: &'static str = "rpc.v1.Auth.CapabilityGroups.Put";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.CatalogIssues.Resolve`.
pub struct AuthCatalogIssuesResolveRpc;
impl RpcDescriptor for AuthCatalogIssuesResolveRpc {
    type Input = super::types::AuthCatalogIssuesResolveRequest;
    type Output = super::types::AuthCatalogIssuesResolveResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CATALOG_ISSUES_RESOLVE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CATALOG_ISSUES_RESOLVE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.CatalogIssues.Resolve";
    const SUBJECT: &'static str = "rpc.v1.Auth.CatalogIssues.Resolve";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Connections.Kick`.
pub struct AuthConnectionsKickRpc;
impl RpcDescriptor for AuthConnectionsKickRpc {
    type Input = super::types::AuthConnectionsKickRequest;
    type Output = super::types::AuthConnectionsKickResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_CONNECTIONS_KICK_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CONNECTIONS_KICK_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Connections.Kick";
    const SUBJECT: &'static str = "rpc.v1.Auth.Connections.Kick";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Connections.List`.
pub struct AuthConnectionsListRpc;
impl RpcDescriptor for AuthConnectionsListRpc {
    type Input = super::types::AuthConnectionsListRequest;
    type Output = super::types::AuthConnectionsListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_CONNECTIONS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_CONNECTIONS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Connections.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Connections.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.AcceptMigration`.
pub struct AuthDeploymentAuthorityAcceptMigrationRpc;
impl RpcDescriptor for AuthDeploymentAuthorityAcceptMigrationRpc {
    type Input = super::types::AuthDeploymentAuthorityAcceptMigrationRequest;
    type Output = super::types::AuthDeploymentAuthorityAcceptMigrationResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_ACCEPT_MIGRATION_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_ACCEPT_MIGRATION_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.AcceptMigration";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.AcceptMigration";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.AcceptUpdate`.
pub struct AuthDeploymentAuthorityAcceptUpdateRpc;
impl RpcDescriptor for AuthDeploymentAuthorityAcceptUpdateRpc {
    type Input = super::types::AuthDeploymentAuthorityAcceptUpdateRequest;
    type Output = super::types::AuthDeploymentAuthorityAcceptUpdateResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_ACCEPT_UPDATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_ACCEPT_UPDATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.AcceptUpdate";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.AcceptUpdate";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.Get`.
pub struct AuthDeploymentAuthorityGetRpc;
impl RpcDescriptor for AuthDeploymentAuthorityGetRpc {
    type Input = super::types::AuthDeploymentAuthorityGetRequest;
    type Output = super::types::AuthDeploymentAuthorityGetResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.GrantOverrides.List`.
pub struct AuthDeploymentAuthorityGrantOverridesListRpc;
impl RpcDescriptor for AuthDeploymentAuthorityGrantOverridesListRpc {
    type Input = super::types::AuthDeploymentAuthorityGrantOverridesListRequest;
    type Output = super::types::AuthDeploymentAuthorityGrantOverridesListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GRANT_OVERRIDES_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GRANT_OVERRIDES_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.GrantOverrides.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.GrantOverrides.Put`.
pub struct AuthDeploymentAuthorityGrantOverridesPutRpc;
impl RpcDescriptor for AuthDeploymentAuthorityGrantOverridesPutRpc {
    type Input = super::types::AuthDeploymentAuthorityGrantOverridesPutRequest;
    type Output = super::types::AuthDeploymentAuthorityGrantOverridesPutResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GRANT_OVERRIDES_PUT_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GRANT_OVERRIDES_PUT_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.GrantOverrides.Put";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Put";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.GrantOverrides.Remove`.
pub struct AuthDeploymentAuthorityGrantOverridesRemoveRpc;
impl RpcDescriptor for AuthDeploymentAuthorityGrantOverridesRemoveRpc {
    type Input = super::types::AuthDeploymentAuthorityGrantOverridesRemoveRequest;
    type Output = super::types::AuthDeploymentAuthorityGrantOverridesRemoveResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GRANT_OVERRIDES_REMOVE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_GRANT_OVERRIDES_REMOVE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.GrantOverrides.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.List`.
pub struct AuthDeploymentAuthorityListRpc;
impl RpcDescriptor for AuthDeploymentAuthorityListRpc {
    type Input = super::types::AuthDeploymentAuthorityListRequest;
    type Output = super::types::AuthDeploymentAuthorityListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.Plan`.
pub struct AuthDeploymentAuthorityPlanRpc;
impl RpcDescriptor for AuthDeploymentAuthorityPlanRpc {
    type Input = super::types::AuthDeploymentAuthorityPlanRequest;
    type Output = super::types::AuthDeploymentAuthorityPlanResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_PLAN_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_PLAN_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.Plan";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.Plan";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.Plans.Get`.
pub struct AuthDeploymentAuthorityPlansGetRpc;
impl RpcDescriptor for AuthDeploymentAuthorityPlansGetRpc {
    type Input = super::types::AuthDeploymentAuthorityPlansGetRequest;
    type Output = super::types::AuthDeploymentAuthorityPlansGetResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_PLANS_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_PLANS_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.Plans.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.Plans.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.Plans.List`.
pub struct AuthDeploymentAuthorityPlansListRpc;
impl RpcDescriptor for AuthDeploymentAuthorityPlansListRpc {
    type Input = super::types::AuthDeploymentAuthorityPlansListRequest;
    type Output = super::types::AuthDeploymentAuthorityPlansListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_PLANS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_PLANS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.Plans.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.Plans.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}
/// Descriptor for `Auth.DeploymentAuthority.Reconcile`.
pub struct AuthDeploymentAuthorityReconcileRpc;
impl RpcDescriptor for AuthDeploymentAuthorityReconcileRpc {
    type Input = super::types::AuthDeploymentAuthorityReconcileRequest;
    type Output = super::types::AuthDeploymentAuthorityReconcileResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_RECONCILE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_RECONCILE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.Reconcile";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.Reconcile";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeploymentAuthority.Reject`.
pub struct AuthDeploymentAuthorityRejectRpc;
impl RpcDescriptor for AuthDeploymentAuthorityRejectRpc {
    type Input = super::types::AuthDeploymentAuthorityRejectRequest;
    type Output = super::types::AuthDeploymentAuthorityRejectResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_REJECT_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENT_AUTHORITY_REJECT_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeploymentAuthority.Reject";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeploymentAuthority.Reject";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Deployments.Create`.
pub struct AuthDeploymentsCreateRpc;
impl RpcDescriptor for AuthDeploymentsCreateRpc {
    type Input = super::types::AuthDeploymentsCreateRequest;
    type Output = super::types::AuthDeploymentsCreateResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_CREATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_CREATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Deployments.Create";
    const SUBJECT: &'static str = "rpc.v1.Auth.Deployments.Create";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Deployments.Disable`.
pub struct AuthDeploymentsDisableRpc;
impl RpcDescriptor for AuthDeploymentsDisableRpc {
    type Input = super::types::AuthDeploymentsDisableRequest;
    type Output = super::types::AuthDeploymentsDisableResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_DISABLE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_DISABLE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Deployments.Disable";
    const SUBJECT: &'static str = "rpc.v1.Auth.Deployments.Disable";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Deployments.Enable`.
pub struct AuthDeploymentsEnableRpc;
impl RpcDescriptor for AuthDeploymentsEnableRpc {
    type Input = super::types::AuthDeploymentsEnableRequest;
    type Output = super::types::AuthDeploymentsEnableResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_ENABLE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_ENABLE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Deployments.Enable";
    const SUBJECT: &'static str = "rpc.v1.Auth.Deployments.Enable";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Deployments.List`.
pub struct AuthDeploymentsListRpc;
impl RpcDescriptor for AuthDeploymentsListRpc {
    type Input = super::types::AuthDeploymentsListRequest;
    type Output = super::types::AuthDeploymentsListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEPLOYMENTS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Deployments.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Deployments.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Deployments.Remove`.
pub struct AuthDeploymentsRemoveRpc;
impl RpcDescriptor for AuthDeploymentsRemoveRpc {
    type Input = super::types::AuthDeploymentsRemoveRequest;
    type Output = super::types::AuthDeploymentsRemoveResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_REMOVE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEPLOYMENTS_REMOVE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Deployments.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.Deployments.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.List`.
pub struct AuthDeviceUserAuthoritiesListRpc;
impl RpcDescriptor for AuthDeviceUserAuthoritiesListRpc {
    type Input = super::types::AuthDeviceUserAuthoritiesListRequest;
    type Output = super::types::AuthDeviceUserAuthoritiesListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeviceUserAuthorities.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Reviews.Decide`.
pub struct AuthDeviceUserAuthoritiesReviewsDecideRpc;
impl RpcDescriptor for AuthDeviceUserAuthoritiesReviewsDecideRpc {
    type Input = super::types::AuthDeviceUserAuthoritiesReviewsDecideRequest;
    type Output = super::types::AuthDeviceUserAuthoritiesReviewsDecideResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REVIEWS_DECIDE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REVIEWS_DECIDE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Reviews.Decide";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeviceUserAuthorities.Reviews.Decide";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.auth::device.review"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Reviews.List`.
pub struct AuthDeviceUserAuthoritiesReviewsListRpc;
impl RpcDescriptor for AuthDeviceUserAuthoritiesReviewsListRpc {
    type Input = super::types::AuthDeviceUserAuthoritiesReviewsListRequest;
    type Output = super::types::AuthDeviceUserAuthoritiesReviewsListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REVIEWS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REVIEWS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Reviews.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeviceUserAuthorities.Reviews.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["trellis.auth::device.review"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.DeviceUserAuthorities.Revoke`.
pub struct AuthDeviceUserAuthoritiesRevokeRpc;
impl RpcDescriptor for AuthDeviceUserAuthoritiesRevokeRpc {
    type Input = super::types::AuthDeviceUserAuthoritiesRevokeRequest;
    type Output = super::types::AuthDeviceUserAuthoritiesRevokeResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REVOKE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICE_USER_AUTHORITIES_REVOKE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.DeviceUserAuthorities.Revoke";
    const SUBJECT: &'static str = "rpc.v1.Auth.DeviceUserAuthorities.Revoke";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Devices.ConnectInfo.Get`.
pub struct AuthDevicesConnectInfoGetRpc;
impl RpcDescriptor for AuthDevicesConnectInfoGetRpc {
    type Input = super::types::AuthDevicesConnectInfoGetRequest;
    type Output = super::types::AuthDevicesConnectInfoGetResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICES_CONNECT_INFO_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICES_CONNECT_INFO_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Devices.ConnectInfo.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.Devices.ConnectInfo.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Devices.Disable`.
pub struct AuthDevicesDisableRpc;
impl RpcDescriptor for AuthDevicesDisableRpc {
    type Input = super::types::AuthDevicesDisableRequest;
    type Output = super::types::AuthDevicesDisableResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEVICES_DISABLE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICES_DISABLE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Devices.Disable";
    const SUBJECT: &'static str = "rpc.v1.Auth.Devices.Disable";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Devices.Enable`.
pub struct AuthDevicesEnableRpc;
impl RpcDescriptor for AuthDevicesEnableRpc {
    type Input = super::types::AuthDevicesEnableRequest;
    type Output = super::types::AuthDevicesEnableResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEVICES_ENABLE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEVICES_ENABLE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Devices.Enable";
    const SUBJECT: &'static str = "rpc.v1.Auth.Devices.Enable";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Devices.List`.
pub struct AuthDevicesListRpc;
impl RpcDescriptor for AuthDevicesListRpc {
    type Input = super::types::AuthDevicesListRequest;
    type Output = super::types::AuthDevicesListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEVICES_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEVICES_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Devices.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Devices.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Devices.Provision`.
pub struct AuthDevicesProvisionRpc;
impl RpcDescriptor for AuthDevicesProvisionRpc {
    type Input = super::types::AuthDevicesProvisionRequest;
    type Output = super::types::AuthDevicesProvisionResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICES_PROVISION_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_DEVICES_PROVISION_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Devices.Provision";
    const SUBJECT: &'static str = "rpc.v1.Auth.Devices.Provision";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Devices.Remove`.
pub struct AuthDevicesRemoveRpc;
impl RpcDescriptor for AuthDevicesRemoveRpc {
    type Input = super::types::AuthDevicesRemoveRequest;
    type Output = super::types::AuthDevicesRemoveResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEVICES_REMOVE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_DEVICES_REMOVE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Devices.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.Devices.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Health`.
pub struct AuthHealthRpc;
impl RpcDescriptor for AuthHealthRpc {
    type Input = Empty;
    type Output = super::types::AuthHealthResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_HEALTH_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_HEALTH_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Health";
    const SUBJECT: &'static str = "rpc.v1.Auth.Health";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}
/// Descriptor for `Auth.Identities.List`.
pub struct AuthIdentitiesListRpc;
impl RpcDescriptor for AuthIdentitiesListRpc {
    type Input = super::types::AuthIdentitiesListRequest;
    type Output = super::types::AuthIdentitiesListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_IDENTITIES_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_IDENTITIES_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Identities.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Identities.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.IdentityGrants.List`.
pub struct AuthIdentityGrantsListRpc;
impl RpcDescriptor for AuthIdentityGrantsListRpc {
    type Input = super::types::AuthIdentityGrantsListRequest;
    type Output = super::types::AuthIdentityGrantsListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_IDENTITY_GRANTS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_IDENTITY_GRANTS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.IdentityGrants.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.IdentityGrants.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}
/// Descriptor for `Auth.IdentityGrants.Revoke`.
pub struct AuthIdentityGrantsRevokeRpc;
impl RpcDescriptor for AuthIdentityGrantsRevokeRpc {
    type Input = super::types::AuthIdentityGrantsRevokeRequest;
    type Output = super::types::AuthIdentityGrantsRevokeResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_IDENTITY_GRANTS_REVOKE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_IDENTITY_GRANTS_REVOKE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.IdentityGrants.Revoke";
    const SUBJECT: &'static str = "rpc.v1.Auth.IdentityGrants.Revoke";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.Get`.
pub struct AuthPortalsGetRpc;
impl RpcDescriptor for AuthPortalsGetRpc {
    type Input = super::types::AuthPortalsGetRequest;
    type Output = super::types::AuthPortalsGetResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.List`.
pub struct AuthPortalsListRpc;
impl RpcDescriptor for AuthPortalsListRpc {
    type Input = super::types::AuthPortalsListRequest;
    type Output = super::types::AuthPortalsListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}
/// Descriptor for `Auth.Portals.LoginSettings.Get`.
pub struct AuthPortalsLoginSettingsGetRpc;
impl RpcDescriptor for AuthPortalsLoginSettingsGetRpc {
    type Input = super::types::AuthPortalsLoginSettingsGetRequest;
    type Output = super::types::AuthPortalsLoginSettingsGetResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_LOGIN_SETTINGS_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_LOGIN_SETTINGS_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.LoginSettings.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.LoginSettings.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.LoginSettings.Update`.
pub struct AuthPortalsLoginSettingsUpdateRpc;
impl RpcDescriptor for AuthPortalsLoginSettingsUpdateRpc {
    type Input = super::types::AuthPortalsLoginSettingsUpdateRequest;
    type Output = super::types::AuthPortalsLoginSettingsUpdateResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_LOGIN_SETTINGS_UPDATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_LOGIN_SETTINGS_UPDATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.LoginSettings.Update";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.LoginSettings.Update";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.Put`.
pub struct AuthPortalsPutRpc;
impl RpcDescriptor for AuthPortalsPutRpc {
    type Input = super::types::AuthPortalsPutRequest;
    type Output = super::types::AuthPortalsPutResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_PUT_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_PUT_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.Put";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.Put";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.Remove`.
pub struct AuthPortalsRemoveRpc;
impl RpcDescriptor for AuthPortalsRemoveRpc {
    type Input = super::types::AuthPortalsRemoveRequest;
    type Output = super::types::AuthPortalsRemoveResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_REMOVE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_PORTALS_REMOVE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.Routes.Put`.
pub struct AuthPortalsRoutesPutRpc;
impl RpcDescriptor for AuthPortalsRoutesPutRpc {
    type Input = super::types::AuthPortalsRoutesPutRequest;
    type Output = super::types::AuthPortalsRoutesPutResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_ROUTES_PUT_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_ROUTES_PUT_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.Routes.Put";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.Routes.Put";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.Routes.Remove`.
pub struct AuthPortalsRoutesRemoveRpc;
impl RpcDescriptor for AuthPortalsRoutesRemoveRpc {
    type Input = super::types::AuthPortalsRoutesRemoveRequest;
    type Output = super::types::AuthPortalsRoutesRemoveResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_ROUTES_REMOVE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_PORTALS_ROUTES_REMOVE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Portals.Routes.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.Portals.Routes.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Requests.Validate`.
pub struct AuthRequestsValidateRpc;
impl RpcDescriptor for AuthRequestsValidateRpc {
    type Input = super::types::AuthRequestsValidateRequest;
    type Output = super::types::AuthRequestsValidateResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_REQUESTS_VALIDATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_REQUESTS_VALIDATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Requests.Validate";
    const SUBJECT: &'static str = "rpc.v1.Auth.Requests.Validate";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["service"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.ServiceInstances.Disable`.
pub struct AuthServiceInstancesDisableRpc;
impl RpcDescriptor for AuthServiceInstancesDisableRpc {
    type Input = super::types::AuthServiceInstancesDisableRequest;
    type Output = super::types::AuthServiceInstancesDisableResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_DISABLE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_DISABLE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.ServiceInstances.Disable";
    const SUBJECT: &'static str = "rpc.v1.Auth.ServiceInstances.Disable";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.ServiceInstances.Enable`.
pub struct AuthServiceInstancesEnableRpc;
impl RpcDescriptor for AuthServiceInstancesEnableRpc {
    type Input = super::types::AuthServiceInstancesEnableRequest;
    type Output = super::types::AuthServiceInstancesEnableResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_ENABLE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_ENABLE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.ServiceInstances.Enable";
    const SUBJECT: &'static str = "rpc.v1.Auth.ServiceInstances.Enable";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.ServiceInstances.List`.
pub struct AuthServiceInstancesListRpc;
impl RpcDescriptor for AuthServiceInstancesListRpc {
    type Input = super::types::AuthServiceInstancesListRequest;
    type Output = super::types::AuthServiceInstancesListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.ServiceInstances.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.ServiceInstances.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.ServiceInstances.Provision`.
pub struct AuthServiceInstancesProvisionRpc;
impl RpcDescriptor for AuthServiceInstancesProvisionRpc {
    type Input = super::types::AuthServiceInstancesProvisionRequest;
    type Output = super::types::AuthServiceInstancesProvisionResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_PROVISION_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_PROVISION_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.ServiceInstances.Provision";
    const SUBJECT: &'static str = "rpc.v1.Auth.ServiceInstances.Provision";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.ServiceInstances.Remove`.
pub struct AuthServiceInstancesRemoveRpc;
impl RpcDescriptor for AuthServiceInstancesRemoveRpc {
    type Input = super::types::AuthServiceInstancesRemoveRequest;
    type Output = super::types::AuthServiceInstancesRemoveResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_REMOVE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SERVICE_INSTANCES_REMOVE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.ServiceInstances.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.ServiceInstances.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Sessions.List`.
pub struct AuthSessionsListRpc;
impl RpcDescriptor for AuthSessionsListRpc {
    type Input = super::types::AuthSessionsListRequest;
    type Output = super::types::AuthSessionsListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_SESSIONS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_SESSIONS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Sessions.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Sessions.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Sessions.Logout`.
pub struct AuthSessionsLogoutRpc;
impl RpcDescriptor for AuthSessionsLogoutRpc {
    type Input = Empty;
    type Output = super::types::AuthSessionsLogoutResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_SESSIONS_LOGOUT_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SESSIONS_LOGOUT_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Sessions.Logout";
    const SUBJECT: &'static str = "rpc.v1.Auth.Sessions.Logout";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}
/// Descriptor for `Auth.Sessions.Me`.
pub struct AuthSessionsMeRpc;
impl RpcDescriptor for AuthSessionsMeRpc {
    type Input = Empty;
    type Output = super::types::AuthSessionsMeResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_SESSIONS_ME_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_SESSIONS_ME_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Sessions.Me";
    const SUBJECT: &'static str = "rpc.v1.Auth.Sessions.Me";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}
/// Descriptor for `Auth.Sessions.Revoke`.
pub struct AuthSessionsRevokeRpc;
impl RpcDescriptor for AuthSessionsRevokeRpc {
    type Input = super::types::AuthSessionsRevokeRequest;
    type Output = super::types::AuthSessionsRevokeResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_SESSIONS_REVOKE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_SESSIONS_REVOKE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Sessions.Revoke";
    const SUBJECT: &'static str = "rpc.v1.Auth.Sessions.Revoke";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.UserIdentities.List`.
pub struct AuthUserIdentitiesListRpc;
impl RpcDescriptor for AuthUserIdentitiesListRpc {
    type Input = super::types::AuthUserIdentitiesListRequest;
    type Output = super::types::AuthUserIdentitiesListResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USER_IDENTITIES_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USER_IDENTITIES_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.UserIdentities.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.UserIdentities.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.UserIdentities.Unlink`.
pub struct AuthUserIdentitiesUnlinkRpc;
impl RpcDescriptor for AuthUserIdentitiesUnlinkRpc {
    type Input = super::types::AuthUserIdentitiesUnlinkRequest;
    type Output = super::types::AuthUserIdentitiesUnlinkResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USER_IDENTITIES_UNLINK_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USER_IDENTITIES_UNLINK_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.UserIdentities.Unlink";
    const SUBJECT: &'static str = "rpc.v1.Auth.UserIdentities.Unlink";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Users.Create`.
pub struct AuthUsersCreateRpc;
impl RpcDescriptor for AuthUsersCreateRpc {
    type Input = super::types::AuthUsersCreateRequest;
    type Output = super::types::AuthUsersCreateResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_CREATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_CREATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Users.Create";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.Create";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Users.Get`.
pub struct AuthUsersGetRpc;
impl RpcDescriptor for AuthUsersGetRpc {
    type Input = super::types::AuthUsersGetRequest;
    type Output = super::types::AuthUsersGetResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_GET_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_GET_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Users.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Users.IdentityLink.Create`.
pub struct AuthUsersIdentityLinkCreateRpc;
impl RpcDescriptor for AuthUsersIdentityLinkCreateRpc {
    type Input = super::types::AuthUsersIdentityLinkCreateRequest;
    type Output = super::types::AuthUsersIdentityLinkCreateResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USERS_IDENTITY_LINK_CREATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USERS_IDENTITY_LINK_CREATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Users.IdentityLink.Create";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.IdentityLink.Create";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Users.List`.
pub struct AuthUsersListRpc;
impl RpcDescriptor for AuthUsersListRpc {
    type Input = super::types::AuthUsersListRequest;
    type Output = super::types::AuthUsersListResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_LIST_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_LIST_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Users.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Users.Password.Change`.
pub struct AuthUsersPasswordChangeRpc;
impl RpcDescriptor for AuthUsersPasswordChangeRpc {
    type Input = super::types::AuthUsersPasswordChangeRequest;
    type Output = super::types::AuthUsersPasswordChangeResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USERS_PASSWORD_CHANGE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USERS_PASSWORD_CHANGE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Users.Password.Change";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.Password.Change";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Users.PasswordReset.Create`.
pub struct AuthUsersPasswordResetCreateRpc;
impl RpcDescriptor for AuthUsersPasswordResetCreateRpc {
    type Input = super::types::AuthUsersPasswordResetCreateRequest;
    type Output = super::types::AuthUsersPasswordResetCreateResponse;
    const INPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USERS_PASSWORD_RESET_CREATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str =
        super::schemas::AUTH_USERS_PASSWORD_RESET_CREATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Users.PasswordReset.Create";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.PasswordReset.Create";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Users.Update`.
pub struct AuthUsersUpdateRpc;
impl RpcDescriptor for AuthUsersUpdateRpc {
    type Input = super::types::AuthUsersUpdateRequest;
    type Output = super::types::AuthUsersUpdateResponse;
    const INPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_UPDATE_INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = super::schemas::AUTH_USERS_UPDATE_OUTPUT_SCHEMA_JSON;
    const KEY: &'static str = "Auth.Users.Update";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.Update";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
