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
    const KEY: &'static str = "Auth.Connections.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Connections.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Deployments.Create`.
pub struct AuthDeploymentsCreateRpc;
impl RpcDescriptor for AuthDeploymentsCreateRpc {
    type Input = super::types::AuthDeploymentsCreateRequest;
    type Output = super::types::AuthDeploymentsCreateResponse;
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
    const KEY: &'static str = "Auth.Devices.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.Devices.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.EnvelopeExpansions.Approve`.
pub struct AuthEnvelopeExpansionsApproveRpc;
impl RpcDescriptor for AuthEnvelopeExpansionsApproveRpc {
    type Input = super::types::AuthEnvelopeExpansionsApproveRequest;
    type Output = super::types::AuthEnvelopeExpansionsApproveResponse;
    const KEY: &'static str = "Auth.EnvelopeExpansions.Approve";
    const SUBJECT: &'static str = "rpc.v1.Auth.EnvelopeExpansions.Approve";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.EnvelopeExpansions.List`.
pub struct AuthEnvelopeExpansionsListRpc;
impl RpcDescriptor for AuthEnvelopeExpansionsListRpc {
    type Input = super::types::AuthEnvelopeExpansionsListRequest;
    type Output = super::types::AuthEnvelopeExpansionsListResponse;
    const KEY: &'static str = "Auth.EnvelopeExpansions.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.EnvelopeExpansions.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.EnvelopeExpansions.Reject`.
pub struct AuthEnvelopeExpansionsRejectRpc;
impl RpcDescriptor for AuthEnvelopeExpansionsRejectRpc {
    type Input = super::types::AuthEnvelopeExpansionsRejectRequest;
    type Output = super::types::AuthEnvelopeExpansionsRejectResponse;
    const KEY: &'static str = "Auth.EnvelopeExpansions.Reject";
    const SUBJECT: &'static str = "rpc.v1.Auth.EnvelopeExpansions.Reject";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.Changes.Preview`.
pub struct AuthEnvelopesChangesPreviewRpc;
impl RpcDescriptor for AuthEnvelopesChangesPreviewRpc {
    type Input = super::types::AuthEnvelopesChangesPreviewRequest;
    type Output = super::types::AuthEnvelopesChangesPreviewResponse;
    const KEY: &'static str = "Auth.Envelopes.Changes.Preview";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.Changes.Preview";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.Expand`.
pub struct AuthEnvelopesExpandRpc;
impl RpcDescriptor for AuthEnvelopesExpandRpc {
    type Input = super::types::AuthEnvelopesExpandRequest;
    type Output = super::types::AuthEnvelopesExpandResponse;
    const KEY: &'static str = "Auth.Envelopes.Expand";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.Expand";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.Get`.
pub struct AuthEnvelopesGetRpc;
impl RpcDescriptor for AuthEnvelopesGetRpc {
    type Input = super::types::AuthEnvelopesGetRequest;
    type Output = super::types::AuthEnvelopesGetResponse;
    const KEY: &'static str = "Auth.Envelopes.Get";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.GrantOverrides.List`.
pub struct AuthEnvelopesGrantOverridesListRpc;
impl RpcDescriptor for AuthEnvelopesGrantOverridesListRpc {
    type Input = super::types::AuthEnvelopesGrantOverridesListRequest;
    type Output = super::types::AuthEnvelopesGrantOverridesListResponse;
    const KEY: &'static str = "Auth.Envelopes.GrantOverrides.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.GrantOverrides.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.GrantOverrides.Put`.
pub struct AuthEnvelopesGrantOverridesPutRpc;
impl RpcDescriptor for AuthEnvelopesGrantOverridesPutRpc {
    type Input = super::types::AuthEnvelopesGrantOverridesPutRequest;
    type Output = super::types::AuthEnvelopesGrantOverridesPutResponse;
    const KEY: &'static str = "Auth.Envelopes.GrantOverrides.Put";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.GrantOverrides.Put";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.GrantOverrides.Remove`.
pub struct AuthEnvelopesGrantOverridesRemoveRpc;
impl RpcDescriptor for AuthEnvelopesGrantOverridesRemoveRpc {
    type Input = super::types::AuthEnvelopesGrantOverridesRemoveRequest;
    type Output = super::types::AuthEnvelopesGrantOverridesRemoveResponse;
    const KEY: &'static str = "Auth.Envelopes.GrantOverrides.Remove";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.GrantOverrides.Remove";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.List`.
pub struct AuthEnvelopesListRpc;
impl RpcDescriptor for AuthEnvelopesListRpc {
    type Input = super::types::AuthEnvelopesListRequest;
    type Output = super::types::AuthEnvelopesListResponse;
    const KEY: &'static str = "Auth.Envelopes.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Envelopes.Shrink`.
pub struct AuthEnvelopesShrinkRpc;
impl RpcDescriptor for AuthEnvelopesShrinkRpc {
    type Input = super::types::AuthEnvelopesShrinkRequest;
    type Output = super::types::AuthEnvelopesShrinkResponse;
    const KEY: &'static str = "Auth.Envelopes.Shrink";
    const SUBJECT: &'static str = "rpc.v1.Auth.Envelopes.Shrink";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Health`.
pub struct AuthHealthRpc;
impl RpcDescriptor for AuthHealthRpc {
    type Input = Empty;
    type Output = super::types::AuthHealthResponse;
    const KEY: &'static str = "Auth.Health";
    const SUBJECT: &'static str = "rpc.v1.Auth.Health";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}
/// Descriptor for `Auth.Identities.Grants.List`.
pub struct AuthIdentitiesGrantsListRpc;
impl RpcDescriptor for AuthIdentitiesGrantsListRpc {
    type Input = super::types::AuthIdentitiesGrantsListRequest;
    type Output = super::types::AuthIdentitiesGrantsListResponse;
    const KEY: &'static str = "Auth.Identities.Grants.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Identities.Grants.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError"];
}
/// Descriptor for `Auth.Identities.List`.
pub struct AuthIdentitiesListRpc;
impl RpcDescriptor for AuthIdentitiesListRpc {
    type Input = super::types::AuthIdentitiesListRequest;
    type Output = super::types::AuthIdentitiesListResponse;
    const KEY: &'static str = "Auth.Identities.List";
    const SUBJECT: &'static str = "rpc.v1.Auth.Identities.List";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.IdentityEnvelopes.Revoke`.
pub struct AuthIdentityEnvelopesRevokeRpc;
impl RpcDescriptor for AuthIdentityEnvelopesRevokeRpc {
    type Input = super::types::AuthIdentityEnvelopesRevokeRequest;
    type Output = super::types::AuthIdentityEnvelopesRevokeResponse;
    const KEY: &'static str = "Auth.IdentityEnvelopes.Revoke";
    const SUBJECT: &'static str = "rpc.v1.Auth.IdentityEnvelopes.Revoke";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
/// Descriptor for `Auth.Portals.Get`.
pub struct AuthPortalsGetRpc;
impl RpcDescriptor for AuthPortalsGetRpc {
    type Input = super::types::AuthPortalsGetRequest;
    type Output = super::types::AuthPortalsGetResponse;
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
    const KEY: &'static str = "Auth.Users.Update";
    const SUBJECT: &'static str = "rpc.v1.Auth.Users.Update";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["admin"];
    const ERRORS: &'static [&'static str] = &["AuthError", "UnexpectedError", "ValidationError"];
}
