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
    /// Access typed RPC calls.
    pub fn rpc(&self) -> Rpc<'a> {
        Rpc { _inner: self.inner }
    }
    /// Access typed events.
    pub fn event(&self) -> Event<'a> {
        Event { _inner: self.inner }
    }
    /// Access typed feeds.
    pub fn feed(&self) -> Feed<'a> {
        Feed { _inner: self.inner }
    }
    /// Access typed operations.
    pub fn operation(&self) -> Operation<'a> {
        Operation { _inner: self.inner }
    }
}
/// Typed RPC surface.
pub struct Rpc<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Rpc<'a> {
    pub fn auth(&self) -> AuthRpc<'a> {
        AuthRpc { inner: self._inner }
    }
}
pub struct AuthRpc<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthRpc<'a> {
    /// Call `Auth.Capabilities.List`.
    pub async fn capabilities_list(
        &self,
        input: &super::types::AuthCapabilitiesListRequest,
    ) -> Result<super::types::AuthCapabilitiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilitiesListRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Delete`.
    pub async fn capability_groups_delete(
        &self,
        input: &super::types::AuthCapabilityGroupsDeleteRequest,
    ) -> Result<super::types::AuthCapabilityGroupsDeleteResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsDeleteRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Get`.
    pub async fn capability_groups_get(
        &self,
        input: &super::types::AuthCapabilityGroupsGetRequest,
    ) -> Result<super::types::AuthCapabilityGroupsGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsGetRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.List`.
    pub async fn capability_groups_list(
        &self,
        input: &super::types::AuthCapabilityGroupsListRequest,
    ) -> Result<super::types::AuthCapabilityGroupsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsListRpc>(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Put`.
    pub async fn capability_groups_put(
        &self,
        input: &super::types::AuthCapabilityGroupsPutRequest,
    ) -> Result<super::types::AuthCapabilityGroupsPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCapabilityGroupsPutRpc>(input)
            .await
    }
    /// Call `Auth.CatalogIssues.Resolve`.
    pub async fn catalog_issues_resolve(
        &self,
        input: &super::types::AuthCatalogIssuesResolveRequest,
    ) -> Result<super::types::AuthCatalogIssuesResolveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthCatalogIssuesResolveRpc>(input)
            .await
    }
    /// Call `Auth.Connections.Kick`.
    pub async fn connections_kick(
        &self,
        input: &super::types::AuthConnectionsKickRequest,
    ) -> Result<super::types::AuthConnectionsKickResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthConnectionsKickRpc>(input)
            .await
    }
    /// Call `Auth.Connections.List`.
    pub async fn connections_list(
        &self,
        input: &super::types::AuthConnectionsListRequest,
    ) -> Result<super::types::AuthConnectionsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthConnectionsListRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Create`.
    pub async fn deployments_create(
        &self,
        input: &super::types::AuthDeploymentsCreateRequest,
    ) -> Result<super::types::AuthDeploymentsCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsCreateRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Disable`.
    pub async fn deployments_disable(
        &self,
        input: &super::types::AuthDeploymentsDisableRequest,
    ) -> Result<super::types::AuthDeploymentsDisableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsDisableRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Enable`.
    pub async fn deployments_enable(
        &self,
        input: &super::types::AuthDeploymentsEnableRequest,
    ) -> Result<super::types::AuthDeploymentsEnableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsEnableRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.List`.
    pub async fn deployments_list(
        &self,
        input: &super::types::AuthDeploymentsListRequest,
    ) -> Result<super::types::AuthDeploymentsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsListRpc>(input)
            .await
    }
    /// Call `Auth.Deployments.Remove`.
    pub async fn deployments_remove(
        &self,
        input: &super::types::AuthDeploymentsRemoveRequest,
    ) -> Result<super::types::AuthDeploymentsRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeploymentsRemoveRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.List`.
    pub async fn device_user_authorities_list(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesListRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesListRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Reviews.Decide`.
    pub async fn device_user_authorities_reviews_decide(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesReviewsDecideRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesReviewsDecideResponse, TrellisClientError>
    {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesReviewsDecideRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Reviews.List`.
    pub async fn device_user_authorities_reviews_list(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesReviewsListRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesReviewsListResponse, TrellisClientError>
    {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesReviewsListRpc>(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Revoke`.
    pub async fn device_user_authorities_revoke(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesRevokeRequest,
    ) -> Result<super::types::AuthDeviceUserAuthoritiesRevokeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDeviceUserAuthoritiesRevokeRpc>(input)
            .await
    }
    /// Call `Auth.Devices.ConnectInfo.Get`.
    pub async fn devices_connect_info_get(
        &self,
        input: &super::types::AuthDevicesConnectInfoGetRequest,
    ) -> Result<super::types::AuthDevicesConnectInfoGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesConnectInfoGetRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Disable`.
    pub async fn devices_disable(
        &self,
        input: &super::types::AuthDevicesDisableRequest,
    ) -> Result<super::types::AuthDevicesDisableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesDisableRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Enable`.
    pub async fn devices_enable(
        &self,
        input: &super::types::AuthDevicesEnableRequest,
    ) -> Result<super::types::AuthDevicesEnableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesEnableRpc>(input)
            .await
    }
    /// Call `Auth.Devices.List`.
    pub async fn devices_list(
        &self,
        input: &super::types::AuthDevicesListRequest,
    ) -> Result<super::types::AuthDevicesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesListRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Provision`.
    pub async fn devices_provision(
        &self,
        input: &super::types::AuthDevicesProvisionRequest,
    ) -> Result<super::types::AuthDevicesProvisionResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesProvisionRpc>(input)
            .await
    }
    /// Call `Auth.Devices.Remove`.
    pub async fn devices_remove(
        &self,
        input: &super::types::AuthDevicesRemoveRequest,
    ) -> Result<super::types::AuthDevicesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthDevicesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.EnvelopeExpansions.Approve`.
    pub async fn envelope_expansions_approve(
        &self,
        input: &super::types::AuthEnvelopeExpansionsApproveRequest,
    ) -> Result<super::types::AuthEnvelopeExpansionsApproveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopeExpansionsApproveRpc>(input)
            .await
    }
    /// Call `Auth.EnvelopeExpansions.List`.
    pub async fn envelope_expansions_list(
        &self,
        input: &super::types::AuthEnvelopeExpansionsListRequest,
    ) -> Result<super::types::AuthEnvelopeExpansionsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopeExpansionsListRpc>(input)
            .await
    }
    /// Call `Auth.EnvelopeExpansions.Reject`.
    pub async fn envelope_expansions_reject(
        &self,
        input: &super::types::AuthEnvelopeExpansionsRejectRequest,
    ) -> Result<super::types::AuthEnvelopeExpansionsRejectResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopeExpansionsRejectRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Changes.Preview`.
    pub async fn envelopes_changes_preview(
        &self,
        input: &super::types::AuthEnvelopesChangesPreviewRequest,
    ) -> Result<super::types::AuthEnvelopesChangesPreviewResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesChangesPreviewRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Expand`.
    pub async fn envelopes_expand(
        &self,
        input: &super::types::AuthEnvelopesExpandRequest,
    ) -> Result<super::types::AuthEnvelopesExpandResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesExpandRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Get`.
    pub async fn envelopes_get(
        &self,
        input: &super::types::AuthEnvelopesGetRequest,
    ) -> Result<super::types::AuthEnvelopesGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGetRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.GrantOverrides.List`.
    pub async fn envelopes_grant_overrides_list(
        &self,
        input: &super::types::AuthEnvelopesGrantOverridesListRequest,
    ) -> Result<super::types::AuthEnvelopesGrantOverridesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGrantOverridesListRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.GrantOverrides.Put`.
    pub async fn envelopes_grant_overrides_put(
        &self,
        input: &super::types::AuthEnvelopesGrantOverridesPutRequest,
    ) -> Result<super::types::AuthEnvelopesGrantOverridesPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGrantOverridesPutRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.GrantOverrides.Remove`.
    pub async fn envelopes_grant_overrides_remove(
        &self,
        input: &super::types::AuthEnvelopesGrantOverridesRemoveRequest,
    ) -> Result<super::types::AuthEnvelopesGrantOverridesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesGrantOverridesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.List`.
    pub async fn envelopes_list(
        &self,
        input: &super::types::AuthEnvelopesListRequest,
    ) -> Result<super::types::AuthEnvelopesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesListRpc>(input)
            .await
    }
    /// Call `Auth.Envelopes.Shrink`.
    pub async fn envelopes_shrink(
        &self,
        input: &super::types::AuthEnvelopesShrinkRequest,
    ) -> Result<super::types::AuthEnvelopesShrinkResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthEnvelopesShrinkRpc>(input)
            .await
    }
    /// Call `Auth.Health`.
    pub async fn health(&self) -> Result<super::types::AuthHealthResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthHealthRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Auth.Identities.Grants.List`.
    pub async fn identities_grants_list(
        &self,
        input: &super::types::AuthIdentitiesGrantsListRequest,
    ) -> Result<super::types::AuthIdentitiesGrantsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthIdentitiesGrantsListRpc>(input)
            .await
    }
    /// Call `Auth.Identities.List`.
    pub async fn identities_list(
        &self,
        input: &super::types::AuthIdentitiesListRequest,
    ) -> Result<super::types::AuthIdentitiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthIdentitiesListRpc>(input)
            .await
    }
    /// Call `Auth.IdentityEnvelopes.Revoke`.
    pub async fn identity_envelopes_revoke(
        &self,
        input: &super::types::AuthIdentityEnvelopesRevokeRequest,
    ) -> Result<super::types::AuthIdentityEnvelopesRevokeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthIdentityEnvelopesRevokeRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Get`.
    pub async fn portals_get(
        &self,
        input: &super::types::AuthPortalsGetRequest,
    ) -> Result<super::types::AuthPortalsGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsGetRpc>(input)
            .await
    }
    /// Call `Auth.Portals.List`.
    pub async fn portals_list(
        &self,
        input: &super::types::AuthPortalsListRequest,
    ) -> Result<super::types::AuthPortalsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsListRpc>(input)
            .await
    }
    /// Call `Auth.Portals.LoginSettings.Get`.
    pub async fn portals_login_settings_get(
        &self,
        input: &super::types::AuthPortalsLoginSettingsGetRequest,
    ) -> Result<super::types::AuthPortalsLoginSettingsGetResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsLoginSettingsGetRpc>(input)
            .await
    }
    /// Call `Auth.Portals.LoginSettings.Update`.
    pub async fn portals_login_settings_update(
        &self,
        input: &super::types::AuthPortalsLoginSettingsUpdateRequest,
    ) -> Result<super::types::AuthPortalsLoginSettingsUpdateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsLoginSettingsUpdateRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Put`.
    pub async fn portals_put(
        &self,
        input: &super::types::AuthPortalsPutRequest,
    ) -> Result<super::types::AuthPortalsPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsPutRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Remove`.
    pub async fn portals_remove(
        &self,
        input: &super::types::AuthPortalsRemoveRequest,
    ) -> Result<super::types::AuthPortalsRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Routes.Put`.
    pub async fn portals_routes_put(
        &self,
        input: &super::types::AuthPortalsRoutesPutRequest,
    ) -> Result<super::types::AuthPortalsRoutesPutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsRoutesPutRpc>(input)
            .await
    }
    /// Call `Auth.Portals.Routes.Remove`.
    pub async fn portals_routes_remove(
        &self,
        input: &super::types::AuthPortalsRoutesRemoveRequest,
    ) -> Result<super::types::AuthPortalsRoutesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthPortalsRoutesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Requests.Validate`.
    pub async fn requests_validate(
        &self,
        input: &super::types::AuthRequestsValidateRequest,
    ) -> Result<super::types::AuthRequestsValidateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthRequestsValidateRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Disable`.
    pub async fn service_instances_disable(
        &self,
        input: &super::types::AuthServiceInstancesDisableRequest,
    ) -> Result<super::types::AuthServiceInstancesDisableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesDisableRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Enable`.
    pub async fn service_instances_enable(
        &self,
        input: &super::types::AuthServiceInstancesEnableRequest,
    ) -> Result<super::types::AuthServiceInstancesEnableResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesEnableRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.List`.
    pub async fn service_instances_list(
        &self,
        input: &super::types::AuthServiceInstancesListRequest,
    ) -> Result<super::types::AuthServiceInstancesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesListRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Provision`.
    pub async fn service_instances_provision(
        &self,
        input: &super::types::AuthServiceInstancesProvisionRequest,
    ) -> Result<super::types::AuthServiceInstancesProvisionResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesProvisionRpc>(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Remove`.
    pub async fn service_instances_remove(
        &self,
        input: &super::types::AuthServiceInstancesRemoveRequest,
    ) -> Result<super::types::AuthServiceInstancesRemoveResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthServiceInstancesRemoveRpc>(input)
            .await
    }
    /// Call `Auth.Sessions.List`.
    pub async fn sessions_list(
        &self,
        input: &super::types::AuthSessionsListRequest,
    ) -> Result<super::types::AuthSessionsListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsListRpc>(input)
            .await
    }
    /// Call `Auth.Sessions.Logout`.
    pub async fn sessions_logout(
        &self,
    ) -> Result<super::types::AuthSessionsLogoutResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsLogoutRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Auth.Sessions.Me`.
    pub async fn sessions_me(
        &self,
    ) -> Result<super::types::AuthSessionsMeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsMeRpc>(&super::rpc::Empty {})
            .await
    }
    /// Call `Auth.Sessions.Revoke`.
    pub async fn sessions_revoke(
        &self,
        input: &super::types::AuthSessionsRevokeRequest,
    ) -> Result<super::types::AuthSessionsRevokeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthSessionsRevokeRpc>(input)
            .await
    }
    /// Call `Auth.UserIdentities.List`.
    pub async fn user_identities_list(
        &self,
        input: &super::types::AuthUserIdentitiesListRequest,
    ) -> Result<super::types::AuthUserIdentitiesListResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUserIdentitiesListRpc>(input)
            .await
    }
    /// Call `Auth.UserIdentities.Unlink`.
    pub async fn user_identities_unlink(
        &self,
        input: &super::types::AuthUserIdentitiesUnlinkRequest,
    ) -> Result<super::types::AuthUserIdentitiesUnlinkResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUserIdentitiesUnlinkRpc>(input)
            .await
    }
    /// Call `Auth.Users.Create`.
    pub async fn users_create(
        &self,
        input: &super::types::AuthUsersCreateRequest,
    ) -> Result<super::types::AuthUsersCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersCreateRpc>(input)
            .await
    }
    /// Call `Auth.Users.Get`.
    pub async fn users_get(
        &self,
        input: &super::types::AuthUsersGetRequest,
    ) -> Result<super::types::AuthUsersGetResponse, TrellisClientError> {
        self.inner.call::<super::rpc::AuthUsersGetRpc>(input).await
    }
    /// Call `Auth.Users.IdentityLink.Create`.
    pub async fn users_identity_link_create(
        &self,
        input: &super::types::AuthUsersIdentityLinkCreateRequest,
    ) -> Result<super::types::AuthUsersIdentityLinkCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersIdentityLinkCreateRpc>(input)
            .await
    }
    /// Call `Auth.Users.List`.
    pub async fn users_list(
        &self,
        input: &super::types::AuthUsersListRequest,
    ) -> Result<super::types::AuthUsersListResponse, TrellisClientError> {
        self.inner.call::<super::rpc::AuthUsersListRpc>(input).await
    }
    /// Call `Auth.Users.Password.Change`.
    pub async fn users_password_change(
        &self,
        input: &super::types::AuthUsersPasswordChangeRequest,
    ) -> Result<super::types::AuthUsersPasswordChangeResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersPasswordChangeRpc>(input)
            .await
    }
    /// Call `Auth.Users.PasswordReset.Create`.
    pub async fn users_password_reset_create(
        &self,
        input: &super::types::AuthUsersPasswordResetCreateRequest,
    ) -> Result<super::types::AuthUsersPasswordResetCreateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersPasswordResetCreateRpc>(input)
            .await
    }
    /// Call `Auth.Users.Update`.
    pub async fn users_update(
        &self,
        input: &super::types::AuthUsersUpdateRequest,
    ) -> Result<super::types::AuthUsersUpdateResponse, TrellisClientError> {
        self.inner
            .call::<super::rpc::AuthUsersUpdateRpc>(input)
            .await
    }
}
/// Typed event surface.
pub struct Event<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Event<'a> {
    pub fn auth(&self) -> AuthEvent<'a> {
        AuthEvent { inner: self._inner }
    }
}
pub struct AuthEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthEvent<'a> {
    pub fn connections_closed(&self) -> AuthConnectionsClosedEvent<'a> {
        AuthConnectionsClosedEvent { inner: self.inner }
    }
    pub fn connections_kicked(&self) -> AuthConnectionsKickedEvent<'a> {
        AuthConnectionsKickedEvent { inner: self.inner }
    }
    pub fn connections_opened(&self) -> AuthConnectionsOpenedEvent<'a> {
        AuthConnectionsOpenedEvent { inner: self.inner }
    }
    pub fn device_user_authorities_approved(&self) -> AuthDeviceUserAuthoritiesApprovedEvent<'a> {
        AuthDeviceUserAuthoritiesApprovedEvent { inner: self.inner }
    }
    pub fn device_user_authorities_requested(&self) -> AuthDeviceUserAuthoritiesRequestedEvent<'a> {
        AuthDeviceUserAuthoritiesRequestedEvent { inner: self.inner }
    }
    pub fn device_user_authorities_resolved(&self) -> AuthDeviceUserAuthoritiesResolvedEvent<'a> {
        AuthDeviceUserAuthoritiesResolvedEvent { inner: self.inner }
    }
    pub fn device_user_authorities_review_requested(
        &self,
    ) -> AuthDeviceUserAuthoritiesReviewRequestedEvent<'a> {
        AuthDeviceUserAuthoritiesReviewRequestedEvent { inner: self.inner }
    }
    pub fn sessions_revoked(&self) -> AuthSessionsRevokedEvent<'a> {
        AuthSessionsRevokedEvent { inner: self.inner }
    }
}
pub struct AuthConnectionsClosedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthConnectionsClosedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthConnectionsClosedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsClosedEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthConnectionsClosedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthConnectionsClosedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
pub struct AuthConnectionsKickedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthConnectionsKickedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthConnectionsKickedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsKickedEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthConnectionsKickedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthConnectionsKickedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
pub struct AuthConnectionsOpenedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthConnectionsOpenedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthConnectionsOpenedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsOpenedEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthConnectionsOpenedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthConnectionsOpenedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
pub struct AuthDeviceUserAuthoritiesApprovedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthDeviceUserAuthoritiesApprovedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesApprovedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesApprovedEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthDeviceUserAuthoritiesApprovedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthDeviceUserAuthoritiesApprovedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
pub struct AuthDeviceUserAuthoritiesRequestedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthDeviceUserAuthoritiesRequestedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesRequestedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesRequestedEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthDeviceUserAuthoritiesRequestedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthDeviceUserAuthoritiesRequestedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
pub struct AuthDeviceUserAuthoritiesResolvedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthDeviceUserAuthoritiesResolvedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesResolvedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesResolvedEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthDeviceUserAuthoritiesResolvedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthDeviceUserAuthoritiesResolvedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
pub struct AuthDeviceUserAuthoritiesReviewRequestedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthDeviceUserAuthoritiesReviewRequestedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesReviewRequestedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesReviewRequestedEventDescriptor>(
                event,
            )
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthDeviceUserAuthoritiesReviewRequestedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthDeviceUserAuthoritiesReviewRequestedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
pub struct AuthSessionsRevokedEvent<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthSessionsRevokedEvent<'a> {
    pub async fn publish(
        &self,
        event: &super::types::AuthSessionsRevokedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthSessionsRevokedEventDescriptor>(event)
            .await
    }
    pub async fn listen<F, Fut>(&self, handler: F) -> Result<(), TrellisClientError>
    where
        F: Fn(super::types::AuthSessionsRevokedEvent) -> Fut,
        Fut: std::future::Future<Output = Result<(), TrellisClientError>>,
    {
        let mut stream = self
            .inner
            .subscribe::<super::events::AuthSessionsRevokedEventDescriptor>()
            .await?;
        while let Some(event) = futures_util::StreamExt::next(&mut stream).await {
            handler(event?).await?;
        }
        Ok(())
    }
}
/// Typed feed surface.
pub struct Feed<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Feed<'a> {}
/// Typed operation surface.
pub struct Operation<'a> {
    pub(crate) _inner: &'a crate::client::TrellisClient,
}
impl<'a> Operation<'a> {
    pub fn auth(&self) -> AuthOperation<'a> {
        AuthOperation { inner: self._inner }
    }
}
pub struct AuthOperation<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthOperation<'a> {
    pub fn device_user_authorities_resolve(&self) -> AuthDeviceUserAuthoritiesResolveOperation<'a> {
        AuthDeviceUserAuthoritiesResolveOperation { inner: self.inner }
    }
}
pub struct AuthDeviceUserAuthoritiesResolveOperation<'a> {
    inner: &'a crate::client::TrellisClient,
}
impl<'a> AuthDeviceUserAuthoritiesResolveOperation<'a> {
    pub async fn start(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesResolveInput,
    ) -> Result<
        crate::client::OperationRef<
            'a,
            crate::client::TrellisClient,
            super::operations::AuthDeviceUserAuthoritiesResolveOperation,
        >,
        TrellisClientError,
    > {
        self.inner
            .operation::<super::operations::AuthDeviceUserAuthoritiesResolveOperation>()
            .start(input)
            .await
    }
}
