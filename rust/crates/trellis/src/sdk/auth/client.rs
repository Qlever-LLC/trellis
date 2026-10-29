//! Thin typed client helpers for `trellis.auth@v1`.
use crate::generated::TrellisClientError;
/// Typed API wrapper for the `trellis.auth@v1` contract.
pub struct AuthClient<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthClient<'a> {
    /// Wrap an already connected low-level Trellis client.
    pub fn new(inner: &'a crate::generated::Caller) -> Self {
        Self { inner }
    }
    #[allow(dead_code)]
    pub(crate) fn inner(&self) -> &'a crate::generated::Caller {
        self.inner
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
    pub(crate) _inner: &'a crate::generated::Caller,
}
impl<'a> Rpc<'a> {
    /// Access the `auth` RPC group.
    pub fn auth(&self) -> AuthRpc<'a> {
        AuthRpc { inner: self._inner }
    }
}
/// Typed RPC methods in the `auth` group.
pub struct AuthRpc<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthRpc<'a> {
    /// Call `Auth.Capabilities.List`.
    pub async fn capabilities_list(
        &self,
        input: &super::types::AuthCapabilitiesListRequest,
    ) -> Result<
        super::types::AuthCapabilitiesListResponse,
        crate::generated::CallError<super::rpc::AuthCapabilitiesListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthCapabilitiesListRpc,
                super::rpc::AuthCapabilitiesListError,
            >(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Delete`.
    pub async fn capability_groups_delete(
        &self,
        input: &super::types::AuthCapabilityGroupsDeleteRequest,
    ) -> Result<
        super::types::AuthCapabilityGroupsDeleteResponse,
        crate::generated::CallError<super::rpc::AuthCapabilityGroupsDeleteError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthCapabilityGroupsDeleteRpc,
                super::rpc::AuthCapabilityGroupsDeleteError,
            >(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Get`.
    pub async fn capability_groups_get(
        &self,
        input: &super::types::AuthCapabilityGroupsGetRequest,
    ) -> Result<
        super::types::AuthCapabilityGroupsGetResponse,
        crate::generated::CallError<super::rpc::AuthCapabilityGroupsGetError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthCapabilityGroupsGetRpc,
                super::rpc::AuthCapabilityGroupsGetError,
            >(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.List`.
    pub async fn capability_groups_list(
        &self,
        input: &super::types::AuthCapabilityGroupsListRequest,
    ) -> Result<
        super::types::AuthCapabilityGroupsListResponse,
        crate::generated::CallError<super::rpc::AuthCapabilityGroupsListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthCapabilityGroupsListRpc,
                super::rpc::AuthCapabilityGroupsListError,
            >(input)
            .await
    }
    /// Call `Auth.CapabilityGroups.Put`.
    pub async fn capability_groups_put(
        &self,
        input: &super::types::AuthCapabilityGroupsPutRequest,
    ) -> Result<
        super::types::AuthCapabilityGroupsPutResponse,
        crate::generated::CallError<super::rpc::AuthCapabilityGroupsPutError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthCapabilityGroupsPutRpc,
                super::rpc::AuthCapabilityGroupsPutError,
            >(input)
            .await
    }
    /// Call `Auth.CatalogIssues.Resolve`.
    pub async fn catalog_issues_resolve(
        &self,
        input: &super::types::AuthCatalogIssuesResolveRequest,
    ) -> Result<
        super::types::AuthCatalogIssuesResolveResponse,
        crate::generated::CallError<super::rpc::AuthCatalogIssuesResolveError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthCatalogIssuesResolveRpc,
                super::rpc::AuthCatalogIssuesResolveError,
            >(input)
            .await
    }
    /// Call `Auth.Connections.Kick`.
    pub async fn connections_kick(
        &self,
        input: &super::types::AuthConnectionsKickRequest,
    ) -> Result<
        super::types::AuthConnectionsKickResponse,
        crate::generated::CallError<super::rpc::AuthConnectionsKickError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthConnectionsKickRpc, super::rpc::AuthConnectionsKickError>(
                input,
            )
            .await
    }
    /// Call `Auth.Connections.List`.
    pub async fn connections_list(
        &self,
        input: &super::types::AuthConnectionsListRequest,
    ) -> Result<
        super::types::AuthConnectionsListResponse,
        crate::generated::CallError<super::rpc::AuthConnectionsListError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthConnectionsListRpc, super::rpc::AuthConnectionsListError>(
                input,
            )
            .await
    }
    /// Call `Auth.DeploymentAuthority.AcceptMigration`.
    pub async fn deployment_authority_accept_migration(
        &self,
        input: &super::types::AuthDeploymentAuthorityAcceptMigrationRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityAcceptMigrationResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityAcceptMigrationError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityAcceptMigrationRpc,
                super::rpc::AuthDeploymentAuthorityAcceptMigrationError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.AcceptUpdate`.
    pub async fn deployment_authority_accept_update(
        &self,
        input: &super::types::AuthDeploymentAuthorityAcceptUpdateRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityAcceptUpdateResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityAcceptUpdateError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityAcceptUpdateRpc,
                super::rpc::AuthDeploymentAuthorityAcceptUpdateError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.Get`.
    pub async fn deployment_authority_get(
        &self,
        input: &super::types::AuthDeploymentAuthorityGetRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityGetResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityGetError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityGetRpc,
                super::rpc::AuthDeploymentAuthorityGetError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.GrantOverrides.List`.
    pub async fn deployment_authority_grant_overrides_list(
        &self,
        input: &super::types::AuthDeploymentAuthorityGrantOverridesListRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityGrantOverridesListResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityGrantOverridesListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityGrantOverridesListRpc,
                super::rpc::AuthDeploymentAuthorityGrantOverridesListError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.GrantOverrides.Put`.
    pub async fn deployment_authority_grant_overrides_put(
        &self,
        input: &super::types::AuthDeploymentAuthorityGrantOverridesPutRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityGrantOverridesPutResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityGrantOverridesPutError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityGrantOverridesPutRpc,
                super::rpc::AuthDeploymentAuthorityGrantOverridesPutError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.GrantOverrides.Remove`.
    pub async fn deployment_authority_grant_overrides_remove(
        &self,
        input: &super::types::AuthDeploymentAuthorityGrantOverridesRemoveRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityGrantOverridesRemoveResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityGrantOverridesRemoveError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityGrantOverridesRemoveRpc,
                super::rpc::AuthDeploymentAuthorityGrantOverridesRemoveError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.List`.
    pub async fn deployment_authority_list(
        &self,
        input: &super::types::AuthDeploymentAuthorityListRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityListResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityListRpc,
                super::rpc::AuthDeploymentAuthorityListError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.Plan`.
    pub async fn deployment_authority_plan(
        &self,
        input: &super::types::AuthDeploymentAuthorityPlanRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityPlanResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityPlanError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityPlanRpc,
                super::rpc::AuthDeploymentAuthorityPlanError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.Plans.Get`.
    pub async fn deployment_authority_plans_get(
        &self,
        input: &super::types::AuthDeploymentAuthorityPlansGetRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityPlansGetResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityPlansGetError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityPlansGetRpc,
                super::rpc::AuthDeploymentAuthorityPlansGetError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.Plans.List`.
    pub async fn deployment_authority_plans_list(
        &self,
        input: &super::types::AuthDeploymentAuthorityPlansListRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityPlansListResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityPlansListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityPlansListRpc,
                super::rpc::AuthDeploymentAuthorityPlansListError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.Reconcile`.
    pub async fn deployment_authority_reconcile(
        &self,
        input: &super::types::AuthDeploymentAuthorityReconcileRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityReconcileResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityReconcileError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityReconcileRpc,
                super::rpc::AuthDeploymentAuthorityReconcileError,
            >(input)
            .await
    }
    /// Call `Auth.DeploymentAuthority.Reject`.
    pub async fn deployment_authority_reject(
        &self,
        input: &super::types::AuthDeploymentAuthorityRejectRequest,
    ) -> Result<
        super::types::AuthDeploymentAuthorityRejectResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentAuthorityRejectError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentAuthorityRejectRpc,
                super::rpc::AuthDeploymentAuthorityRejectError,
            >(input)
            .await
    }
    /// Call `Auth.Deployments.Create`.
    pub async fn deployments_create(
        &self,
        input: &super::types::AuthDeploymentsCreateRequest,
    ) -> Result<
        super::types::AuthDeploymentsCreateResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentsCreateError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentsCreateRpc,
                super::rpc::AuthDeploymentsCreateError,
            >(input)
            .await
    }
    /// Call `Auth.Deployments.Disable`.
    pub async fn deployments_disable(
        &self,
        input: &super::types::AuthDeploymentsDisableRequest,
    ) -> Result<
        super::types::AuthDeploymentsDisableResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentsDisableError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentsDisableRpc,
                super::rpc::AuthDeploymentsDisableError,
            >(input)
            .await
    }
    /// Call `Auth.Deployments.Enable`.
    pub async fn deployments_enable(
        &self,
        input: &super::types::AuthDeploymentsEnableRequest,
    ) -> Result<
        super::types::AuthDeploymentsEnableResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentsEnableError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentsEnableRpc,
                super::rpc::AuthDeploymentsEnableError,
            >(input)
            .await
    }
    /// Call `Auth.Deployments.List`.
    pub async fn deployments_list(
        &self,
        input: &super::types::AuthDeploymentsListRequest,
    ) -> Result<
        super::types::AuthDeploymentsListResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentsListError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthDeploymentsListRpc, super::rpc::AuthDeploymentsListError>(
                input,
            )
            .await
    }
    /// Call `Auth.Deployments.Remove`.
    pub async fn deployments_remove(
        &self,
        input: &super::types::AuthDeploymentsRemoveRequest,
    ) -> Result<
        super::types::AuthDeploymentsRemoveResponse,
        crate::generated::CallError<super::rpc::AuthDeploymentsRemoveError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeploymentsRemoveRpc,
                super::rpc::AuthDeploymentsRemoveError,
            >(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.List`.
    pub async fn device_user_authorities_list(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesListRequest,
    ) -> Result<
        super::types::AuthDeviceUserAuthoritiesListResponse,
        crate::generated::CallError<super::rpc::AuthDeviceUserAuthoritiesListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeviceUserAuthoritiesListRpc,
                super::rpc::AuthDeviceUserAuthoritiesListError,
            >(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Reviews.Decide`.
    pub async fn device_user_authorities_reviews_decide(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesReviewsDecideRequest,
    ) -> Result<
        super::types::AuthDeviceUserAuthoritiesReviewsDecideResponse,
        crate::generated::CallError<super::rpc::AuthDeviceUserAuthoritiesReviewsDecideError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeviceUserAuthoritiesReviewsDecideRpc,
                super::rpc::AuthDeviceUserAuthoritiesReviewsDecideError,
            >(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Reviews.List`.
    pub async fn device_user_authorities_reviews_list(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesReviewsListRequest,
    ) -> Result<
        super::types::AuthDeviceUserAuthoritiesReviewsListResponse,
        crate::generated::CallError<super::rpc::AuthDeviceUserAuthoritiesReviewsListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeviceUserAuthoritiesReviewsListRpc,
                super::rpc::AuthDeviceUserAuthoritiesReviewsListError,
            >(input)
            .await
    }
    /// Call `Auth.DeviceUserAuthorities.Revoke`.
    pub async fn device_user_authorities_revoke(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesRevokeRequest,
    ) -> Result<
        super::types::AuthDeviceUserAuthoritiesRevokeResponse,
        crate::generated::CallError<super::rpc::AuthDeviceUserAuthoritiesRevokeError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDeviceUserAuthoritiesRevokeRpc,
                super::rpc::AuthDeviceUserAuthoritiesRevokeError,
            >(input)
            .await
    }
    /// Call `Auth.Devices.ConnectInfo.Get`.
    pub async fn devices_connect_info_get(
        &self,
        input: &super::types::AuthDevicesConnectInfoGetRequest,
    ) -> Result<
        super::types::AuthDevicesConnectInfoGetResponse,
        crate::generated::CallError<super::rpc::AuthDevicesConnectInfoGetError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDevicesConnectInfoGetRpc,
                super::rpc::AuthDevicesConnectInfoGetError,
            >(input)
            .await
    }
    /// Call `Auth.Devices.Disable`.
    pub async fn devices_disable(
        &self,
        input: &super::types::AuthDevicesDisableRequest,
    ) -> Result<
        super::types::AuthDevicesDisableResponse,
        crate::generated::CallError<super::rpc::AuthDevicesDisableError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthDevicesDisableRpc, super::rpc::AuthDevicesDisableError>(
                input,
            )
            .await
    }
    /// Call `Auth.Devices.Enable`.
    pub async fn devices_enable(
        &self,
        input: &super::types::AuthDevicesEnableRequest,
    ) -> Result<
        super::types::AuthDevicesEnableResponse,
        crate::generated::CallError<super::rpc::AuthDevicesEnableError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthDevicesEnableRpc, super::rpc::AuthDevicesEnableError>(
                input,
            )
            .await
    }
    /// Call `Auth.Devices.List`.
    pub async fn devices_list(
        &self,
        input: &super::types::AuthDevicesListRequest,
    ) -> Result<
        super::types::AuthDevicesListResponse,
        crate::generated::CallError<super::rpc::AuthDevicesListError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthDevicesListRpc, super::rpc::AuthDevicesListError>(input)
            .await
    }
    /// Call `Auth.Devices.Provision`.
    pub async fn devices_provision(
        &self,
        input: &super::types::AuthDevicesProvisionRequest,
    ) -> Result<
        super::types::AuthDevicesProvisionResponse,
        crate::generated::CallError<super::rpc::AuthDevicesProvisionError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthDevicesProvisionRpc,
                super::rpc::AuthDevicesProvisionError,
            >(input)
            .await
    }
    /// Call `Auth.Devices.Remove`.
    pub async fn devices_remove(
        &self,
        input: &super::types::AuthDevicesRemoveRequest,
    ) -> Result<
        super::types::AuthDevicesRemoveResponse,
        crate::generated::CallError<super::rpc::AuthDevicesRemoveError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthDevicesRemoveRpc, super::rpc::AuthDevicesRemoveError>(
                input,
            )
            .await
    }
    /// Call `Auth.EventConsumers.List`.
    pub async fn event_consumers_list(
        &self,
        input: &super::types::AuthEventConsumersListRequest,
    ) -> Result<
        super::types::AuthEventConsumersListResponse,
        crate::generated::CallError<super::rpc::AuthEventConsumersListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthEventConsumersListRpc,
                super::rpc::AuthEventConsumersListError,
            >(input)
            .await
    }
    /// Call `Auth.Events.Validate`.
    pub async fn events_validate(
        &self,
        input: &super::types::AuthEventsValidateRequest,
    ) -> Result<
        super::types::AuthEventsValidateResponse,
        crate::generated::CallError<super::rpc::AuthEventsValidateError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthEventsValidateRpc, super::rpc::AuthEventsValidateError>(
                input,
            )
            .await
    }
    /// Call `Auth.Identities.List`.
    pub async fn identities_list(
        &self,
        input: &super::types::AuthIdentitiesListRequest,
    ) -> Result<
        super::types::AuthIdentitiesListResponse,
        crate::generated::CallError<super::rpc::AuthIdentitiesListError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthIdentitiesListRpc, super::rpc::AuthIdentitiesListError>(
                input,
            )
            .await
    }
    /// Call `Auth.IdentityGrants.List`.
    pub async fn identity_grants_list(
        &self,
        input: &super::types::AuthIdentityGrantsListRequest,
    ) -> Result<
        super::types::AuthIdentityGrantsListResponse,
        crate::generated::CallError<super::rpc::AuthIdentityGrantsListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthIdentityGrantsListRpc,
                super::rpc::AuthIdentityGrantsListError,
            >(input)
            .await
    }
    /// Call `Auth.IdentityGrants.Revoke`.
    pub async fn identity_grants_revoke(
        &self,
        input: &super::types::AuthIdentityGrantsRevokeRequest,
    ) -> Result<
        super::types::AuthIdentityGrantsRevokeResponse,
        crate::generated::CallError<super::rpc::AuthIdentityGrantsRevokeError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthIdentityGrantsRevokeRpc,
                super::rpc::AuthIdentityGrantsRevokeError,
            >(input)
            .await
    }
    /// Call `Auth.Portals.Get`.
    pub async fn portals_get(
        &self,
        input: &super::types::AuthPortalsGetRequest,
    ) -> Result<
        super::types::AuthPortalsGetResponse,
        crate::generated::CallError<super::rpc::AuthPortalsGetError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthPortalsGetRpc, super::rpc::AuthPortalsGetError>(input)
            .await
    }
    /// Call `Auth.Portals.List`.
    pub async fn portals_list(
        &self,
        input: &super::types::AuthPortalsListRequest,
    ) -> Result<
        super::types::AuthPortalsListResponse,
        crate::generated::CallError<super::rpc::AuthPortalsListError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthPortalsListRpc, super::rpc::AuthPortalsListError>(input)
            .await
    }
    /// Call `Auth.Portals.LoginSettings.Get`.
    pub async fn portals_login_settings_get(
        &self,
        input: &super::types::AuthPortalsLoginSettingsGetRequest,
    ) -> Result<
        super::types::AuthPortalsLoginSettingsGetResponse,
        crate::generated::CallError<super::rpc::AuthPortalsLoginSettingsGetError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthPortalsLoginSettingsGetRpc,
                super::rpc::AuthPortalsLoginSettingsGetError,
            >(input)
            .await
    }
    /// Call `Auth.Portals.LoginSettings.Update`.
    pub async fn portals_login_settings_update(
        &self,
        input: &super::types::AuthPortalsLoginSettingsUpdateRequest,
    ) -> Result<
        super::types::AuthPortalsLoginSettingsUpdateResponse,
        crate::generated::CallError<super::rpc::AuthPortalsLoginSettingsUpdateError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthPortalsLoginSettingsUpdateRpc,
                super::rpc::AuthPortalsLoginSettingsUpdateError,
            >(input)
            .await
    }
    /// Call `Auth.Portals.Put`.
    pub async fn portals_put(
        &self,
        input: &super::types::AuthPortalsPutRequest,
    ) -> Result<
        super::types::AuthPortalsPutResponse,
        crate::generated::CallError<super::rpc::AuthPortalsPutError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthPortalsPutRpc, super::rpc::AuthPortalsPutError>(input)
            .await
    }
    /// Call `Auth.Portals.Remove`.
    pub async fn portals_remove(
        &self,
        input: &super::types::AuthPortalsRemoveRequest,
    ) -> Result<
        super::types::AuthPortalsRemoveResponse,
        crate::generated::CallError<super::rpc::AuthPortalsRemoveError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthPortalsRemoveRpc, super::rpc::AuthPortalsRemoveError>(
                input,
            )
            .await
    }
    /// Call `Auth.Portals.Routes.Put`.
    pub async fn portals_routes_put(
        &self,
        input: &super::types::AuthPortalsRoutesPutRequest,
    ) -> Result<
        super::types::AuthPortalsRoutesPutResponse,
        crate::generated::CallError<super::rpc::AuthPortalsRoutesPutError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthPortalsRoutesPutRpc,
                super::rpc::AuthPortalsRoutesPutError,
            >(input)
            .await
    }
    /// Call `Auth.Portals.Routes.Remove`.
    pub async fn portals_routes_remove(
        &self,
        input: &super::types::AuthPortalsRoutesRemoveRequest,
    ) -> Result<
        super::types::AuthPortalsRoutesRemoveResponse,
        crate::generated::CallError<super::rpc::AuthPortalsRoutesRemoveError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthPortalsRoutesRemoveRpc,
                super::rpc::AuthPortalsRoutesRemoveError,
            >(input)
            .await
    }
    /// Call `Auth.Requests.Validate`.
    pub async fn requests_validate(
        &self,
        input: &super::types::AuthRequestsValidateRequest,
    ) -> Result<
        super::types::AuthRequestsValidateResponse,
        crate::generated::CallError<super::rpc::AuthRequestsValidateError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthRequestsValidateRpc,
                super::rpc::AuthRequestsValidateError,
            >(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Disable`.
    pub async fn service_instances_disable(
        &self,
        input: &super::types::AuthServiceInstancesDisableRequest,
    ) -> Result<
        super::types::AuthServiceInstancesDisableResponse,
        crate::generated::CallError<super::rpc::AuthServiceInstancesDisableError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthServiceInstancesDisableRpc,
                super::rpc::AuthServiceInstancesDisableError,
            >(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Enable`.
    pub async fn service_instances_enable(
        &self,
        input: &super::types::AuthServiceInstancesEnableRequest,
    ) -> Result<
        super::types::AuthServiceInstancesEnableResponse,
        crate::generated::CallError<super::rpc::AuthServiceInstancesEnableError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthServiceInstancesEnableRpc,
                super::rpc::AuthServiceInstancesEnableError,
            >(input)
            .await
    }
    /// Call `Auth.ServiceInstances.List`.
    pub async fn service_instances_list(
        &self,
        input: &super::types::AuthServiceInstancesListRequest,
    ) -> Result<
        super::types::AuthServiceInstancesListResponse,
        crate::generated::CallError<super::rpc::AuthServiceInstancesListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthServiceInstancesListRpc,
                super::rpc::AuthServiceInstancesListError,
            >(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Provision`.
    pub async fn service_instances_provision(
        &self,
        input: &super::types::AuthServiceInstancesProvisionRequest,
    ) -> Result<
        super::types::AuthServiceInstancesProvisionResponse,
        crate::generated::CallError<super::rpc::AuthServiceInstancesProvisionError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthServiceInstancesProvisionRpc,
                super::rpc::AuthServiceInstancesProvisionError,
            >(input)
            .await
    }
    /// Call `Auth.ServiceInstances.Remove`.
    pub async fn service_instances_remove(
        &self,
        input: &super::types::AuthServiceInstancesRemoveRequest,
    ) -> Result<
        super::types::AuthServiceInstancesRemoveResponse,
        crate::generated::CallError<super::rpc::AuthServiceInstancesRemoveError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthServiceInstancesRemoveRpc,
                super::rpc::AuthServiceInstancesRemoveError,
            >(input)
            .await
    }
    /// Call `Auth.Sessions.List`.
    pub async fn sessions_list(
        &self,
        input: &super::types::AuthSessionsListRequest,
    ) -> Result<
        super::types::AuthSessionsListResponse,
        crate::generated::CallError<super::rpc::AuthSessionsListError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthSessionsListRpc, super::rpc::AuthSessionsListError>(input)
            .await
    }
    /// Call `Auth.Sessions.Logout`.
    pub async fn sessions_logout(
        &self,
    ) -> Result<
        super::types::AuthSessionsLogoutResponse,
        crate::generated::CallError<super::rpc::AuthSessionsLogoutError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthSessionsLogoutRpc, super::rpc::AuthSessionsLogoutError>(
                &super::rpc::Empty {},
            )
            .await
    }
    /// Call `Auth.Sessions.Me`.
    pub async fn sessions_me(
        &self,
    ) -> Result<
        super::types::AuthSessionsMeResponse,
        crate::generated::CallError<super::rpc::AuthSessionsMeError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthSessionsMeRpc, super::rpc::AuthSessionsMeError>(
                &super::rpc::Empty {},
            )
            .await
    }
    /// Call `Auth.Sessions.Revoke`.
    pub async fn sessions_revoke(
        &self,
        input: &super::types::AuthSessionsRevokeRequest,
    ) -> Result<
        super::types::AuthSessionsRevokeResponse,
        crate::generated::CallError<super::rpc::AuthSessionsRevokeError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthSessionsRevokeRpc, super::rpc::AuthSessionsRevokeError>(
                input,
            )
            .await
    }
    /// Call `Auth.UserIdentities.List`.
    pub async fn user_identities_list(
        &self,
        input: &super::types::AuthUserIdentitiesListRequest,
    ) -> Result<
        super::types::AuthUserIdentitiesListResponse,
        crate::generated::CallError<super::rpc::AuthUserIdentitiesListError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUserIdentitiesListRpc,
                super::rpc::AuthUserIdentitiesListError,
            >(input)
            .await
    }
    /// Call `Auth.UserIdentities.Unlink`.
    pub async fn user_identities_unlink(
        &self,
        input: &super::types::AuthUserIdentitiesUnlinkRequest,
    ) -> Result<
        super::types::AuthUserIdentitiesUnlinkResponse,
        crate::generated::CallError<super::rpc::AuthUserIdentitiesUnlinkError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUserIdentitiesUnlinkRpc,
                super::rpc::AuthUserIdentitiesUnlinkError,
            >(input)
            .await
    }
    /// Call `Auth.UserLifecycle.Deactivate`.
    pub async fn user_lifecycle_deactivate(
        &self,
        input: &super::types::AuthUserLifecycleDeactivateRequest,
    ) -> Result<
        super::types::AuthUserLifecycleDeactivateResponse,
        crate::generated::CallError<super::rpc::AuthUserLifecycleDeactivateError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUserLifecycleDeactivateRpc,
                super::rpc::AuthUserLifecycleDeactivateError,
            >(input)
            .await
    }
    /// Call `Auth.UserLifecycle.Inspect`.
    pub async fn user_lifecycle_inspect(
        &self,
        input: &super::types::AuthUserLifecycleInspectRequest,
    ) -> Result<
        super::types::AuthUserLifecycleInspectResponse,
        crate::generated::CallError<super::rpc::AuthUserLifecycleInspectError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUserLifecycleInspectRpc,
                super::rpc::AuthUserLifecycleInspectError,
            >(input)
            .await
    }
    /// Call `Auth.UserLifecycle.Unlink`.
    pub async fn user_lifecycle_unlink(
        &self,
        input: &super::types::AuthUserLifecycleUnlinkRequest,
    ) -> Result<
        super::types::AuthUserLifecycleUnlinkResponse,
        crate::generated::CallError<super::rpc::AuthUserLifecycleUnlinkError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUserLifecycleUnlinkRpc,
                super::rpc::AuthUserLifecycleUnlinkError,
            >(input)
            .await
    }
    /// Call `Auth.Users.Create`.
    pub async fn users_create(
        &self,
        input: &super::types::AuthUsersCreateRequest,
    ) -> Result<
        super::types::AuthUsersCreateResponse,
        crate::generated::CallError<super::rpc::AuthUsersCreateError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthUsersCreateRpc, super::rpc::AuthUsersCreateError>(input)
            .await
    }
    /// Call `Auth.Users.Get`.
    pub async fn users_get(
        &self,
        input: &super::types::AuthUsersGetRequest,
    ) -> Result<
        super::types::AuthUsersGetResponse,
        crate::generated::CallError<super::rpc::AuthUsersGetError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthUsersGetRpc, super::rpc::AuthUsersGetError>(input)
            .await
    }
    /// Call `Auth.Users.IdentityLink.Create`.
    pub async fn users_identity_link_create(
        &self,
        input: &super::types::AuthUsersIdentityLinkCreateRequest,
    ) -> Result<
        super::types::AuthUsersIdentityLinkCreateResponse,
        crate::generated::CallError<super::rpc::AuthUsersIdentityLinkCreateError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUsersIdentityLinkCreateRpc,
                super::rpc::AuthUsersIdentityLinkCreateError,
            >(input)
            .await
    }
    /// Call `Auth.Users.List`.
    pub async fn users_list(
        &self,
        input: &super::types::AuthUsersListRequest,
    ) -> Result<
        super::types::AuthUsersListResponse,
        crate::generated::CallError<super::rpc::AuthUsersListError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthUsersListRpc, super::rpc::AuthUsersListError>(input)
            .await
    }
    /// Call `Auth.Users.Password.Change`.
    pub async fn users_password_change(
        &self,
        input: &super::types::AuthUsersPasswordChangeRequest,
    ) -> Result<
        super::types::AuthUsersPasswordChangeResponse,
        crate::generated::CallError<super::rpc::AuthUsersPasswordChangeError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUsersPasswordChangeRpc,
                super::rpc::AuthUsersPasswordChangeError,
            >(input)
            .await
    }
    /// Call `Auth.Users.PasswordReset.Create`.
    pub async fn users_password_reset_create(
        &self,
        input: &super::types::AuthUsersPasswordResetCreateRequest,
    ) -> Result<
        super::types::AuthUsersPasswordResetCreateResponse,
        crate::generated::CallError<super::rpc::AuthUsersPasswordResetCreateError>,
    > {
        self.inner
            .call_typed::<
                super::rpc::AuthUsersPasswordResetCreateRpc,
                super::rpc::AuthUsersPasswordResetCreateError,
            >(input)
            .await
    }
    /// Call `Auth.Users.Resolve`.
    pub async fn users_resolve(
        &self,
        input: &super::types::AuthUsersResolveRequest,
    ) -> Result<
        super::types::AuthUsersResolveResponse,
        crate::generated::CallError<super::rpc::AuthUsersResolveError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthUsersResolveRpc, super::rpc::AuthUsersResolveError>(input)
            .await
    }
    /// Call `Auth.Users.Update`.
    pub async fn users_update(
        &self,
        input: &super::types::AuthUsersUpdateRequest,
    ) -> Result<
        super::types::AuthUsersUpdateResponse,
        crate::generated::CallError<super::rpc::AuthUsersUpdateError>,
    > {
        self.inner
            .call_typed::<super::rpc::AuthUsersUpdateRpc, super::rpc::AuthUsersUpdateError>(input)
            .await
    }
}
/// Typed event surface.
pub struct Event<'a> {
    pub(crate) _inner: &'a crate::generated::Caller,
}
impl<'a> Event<'a> {
    /// Access the `auth` event group.
    pub fn auth(&self) -> AuthEvent<'a> {
        AuthEvent { inner: self._inner }
    }
}
/// Typed events in the `auth` group.
pub struct AuthEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthEvent<'a> {
    /// Access `Auth.Connections.Closed`.
    pub fn connections_closed(&self) -> AuthConnectionsClosedEvent<'a> {
        AuthConnectionsClosedEvent { inner: self.inner }
    }
    /// Access `Auth.Connections.Kicked`.
    pub fn connections_kicked(&self) -> AuthConnectionsKickedEvent<'a> {
        AuthConnectionsKickedEvent { inner: self.inner }
    }
    /// Access `Auth.Connections.Opened`.
    pub fn connections_opened(&self) -> AuthConnectionsOpenedEvent<'a> {
        AuthConnectionsOpenedEvent { inner: self.inner }
    }
    /// Access `Auth.DeviceUserAuthorities.Approved`.
    pub fn device_user_authorities_approved(&self) -> AuthDeviceUserAuthoritiesApprovedEvent<'a> {
        AuthDeviceUserAuthoritiesApprovedEvent { inner: self.inner }
    }
    /// Access `Auth.DeviceUserAuthorities.Requested`.
    pub fn device_user_authorities_requested(&self) -> AuthDeviceUserAuthoritiesRequestedEvent<'a> {
        AuthDeviceUserAuthoritiesRequestedEvent { inner: self.inner }
    }
    /// Access `Auth.DeviceUserAuthorities.Resolved`.
    pub fn device_user_authorities_resolved(&self) -> AuthDeviceUserAuthoritiesResolvedEvent<'a> {
        AuthDeviceUserAuthoritiesResolvedEvent { inner: self.inner }
    }
    /// Access `Auth.DeviceUserAuthorities.ReviewRequested`.
    pub fn device_user_authorities_review_requested(
        &self,
    ) -> AuthDeviceUserAuthoritiesReviewRequestedEvent<'a> {
        AuthDeviceUserAuthoritiesReviewRequestedEvent { inner: self.inner }
    }
    /// Access `Auth.Sessions.Revoked`.
    pub fn sessions_revoked(&self) -> AuthSessionsRevokedEvent<'a> {
        AuthSessionsRevokedEvent { inner: self.inner }
    }
}
/// Typed `Auth.Connections.Closed` event operations.
pub struct AuthConnectionsClosedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthConnectionsClosedEvent<'a> {
    /// Publish `Auth.Connections.Closed`.
    pub async fn publish(
        &self,
        event: &super::types::AuthConnectionsClosedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsClosedEventDescriptor>(event)
            .await
    }
    /// Listen for live `Auth.Connections.Closed` events.
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
/// Typed `Auth.Connections.Kicked` event operations.
pub struct AuthConnectionsKickedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthConnectionsKickedEvent<'a> {
    /// Publish `Auth.Connections.Kicked`.
    pub async fn publish(
        &self,
        event: &super::types::AuthConnectionsKickedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsKickedEventDescriptor>(event)
            .await
    }
    /// Listen for live `Auth.Connections.Kicked` events.
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
/// Typed `Auth.Connections.Opened` event operations.
pub struct AuthConnectionsOpenedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthConnectionsOpenedEvent<'a> {
    /// Publish `Auth.Connections.Opened`.
    pub async fn publish(
        &self,
        event: &super::types::AuthConnectionsOpenedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthConnectionsOpenedEventDescriptor>(event)
            .await
    }
    /// Listen for live `Auth.Connections.Opened` events.
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
/// Typed `Auth.DeviceUserAuthorities.Approved` event operations.
pub struct AuthDeviceUserAuthoritiesApprovedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthDeviceUserAuthoritiesApprovedEvent<'a> {
    /// Publish `Auth.DeviceUserAuthorities.Approved`.
    pub async fn publish(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesApprovedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesApprovedEventDescriptor>(event)
            .await
    }
    /// Listen for live `Auth.DeviceUserAuthorities.Approved` events.
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
/// Typed `Auth.DeviceUserAuthorities.Requested` event operations.
pub struct AuthDeviceUserAuthoritiesRequestedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthDeviceUserAuthoritiesRequestedEvent<'a> {
    /// Publish `Auth.DeviceUserAuthorities.Requested`.
    pub async fn publish(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesRequestedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesRequestedEventDescriptor>(event)
            .await
    }
    /// Listen for live `Auth.DeviceUserAuthorities.Requested` events.
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
/// Typed `Auth.DeviceUserAuthorities.Resolved` event operations.
pub struct AuthDeviceUserAuthoritiesResolvedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthDeviceUserAuthoritiesResolvedEvent<'a> {
    /// Publish `Auth.DeviceUserAuthorities.Resolved`.
    pub async fn publish(
        &self,
        event: &super::types::AuthDeviceUserAuthoritiesResolvedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthDeviceUserAuthoritiesResolvedEventDescriptor>(event)
            .await
    }
    /// Listen for live `Auth.DeviceUserAuthorities.Resolved` events.
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
/// Typed `Auth.DeviceUserAuthorities.ReviewRequested` event operations.
pub struct AuthDeviceUserAuthoritiesReviewRequestedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthDeviceUserAuthoritiesReviewRequestedEvent<'a> {
    /// Publish `Auth.DeviceUserAuthorities.ReviewRequested`.
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
    /// Listen for live `Auth.DeviceUserAuthorities.ReviewRequested` events.
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
/// Typed `Auth.Sessions.Revoked` event operations.
pub struct AuthSessionsRevokedEvent<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthSessionsRevokedEvent<'a> {
    /// Publish `Auth.Sessions.Revoked`.
    pub async fn publish(
        &self,
        event: &super::types::AuthSessionsRevokedEvent,
    ) -> Result<(), TrellisClientError> {
        self.inner
            .publish::<super::events::AuthSessionsRevokedEventDescriptor>(event)
            .await
    }
    /// Listen for live `Auth.Sessions.Revoked` events.
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
    pub(crate) _inner: &'a crate::generated::Caller,
}
impl<'a> Feed<'a> {}
/// Typed operation surface.
pub struct Operation<'a> {
    pub(crate) _inner: &'a crate::generated::Caller,
}
impl<'a> Operation<'a> {
    /// Access the `auth` operation group.
    pub fn auth(&self) -> AuthOperation<'a> {
        AuthOperation { inner: self._inner }
    }
}
/// Typed operations in the `auth` group.
pub struct AuthOperation<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthOperation<'a> {
    /// Access `Auth.DeviceUserAuthorities.Resolve`.
    pub fn device_user_authorities_resolve(&self) -> AuthDeviceUserAuthoritiesResolveOperation<'a> {
        AuthDeviceUserAuthoritiesResolveOperation { inner: self.inner }
    }
}
/// Typed `Auth.DeviceUserAuthorities.Resolve` operation controls.
pub struct AuthDeviceUserAuthoritiesResolveOperation<'a> {
    inner: &'a crate::generated::Caller,
}
impl<'a> AuthDeviceUserAuthoritiesResolveOperation<'a> {
    /// Start `Auth.DeviceUserAuthorities.Resolve`.
    pub async fn start(
        &self,
        input: &super::types::AuthDeviceUserAuthoritiesResolveInput,
    ) -> Result<
        crate::generated::OperationRef<
            'a,
            crate::generated::Caller,
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
