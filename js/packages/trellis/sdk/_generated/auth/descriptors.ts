// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import {
  eventActions,
  feedAction,
  operationAction,
  rpcAction,
  schema,
} from "../../../contracts.ts";
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
  AuthEventConsumersListRequestSchema,
  AuthEventConsumersListResponseSchema,
  AuthEventsValidateRequestSchema,
  AuthEventsValidateResponseSchema,
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
  AuthUserLifecycleDeactivateRequestSchema,
  AuthUserLifecycleDeactivateResponseSchema,
  AuthUserLifecycleInspectRequestSchema,
  AuthUserLifecycleInspectResponseSchema,
  AuthUserLifecycleUnlinkRequestSchema,
  AuthUserLifecycleUnlinkResponseSchema,
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
  AuthUsersResolveRequestSchema,
  AuthUsersResolveResponseSchema,
  AuthUsersUpdateRequestSchema,
  AuthUsersUpdateResponseSchema,
} from "./schemas.ts";

const CONTRACT_ID = "trellis.auth@v1" as const;

export const AuthCapabilitiesList = rpcAction(
  CONTRACT_ID,
  "Auth.Capabilities.List",
  {
    subject: "rpc.v1.Auth.Capabilities.List",
    input: schema<Types.AuthCapabilitiesListInput>(
      AuthCapabilitiesListRequestSchema,
    ),
    output: schema<Types.AuthCapabilitiesListOutput>(
      AuthCapabilitiesListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthCapabilitiesList",
);

export const AuthCapabilityGroupsDelete = rpcAction(
  CONTRACT_ID,
  "Auth.CapabilityGroups.Delete",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.Delete",
    input: schema<Types.AuthCapabilityGroupsDeleteInput>(
      AuthCapabilityGroupsDeleteRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsDeleteOutput>(
      AuthCapabilityGroupsDeleteResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthCapabilityGroupsDelete",
);

export const AuthCapabilityGroupsGet = rpcAction(
  CONTRACT_ID,
  "Auth.CapabilityGroups.Get",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.Get",
    input: schema<Types.AuthCapabilityGroupsGetInput>(
      AuthCapabilityGroupsGetRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsGetOutput>(
      AuthCapabilityGroupsGetResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthCapabilityGroupsGet",
);

export const AuthCapabilityGroupsList = rpcAction(
  CONTRACT_ID,
  "Auth.CapabilityGroups.List",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.List",
    input: schema<Types.AuthCapabilityGroupsListInput>(
      AuthCapabilityGroupsListRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsListOutput>(
      AuthCapabilityGroupsListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthCapabilityGroupsList",
);

export const AuthCapabilityGroupsPut = rpcAction(
  CONTRACT_ID,
  "Auth.CapabilityGroups.Put",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.Put",
    input: schema<Types.AuthCapabilityGroupsPutInput>(
      AuthCapabilityGroupsPutRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsPutOutput>(
      AuthCapabilityGroupsPutResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthCapabilityGroupsPut",
);

export const AuthCatalogIssuesResolve = rpcAction(
  CONTRACT_ID,
  "Auth.CatalogIssues.Resolve",
  {
    subject: "rpc.v1.Auth.CatalogIssues.Resolve",
    input: schema<Types.AuthCatalogIssuesResolveInput>(
      AuthCatalogIssuesResolveRequestSchema,
    ),
    output: schema<Types.AuthCatalogIssuesResolveOutput>(
      AuthCatalogIssuesResolveResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthCatalogIssuesResolve",
);

export const AuthConnectionsKick = rpcAction(
  CONTRACT_ID,
  "Auth.Connections.Kick",
  {
    subject: "rpc.v1.Auth.Connections.Kick",
    input: schema<Types.AuthConnectionsKickInput>(
      AuthConnectionsKickRequestSchema,
    ),
    output: schema<Types.AuthConnectionsKickOutput>(
      AuthConnectionsKickResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthConnectionsKick",
);

export const AuthConnectionsList = rpcAction(
  CONTRACT_ID,
  "Auth.Connections.List",
  {
    subject: "rpc.v1.Auth.Connections.List",
    input: schema<Types.AuthConnectionsListInput>(
      AuthConnectionsListRequestSchema,
    ),
    output: schema<Types.AuthConnectionsListOutput>(
      AuthConnectionsListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthConnectionsList",
);

export const AuthDeploymentAuthorityAcceptMigration = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.AcceptMigration",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.AcceptMigration",
    input: schema<Types.AuthDeploymentAuthorityAcceptMigrationInput>(
      AuthDeploymentAuthorityAcceptMigrationRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityAcceptMigrationOutput>(
      AuthDeploymentAuthorityAcceptResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityAcceptMigration",
);

export const AuthDeploymentAuthorityAcceptUpdate = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.AcceptUpdate",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.AcceptUpdate",
    input: schema<Types.AuthDeploymentAuthorityAcceptUpdateInput>(
      AuthDeploymentAuthorityAcceptUpdateRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityAcceptUpdateOutput>(
      AuthDeploymentAuthorityAcceptResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityAcceptUpdate",
);

export const AuthDeploymentAuthorityGet = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.Get",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Get",
    input: schema<Types.AuthDeploymentAuthorityGetInput>(
      AuthDeploymentAuthorityGetRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityGetOutput>(
      AuthDeploymentAuthorityGetResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityGet",
);

export const AuthDeploymentAuthorityGrantOverridesList = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.GrantOverrides.List",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.List",
    input: schema<Types.AuthDeploymentAuthorityGrantOverridesListInput>(
      AuthDeploymentAuthorityGrantOverridesListRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityGrantOverridesListOutput>(
      AuthDeploymentAuthorityGrantOverridesListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityGrantOverridesList",
);

export const AuthDeploymentAuthorityGrantOverridesPut = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.GrantOverrides.Put",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Put",
    input: schema<Types.AuthDeploymentAuthorityGrantOverridesPutInput>(
      AuthDeploymentAuthorityGrantOverridesPutRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityGrantOverridesPutOutput>(
      AuthDeploymentAuthorityGrantOverridesResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityGrantOverridesPut",
);

export const AuthDeploymentAuthorityGrantOverridesRemove = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.GrantOverrides.Remove",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Remove",
    input: schema<Types.AuthDeploymentAuthorityGrantOverridesRemoveInput>(
      AuthDeploymentAuthorityGrantOverridesRemoveRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityGrantOverridesRemoveOutput>(
      AuthDeploymentAuthorityGrantOverridesResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityGrantOverridesRemove",
);

export const AuthDeploymentAuthorityList = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.List",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.List",
    input: schema<Types.AuthDeploymentAuthorityListInput>(
      AuthDeploymentAuthorityListRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityListOutput>(
      AuthDeploymentAuthorityListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityList",
);

export const AuthDeploymentAuthorityPlan = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.Plan",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Plan",
    input: schema<Types.AuthDeploymentAuthorityPlanInput>(
      AuthDeploymentAuthorityPlanRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityPlanOutput>(
      AuthDeploymentAuthorityPlanResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityPlan",
);

export const AuthDeploymentAuthorityPlansGet = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.Plans.Get",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Plans.Get",
    input: schema<Types.AuthDeploymentAuthorityPlansGetInput>(
      AuthDeploymentAuthorityPlansGetRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityPlansGetOutput>(
      AuthDeploymentAuthorityPlansGetResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityPlansGet",
);

export const AuthDeploymentAuthorityPlansList = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.Plans.List",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Plans.List",
    input: schema<Types.AuthDeploymentAuthorityPlansListInput>(
      AuthDeploymentAuthorityPlansListRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityPlansListOutput>(
      AuthDeploymentAuthorityPlansListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError"] as const,
    declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
  },
  "AuthDeploymentAuthorityPlansList",
);

export const AuthDeploymentAuthorityReconcile = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.Reconcile",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Reconcile",
    input: schema<Types.AuthDeploymentAuthorityReconcileInput>(
      AuthDeploymentAuthorityReconcileRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityReconcileOutput>(
      AuthDeploymentAuthorityReconcileResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityReconcile",
);

export const AuthDeploymentAuthorityReject = rpcAction(
  CONTRACT_ID,
  "Auth.DeploymentAuthority.Reject",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Reject",
    input: schema<Types.AuthDeploymentAuthorityRejectInput>(
      AuthDeploymentAuthorityRejectRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityRejectOutput>(
      AuthDeploymentAuthorityRejectResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentAuthorityReject",
);

export const AuthDeploymentsCreate = rpcAction(
  CONTRACT_ID,
  "Auth.Deployments.Create",
  {
    subject: "rpc.v1.Auth.Deployments.Create",
    input: schema<Types.AuthDeploymentsCreateInput>(
      AuthDeploymentsCreateRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsCreateOutput>(
      AuthDeploymentsCreateResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentsCreate",
);

export const AuthDeploymentsDisable = rpcAction(
  CONTRACT_ID,
  "Auth.Deployments.Disable",
  {
    subject: "rpc.v1.Auth.Deployments.Disable",
    input: schema<Types.AuthDeploymentsDisableInput>(
      AuthDeploymentsDisableRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsDisableOutput>(
      AuthDeploymentsDisableResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentsDisable",
);

export const AuthDeploymentsEnable = rpcAction(
  CONTRACT_ID,
  "Auth.Deployments.Enable",
  {
    subject: "rpc.v1.Auth.Deployments.Enable",
    input: schema<Types.AuthDeploymentsEnableInput>(
      AuthDeploymentsEnableRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsEnableOutput>(
      AuthDeploymentsEnableResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentsEnable",
);

export const AuthDeploymentsList = rpcAction(
  CONTRACT_ID,
  "Auth.Deployments.List",
  {
    subject: "rpc.v1.Auth.Deployments.List",
    input: schema<Types.AuthDeploymentsListInput>(
      AuthDeploymentsListRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsListOutput>(
      AuthDeploymentsListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentsList",
);

export const AuthDeploymentsRemove = rpcAction(
  CONTRACT_ID,
  "Auth.Deployments.Remove",
  {
    subject: "rpc.v1.Auth.Deployments.Remove",
    input: schema<Types.AuthDeploymentsRemoveInput>(
      AuthDeploymentsRemoveRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsRemoveOutput>(
      AuthDeploymentsRemoveResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeploymentsRemove",
);

export const AuthDeviceUserAuthoritiesList = rpcAction(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.List",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.List",
    input: schema<Types.AuthDeviceUserAuthoritiesListInput>(
      AuthDeviceUserAuthoritiesListRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesListOutput>(
      AuthDeviceUserAuthoritiesListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeviceUserAuthoritiesList",
);

export const AuthDeviceUserAuthoritiesReviewsDecide = rpcAction(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.Reviews.Decide",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.Reviews.Decide",
    input: schema<Types.AuthDeviceUserAuthoritiesReviewsDecideInput>(
      AuthDeviceUserAuthoritiesReviewsDecideRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesReviewsDecideOutput>(
      AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::device.review"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeviceUserAuthoritiesReviewsDecide",
);

export const AuthDeviceUserAuthoritiesReviewsList = rpcAction(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.Reviews.List",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.Reviews.List",
    input: schema<Types.AuthDeviceUserAuthoritiesReviewsListInput>(
      AuthDeviceUserAuthoritiesReviewsListRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesReviewsListOutput>(
      AuthDeviceUserAuthoritiesReviewsListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::device.review"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeviceUserAuthoritiesReviewsList",
);

export const AuthDeviceUserAuthoritiesRevoke = rpcAction(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.Revoke",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.Revoke",
    input: schema<Types.AuthDeviceUserAuthoritiesRevokeInput>(
      AuthDeviceUserAuthoritiesRevokeRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesRevokeOutput>(
      AuthDeviceUserAuthoritiesRevokeResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeviceUserAuthoritiesRevoke",
);

export const AuthDevicesConnectInfoGet = rpcAction(
  CONTRACT_ID,
  "Auth.Devices.ConnectInfo.Get",
  {
    subject: "rpc.v1.Auth.Devices.ConnectInfo.Get",
    input: schema<Types.AuthDevicesConnectInfoGetInput>(
      AuthDevicesConnectInfoGetRequestSchema,
    ),
    output: schema<Types.AuthDevicesConnectInfoGetOutput>(
      AuthDevicesConnectInfoGetResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDevicesConnectInfoGet",
);

export const AuthDevicesDisable = rpcAction(
  CONTRACT_ID,
  "Auth.Devices.Disable",
  {
    subject: "rpc.v1.Auth.Devices.Disable",
    input: schema<Types.AuthDevicesDisableInput>(
      AuthDevicesDisableRequestSchema,
    ),
    output: schema<Types.AuthDevicesDisableOutput>(
      AuthDevicesDisableResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDevicesDisable",
);

export const AuthDevicesEnable = rpcAction(CONTRACT_ID, "Auth.Devices.Enable", {
  subject: "rpc.v1.Auth.Devices.Enable",
  input: schema<Types.AuthDevicesEnableInput>(AuthDevicesEnableRequestSchema),
  output: schema<Types.AuthDevicesEnableOutput>(
    AuthDevicesEnableResponseSchema,
  ),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthDevicesEnable");

export const AuthDevicesList = rpcAction(CONTRACT_ID, "Auth.Devices.List", {
  subject: "rpc.v1.Auth.Devices.List",
  input: schema<Types.AuthDevicesListInput>(AuthDevicesListRequestSchema),
  output: schema<Types.AuthDevicesListOutput>(AuthDevicesListResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthDevicesList");

export const AuthDevicesProvision = rpcAction(
  CONTRACT_ID,
  "Auth.Devices.Provision",
  {
    subject: "rpc.v1.Auth.Devices.Provision",
    input: schema<Types.AuthDevicesProvisionInput>(
      AuthDevicesProvisionRequestSchema,
    ),
    output: schema<Types.AuthDevicesProvisionOutput>(
      AuthDevicesProvisionResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDevicesProvision",
);

export const AuthDevicesRemove = rpcAction(CONTRACT_ID, "Auth.Devices.Remove", {
  subject: "rpc.v1.Auth.Devices.Remove",
  input: schema<Types.AuthDevicesRemoveInput>(AuthDevicesRemoveRequestSchema),
  output: schema<Types.AuthDevicesRemoveOutput>(
    AuthDevicesRemoveResponseSchema,
  ),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthDevicesRemove");

export const AuthEventConsumersList = rpcAction(
  CONTRACT_ID,
  "Auth.EventConsumers.List",
  {
    subject: "rpc.v1.Auth.EventConsumers.List",
    input: schema<Types.AuthEventConsumersListInput>(
      AuthEventConsumersListRequestSchema,
    ),
    output: schema<Types.AuthEventConsumersListOutput>(
      AuthEventConsumersListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::event-consumers.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthEventConsumersList",
);

export const AuthEventsValidate = rpcAction(
  CONTRACT_ID,
  "Auth.Events.Validate",
  {
    subject: "rpc.v1.Auth.Events.Validate",
    input: schema<Types.AuthEventsValidateInput>(
      AuthEventsValidateRequestSchema,
    ),
    output: schema<Types.AuthEventsValidateOutput>(
      AuthEventsValidateResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthEventsValidate",
);

export const AuthIdentitiesList = rpcAction(
  CONTRACT_ID,
  "Auth.Identities.List",
  {
    subject: "rpc.v1.Auth.Identities.List",
    input: schema<Types.AuthIdentitiesListInput>(
      AuthIdentitiesListRequestSchema,
    ),
    output: schema<Types.AuthIdentitiesListOutput>(
      AuthIdentitiesListResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthIdentitiesList",
);

export const AuthIdentityGrantsList = rpcAction(
  CONTRACT_ID,
  "Auth.IdentityGrants.List",
  {
    subject: "rpc.v1.Auth.IdentityGrants.List",
    input: schema<Types.AuthIdentityGrantsListInput>(
      AuthIdentityGrantsListRequestSchema,
    ),
    output: schema<Types.AuthIdentityGrantsListOutput>(
      AuthIdentityGrantsListResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError"] as const,
    declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
  },
  "AuthIdentityGrantsList",
);

export const AuthIdentityGrantsRevoke = rpcAction(
  CONTRACT_ID,
  "Auth.IdentityGrants.Revoke",
  {
    subject: "rpc.v1.Auth.IdentityGrants.Revoke",
    input: schema<Types.AuthIdentityGrantsRevokeInput>(
      AuthIdentityGrantsRevokeRequestSchema,
    ),
    output: schema<Types.AuthIdentityGrantsRevokeOutput>(
      AuthIdentityGrantsRevokeResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthIdentityGrantsRevoke",
);

export const AuthPortalsGet = rpcAction(CONTRACT_ID, "Auth.Portals.Get", {
  subject: "rpc.v1.Auth.Portals.Get",
  input: schema<Types.AuthPortalsGetInput>(AuthPortalsGetRequestSchema),
  output: schema<Types.AuthPortalsGetOutput>(AuthPortalsGetResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthPortalsGet");

export const AuthPortalsList = rpcAction(CONTRACT_ID, "Auth.Portals.List", {
  subject: "rpc.v1.Auth.Portals.List",
  input: schema<Types.AuthPortalsListInput>(AuthPortalsListRequestSchema),
  output: schema<Types.AuthPortalsListOutput>(AuthPortalsListResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError"] as const,
  declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
}, "AuthPortalsList");

export const AuthPortalsLoginSettingsGet = rpcAction(
  CONTRACT_ID,
  "Auth.Portals.LoginSettings.Get",
  {
    subject: "rpc.v1.Auth.Portals.LoginSettings.Get",
    input: schema<Types.AuthPortalsLoginSettingsGetInput>(
      AuthPortalsLoginSettingsGetRequestSchema,
    ),
    output: schema<Types.AuthPortalsLoginSettingsGetOutput>(
      AuthPortalsLoginSettingsResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthPortalsLoginSettingsGet",
);

export const AuthPortalsLoginSettingsUpdate = rpcAction(
  CONTRACT_ID,
  "Auth.Portals.LoginSettings.Update",
  {
    subject: "rpc.v1.Auth.Portals.LoginSettings.Update",
    input: schema<Types.AuthPortalsLoginSettingsUpdateInput>(
      AuthPortalsLoginSettingsUpdateRequestSchema,
    ),
    output: schema<Types.AuthPortalsLoginSettingsUpdateOutput>(
      AuthPortalsLoginSettingsResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthPortalsLoginSettingsUpdate",
);

export const AuthPortalsPut = rpcAction(CONTRACT_ID, "Auth.Portals.Put", {
  subject: "rpc.v1.Auth.Portals.Put",
  input: schema<Types.AuthPortalsPutInput>(AuthPortalsPutRequestSchema),
  output: schema<Types.AuthPortalsPutOutput>(AuthPortalsPutResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthPortalsPut");

export const AuthPortalsRemove = rpcAction(CONTRACT_ID, "Auth.Portals.Remove", {
  subject: "rpc.v1.Auth.Portals.Remove",
  input: schema<Types.AuthPortalsRemoveInput>(AuthPortalsRemoveRequestSchema),
  output: schema<Types.AuthPortalsRemoveOutput>(
    AuthPortalsRemoveResponseSchema,
  ),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthPortalsRemove");

export const AuthPortalsRoutesPut = rpcAction(
  CONTRACT_ID,
  "Auth.Portals.Routes.Put",
  {
    subject: "rpc.v1.Auth.Portals.Routes.Put",
    input: schema<Types.AuthPortalsRoutesPutInput>(
      AuthPortalsRoutesPutRequestSchema,
    ),
    output: schema<Types.AuthPortalsRoutesPutOutput>(
      AuthPortalsRoutesPutResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthPortalsRoutesPut",
);

export const AuthPortalsRoutesRemove = rpcAction(
  CONTRACT_ID,
  "Auth.Portals.Routes.Remove",
  {
    subject: "rpc.v1.Auth.Portals.Routes.Remove",
    input: schema<Types.AuthPortalsRoutesRemoveInput>(
      AuthPortalsRoutesRemoveRequestSchema,
    ),
    output: schema<Types.AuthPortalsRoutesRemoveOutput>(
      AuthPortalsRoutesRemoveResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthPortalsRoutesRemove",
);

export const AuthRequestsValidate = rpcAction(
  CONTRACT_ID,
  "Auth.Requests.Validate",
  {
    subject: "rpc.v1.Auth.Requests.Validate",
    input: schema<Types.AuthRequestsValidateInput>(
      AuthRequestsValidateRequestSchema,
    ),
    output: schema<Types.AuthRequestsValidateOutput>(
      AuthRequestsValidateResponseSchema,
    ),
    callerCapabilities: ["service"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthRequestsValidate",
);

export const AuthServiceInstancesDisable = rpcAction(
  CONTRACT_ID,
  "Auth.ServiceInstances.Disable",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Disable",
    input: schema<Types.AuthServiceInstancesDisableInput>(
      AuthServiceInstancesDisableRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesDisableOutput>(
      AuthServiceInstancesDisableResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthServiceInstancesDisable",
);

export const AuthServiceInstancesEnable = rpcAction(
  CONTRACT_ID,
  "Auth.ServiceInstances.Enable",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Enable",
    input: schema<Types.AuthServiceInstancesEnableInput>(
      AuthServiceInstancesEnableRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesEnableOutput>(
      AuthServiceInstancesEnableResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthServiceInstancesEnable",
);

export const AuthServiceInstancesList = rpcAction(
  CONTRACT_ID,
  "Auth.ServiceInstances.List",
  {
    subject: "rpc.v1.Auth.ServiceInstances.List",
    input: schema<Types.AuthServiceInstancesListInput>(
      AuthServiceInstancesListRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesListOutput>(
      AuthServiceInstancesListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthServiceInstancesList",
);

export const AuthServiceInstancesProvision = rpcAction(
  CONTRACT_ID,
  "Auth.ServiceInstances.Provision",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Provision",
    input: schema<Types.AuthServiceInstancesProvisionInput>(
      AuthServiceInstancesProvisionRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesProvisionOutput>(
      AuthServiceInstancesProvisionResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthServiceInstancesProvision",
);

export const AuthServiceInstancesRemove = rpcAction(
  CONTRACT_ID,
  "Auth.ServiceInstances.Remove",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Remove",
    input: schema<Types.AuthServiceInstancesRemoveInput>(
      AuthServiceInstancesRemoveRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesRemoveOutput>(
      AuthServiceInstancesRemoveResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthServiceInstancesRemove",
);

export const AuthSessionsList = rpcAction(CONTRACT_ID, "Auth.Sessions.List", {
  subject: "rpc.v1.Auth.Sessions.List",
  input: schema<Types.AuthSessionsListInput>(AuthSessionsListRequestSchema),
  output: schema<Types.AuthSessionsListOutput>(AuthSessionsListResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthSessionsList");

export const AuthSessionsLogout = rpcAction(
  CONTRACT_ID,
  "Auth.Sessions.Logout",
  {
    subject: "rpc.v1.Auth.Sessions.Logout",
    input: schema<Types.AuthSessionsLogoutInput>(
      AuthSessionsLogoutRequestSchema,
    ),
    output: schema<Types.AuthSessionsLogoutOutput>(
      AuthSessionsLogoutResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError"] as const,
    declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
  },
  "AuthSessionsLogout",
);

export const AuthSessionsMe = rpcAction(CONTRACT_ID, "Auth.Sessions.Me", {
  subject: "rpc.v1.Auth.Sessions.Me",
  input: schema<Types.AuthSessionsMeInput>(AuthSessionsMeRequestSchema),
  output: schema<Types.AuthSessionsMeOutput>(AuthSessionsMeResponseSchema),
  callerCapabilities: [] as const,
  errors: ["AuthError", "UnexpectedError"] as const,
  declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
}, "AuthSessionsMe");

export const AuthSessionsRevoke = rpcAction(
  CONTRACT_ID,
  "Auth.Sessions.Revoke",
  {
    subject: "rpc.v1.Auth.Sessions.Revoke",
    input: schema<Types.AuthSessionsRevokeInput>(
      AuthSessionsRevokeRequestSchema,
    ),
    output: schema<Types.AuthSessionsRevokeOutput>(
      AuthSessionsRevokeResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthSessionsRevoke",
);

export const AuthUserIdentitiesList = rpcAction(
  CONTRACT_ID,
  "Auth.UserIdentities.List",
  {
    subject: "rpc.v1.Auth.UserIdentities.List",
    input: schema<Types.AuthUserIdentitiesListInput>(
      AuthUserIdentitiesListRequestSchema,
    ),
    output: schema<Types.AuthUserIdentitiesListOutput>(
      AuthUserIdentitiesListResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUserIdentitiesList",
);

export const AuthUserIdentitiesUnlink = rpcAction(
  CONTRACT_ID,
  "Auth.UserIdentities.Unlink",
  {
    subject: "rpc.v1.Auth.UserIdentities.Unlink",
    input: schema<Types.AuthUserIdentitiesUnlinkInput>(
      AuthUserIdentitiesUnlinkRequestSchema,
    ),
    output: schema<Types.AuthUserIdentitiesUnlinkOutput>(
      AuthUserIdentitiesUnlinkResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUserIdentitiesUnlink",
);

export const AuthUserLifecycleDeactivate = rpcAction(
  CONTRACT_ID,
  "Auth.UserLifecycle.Deactivate",
  {
    subject: "rpc.v1.Auth.UserLifecycle.Deactivate",
    input: schema<Types.AuthUserLifecycleDeactivateInput>(
      AuthUserLifecycleDeactivateRequestSchema,
    ),
    output: schema<Types.AuthUserLifecycleDeactivateOutput>(
      AuthUserLifecycleDeactivateResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::user_lifecycle.manage"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUserLifecycleDeactivate",
);

export const AuthUserLifecycleInspect = rpcAction(
  CONTRACT_ID,
  "Auth.UserLifecycle.Inspect",
  {
    subject: "rpc.v1.Auth.UserLifecycle.Inspect",
    input: schema<Types.AuthUserLifecycleInspectInput>(
      AuthUserLifecycleInspectRequestSchema,
    ),
    output: schema<Types.AuthUserLifecycleInspectOutput>(
      AuthUserLifecycleInspectResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::user_lifecycle.manage"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUserLifecycleInspect",
);

export const AuthUserLifecycleUnlink = rpcAction(
  CONTRACT_ID,
  "Auth.UserLifecycle.Unlink",
  {
    subject: "rpc.v1.Auth.UserLifecycle.Unlink",
    input: schema<Types.AuthUserLifecycleUnlinkInput>(
      AuthUserLifecycleUnlinkRequestSchema,
    ),
    output: schema<Types.AuthUserLifecycleUnlinkOutput>(
      AuthUserLifecycleUnlinkResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::user_lifecycle.manage"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUserLifecycleUnlink",
);

export const AuthUsersCreate = rpcAction(CONTRACT_ID, "Auth.Users.Create", {
  subject: "rpc.v1.Auth.Users.Create",
  input: schema<Types.AuthUsersCreateInput>(AuthUsersCreateRequestSchema),
  output: schema<Types.AuthUsersCreateOutput>(AuthUsersCreateResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthUsersCreate");

export const AuthUsersGet = rpcAction(CONTRACT_ID, "Auth.Users.Get", {
  subject: "rpc.v1.Auth.Users.Get",
  input: schema<Types.AuthUsersGetInput>(AuthUsersGetRequestSchema),
  output: schema<Types.AuthUsersGetOutput>(AuthUsersGetResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthUsersGet");

export const AuthUsersIdentityLinkCreate = rpcAction(
  CONTRACT_ID,
  "Auth.Users.IdentityLink.Create",
  {
    subject: "rpc.v1.Auth.Users.IdentityLink.Create",
    input: schema<Types.AuthUsersIdentityLinkCreateInput>(
      AuthUsersIdentityLinkCreateRequestSchema,
    ),
    output: schema<Types.AuthUsersIdentityLinkCreateOutput>(
      AuthUsersAccountFlowCreateResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUsersIdentityLinkCreate",
);

export const AuthUsersList = rpcAction(CONTRACT_ID, "Auth.Users.List", {
  subject: "rpc.v1.Auth.Users.List",
  input: schema<Types.AuthUsersListInput>(AuthUsersListRequestSchema),
  output: schema<Types.AuthUsersListOutput>(AuthUsersListResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthUsersList");

export const AuthUsersPasswordChange = rpcAction(
  CONTRACT_ID,
  "Auth.Users.Password.Change",
  {
    subject: "rpc.v1.Auth.Users.Password.Change",
    input: schema<Types.AuthUsersPasswordChangeInput>(
      AuthUsersPasswordChangeRequestSchema,
    ),
    output: schema<Types.AuthUsersPasswordChangeOutput>(
      AuthUsersPasswordChangeResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUsersPasswordChange",
);

export const AuthUsersPasswordResetCreate = rpcAction(
  CONTRACT_ID,
  "Auth.Users.PasswordReset.Create",
  {
    subject: "rpc.v1.Auth.Users.PasswordReset.Create",
    input: schema<Types.AuthUsersPasswordResetCreateInput>(
      AuthUsersPasswordResetCreateRequestSchema,
    ),
    output: schema<Types.AuthUsersPasswordResetCreateOutput>(
      AuthUsersAccountFlowCreateResponseSchema,
    ),
    callerCapabilities: ["admin"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthUsersPasswordResetCreate",
);

export const AuthUsersResolve = rpcAction(CONTRACT_ID, "Auth.Users.Resolve", {
  subject: "rpc.v1.Auth.Users.Resolve",
  input: schema<Types.AuthUsersResolveInput>(AuthUsersResolveRequestSchema),
  output: schema<Types.AuthUsersResolveOutput>(AuthUsersResolveResponseSchema),
  callerCapabilities: [] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthUsersResolve");

export const AuthUsersUpdate = rpcAction(CONTRACT_ID, "Auth.Users.Update", {
  subject: "rpc.v1.Auth.Users.Update",
  input: schema<Types.AuthUsersUpdateInput>(AuthUsersUpdateRequestSchema),
  output: schema<Types.AuthUsersUpdateOutput>(AuthUsersUpdateResponseSchema),
  callerCapabilities: ["admin"] as const,
  errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
  declaredErrorTypes: [
    "AuthError",
    "UnexpectedError",
    "ValidationError",
  ] as const,
}, "AuthUsersUpdate");

export const AuthDeviceUserAuthoritiesResolve = operationAction(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.Resolve",
  {
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
    callerCapabilities: [] as const,
    observeCapabilities: [] as const,
    cancelCapabilities: [] as const,
    controlCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
  },
  "AuthDeviceUserAuthoritiesResolve",
);

export const AuthConnectionsClosed = eventActions(
  CONTRACT_ID,
  "Auth.Connections.Closed",
  {
    subject: "events.v1.Auth.Connections.Closed",
    event: schema<Types.AuthConnectionsClosedEvent>(
      AuthConnectionsClosedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: ["trellis.auth::events.auth"] as const,
  },
  "AuthConnectionsClosed",
  true,
);

export const AuthConnectionsKicked = eventActions(
  CONTRACT_ID,
  "Auth.Connections.Kicked",
  {
    subject: "events.v1.Auth.Connections.Kicked",
    event: schema<Types.AuthConnectionsKickedEvent>(
      AuthConnectionsKickedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: ["trellis.auth::events.auth"] as const,
  },
  "AuthConnectionsKicked",
  true,
);

export const AuthConnectionsOpened = eventActions(
  CONTRACT_ID,
  "Auth.Connections.Opened",
  {
    subject: "events.v1.Auth.Connections.Opened",
    event: schema<Types.AuthConnectionsOpenedEvent>(
      AuthConnectionsOpenedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: ["trellis.auth::events.auth"] as const,
  },
  "AuthConnectionsOpened",
  true,
);

export const AuthDeviceUserAuthoritiesApproved = eventActions(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.Approved",
  {
    subject: "events.v1.Auth.DeviceUserAuthorities.Approved.{/deploymentId}",
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesApprovedEvent>(
      AuthDeviceUserAuthoritiesApprovedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: ["trellis.auth::device.review"] as const,
  },
  "AuthDeviceUserAuthoritiesApproved",
  true,
);

export const AuthDeviceUserAuthoritiesRequested = eventActions(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.Requested",
  {
    subject: "events.v1.Auth.DeviceUserAuthorities.Requested.{/deploymentId}",
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesRequestedEvent>(
      AuthDeviceUserAuthoritiesRequestedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: ["trellis.auth::device.review"] as const,
  },
  "AuthDeviceUserAuthoritiesRequested",
  true,
);

export const AuthDeviceUserAuthoritiesResolved = eventActions(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.Resolved",
  {
    subject: "events.v1.Auth.DeviceUserAuthorities.Resolved.{/deploymentId}",
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesResolvedEvent>(
      AuthDeviceUserAuthoritiesResolvedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: [
      "trellis.auth::device.review",
      "trellis.auth::events.auth",
    ] as const,
  },
  "AuthDeviceUserAuthoritiesResolved",
  true,
);

export const AuthDeviceUserAuthoritiesReviewRequested = eventActions(
  CONTRACT_ID,
  "Auth.DeviceUserAuthorities.ReviewRequested",
  {
    subject:
      "events.v1.Auth.DeviceUserAuthorities.ReviewRequested.{/deploymentId}",
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesReviewRequestedEvent>(
      AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: ["trellis.auth::device.review"] as const,
  },
  "AuthDeviceUserAuthoritiesReviewRequested",
  true,
);

export const AuthSessionsRevoked = eventActions(
  CONTRACT_ID,
  "Auth.Sessions.Revoked",
  {
    subject: "events.v1.Auth.Sessions.Revoked",
    event: schema<Types.AuthSessionsRevokedEvent>(
      AuthSessionsRevokedEventSchema,
    ),
    publishCapabilities: ["trellis.auth::events.auth"] as const,
    subscribeCapabilities: ["trellis.auth::events.auth"] as const,
  },
  "AuthSessionsRevoked",
  true,
);
