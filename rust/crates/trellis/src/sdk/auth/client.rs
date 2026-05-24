//! Thin typed client helpers for `trellis.auth@v1`.
use crate::client::TrellisClientError;
/// Typed API wrapper for the `trellis.auth@v1` contract.
pub struct AuthClient<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a crate::client::TrellisClient) -> Self {
        Self { inner }
    }
    /// Call `Auth.Capabilities.List`.
    pub async fn auth_capabilities_list(
        &self,
        input: &super::types::AuthCapabilitiesListRequest,
    ) -> Result<super::types::AuthCapabilitiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilitiesListRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Delete`.
    pub async fn auth_capability_groups_delete(
        &self,
        input: &super::types::AuthCapabilityGroupsDeleteRequest,
    ) -> Result<super::types::AuthCapabilityGroupsDeleteResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsDeleteRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Get`.
    pub async fn auth_capability_groups_get(
        &self,
        input: &super::types::AuthCapabilityGroupsGetRequest,
    ) -> Result<super::types::AuthCapabilityGroupsGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsGetRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.List`.
    pub async fn auth_capability_groups_list(
        &self,
        input: &super::types::AuthCapabilityGroupsListRequest,
    ) -> Result<super::types::AuthCapabilityGroupsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsListRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Put`.
    pub async fn auth_capability_groups_put(
        &self,
        input: &super::types::AuthCapabilityGroupsPutRequest,
    ) -> Result<super::types::AuthCapabilityGroupsPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsPutRpc>(input)
            .await
    }
    /// Call `Auth.CatalogIssues.Resolve`.
    pub async fn auth_catalog_issues_resolve(
        &self,
        input: &super::types::AuthCatalogIssuesResolveRequest,
    ) -> Result<super::types::AuthCatalogIssuesResolveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCatalogIssuesResolveRpc>(input)
            .await
    }
    /// Call `Auth.Connections.Kick`.
    pub async fn auth_connections_kick(
        &self,
        input: &super::types::AuthConnectionsKickRequest,
    ) -> Result<super::types::AuthConnectionsKickResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthConnectionsKickRpc>(input)
            .await
    }
    /// Call `Auth.Connections.List`.
    pub async fn auth_connections_list(
        &self,
        input: &super::types::AuthConnectionsListRequest,
    ) -> Result<super::types::AuthConnectionsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthConnectionsListRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Create`.
    pub async fn auth_deployments_create(
        &self,
        input: &super::types::AuthDeploymentsCreateRequest,
    ) -> Result<super::types::AuthDeploymentsCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsCreateRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Disable`.
    pub async fn auth_deployments_disable(
        &self,
        input: &super::types::AuthDeploymentsDisableRequest,
    ) -> Result<super::types::AuthDeploymentsDisableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsDisableRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Enable`.
    pub async fn auth_deployments_enable(
        &self,
        input: &super::types::AuthDeploymentsEnableRequest,
    ) -> Result<super::types::AuthDeploymentsEnableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsEnableRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.List`.
    pub async fn auth_deployments_list(
        &self,
        input: &super::types::AuthDeploymentsListRequest,
    ) -> Result<super::types::AuthDeploymentsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsListRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Remove`.
    pub async fn auth_deployments_remove(
        &self,
        input: &super::types::AuthDeploymentsRemoveRequest,
    ) -> Result<super::types::AuthDeploymentsRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsRemoveRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.List`.
    pub async fn auth_device_user_authorities_list(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesListRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesListRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Reviews.Decide`.
    pub async fn auth_device_user_authorities_reviews_decide(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesReviewsDecideRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesReviewsDecideResponse, TrellisClientError>
    {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesReviewsDecideRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Reviews.List`.
    pub async fn auth_device_user_authorities_reviews_list(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesReviewsListRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesReviewsListResponse, TrellisClientError>
    {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesReviewsListRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Revoke`.
    pub async fn auth_device_user_authorities_revoke(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesRevokeRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesRevokeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesRevokeRpc>(input)
            .await
    }
    /// Call `Auth.Devices.ConnectInfo.Get`.
    pub async fn auth_devices_connect_info_get(
        &self,
        input: &super::types::AuthDevicesConnectInfoGetRequest,
    ) -> Result<super::types::AuthDevicesConnectInfoGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesConnectInfoGetRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Disable`.
    pub async fn auth_devices_disable(
        &self,
        input: &super::types::AuthDevicesDisableRequest,
    ) -> Result<super::types::AuthDevicesDisableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesDisableRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Enable`.
    pub async fn auth_devices_enable(
        &self,
        input: &super::types::AuthDevicesEnableRequest,
    ) -> Result<super::types::AuthDevicesEnableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesEnableRpc>(input)
            .await
    }
    /// Call `Auth.Devices.List`.
    pub async fn auth_devices_list(
        &self,
        input: &super::types::AuthDevicesListRequest,
    ) -> Result<super::types::AuthDevicesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesListRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Provision`.
    pub async fn auth_devices_provision(
        &self,
        input: &super::types::AuthDevicesProvisionRequest,
    ) -> Result<super::types::AuthDevicesProvisionResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesProvisionRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Remove`.
    pub async fn auth_devices_remove(
        &self,
        input: &super::types::AuthDevicesRemoveRequest,
    ) -> Result<super::types::AuthDevicesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.EnvelopeExpansions.Approve`.
    pub async fn auth_envelope_expansions_approve(
        &self,
        input: &super::types::AuthEnvelopeExpansionsApproveRequest,
    ) -> Result<super::types::AuthEnvelopeExpansionsApproveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopeExpansionsApproveRpc>(input)
            .await
    }
    /// Call `Auth.EnvelopeExpansions.List`.
    pub async fn auth_envelope_expansions_list(
        &self,
        input: &super::types::AuthEnvelopeExpansionsListRequest,
    ) -> Result<super::types::AuthEnvelopeExpansionsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopeExpansionsListRpc>(input)
            .await
    }
    /// Call `Auth.EnvelopeExpansions.Reject`.
    pub async fn auth_envelope_expansions_reject(
        &self,
        input: &super::types::AuthEnvelopeExpansionsRejectRequest,
    ) -> Result<super::types::AuthEnvelopeExpansionsRejectResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopeExpansionsRejectRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Changes.Preview`.
    pub async fn auth_envelopes_changes_preview(
        &self,
        input: &super::types::AuthEnvelopesChangesPreviewRequest,
    ) -> Result<super::types::AuthEnvelopesChangesPreviewResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesChangesPreviewRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Expand`.
    pub async fn auth_envelopes_expand(
        &self,
        input: &super::types::AuthEnvelopesExpandRequest,
    ) -> Result<super::types::AuthEnvelopesExpandResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesExpandRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Get`.
    pub async fn auth_envelopes_get(
        &self,
        input: &super::types::AuthEnvelopesGetRequest,
    ) -> Result<super::types::AuthEnvelopesGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGetRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.GrantOverrides.List`.
    pub async fn auth_envelopes_grant_overrides_list(
        &self,
        input: &super::types::AuthEnvelopesGrantOverridesListRequest,
    ) -> Result<super::types::AuthEnvelopesGrantOverridesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGrantOverridesListRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.GrantOverrides.Put`.
    pub async fn auth_envelopes_grant_overrides_put(
        &self,
        input: &super::types::AuthEnvelopesGrantOverridesPutRequest,
    ) -> Result<super::types::AuthEnvelopesGrantOverridesPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGrantOverridesPutRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.GrantOverrides.Remove`.
    pub async fn auth_envelopes_grant_overrides_remove(
        &self,
        input: &super::types::AuthEnvelopesGrantOverridesRemoveRequest,
    ) -> Result<super::types::AuthEnvelopesGrantOverridesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGrantOverridesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.List`.
    pub async fn auth_envelopes_list(
        &self,
        input: &super::types::AuthEnvelopesListRequest,
    ) -> Result<super::types::AuthEnvelopesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesListRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Shrink`.
    pub async fn auth_envelopes_shrink(
        &self,
        input: &super::types::AuthEnvelopesShrinkRequest,
    ) -> Result<super::types::AuthEnvelopesShrinkResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesShrinkRpc>(input)
            .await
    }
    /// Call `Auth.Health`.
    pub async fn auth_health(
        &self,
    ) -> Result<super::types::AuthHealthResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthHealthRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Auth.Identities.Grants.List`.
    pub async fn auth_identities_grants_list(
        &self,
        input: &super::types::AuthIdentitiesGrantsListRequest,
    ) -> Result<super::types::AuthIdentitiesGrantsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthIdentitiesGrantsListRpc>(input)
            .await
    }
    /// Call `Auth.Identities.List`.
    pub async fn auth_identities_list(
        &self,
        input: &super::types::AuthIdentitiesListRequest,
    ) -> Result<super::types::AuthIdentitiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthIdentitiesListRpc>(input)
            .await
    }
    /// Call `Auth.IdentityEnvelopes.Revoke`.
    pub async fn auth_identity_envelopes_revoke(
        &self,
        input: &super::types::AuthIdentityEnvelopesRevokeRequest,
    ) -> Result<super::types::AuthIdentityEnvelopesRevokeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthIdentityEnvelopesRevokeRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Get`.
    pub async fn auth_portals_get(
        &self,
        input: &super::types::AuthPortalsGetRequest,
    ) -> Result<super::types::AuthPortalsGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsGetRpc>(input)
            .await
    }
    /// Call `Auth.Portals.List`.
    pub async fn auth_portals_list(
        &self,
        input: &super::types::AuthPortalsListRequest,
    ) -> Result<super::types::AuthPortalsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsListRpc>(input)
            .await
    }
    /// Call `Auth.Portals.LoginSettings.Get`.
    pub async fn auth_portals_login_settings_get(
        &self,
        input: &super::types::AuthPortalsLoginSettingsGetRequest,
    ) -> Result<super::types::AuthPortalsLoginSettingsGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsLoginSettingsGetRpc>(input)
            .await
    }
    /// Call `Auth.Portals.LoginSettings.Update`.
    pub async fn auth_portals_login_settings_update(
        &self,
        input: &super::types::AuthPortalsLoginSettingsUpdateRequest,
    ) -> Result<super::types::AuthPortalsLoginSettingsUpdateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsLoginSettingsUpdateRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Put`.
    pub async fn auth_portals_put(
        &self,
        input: &super::types::AuthPortalsPutRequest,
    ) -> Result<super::types::AuthPortalsPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsPutRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Remove`.
    pub async fn auth_portals_remove(
        &self,
        input: &super::types::AuthPortalsRemoveRequest,
    ) -> Result<super::types::AuthPortalsRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Routes.Put`.
    pub async fn auth_portals_routes_put(
        &self,
        input: &super::types::AuthPortalsRoutesPutRequest,
    ) -> Result<super::types::AuthPortalsRoutesPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsRoutesPutRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Routes.Remove`.
    pub async fn auth_portals_routes_remove(
        &self,
        input: &super::types::AuthPortalsRoutesRemoveRequest,
    ) -> Result<super::types::AuthPortalsRoutesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsRoutesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Requests.Validate`.
    pub async fn auth_requests_validate(
        &self,
        input: &super::types::AuthRequestsValidateRequest,
    ) -> Result<super::types::AuthRequestsValidateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthRequestsValidateRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Disable`.
    pub async fn auth_service_instances_disable(
        &self,
        input: &super::types::AuthServiceInstancesDisableRequest,
    ) -> Result<super::types::AuthServiceInstancesDisableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesDisableRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Enable`.
    pub async fn auth_service_instances_enable(
        &self,
        input: &super::types::AuthServiceInstancesEnableRequest,
    ) -> Result<super::types::AuthServiceInstancesEnableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesEnableRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.List`.
    pub async fn auth_service_instances_list(
        &self,
        input: &super::types::AuthServiceInstancesListRequest,
    ) -> Result<super::types::AuthServiceInstancesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesListRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Provision`.
    pub async fn auth_service_instances_provision(
        &self,
        input: &super::types::AuthServiceInstancesProvisionRequest,
    ) -> Result<super::types::AuthServiceInstancesProvisionResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesProvisionRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Remove`.
    pub async fn auth_service_instances_remove(
        &self,
        input: &super::types::AuthServiceInstancesRemoveRequest,
    ) -> Result<super::types::AuthServiceInstancesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Sessions.List`.
    pub async fn auth_sessions_list(
        &self,
        input: &super::types::AuthSessionsListRequest,
    ) -> Result<super::types::AuthSessionsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsListRpc>(input)
            .await
    }
    /// Call `Auth.Sessions.Logout`.
    pub async fn auth_sessions_logout(
        &self,
    ) -> Result<super::types::AuthSessionsLogoutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsLogoutRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Auth.Sessions.Me`.
    pub async fn auth_sessions_me(
        &self,
    ) -> Result<super::types::AuthSessionsMeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsMeRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Auth.Sessions.Revoke`.
    pub async fn auth_sessions_revoke(
        &self,
        input: &super::types::AuthSessionsRevokeRequest,
    ) -> Result<super::types::AuthSessionsRevokeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsRevokeRpc>(input)
            .await
    }
    /// Call `Auth.UserIdentities.List`.
    pub async fn auth_user_identities_list(
        &self,
        input: &super::types::AuthUserIdentitiesListRequest,
    ) -> Result<super::types::AuthUserIdentitiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUserIdentitiesListRpc>(input)
            .await
    }
    /// Call `Auth.UserIdentities.Unlink`.
    pub async fn auth_user_identities_unlink(
        &self,
        input: &super::types::AuthUserIdentitiesUnlinkRequest,
    ) -> Result<super::types::AuthUserIdentitiesUnlinkResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUserIdentitiesUnlinkRpc>(input)
            .await
    }
    /// Call `Auth.Users.Create`.
    pub async fn auth_users_create(
        &self,
        input: &super::types::AuthUsersCreateRequest,
    ) -> Result<super::types::AuthUsersCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersCreateRpc>(input)
            .await
    }
    /// Call `Auth.Users.Get`.
    pub async fn auth_users_get(
        &self,
        input: &super::types::AuthUsersGetRequest,
    ) -> Result<super::types::AuthUsersGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::AuthUsersGetRpc>(input).await
    }
    /// Call `Auth.Users.IdentityLink.Create`.
    pub async fn auth_users_identity_link_create(
        &self,
        input: &super::types::AuthUsersIdentityLinkCreateRequest,
    ) -> Result<super::types::AuthUsersIdentityLinkCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersIdentityLinkCreateRpc>(input)
            .await
    }
    /// Call `Auth.Users.List`.
    pub async fn auth_users_list(
        &self,
        input: &super::types::AuthUsersListRequest,
    ) -> Result<super::types::AuthUsersListResponse, TrellisClientError> {
        self.inner.call::<super::rpc::AuthUsersListRpc>(input).await
    }
    /// Call `Auth.Users.Password.Change`.
    pub async fn auth_users_password_change(
        &self,
        input: &super::types::AuthUsersPasswordChangeRequest,
    ) -> Result<super::types::AuthUsersPasswordChangeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersPasswordChangeRpc>(input)
            .await
    }
    /// Call `Auth.Users.PasswordReset.Create`.
    pub async fn auth_users_password_reset_create(
        &self,
        input: &super::types::AuthUsersPasswordResetCreateRequest,
    ) -> Result<super::types::AuthUsersPasswordResetCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersPasswordResetCreateRpc>(input)
            .await
    }
    /// Call `Auth.Users.Update`.
    pub async fn auth_users_update(
        &self,
        input: &super::types::AuthUsersUpdateRequest,
    ) -> Result<super::types::AuthUsersUpdateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersUpdateRpc>(input)
            .await
    }
    /// Start or control `Auth.DeviceUserAuthorities.Resolve`.
    pub fn auth_device_user_authorities_resolve(
        &self,
    ) -> crate::client::OperationInvoker<
        'a,
        crate::client::TrellisClient,
        super::operations::AuthDeviceUserAuthoritiesResolveOperation,
    > {
        self.inner
            .operation::<super::operations::AuthDeviceUserAuthoritiesResolveOperation>()
    }
    /// Publish `Auth.Connections.Closed`.
    pub async fn publish_auth_connections_closed(
        &self,
        event: &super::types::AuthConnectionsClosedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsClosedEventDescriptor>(event)
            .await
    }
    /// Publish `Auth.Connections.Kicked`.
    pub async fn publish_auth_connections_kicked(
        &self,
        event: &super::types::AuthConnectionsKickedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsKickedEventDescriptor>(event)
            .await
    }
    /// Publish `Auth.Connections.Opened`.
    pub async fn publish_auth_connections_opened(
        &self,
        event: &super::types::AuthConnectionsOpenedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsOpenedEventDescriptor>(event)
            .await
    }
    /// Publish `Auth.DeviceUserAuthorities.Approved`.
    pub async fn publish_auth_device_user_authorities_approved(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesApprovedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesApprovedEventDescriptor>(event)
            .await
    }
    /// Publish `Auth.DeviceUserAuthorities.Requested`.
    pub async fn publish_auth_device_user_authorities_requested(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesRequestedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesRequestedEventDescriptor>(event)
            .await
    }
    /// Publish `Auth.DeviceUserAuthorities.Resolved`.
    pub async fn publish_auth_device_user_authorities_resolved(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesResolvedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesResolvedEventDescriptor>(event)
            .await
    }
    /// Publish `Auth.DeviceUserAuthorities.ReviewRequested`.
    pub async fn publish_auth_device_user_authorities_review_requested(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesReviewRequestedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesReviewRequestedEventDescriptor>(
                event,
            )
            .await
    }
    /// Publish `Auth.Sessions.Revoked`.
    pub async fn publish_auth_sessions_revoked(
        &self,
        event: &super::types::AuthSessionsRevokedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthSessionsRevokedEventDescriptor>(event)
            .await
    }
}
