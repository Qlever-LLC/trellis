// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import type { TrellisAPI } from "../../../contracts.ts";
import { schema } from "../../../contracts.ts";
import type * as Types from "./types.ts";
import {
  AuthCapabilitiesListRequestSchema,
  AuthCapabilitiesListResponseSchema,
  AuthCapabilityGroupsDeleteRequestSchema,
  AuthCapabilityGroupsDeleteResponseSchema,
  AuthCapabilityGroupsGetRequestSchema,
  AuthCapabilityGroupsGetResponseSchema,
  AuthCapabilityGroupsListRequestSchema,
  AuthCapabilityGroupsListResponseSchema,
  AuthCapabilityGroupsPutRequestSchema,
  AuthCapabilityGroupsPutResponseSchema,
  AuthCatalogIssuesResolveRequestSchema,
  AuthCatalogIssuesResolveResponseSchema,
  AuthConnectionsClosedEventSchema,
  AuthConnectionsKickedEventSchema,
  AuthConnectionsKickRequestSchema,
  AuthConnectionsKickResponseSchema,
  AuthConnectionsListRequestSchema,
  AuthConnectionsListResponseSchema,
  AuthConnectionsOpenedEventSchema,
  AuthDeploymentAuthorityAcceptMigrationRequestSchema,
  AuthDeploymentAuthorityAcceptResponseSchema,
  AuthDeploymentAuthorityAcceptUpdateRequestSchema,
  AuthDeploymentAuthorityGetRequestSchema,
  AuthDeploymentAuthorityGetResponseSchema,
  AuthDeploymentAuthorityGrantOverridesListRequestSchema,
  AuthDeploymentAuthorityGrantOverridesListResponseSchema,
  AuthDeploymentAuthorityGrantOverridesPutRequestSchema,
  AuthDeploymentAuthorityGrantOverridesRemoveRequestSchema,
  AuthDeploymentAuthorityGrantOverridesResponseSchema,
  AuthDeploymentAuthorityListRequestSchema,
  AuthDeploymentAuthorityListResponseSchema,
  AuthDeploymentAuthorityPlanRequestSchema,
  AuthDeploymentAuthorityPlanResponseSchema,
  AuthDeploymentAuthorityPlansGetRequestSchema,
  AuthDeploymentAuthorityPlansGetResponseSchema,
  AuthDeploymentAuthorityPlansListRequestSchema,
  AuthDeploymentAuthorityPlansListResponseSchema,
  AuthDeploymentAuthorityReconcileRequestSchema,
  AuthDeploymentAuthorityReconcileResponseSchema,
  AuthDeploymentAuthorityRejectRequestSchema,
  AuthDeploymentAuthorityRejectResponseSchema,
  AuthDeploymentsCreateRequestSchema,
  AuthDeploymentsCreateResponseSchema,
  AuthDeploymentsDisableRequestSchema,
  AuthDeploymentsDisableResponseSchema,
  AuthDeploymentsEnableRequestSchema,
  AuthDeploymentsEnableResponseSchema,
  AuthDeploymentsListRequestSchema,
  AuthDeploymentsListResponseSchema,
  AuthDeploymentsRemoveRequestSchema,
  AuthDeploymentsRemoveResponseSchema,
  AuthDevicesConnectInfoGetRequestSchema,
  AuthDevicesConnectInfoGetResponseSchema,
  AuthDevicesDisableRequestSchema,
  AuthDevicesDisableResponseSchema,
  AuthDevicesEnableRequestSchema,
  AuthDevicesEnableResponseSchema,
  AuthDevicesListRequestSchema,
  AuthDevicesListResponseSchema,
  AuthDevicesProvisionRequestSchema,
  AuthDevicesProvisionResponseSchema,
  AuthDevicesRemoveRequestSchema,
  AuthDevicesRemoveResponseSchema,
  AuthDeviceUserAuthoritiesApprovedEventSchema,
  AuthDeviceUserAuthoritiesListRequestSchema,
  AuthDeviceUserAuthoritiesListResponseSchema,
  AuthDeviceUserAuthoritiesRequestedEventSchema,
  AuthDeviceUserAuthoritiesResolvedEventSchema,
  AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
  AuthDeviceUserAuthoritiesReviewsDecideRequestSchema,
  AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
  AuthDeviceUserAuthoritiesReviewsListRequestSchema,
  AuthDeviceUserAuthoritiesReviewsListResponseSchema,
  AuthDeviceUserAuthoritiesRevokeRequestSchema,
  AuthDeviceUserAuthoritiesRevokeResponseSchema,
  AuthIdentitiesListRequestSchema,
  AuthIdentitiesListResponseSchema,
  AuthIdentityGrantsListRequestSchema,
  AuthIdentityGrantsListResponseSchema,
  AuthIdentityGrantsRevokeRequestSchema,
  AuthIdentityGrantsRevokeResponseSchema,
  AuthPortalsGetRequestSchema,
  AuthPortalsGetResponseSchema,
  AuthPortalsListRequestSchema,
  AuthPortalsListResponseSchema,
  AuthPortalsLoginSettingsGetRequestSchema,
  AuthPortalsLoginSettingsResponseSchema,
  AuthPortalsLoginSettingsUpdateRequestSchema,
  AuthPortalsPutRequestSchema,
  AuthPortalsPutResponseSchema,
  AuthPortalsRemoveRequestSchema,
  AuthPortalsRemoveResponseSchema,
  AuthPortalsRoutesPutRequestSchema,
  AuthPortalsRoutesPutResponseSchema,
  AuthPortalsRoutesRemoveRequestSchema,
  AuthPortalsRoutesRemoveResponseSchema,
  AuthRequestsValidateRequestSchema,
  AuthRequestsValidateResponseSchema,
  AuthResolveDeviceUserAuthoritiesProgressSchema,
  AuthResolveDeviceUserAuthoritiesRequestSchema,
  AuthResolveDeviceUserAuthoritiesResponseSchema,
  AuthServiceInstancesDisableRequestSchema,
  AuthServiceInstancesDisableResponseSchema,
  AuthServiceInstancesEnableRequestSchema,
  AuthServiceInstancesEnableResponseSchema,
  AuthServiceInstancesListRequestSchema,
  AuthServiceInstancesListResponseSchema,
  AuthServiceInstancesProvisionRequestSchema,
  AuthServiceInstancesProvisionResponseSchema,
  AuthServiceInstancesRemoveRequestSchema,
  AuthServiceInstancesRemoveResponseSchema,
  AuthSessionsListRequestSchema,
  AuthSessionsListResponseSchema,
  AuthSessionsLogoutRequestSchema,
  AuthSessionsLogoutResponseSchema,
  AuthSessionsMeRequestSchema,
  AuthSessionsMeResponseSchema,
  AuthSessionsRevokedEventSchema,
  AuthSessionsRevokeRequestSchema,
  AuthSessionsRevokeResponseSchema,
  AuthUserIdentitiesListRequestSchema,
  AuthUserIdentitiesListResponseSchema,
  AuthUserIdentitiesUnlinkRequestSchema,
  AuthUserIdentitiesUnlinkResponseSchema,
  AuthUsersAccountFlowCreateResponseSchema,
  AuthUsersCreateRequestSchema,
  AuthUsersCreateResponseSchema,
  AuthUsersGetRequestSchema,
  AuthUsersGetResponseSchema,
  AuthUsersIdentityLinkCreateRequestSchema,
  AuthUsersListRequestSchema,
  AuthUsersListResponseSchema,
  AuthUsersPasswordChangeRequestSchema,
  AuthUsersPasswordChangeResponseSchema,
  AuthUsersPasswordResetCreateRequestSchema,
  AuthUsersUpdateRequestSchema,
  AuthUsersUpdateResponseSchema,
  HealthRequestSchema,
  HealthResponseSchema,
} from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Auth.Capabilities.List": {
      subject: "rpc.v1.Auth.Capabilities.List",
      input: schema<Types.AuthCapabilitiesListInput>(
        AuthCapabilitiesListRequestSchema,
      ),
      output: schema<Types.AuthCapabilitiesListOutput>(
        AuthCapabilitiesListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.CapabilityGroups.Delete": {
      subject: "rpc.v1.Auth.CapabilityGroups.Delete",
      input: schema<Types.AuthCapabilityGroupsDeleteInput>(
        AuthCapabilityGroupsDeleteRequestSchema,
      ),
      output: schema<Types.AuthCapabilityGroupsDeleteOutput>(
        AuthCapabilityGroupsDeleteResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.CapabilityGroups.Get": {
      subject: "rpc.v1.Auth.CapabilityGroups.Get",
      input: schema<Types.AuthCapabilityGroupsGetInput>(
        AuthCapabilityGroupsGetRequestSchema,
      ),
      output: schema<Types.AuthCapabilityGroupsGetOutput>(
        AuthCapabilityGroupsGetResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.CapabilityGroups.List": {
      subject: "rpc.v1.Auth.CapabilityGroups.List",
      input: schema<Types.AuthCapabilityGroupsListInput>(
        AuthCapabilityGroupsListRequestSchema,
      ),
      output: schema<Types.AuthCapabilityGroupsListOutput>(
        AuthCapabilityGroupsListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.CapabilityGroups.Put": {
      subject: "rpc.v1.Auth.CapabilityGroups.Put",
      input: schema<Types.AuthCapabilityGroupsPutInput>(
        AuthCapabilityGroupsPutRequestSchema,
      ),
      output: schema<Types.AuthCapabilityGroupsPutOutput>(
        AuthCapabilityGroupsPutResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.CatalogIssues.Resolve": {
      subject: "rpc.v1.Auth.CatalogIssues.Resolve",
      input: schema<Types.AuthCatalogIssuesResolveInput>(
        AuthCatalogIssuesResolveRequestSchema,
      ),
      output: schema<Types.AuthCatalogIssuesResolveOutput>(
        AuthCatalogIssuesResolveResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Connections.Kick": {
      subject: "rpc.v1.Auth.Connections.Kick",
      input: schema<Types.AuthConnectionsKickInput>(
        AuthConnectionsKickRequestSchema,
      ),
      output: schema<Types.AuthConnectionsKickOutput>(
        AuthConnectionsKickResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Connections.List": {
      subject: "rpc.v1.Auth.Connections.List",
      input: schema<Types.AuthConnectionsListInput>(
        AuthConnectionsListRequestSchema,
      ),
      output: schema<Types.AuthConnectionsListOutput>(
        AuthConnectionsListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.AcceptMigration": {
      subject: "rpc.v1.Auth.DeploymentAuthority.AcceptMigration",
      input: schema<Types.AuthDeploymentAuthorityAcceptMigrationInput>(
        AuthDeploymentAuthorityAcceptMigrationRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityAcceptMigrationOutput>(
        AuthDeploymentAuthorityAcceptResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.AcceptUpdate": {
      subject: "rpc.v1.Auth.DeploymentAuthority.AcceptUpdate",
      input: schema<Types.AuthDeploymentAuthorityAcceptUpdateInput>(
        AuthDeploymentAuthorityAcceptUpdateRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityAcceptUpdateOutput>(
        AuthDeploymentAuthorityAcceptResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.Get": {
      subject: "rpc.v1.Auth.DeploymentAuthority.Get",
      input: schema<Types.AuthDeploymentAuthorityGetInput>(
        AuthDeploymentAuthorityGetRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityGetOutput>(
        AuthDeploymentAuthorityGetResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.GrantOverrides.List": {
      subject: "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.List",
      input: schema<Types.AuthDeploymentAuthorityGrantOverridesListInput>(
        AuthDeploymentAuthorityGrantOverridesListRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityGrantOverridesListOutput>(
        AuthDeploymentAuthorityGrantOverridesListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.GrantOverrides.Put": {
      subject: "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Put",
      input: schema<Types.AuthDeploymentAuthorityGrantOverridesPutInput>(
        AuthDeploymentAuthorityGrantOverridesPutRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityGrantOverridesPutOutput>(
        AuthDeploymentAuthorityGrantOverridesResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.GrantOverrides.Remove": {
      subject: "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Remove",
      input: schema<Types.AuthDeploymentAuthorityGrantOverridesRemoveInput>(
        AuthDeploymentAuthorityGrantOverridesRemoveRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityGrantOverridesRemoveOutput>(
        AuthDeploymentAuthorityGrantOverridesResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.List": {
      subject: "rpc.v1.Auth.DeploymentAuthority.List",
      input: schema<Types.AuthDeploymentAuthorityListInput>(
        AuthDeploymentAuthorityListRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityListOutput>(
        AuthDeploymentAuthorityListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.Plan": {
      subject: "rpc.v1.Auth.DeploymentAuthority.Plan",
      input: schema<Types.AuthDeploymentAuthorityPlanInput>(
        AuthDeploymentAuthorityPlanRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityPlanOutput>(
        AuthDeploymentAuthorityPlanResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.Plans.Get": {
      subject: "rpc.v1.Auth.DeploymentAuthority.Plans.Get",
      input: schema<Types.AuthDeploymentAuthorityPlansGetInput>(
        AuthDeploymentAuthorityPlansGetRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityPlansGetOutput>(
        AuthDeploymentAuthorityPlansGetResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.Plans.List": {
      subject: "rpc.v1.Auth.DeploymentAuthority.Plans.List",
      input: schema<Types.AuthDeploymentAuthorityPlansListInput>(
        AuthDeploymentAuthorityPlansListRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityPlansListOutput>(
        AuthDeploymentAuthorityPlansListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError"] as const,
      declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
    },
    "Auth.DeploymentAuthority.Reconcile": {
      subject: "rpc.v1.Auth.DeploymentAuthority.Reconcile",
      input: schema<Types.AuthDeploymentAuthorityReconcileInput>(
        AuthDeploymentAuthorityReconcileRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityReconcileOutput>(
        AuthDeploymentAuthorityReconcileResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeploymentAuthority.Reject": {
      subject: "rpc.v1.Auth.DeploymentAuthority.Reject",
      input: schema<Types.AuthDeploymentAuthorityRejectInput>(
        AuthDeploymentAuthorityRejectRequestSchema,
      ),
      output: schema<Types.AuthDeploymentAuthorityRejectOutput>(
        AuthDeploymentAuthorityRejectResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Deployments.Create": {
      subject: "rpc.v1.Auth.Deployments.Create",
      input: schema<Types.AuthDeploymentsCreateInput>(
        AuthDeploymentsCreateRequestSchema,
      ),
      output: schema<Types.AuthDeploymentsCreateOutput>(
        AuthDeploymentsCreateResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Deployments.Disable": {
      subject: "rpc.v1.Auth.Deployments.Disable",
      input: schema<Types.AuthDeploymentsDisableInput>(
        AuthDeploymentsDisableRequestSchema,
      ),
      output: schema<Types.AuthDeploymentsDisableOutput>(
        AuthDeploymentsDisableResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Deployments.Enable": {
      subject: "rpc.v1.Auth.Deployments.Enable",
      input: schema<Types.AuthDeploymentsEnableInput>(
        AuthDeploymentsEnableRequestSchema,
      ),
      output: schema<Types.AuthDeploymentsEnableOutput>(
        AuthDeploymentsEnableResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Deployments.List": {
      subject: "rpc.v1.Auth.Deployments.List",
      input: schema<Types.AuthDeploymentsListInput>(
        AuthDeploymentsListRequestSchema,
      ),
      output: schema<Types.AuthDeploymentsListOutput>(
        AuthDeploymentsListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Deployments.Remove": {
      subject: "rpc.v1.Auth.Deployments.Remove",
      input: schema<Types.AuthDeploymentsRemoveInput>(
        AuthDeploymentsRemoveRequestSchema,
      ),
      output: schema<Types.AuthDeploymentsRemoveOutput>(
        AuthDeploymentsRemoveResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeviceUserAuthorities.List": {
      subject: "rpc.v1.Auth.DeviceUserAuthorities.List",
      input: schema<Types.AuthDeviceUserAuthoritiesListInput>(
        AuthDeviceUserAuthoritiesListRequestSchema,
      ),
      output: schema<Types.AuthDeviceUserAuthoritiesListOutput>(
        AuthDeviceUserAuthoritiesListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeviceUserAuthorities.Reviews.Decide": {
      subject: "rpc.v1.Auth.DeviceUserAuthorities.Reviews.Decide",
      input: schema<Types.AuthDeviceUserAuthoritiesReviewsDecideInput>(
        AuthDeviceUserAuthoritiesReviewsDecideRequestSchema,
      ),
      output: schema<Types.AuthDeviceUserAuthoritiesReviewsDecideOutput>(
        AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
      ),
      callerCapabilities: ["trellis.auth::device.review"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeviceUserAuthorities.Reviews.List": {
      subject: "rpc.v1.Auth.DeviceUserAuthorities.Reviews.List",
      input: schema<Types.AuthDeviceUserAuthoritiesReviewsListInput>(
        AuthDeviceUserAuthoritiesReviewsListRequestSchema,
      ),
      output: schema<Types.AuthDeviceUserAuthoritiesReviewsListOutput>(
        AuthDeviceUserAuthoritiesReviewsListResponseSchema,
      ),
      callerCapabilities: ["trellis.auth::device.review"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.DeviceUserAuthorities.Revoke": {
      subject: "rpc.v1.Auth.DeviceUserAuthorities.Revoke",
      input: schema<Types.AuthDeviceUserAuthoritiesRevokeInput>(
        AuthDeviceUserAuthoritiesRevokeRequestSchema,
      ),
      output: schema<Types.AuthDeviceUserAuthoritiesRevokeOutput>(
        AuthDeviceUserAuthoritiesRevokeResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Devices.ConnectInfo.Get": {
      subject: "rpc.v1.Auth.Devices.ConnectInfo.Get",
      input: schema<Types.AuthDevicesConnectInfoGetInput>(
        AuthDevicesConnectInfoGetRequestSchema,
      ),
      output: schema<Types.AuthDevicesConnectInfoGetOutput>(
        AuthDevicesConnectInfoGetResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Devices.Disable": {
      subject: "rpc.v1.Auth.Devices.Disable",
      input: schema<Types.AuthDevicesDisableInput>(
        AuthDevicesDisableRequestSchema,
      ),
      output: schema<Types.AuthDevicesDisableOutput>(
        AuthDevicesDisableResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Devices.Enable": {
      subject: "rpc.v1.Auth.Devices.Enable",
      input: schema<Types.AuthDevicesEnableInput>(
        AuthDevicesEnableRequestSchema,
      ),
      output: schema<Types.AuthDevicesEnableOutput>(
        AuthDevicesEnableResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Devices.List": {
      subject: "rpc.v1.Auth.Devices.List",
      input: schema<Types.AuthDevicesListInput>(AuthDevicesListRequestSchema),
      output: schema<Types.AuthDevicesListOutput>(
        AuthDevicesListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Devices.Provision": {
      subject: "rpc.v1.Auth.Devices.Provision",
      input: schema<Types.AuthDevicesProvisionInput>(
        AuthDevicesProvisionRequestSchema,
      ),
      output: schema<Types.AuthDevicesProvisionOutput>(
        AuthDevicesProvisionResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Devices.Remove": {
      subject: "rpc.v1.Auth.Devices.Remove",
      input: schema<Types.AuthDevicesRemoveInput>(
        AuthDevicesRemoveRequestSchema,
      ),
      output: schema<Types.AuthDevicesRemoveOutput>(
        AuthDevicesRemoveResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Health": {
      subject: "rpc.v1.Auth.Health",
      input: schema<Types.AuthHealthInput>(HealthRequestSchema),
      output: schema<Types.AuthHealthOutput>(HealthResponseSchema),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
      declaredErrorTypes: ["UnexpectedError"] as const,
    },
    "Auth.Identities.List": {
      subject: "rpc.v1.Auth.Identities.List",
      input: schema<Types.AuthIdentitiesListInput>(
        AuthIdentitiesListRequestSchema,
      ),
      output: schema<Types.AuthIdentitiesListOutput>(
        AuthIdentitiesListResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.IdentityGrants.List": {
      subject: "rpc.v1.Auth.IdentityGrants.List",
      input: schema<Types.AuthIdentityGrantsListInput>(
        AuthIdentityGrantsListRequestSchema,
      ),
      output: schema<Types.AuthIdentityGrantsListOutput>(
        AuthIdentityGrantsListResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError"] as const,
      declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
    },
    "Auth.IdentityGrants.Revoke": {
      subject: "rpc.v1.Auth.IdentityGrants.Revoke",
      input: schema<Types.AuthIdentityGrantsRevokeInput>(
        AuthIdentityGrantsRevokeRequestSchema,
      ),
      output: schema<Types.AuthIdentityGrantsRevokeOutput>(
        AuthIdentityGrantsRevokeResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Portals.Get": {
      subject: "rpc.v1.Auth.Portals.Get",
      input: schema<Types.AuthPortalsGetInput>(AuthPortalsGetRequestSchema),
      output: schema<Types.AuthPortalsGetOutput>(AuthPortalsGetResponseSchema),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Portals.List": {
      subject: "rpc.v1.Auth.Portals.List",
      input: schema<Types.AuthPortalsListInput>(AuthPortalsListRequestSchema),
      output: schema<Types.AuthPortalsListOutput>(
        AuthPortalsListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError"] as const,
      declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
    },
    "Auth.Portals.LoginSettings.Get": {
      subject: "rpc.v1.Auth.Portals.LoginSettings.Get",
      input: schema<Types.AuthPortalsLoginSettingsGetInput>(
        AuthPortalsLoginSettingsGetRequestSchema,
      ),
      output: schema<Types.AuthPortalsLoginSettingsGetOutput>(
        AuthPortalsLoginSettingsResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Portals.LoginSettings.Update": {
      subject: "rpc.v1.Auth.Portals.LoginSettings.Update",
      input: schema<Types.AuthPortalsLoginSettingsUpdateInput>(
        AuthPortalsLoginSettingsUpdateRequestSchema,
      ),
      output: schema<Types.AuthPortalsLoginSettingsUpdateOutput>(
        AuthPortalsLoginSettingsResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Portals.Put": {
      subject: "rpc.v1.Auth.Portals.Put",
      input: schema<Types.AuthPortalsPutInput>(AuthPortalsPutRequestSchema),
      output: schema<Types.AuthPortalsPutOutput>(AuthPortalsPutResponseSchema),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Portals.Remove": {
      subject: "rpc.v1.Auth.Portals.Remove",
      input: schema<Types.AuthPortalsRemoveInput>(
        AuthPortalsRemoveRequestSchema,
      ),
      output: schema<Types.AuthPortalsRemoveOutput>(
        AuthPortalsRemoveResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Portals.Routes.Put": {
      subject: "rpc.v1.Auth.Portals.Routes.Put",
      input: schema<Types.AuthPortalsRoutesPutInput>(
        AuthPortalsRoutesPutRequestSchema,
      ),
      output: schema<Types.AuthPortalsRoutesPutOutput>(
        AuthPortalsRoutesPutResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Portals.Routes.Remove": {
      subject: "rpc.v1.Auth.Portals.Routes.Remove",
      input: schema<Types.AuthPortalsRoutesRemoveInput>(
        AuthPortalsRoutesRemoveRequestSchema,
      ),
      output: schema<Types.AuthPortalsRoutesRemoveOutput>(
        AuthPortalsRoutesRemoveResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Requests.Validate": {
      subject: "rpc.v1.Auth.Requests.Validate",
      input: schema<Types.AuthRequestsValidateInput>(
        AuthRequestsValidateRequestSchema,
      ),
      output: schema<Types.AuthRequestsValidateOutput>(
        AuthRequestsValidateResponseSchema,
      ),
      callerCapabilities: ["service"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.ServiceInstances.Disable": {
      subject: "rpc.v1.Auth.ServiceInstances.Disable",
      input: schema<Types.AuthServiceInstancesDisableInput>(
        AuthServiceInstancesDisableRequestSchema,
      ),
      output: schema<Types.AuthServiceInstancesDisableOutput>(
        AuthServiceInstancesDisableResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.ServiceInstances.Enable": {
      subject: "rpc.v1.Auth.ServiceInstances.Enable",
      input: schema<Types.AuthServiceInstancesEnableInput>(
        AuthServiceInstancesEnableRequestSchema,
      ),
      output: schema<Types.AuthServiceInstancesEnableOutput>(
        AuthServiceInstancesEnableResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.ServiceInstances.List": {
      subject: "rpc.v1.Auth.ServiceInstances.List",
      input: schema<Types.AuthServiceInstancesListInput>(
        AuthServiceInstancesListRequestSchema,
      ),
      output: schema<Types.AuthServiceInstancesListOutput>(
        AuthServiceInstancesListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.ServiceInstances.Provision": {
      subject: "rpc.v1.Auth.ServiceInstances.Provision",
      input: schema<Types.AuthServiceInstancesProvisionInput>(
        AuthServiceInstancesProvisionRequestSchema,
      ),
      output: schema<Types.AuthServiceInstancesProvisionOutput>(
        AuthServiceInstancesProvisionResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.ServiceInstances.Remove": {
      subject: "rpc.v1.Auth.ServiceInstances.Remove",
      input: schema<Types.AuthServiceInstancesRemoveInput>(
        AuthServiceInstancesRemoveRequestSchema,
      ),
      output: schema<Types.AuthServiceInstancesRemoveOutput>(
        AuthServiceInstancesRemoveResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Sessions.List": {
      subject: "rpc.v1.Auth.Sessions.List",
      input: schema<Types.AuthSessionsListInput>(AuthSessionsListRequestSchema),
      output: schema<Types.AuthSessionsListOutput>(
        AuthSessionsListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Sessions.Logout": {
      subject: "rpc.v1.Auth.Sessions.Logout",
      input: schema<Types.AuthSessionsLogoutInput>(
        AuthSessionsLogoutRequestSchema,
      ),
      output: schema<Types.AuthSessionsLogoutOutput>(
        AuthSessionsLogoutResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError"] as const,
      declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
    },
    "Auth.Sessions.Me": {
      subject: "rpc.v1.Auth.Sessions.Me",
      input: schema<Types.AuthSessionsMeInput>(AuthSessionsMeRequestSchema),
      output: schema<Types.AuthSessionsMeOutput>(AuthSessionsMeResponseSchema),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError"] as const,
      declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
    },
    "Auth.Sessions.Revoke": {
      subject: "rpc.v1.Auth.Sessions.Revoke",
      input: schema<Types.AuthSessionsRevokeInput>(
        AuthSessionsRevokeRequestSchema,
      ),
      output: schema<Types.AuthSessionsRevokeOutput>(
        AuthSessionsRevokeResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.UserIdentities.List": {
      subject: "rpc.v1.Auth.UserIdentities.List",
      input: schema<Types.AuthUserIdentitiesListInput>(
        AuthUserIdentitiesListRequestSchema,
      ),
      output: schema<Types.AuthUserIdentitiesListOutput>(
        AuthUserIdentitiesListResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.UserIdentities.Unlink": {
      subject: "rpc.v1.Auth.UserIdentities.Unlink",
      input: schema<Types.AuthUserIdentitiesUnlinkInput>(
        AuthUserIdentitiesUnlinkRequestSchema,
      ),
      output: schema<Types.AuthUserIdentitiesUnlinkOutput>(
        AuthUserIdentitiesUnlinkResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Users.Create": {
      subject: "rpc.v1.Auth.Users.Create",
      input: schema<Types.AuthUsersCreateInput>(AuthUsersCreateRequestSchema),
      output: schema<Types.AuthUsersCreateOutput>(
        AuthUsersCreateResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Users.Get": {
      subject: "rpc.v1.Auth.Users.Get",
      input: schema<Types.AuthUsersGetInput>(AuthUsersGetRequestSchema),
      output: schema<Types.AuthUsersGetOutput>(AuthUsersGetResponseSchema),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Users.IdentityLink.Create": {
      subject: "rpc.v1.Auth.Users.IdentityLink.Create",
      input: schema<Types.AuthUsersIdentityLinkCreateInput>(
        AuthUsersIdentityLinkCreateRequestSchema,
      ),
      output: schema<Types.AuthUsersIdentityLinkCreateOutput>(
        AuthUsersAccountFlowCreateResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Users.List": {
      subject: "rpc.v1.Auth.Users.List",
      input: schema<Types.AuthUsersListInput>(AuthUsersListRequestSchema),
      output: schema<Types.AuthUsersListOutput>(AuthUsersListResponseSchema),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Users.Password.Change": {
      subject: "rpc.v1.Auth.Users.Password.Change",
      input: schema<Types.AuthUsersPasswordChangeInput>(
        AuthUsersPasswordChangeRequestSchema,
      ),
      output: schema<Types.AuthUsersPasswordChangeOutput>(
        AuthUsersPasswordChangeResponseSchema,
      ),
      callerCapabilities: [],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Users.PasswordReset.Create": {
      subject: "rpc.v1.Auth.Users.PasswordReset.Create",
      input: schema<Types.AuthUsersPasswordResetCreateInput>(
        AuthUsersPasswordResetCreateRequestSchema,
      ),
      output: schema<Types.AuthUsersPasswordResetCreateOutput>(
        AuthUsersAccountFlowCreateResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
    "Auth.Users.Update": {
      subject: "rpc.v1.Auth.Users.Update",
      input: schema<Types.AuthUsersUpdateInput>(AuthUsersUpdateRequestSchema),
      output: schema<Types.AuthUsersUpdateOutput>(
        AuthUsersUpdateResponseSchema,
      ),
      callerCapabilities: ["admin"],
      errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: [
        "AuthError",
        "UnexpectedError",
        "ValidationError",
      ] as const,
    },
  },
  operations: {
    "Auth.DeviceUserAuthorities.Resolve": {
      subject: "operations.v1.Auth.DeviceUserAuthorities.Resolve",
      input: schema<Types.AuthDeviceUserAuthoritiesResolveInput>(
        AuthResolveDeviceUserAuthoritiesRequestSchema,
      ),
      progress: schema<Types.AuthDeviceUserAuthoritiesResolveProgress>(
        AuthResolveDeviceUserAuthoritiesProgressSchema,
      ),
      output: schema<Types.AuthDeviceUserAuthoritiesResolveOutput>(
        AuthResolveDeviceUserAuthoritiesResponseSchema,
      ),
      callerCapabilities: [],
      observeCapabilities: [],
      cancelCapabilities: [],
      controlCapabilities: [],
    },
  },
  events: {
    "Auth.Connections.Closed": {
      subject: "events.v1.Auth.Connections.Closed",
      event: schema<Types.AuthConnectionsClosedEvent>(
        AuthConnectionsClosedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: ["trellis.auth::events.auth"],
    },
    "Auth.Connections.Kicked": {
      subject: "events.v1.Auth.Connections.Kicked",
      event: schema<Types.AuthConnectionsKickedEvent>(
        AuthConnectionsKickedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: ["trellis.auth::events.auth"],
    },
    "Auth.Connections.Opened": {
      subject: "events.v1.Auth.Connections.Opened",
      event: schema<Types.AuthConnectionsOpenedEvent>(
        AuthConnectionsOpenedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: ["trellis.auth::events.auth"],
    },
    "Auth.DeviceUserAuthorities.Approved": {
      subject: "events.v1.Auth.DeviceUserAuthorities.Approved.{/deploymentId}",
      params: ["/deploymentId"] as const,
      event: schema<Types.AuthDeviceUserAuthoritiesApprovedEvent>(
        AuthDeviceUserAuthoritiesApprovedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: ["trellis.auth::device.review"],
    },
    "Auth.DeviceUserAuthorities.Requested": {
      subject: "events.v1.Auth.DeviceUserAuthorities.Requested.{/deploymentId}",
      params: ["/deploymentId"] as const,
      event: schema<Types.AuthDeviceUserAuthoritiesRequestedEvent>(
        AuthDeviceUserAuthoritiesRequestedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: ["trellis.auth::device.review"],
    },
    "Auth.DeviceUserAuthorities.Resolved": {
      subject: "events.v1.Auth.DeviceUserAuthorities.Resolved.{/deploymentId}",
      params: ["/deploymentId"] as const,
      event: schema<Types.AuthDeviceUserAuthoritiesResolvedEvent>(
        AuthDeviceUserAuthoritiesResolvedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: [
        "trellis.auth::device.review",
        "trellis.auth::events.auth",
      ],
    },
    "Auth.DeviceUserAuthorities.ReviewRequested": {
      subject:
        "events.v1.Auth.DeviceUserAuthorities.ReviewRequested.{/deploymentId}",
      params: ["/deploymentId"] as const,
      event: schema<Types.AuthDeviceUserAuthoritiesReviewRequestedEvent>(
        AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: ["trellis.auth::device.review"],
    },
    "Auth.Sessions.Revoked": {
      subject: "events.v1.Auth.Sessions.Revoked",
      event: schema<Types.AuthSessionsRevokedEvent>(
        AuthSessionsRevokedEventSchema,
      ),
      publishCapabilities: ["trellis.auth::events.auth"],
      subscribeCapabilities: ["trellis.auth::events.auth"],
    },
  },
  feeds: {},
  subjects: {},
} satisfies TrellisAPI;
