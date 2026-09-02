// Generated from ./rust/crates/runtime/.trellis/generated/protocol/apis/trellis.auth@v1.json
import {
  eventActions,
  feedAction,
  operationAction,
  rpcAction,
  schema,
} from "../../../contracts.ts";
import * as Types from "./types.ts";
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
  AuthConnectionsClosedEventSchema,
  AuthConnectionsKickedEventSchema,
  AuthConnectionsKickRequestSchema,
  AuthConnectionsKickResponseSchema,
  AuthConnectionsListRequestSchema,
  AuthConnectionsListResponseSchema,
  AuthConnectionsOpenedEventSchema,
  AuthDeploymentAuthorityAcceptMigrationRequestSchema,
  AuthDeploymentAuthorityAcceptMigrationResponseSchema,
  AuthDeploymentAuthorityAcceptUpdateRequestSchema,
  AuthDeploymentAuthorityAcceptUpdateResponseSchema,
  AuthDeploymentAuthorityGetRequestSchema,
  AuthDeploymentAuthorityGetResponseSchema,
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
  AuthDeviceUserAuthoritiesResolveProgressSchema,
  AuthDeviceUserAuthoritiesResolveRequestSchema,
  AuthDeviceUserAuthoritiesResolveResponseSchema,
  AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
  AuthDeviceUserAuthoritiesReviewsDecideRequestSchema,
  AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
  AuthDeviceUserAuthoritiesReviewsListRequestSchema,
  AuthDeviceUserAuthoritiesReviewsListResponseSchema,
  AuthDeviceUserAuthoritiesRevokeRequestSchema,
  AuthDeviceUserAuthoritiesRevokeResponseSchema,
  AuthErrorDetailsSchema,
  AuthIdentityAuthorityGetRequestSchema,
  AuthIdentityAuthorityGetResponseSchema,
  AuthIdentityAuthorityListRequestSchema,
  AuthIdentityAuthorityListResponseSchema,
  AuthIdentityAuthorityRevokeRequestSchema,
  AuthIdentityAuthorityRevokeResponseSchema,
  AuthIdentityGrantsListRequestSchema,
  AuthIdentityGrantsListResponseSchema,
  AuthIdentityGrantsRevokeRequestSchema,
  AuthIdentityGrantsRevokeResponseSchema,
  AuthPortalsGetRequestSchema,
  AuthPortalsGetResponseSchema,
  AuthPortalsGrantOverridesListRequestSchema,
  AuthPortalsGrantOverridesListResponseSchema,
  AuthPortalsGrantOverridesPutRequestSchema,
  AuthPortalsGrantOverridesPutResponseSchema,
  AuthPortalsGrantOverridesRemoveRequestSchema,
  AuthPortalsGrantOverridesRemoveResponseSchema,
  AuthPortalsListRequestSchema,
  AuthPortalsListResponseSchema,
  AuthPortalsLoginSettingsGetRequestSchema,
  AuthPortalsLoginSettingsGetResponseSchema,
  AuthPortalsLoginSettingsUpdateRequestSchema,
  AuthPortalsLoginSettingsUpdateResponseSchema,
  AuthPortalsPutRequestSchema,
  AuthPortalsPutResponseSchema,
  AuthPortalsRemoveRequestSchema,
  AuthPortalsRemoveResponseSchema,
  AuthPortalsRoutesPutRequestSchema,
  AuthPortalsRoutesPutResponseSchema,
  AuthPortalsRoutesRemoveRequestSchema,
  AuthPortalsRoutesRemoveResponseSchema,
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
  AuthUsersCreateRequestSchema,
  AuthUsersCreateResponseSchema,
  AuthUsersGetRequestSchema,
  AuthUsersGetResponseSchema,
  AuthUsersIdentityLinkCreateRequestSchema,
  AuthUsersIdentityLinkCreateResponseSchema,
  AuthUsersListRequestSchema,
  AuthUsersListResponseSchema,
  AuthUsersPasswordChangeRequestSchema,
  AuthUsersPasswordChangeResponseSchema,
  AuthUsersPasswordResetCreateRequestSchema,
  AuthUsersPasswordResetCreateResponseSchema,
  AuthUsersResolveRequestSchema,
  AuthUsersResolveResponseSchema,
  AuthUsersUpdateRequestSchema,
  AuthUsersUpdateResponseSchema,
} from "./schemas.ts";
import { API as ACTION_ARTIFACT, API_DIGEST as ACTION_DIGEST } from "./api.ts";

const ACTION_SOURCE = {
  api: ACTION_ARTIFACT,
  apiDigest: ACTION_DIGEST,
} as const;

const API_ID = "trellis.auth@v1" as const;

export const AuthCapabilitiesList = rpcAction(
  API_ID,
  "Auth.Capabilities.List",
  {
    subject: "rpc.v1.Auth.Capabilities.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Capabilities.List",
      action: "call",
    }),
    input: schema<Types.AuthCapabilitiesListInput>(
      AuthCapabilitiesListRequestSchema,
    ),
    output: schema<Types.AuthCapabilitiesListOutput>(
      AuthCapabilitiesListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::capabilities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthCapabilitiesList",
  ACTION_SOURCE,
);

export const AuthCapabilityGroupsDelete = rpcAction(
  API_ID,
  "Auth.CapabilityGroups.Delete",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.Delete",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.CapabilityGroups.Delete",
      action: "call",
    }),
    input: schema<Types.AuthCapabilityGroupsDeleteInput>(
      AuthCapabilityGroupsDeleteRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsDeleteOutput>(
      AuthCapabilityGroupsDeleteResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::capabilities.delegate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthCapabilityGroupsDelete",
  ACTION_SOURCE,
);

export const AuthCapabilityGroupsGet = rpcAction(
  API_ID,
  "Auth.CapabilityGroups.Get",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.CapabilityGroups.Get",
      action: "call",
    }),
    input: schema<Types.AuthCapabilityGroupsGetInput>(
      AuthCapabilityGroupsGetRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsGetOutput>(
      AuthCapabilityGroupsGetResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::capabilities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthCapabilityGroupsGet",
  ACTION_SOURCE,
);

export const AuthCapabilityGroupsList = rpcAction(
  API_ID,
  "Auth.CapabilityGroups.List",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.CapabilityGroups.List",
      action: "call",
    }),
    input: schema<Types.AuthCapabilityGroupsListInput>(
      AuthCapabilityGroupsListRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsListOutput>(
      AuthCapabilityGroupsListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::capabilities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthCapabilityGroupsList",
  ACTION_SOURCE,
);

export const AuthCapabilityGroupsPut = rpcAction(
  API_ID,
  "Auth.CapabilityGroups.Put",
  {
    subject: "rpc.v1.Auth.CapabilityGroups.Put",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.CapabilityGroups.Put",
      action: "call",
    }),
    input: schema<Types.AuthCapabilityGroupsPutInput>(
      AuthCapabilityGroupsPutRequestSchema,
    ),
    output: schema<Types.AuthCapabilityGroupsPutOutput>(
      AuthCapabilityGroupsPutResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::capabilities.delegate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthCapabilityGroupsPut",
  ACTION_SOURCE,
);

export const AuthConnectionsKick = rpcAction(
  API_ID,
  "Auth.Connections.Kick",
  {
    subject: "rpc.v1.Auth.Connections.Kick",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Connections.Kick",
      action: "call",
    }),
    input: schema<Types.AuthConnectionsKickInput>(
      AuthConnectionsKickRequestSchema,
    ),
    output: schema<Types.AuthConnectionsKickOutput>(
      AuthConnectionsKickResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::connections.kick"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthConnectionsKick",
  ACTION_SOURCE,
);

export const AuthConnectionsList = rpcAction(
  API_ID,
  "Auth.Connections.List",
  {
    subject: "rpc.v1.Auth.Connections.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Connections.List",
      action: "call",
    }),
    input: schema<Types.AuthConnectionsListInput>(
      AuthConnectionsListRequestSchema,
    ),
    output: schema<Types.AuthConnectionsListOutput>(
      AuthConnectionsListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::connections.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthConnectionsList",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityAcceptMigration = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.AcceptMigration",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.AcceptMigration",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.AcceptMigration",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityAcceptMigrationInput>(
      AuthDeploymentAuthorityAcceptMigrationRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityAcceptMigrationOutput>(
      AuthDeploymentAuthorityAcceptMigrationResponseSchema,
    ),
    callerCapabilities: [
      "trellis.auth::authorities.mutate",
      "trellis.auth::capabilities.delegate",
    ] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityAcceptMigration",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityAcceptUpdate = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.AcceptUpdate",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.AcceptUpdate",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.AcceptUpdate",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityAcceptUpdateInput>(
      AuthDeploymentAuthorityAcceptUpdateRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityAcceptUpdateOutput>(
      AuthDeploymentAuthorityAcceptUpdateResponseSchema,
    ),
    callerCapabilities: [
      "trellis.auth::authorities.mutate",
      "trellis.auth::capabilities.delegate",
    ] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityAcceptUpdate",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityGet = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.Get",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.Get",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityGetInput>(
      AuthDeploymentAuthorityGetRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityGetOutput>(
      AuthDeploymentAuthorityGetResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityGet",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityList = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.List",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.List",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityListInput>(
      AuthDeploymentAuthorityListRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityListOutput>(
      AuthDeploymentAuthorityListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityList",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityPlan = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.Plan",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Plan",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.Plan",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityPlanInput>(
      AuthDeploymentAuthorityPlanRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityPlanOutput>(
      AuthDeploymentAuthorityPlanResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityPlan",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityPlansGet = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.Plans.Get",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Plans.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.Plans.Get",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityPlansGetInput>(
      AuthDeploymentAuthorityPlansGetRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityPlansGetOutput>(
      AuthDeploymentAuthorityPlansGetResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityPlansGet",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityPlansList = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.Plans.List",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Plans.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.Plans.List",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityPlansListInput>(
      AuthDeploymentAuthorityPlansListRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityPlansListOutput>(
      AuthDeploymentAuthorityPlansListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityPlansList",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityReconcile = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.Reconcile",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Reconcile",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.Reconcile",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityReconcileInput>(
      AuthDeploymentAuthorityReconcileRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityReconcileOutput>(
      AuthDeploymentAuthorityReconcileResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityReconcile",
  ACTION_SOURCE,
);

export const AuthDeploymentAuthorityReject = rpcAction(
  API_ID,
  "Auth.DeploymentAuthority.Reject",
  {
    subject: "rpc.v1.Auth.DeploymentAuthority.Reject",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeploymentAuthority.Reject",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentAuthorityRejectInput>(
      AuthDeploymentAuthorityRejectRequestSchema,
    ),
    output: schema<Types.AuthDeploymentAuthorityRejectOutput>(
      AuthDeploymentAuthorityRejectResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentAuthorityReject",
  ACTION_SOURCE,
);

export const AuthDeploymentsCreate = rpcAction(
  API_ID,
  "Auth.Deployments.Create",
  {
    subject: "rpc.v1.Auth.Deployments.Create",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Deployments.Create",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentsCreateInput>(
      AuthDeploymentsCreateRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsCreateOutput>(
      AuthDeploymentsCreateResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::deployments.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentsCreate",
  ACTION_SOURCE,
);

export const AuthDeploymentsDisable = rpcAction(
  API_ID,
  "Auth.Deployments.Disable",
  {
    subject: "rpc.v1.Auth.Deployments.Disable",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Deployments.Disable",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentsDisableInput>(
      AuthDeploymentsDisableRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsDisableOutput>(
      AuthDeploymentsDisableResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::deployments.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentsDisable",
  ACTION_SOURCE,
);

export const AuthDeploymentsEnable = rpcAction(
  API_ID,
  "Auth.Deployments.Enable",
  {
    subject: "rpc.v1.Auth.Deployments.Enable",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Deployments.Enable",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentsEnableInput>(
      AuthDeploymentsEnableRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsEnableOutput>(
      AuthDeploymentsEnableResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::deployments.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentsEnable",
  ACTION_SOURCE,
);

export const AuthDeploymentsList = rpcAction(
  API_ID,
  "Auth.Deployments.List",
  {
    subject: "rpc.v1.Auth.Deployments.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Deployments.List",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentsListInput>(
      AuthDeploymentsListRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsListOutput>(
      AuthDeploymentsListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::deployments.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentsList",
  ACTION_SOURCE,
);

export const AuthDeploymentsRemove = rpcAction(
  API_ID,
  "Auth.Deployments.Remove",
  {
    subject: "rpc.v1.Auth.Deployments.Remove",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Deployments.Remove",
      action: "call",
    }),
    input: schema<Types.AuthDeploymentsRemoveInput>(
      AuthDeploymentsRemoveRequestSchema,
    ),
    output: schema<Types.AuthDeploymentsRemoveOutput>(
      AuthDeploymentsRemoveResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::deployments.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeploymentsRemove",
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesList = rpcAction(
  API_ID,
  "Auth.DeviceUserAuthorities.List",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeviceUserAuthorities.List",
      action: "call",
    }),
    input: schema<Types.AuthDeviceUserAuthoritiesListInput>(
      AuthDeviceUserAuthoritiesListRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesListOutput>(
      AuthDeviceUserAuthoritiesListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeviceUserAuthoritiesList",
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesReviewsDecide = rpcAction(
  API_ID,
  "Auth.DeviceUserAuthorities.Reviews.Decide",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.Reviews.Decide",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeviceUserAuthorities.Reviews.Decide",
      action: "call",
    }),
    input: schema<Types.AuthDeviceUserAuthoritiesReviewsDecideInput>(
      AuthDeviceUserAuthoritiesReviewsDecideRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesReviewsDecideOutput>(
      AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.review"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeviceUserAuthoritiesReviewsDecide",
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesReviewsList = rpcAction(
  API_ID,
  "Auth.DeviceUserAuthorities.Reviews.List",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.Reviews.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeviceUserAuthorities.Reviews.List",
      action: "call",
    }),
    input: schema<Types.AuthDeviceUserAuthoritiesReviewsListInput>(
      AuthDeviceUserAuthoritiesReviewsListRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesReviewsListOutput>(
      AuthDeviceUserAuthoritiesReviewsListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.review"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeviceUserAuthoritiesReviewsList",
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesRevoke = rpcAction(
  API_ID,
  "Auth.DeviceUserAuthorities.Revoke",
  {
    subject: "rpc.v1.Auth.DeviceUserAuthorities.Revoke",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.DeviceUserAuthorities.Revoke",
      action: "call",
    }),
    input: schema<Types.AuthDeviceUserAuthoritiesRevokeInput>(
      AuthDeviceUserAuthoritiesRevokeRequestSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesRevokeOutput>(
      AuthDeviceUserAuthoritiesRevokeResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeviceUserAuthoritiesRevoke",
  ACTION_SOURCE,
);

export const AuthDevicesConnectInfoGet = rpcAction(
  API_ID,
  "Auth.Devices.ConnectInfo.Get",
  {
    subject: "rpc.v1.Auth.Devices.ConnectInfo.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Devices.ConnectInfo.Get",
      action: "call",
    }),
    input: schema<Types.AuthDevicesConnectInfoGetInput>(
      AuthDevicesConnectInfoGetRequestSchema,
    ),
    output: schema<Types.AuthDevicesConnectInfoGetOutput>(
      AuthDevicesConnectInfoGetResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDevicesConnectInfoGet",
  ACTION_SOURCE,
);

export const AuthDevicesDisable = rpcAction(
  API_ID,
  "Auth.Devices.Disable",
  {
    subject: "rpc.v1.Auth.Devices.Disable",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Devices.Disable",
      action: "call",
    }),
    input: schema<Types.AuthDevicesDisableInput>(
      AuthDevicesDisableRequestSchema,
    ),
    output: schema<Types.AuthDevicesDisableOutput>(
      AuthDevicesDisableResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDevicesDisable",
  ACTION_SOURCE,
);

export const AuthDevicesEnable = rpcAction(
  API_ID,
  "Auth.Devices.Enable",
  {
    subject: "rpc.v1.Auth.Devices.Enable",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Devices.Enable",
      action: "call",
    }),
    input: schema<Types.AuthDevicesEnableInput>(AuthDevicesEnableRequestSchema),
    output: schema<Types.AuthDevicesEnableOutput>(
      AuthDevicesEnableResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDevicesEnable",
  ACTION_SOURCE,
);

export const AuthDevicesList = rpcAction(
  API_ID,
  "Auth.Devices.List",
  {
    subject: "rpc.v1.Auth.Devices.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Devices.List",
      action: "call",
    }),
    input: schema<Types.AuthDevicesListInput>(AuthDevicesListRequestSchema),
    output: schema<Types.AuthDevicesListOutput>(AuthDevicesListResponseSchema),
    callerCapabilities: ["trellis.auth::devices.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDevicesList",
  ACTION_SOURCE,
);

export const AuthDevicesProvision = rpcAction(
  API_ID,
  "Auth.Devices.Provision",
  {
    subject: "rpc.v1.Auth.Devices.Provision",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Devices.Provision",
      action: "call",
    }),
    input: schema<Types.AuthDevicesProvisionInput>(
      AuthDevicesProvisionRequestSchema,
    ),
    output: schema<Types.AuthDevicesProvisionOutput>(
      AuthDevicesProvisionResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDevicesProvision",
  ACTION_SOURCE,
);

export const AuthDevicesRemove = rpcAction(
  API_ID,
  "Auth.Devices.Remove",
  {
    subject: "rpc.v1.Auth.Devices.Remove",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Devices.Remove",
      action: "call",
    }),
    input: schema<Types.AuthDevicesRemoveInput>(AuthDevicesRemoveRequestSchema),
    output: schema<Types.AuthDevicesRemoveOutput>(
      AuthDevicesRemoveResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::devices.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDevicesRemove",
  ACTION_SOURCE,
);

export const AuthIdentityAuthorityGet = rpcAction(
  API_ID,
  "Auth.IdentityAuthority.Get",
  {
    subject: "rpc.v1.Auth.IdentityAuthority.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.IdentityAuthority.Get",
      action: "call",
    }),
    input: schema<Types.AuthIdentityAuthorityGetInput>(
      AuthIdentityAuthorityGetRequestSchema,
    ),
    output: schema<Types.AuthIdentityAuthorityGetOutput>(
      AuthIdentityAuthorityGetResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthIdentityAuthorityGet",
  ACTION_SOURCE,
);

export const AuthIdentityAuthorityList = rpcAction(
  API_ID,
  "Auth.IdentityAuthority.List",
  {
    subject: "rpc.v1.Auth.IdentityAuthority.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.IdentityAuthority.List",
      action: "call",
    }),
    input: schema<Types.AuthIdentityAuthorityListInput>(
      AuthIdentityAuthorityListRequestSchema,
    ),
    output: schema<Types.AuthIdentityAuthorityListOutput>(
      AuthIdentityAuthorityListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthIdentityAuthorityList",
  ACTION_SOURCE,
);

export const AuthIdentityAuthorityRevoke = rpcAction(
  API_ID,
  "Auth.IdentityAuthority.Revoke",
  {
    subject: "rpc.v1.Auth.IdentityAuthority.Revoke",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.IdentityAuthority.Revoke",
      action: "call",
    }),
    input: schema<Types.AuthIdentityAuthorityRevokeInput>(
      AuthIdentityAuthorityRevokeRequestSchema,
    ),
    output: schema<Types.AuthIdentityAuthorityRevokeOutput>(
      AuthIdentityAuthorityRevokeResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::authorities.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthIdentityAuthorityRevoke",
  ACTION_SOURCE,
);

export const AuthIdentityGrantsList = rpcAction(
  API_ID,
  "Auth.IdentityGrants.List",
  {
    subject: "rpc.v1.Auth.IdentityGrants.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.IdentityGrants.List",
      action: "call",
    }),
    input: schema<Types.AuthIdentityGrantsListInput>(
      AuthIdentityGrantsListRequestSchema,
    ),
    output: schema<Types.AuthIdentityGrantsListOutput>(
      AuthIdentityGrantsListResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError"] as const,
    declaredErrorTypes: ["AuthError", "UnexpectedError"] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
    ] as const,
  },
  "AuthIdentityGrantsList",
  ACTION_SOURCE,
);

export const AuthIdentityGrantsRevoke = rpcAction(
  API_ID,
  "Auth.IdentityGrants.Revoke",
  {
    subject: "rpc.v1.Auth.IdentityGrants.Revoke",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.IdentityGrants.Revoke",
      action: "call",
    }),
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
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthIdentityGrantsRevoke",
  ACTION_SOURCE,
);

export const AuthPortalsGet = rpcAction(
  API_ID,
  "Auth.Portals.Get",
  {
    subject: "rpc.v1.Auth.Portals.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.Get",
      action: "call",
    }),
    input: schema<Types.AuthPortalsGetInput>(AuthPortalsGetRequestSchema),
    output: schema<Types.AuthPortalsGetOutput>(AuthPortalsGetResponseSchema),
    callerCapabilities: ["trellis.auth::portals.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsGet",
  ACTION_SOURCE,
);

export const AuthPortalsGrantOverridesList = rpcAction(
  API_ID,
  "Auth.Portals.GrantOverrides.List",
  {
    subject: "rpc.v1.Auth.Portals.GrantOverrides.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.GrantOverrides.List",
      action: "call",
    }),
    input: schema<Types.AuthPortalsGrantOverridesListInput>(
      AuthPortalsGrantOverridesListRequestSchema,
    ),
    output: schema<Types.AuthPortalsGrantOverridesListOutput>(
      AuthPortalsGrantOverridesListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::portals.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsGrantOverridesList",
  ACTION_SOURCE,
);

export const AuthPortalsGrantOverridesPut = rpcAction(
  API_ID,
  "Auth.Portals.GrantOverrides.Put",
  {
    subject: "rpc.v1.Auth.Portals.GrantOverrides.Put",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.GrantOverrides.Put",
      action: "call",
    }),
    input: schema<Types.AuthPortalsGrantOverridesPutInput>(
      AuthPortalsGrantOverridesPutRequestSchema,
    ),
    output: schema<Types.AuthPortalsGrantOverridesPutOutput>(
      AuthPortalsGrantOverridesPutResponseSchema,
    ),
    callerCapabilities: [
      "trellis.auth::capabilities.delegate",
      "trellis.auth::portals.mutate",
    ] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsGrantOverridesPut",
  ACTION_SOURCE,
);

export const AuthPortalsGrantOverridesRemove = rpcAction(
  API_ID,
  "Auth.Portals.GrantOverrides.Remove",
  {
    subject: "rpc.v1.Auth.Portals.GrantOverrides.Remove",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.GrantOverrides.Remove",
      action: "call",
    }),
    input: schema<Types.AuthPortalsGrantOverridesRemoveInput>(
      AuthPortalsGrantOverridesRemoveRequestSchema,
    ),
    output: schema<Types.AuthPortalsGrantOverridesRemoveOutput>(
      AuthPortalsGrantOverridesRemoveResponseSchema,
    ),
    callerCapabilities: [
      "trellis.auth::capabilities.delegate",
      "trellis.auth::portals.mutate",
    ] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsGrantOverridesRemove",
  ACTION_SOURCE,
);

export const AuthPortalsList = rpcAction(
  API_ID,
  "Auth.Portals.List",
  {
    subject: "rpc.v1.Auth.Portals.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.List",
      action: "call",
    }),
    input: schema<Types.AuthPortalsListInput>(AuthPortalsListRequestSchema),
    output: schema<Types.AuthPortalsListOutput>(AuthPortalsListResponseSchema),
    callerCapabilities: ["trellis.auth::portals.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsList",
  ACTION_SOURCE,
);

export const AuthPortalsLoginSettingsGet = rpcAction(
  API_ID,
  "Auth.Portals.LoginSettings.Get",
  {
    subject: "rpc.v1.Auth.Portals.LoginSettings.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.LoginSettings.Get",
      action: "call",
    }),
    input: schema<Types.AuthPortalsLoginSettingsGetInput>(
      AuthPortalsLoginSettingsGetRequestSchema,
    ),
    output: schema<Types.AuthPortalsLoginSettingsGetOutput>(
      AuthPortalsLoginSettingsGetResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::portals.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsLoginSettingsGet",
  ACTION_SOURCE,
);

export const AuthPortalsLoginSettingsUpdate = rpcAction(
  API_ID,
  "Auth.Portals.LoginSettings.Update",
  {
    subject: "rpc.v1.Auth.Portals.LoginSettings.Update",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.LoginSettings.Update",
      action: "call",
    }),
    input: schema<Types.AuthPortalsLoginSettingsUpdateInput>(
      AuthPortalsLoginSettingsUpdateRequestSchema,
    ),
    output: schema<Types.AuthPortalsLoginSettingsUpdateOutput>(
      AuthPortalsLoginSettingsUpdateResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::portals.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsLoginSettingsUpdate",
  ACTION_SOURCE,
);

export const AuthPortalsPut = rpcAction(
  API_ID,
  "Auth.Portals.Put",
  {
    subject: "rpc.v1.Auth.Portals.Put",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.Put",
      action: "call",
    }),
    input: schema<Types.AuthPortalsPutInput>(AuthPortalsPutRequestSchema),
    output: schema<Types.AuthPortalsPutOutput>(AuthPortalsPutResponseSchema),
    callerCapabilities: ["trellis.auth::portals.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsPut",
  ACTION_SOURCE,
);

export const AuthPortalsRemove = rpcAction(
  API_ID,
  "Auth.Portals.Remove",
  {
    subject: "rpc.v1.Auth.Portals.Remove",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.Remove",
      action: "call",
    }),
    input: schema<Types.AuthPortalsRemoveInput>(AuthPortalsRemoveRequestSchema),
    output: schema<Types.AuthPortalsRemoveOutput>(
      AuthPortalsRemoveResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::portals.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsRemove",
  ACTION_SOURCE,
);

export const AuthPortalsRoutesPut = rpcAction(
  API_ID,
  "Auth.Portals.Routes.Put",
  {
    subject: "rpc.v1.Auth.Portals.Routes.Put",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.Routes.Put",
      action: "call",
    }),
    input: schema<Types.AuthPortalsRoutesPutInput>(
      AuthPortalsRoutesPutRequestSchema,
    ),
    output: schema<Types.AuthPortalsRoutesPutOutput>(
      AuthPortalsRoutesPutResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::portals.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsRoutesPut",
  ACTION_SOURCE,
);

export const AuthPortalsRoutesRemove = rpcAction(
  API_ID,
  "Auth.Portals.Routes.Remove",
  {
    subject: "rpc.v1.Auth.Portals.Routes.Remove",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Portals.Routes.Remove",
      action: "call",
    }),
    input: schema<Types.AuthPortalsRoutesRemoveInput>(
      AuthPortalsRoutesRemoveRequestSchema,
    ),
    output: schema<Types.AuthPortalsRoutesRemoveOutput>(
      AuthPortalsRoutesRemoveResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::portals.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthPortalsRoutesRemove",
  ACTION_SOURCE,
);

export const AuthServiceInstancesDisable = rpcAction(
  API_ID,
  "Auth.ServiceInstances.Disable",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Disable",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.ServiceInstances.Disable",
      action: "call",
    }),
    input: schema<Types.AuthServiceInstancesDisableInput>(
      AuthServiceInstancesDisableRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesDisableOutput>(
      AuthServiceInstancesDisableResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::services.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthServiceInstancesDisable",
  ACTION_SOURCE,
);

export const AuthServiceInstancesEnable = rpcAction(
  API_ID,
  "Auth.ServiceInstances.Enable",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Enable",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.ServiceInstances.Enable",
      action: "call",
    }),
    input: schema<Types.AuthServiceInstancesEnableInput>(
      AuthServiceInstancesEnableRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesEnableOutput>(
      AuthServiceInstancesEnableResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::services.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthServiceInstancesEnable",
  ACTION_SOURCE,
);

export const AuthServiceInstancesList = rpcAction(
  API_ID,
  "Auth.ServiceInstances.List",
  {
    subject: "rpc.v1.Auth.ServiceInstances.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.ServiceInstances.List",
      action: "call",
    }),
    input: schema<Types.AuthServiceInstancesListInput>(
      AuthServiceInstancesListRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesListOutput>(
      AuthServiceInstancesListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::services.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthServiceInstancesList",
  ACTION_SOURCE,
);

export const AuthServiceInstancesProvision = rpcAction(
  API_ID,
  "Auth.ServiceInstances.Provision",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Provision",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.ServiceInstances.Provision",
      action: "call",
    }),
    input: schema<Types.AuthServiceInstancesProvisionInput>(
      AuthServiceInstancesProvisionRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesProvisionOutput>(
      AuthServiceInstancesProvisionResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::services.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthServiceInstancesProvision",
  ACTION_SOURCE,
);

export const AuthServiceInstancesRemove = rpcAction(
  API_ID,
  "Auth.ServiceInstances.Remove",
  {
    subject: "rpc.v1.Auth.ServiceInstances.Remove",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.ServiceInstances.Remove",
      action: "call",
    }),
    input: schema<Types.AuthServiceInstancesRemoveInput>(
      AuthServiceInstancesRemoveRequestSchema,
    ),
    output: schema<Types.AuthServiceInstancesRemoveOutput>(
      AuthServiceInstancesRemoveResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::services.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthServiceInstancesRemove",
  ACTION_SOURCE,
);

export const AuthSessionsList = rpcAction(
  API_ID,
  "Auth.Sessions.List",
  {
    subject: "rpc.v1.Auth.Sessions.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Sessions.List",
      action: "call",
    }),
    input: schema<Types.AuthSessionsListInput>(AuthSessionsListRequestSchema),
    output: schema<Types.AuthSessionsListOutput>(
      AuthSessionsListResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::sessions.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthSessionsList",
  ACTION_SOURCE,
);

export const AuthSessionsLogout = rpcAction(
  API_ID,
  "Auth.Sessions.Logout",
  {
    subject: "rpc.v1.Auth.Sessions.Logout",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Sessions.Logout",
      action: "call",
    }),
    input: schema<Types.AuthSessionsLogoutInput>(
      AuthSessionsLogoutRequestSchema,
    ),
    output: schema<Types.AuthSessionsLogoutOutput>(
      AuthSessionsLogoutResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthSessionsLogout",
  ACTION_SOURCE,
);

export const AuthSessionsMe = rpcAction(
  API_ID,
  "Auth.Sessions.Me",
  {
    subject: "rpc.v1.Auth.Sessions.Me",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Sessions.Me",
      action: "call",
    }),
    input: schema<Types.AuthSessionsMeInput>(AuthSessionsMeRequestSchema),
    output: schema<Types.AuthSessionsMeOutput>(AuthSessionsMeResponseSchema),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthSessionsMe",
  ACTION_SOURCE,
);

export const AuthSessionsRevoke = rpcAction(
  API_ID,
  "Auth.Sessions.Revoke",
  {
    subject: "rpc.v1.Auth.Sessions.Revoke",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Sessions.Revoke",
      action: "call",
    }),
    input: schema<Types.AuthSessionsRevokeInput>(
      AuthSessionsRevokeRequestSchema,
    ),
    output: schema<Types.AuthSessionsRevokeOutput>(
      AuthSessionsRevokeResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::sessions.revoke"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthSessionsRevoke",
  ACTION_SOURCE,
);

export const AuthUserIdentitiesList = rpcAction(
  API_ID,
  "Auth.UserIdentities.List",
  {
    subject: "rpc.v1.Auth.UserIdentities.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.UserIdentities.List",
      action: "call",
    }),
    input: schema<Types.AuthUserIdentitiesListInput>(
      AuthUserIdentitiesListRequestSchema,
    ),
    output: schema<Types.AuthUserIdentitiesListOutput>(
      AuthUserIdentitiesListResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUserIdentitiesList",
  ACTION_SOURCE,
);

export const AuthUserIdentitiesUnlink = rpcAction(
  API_ID,
  "Auth.UserIdentities.Unlink",
  {
    subject: "rpc.v1.Auth.UserIdentities.Unlink",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.UserIdentities.Unlink",
      action: "call",
    }),
    input: schema<Types.AuthUserIdentitiesUnlinkInput>(
      AuthUserIdentitiesUnlinkRequestSchema,
    ),
    output: schema<Types.AuthUserIdentitiesUnlinkOutput>(
      AuthUserIdentitiesUnlinkResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUserIdentitiesUnlink",
  ACTION_SOURCE,
);

export const AuthUsersCreate = rpcAction(
  API_ID,
  "Auth.Users.Create",
  {
    subject: "rpc.v1.Auth.Users.Create",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.Create",
      action: "call",
    }),
    input: schema<Types.AuthUsersCreateInput>(AuthUsersCreateRequestSchema),
    output: schema<Types.AuthUsersCreateOutput>(AuthUsersCreateResponseSchema),
    callerCapabilities: ["trellis.auth::users.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersCreate",
  ACTION_SOURCE,
);

export const AuthUsersGet = rpcAction(
  API_ID,
  "Auth.Users.Get",
  {
    subject: "rpc.v1.Auth.Users.Get",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.Get",
      action: "call",
    }),
    input: schema<Types.AuthUsersGetInput>(AuthUsersGetRequestSchema),
    output: schema<Types.AuthUsersGetOutput>(AuthUsersGetResponseSchema),
    callerCapabilities: ["trellis.auth::users.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersGet",
  ACTION_SOURCE,
);

export const AuthUsersIdentityLinkCreate = rpcAction(
  API_ID,
  "Auth.Users.IdentityLink.Create",
  {
    subject: "rpc.v1.Auth.Users.IdentityLink.Create",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.IdentityLink.Create",
      action: "call",
    }),
    input: schema<Types.AuthUsersIdentityLinkCreateInput>(
      AuthUsersIdentityLinkCreateRequestSchema,
    ),
    output: schema<Types.AuthUsersIdentityLinkCreateOutput>(
      AuthUsersIdentityLinkCreateResponseSchema,
    ),
    callerCapabilities: [] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersIdentityLinkCreate",
  ACTION_SOURCE,
);

export const AuthUsersList = rpcAction(
  API_ID,
  "Auth.Users.List",
  {
    subject: "rpc.v1.Auth.Users.List",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.List",
      action: "call",
    }),
    input: schema<Types.AuthUsersListInput>(AuthUsersListRequestSchema),
    output: schema<Types.AuthUsersListOutput>(AuthUsersListResponseSchema),
    callerCapabilities: ["trellis.auth::users.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersList",
  ACTION_SOURCE,
);

export const AuthUsersPasswordChange = rpcAction(
  API_ID,
  "Auth.Users.Password.Change",
  {
    subject: "rpc.v1.Auth.Users.Password.Change",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.Password.Change",
      action: "call",
    }),
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
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersPasswordChange",
  ACTION_SOURCE,
);

export const AuthUsersPasswordResetCreate = rpcAction(
  API_ID,
  "Auth.Users.PasswordReset.Create",
  {
    subject: "rpc.v1.Auth.Users.PasswordReset.Create",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.PasswordReset.Create",
      action: "call",
    }),
    input: schema<Types.AuthUsersPasswordResetCreateInput>(
      AuthUsersPasswordResetCreateRequestSchema,
    ),
    output: schema<Types.AuthUsersPasswordResetCreateOutput>(
      AuthUsersPasswordResetCreateResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::users.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersPasswordResetCreate",
  ACTION_SOURCE,
);

export const AuthUsersResolve = rpcAction(
  API_ID,
  "Auth.Users.Resolve",
  {
    subject: "rpc.v1.Auth.Users.Resolve",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.Resolve",
      action: "call",
    }),
    input: schema<Types.AuthUsersResolveInput>(AuthUsersResolveRequestSchema),
    output: schema<Types.AuthUsersResolveOutput>(
      AuthUsersResolveResponseSchema,
    ),
    callerCapabilities: ["trellis.auth::users.read"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersResolve",
  ACTION_SOURCE,
);

export const AuthUsersUpdate = rpcAction(
  API_ID,
  "Auth.Users.Update",
  {
    subject: "rpc.v1.Auth.Users.Update",
    permission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "rpc",
      surfaceName: "Auth.Users.Update",
      action: "call",
    }),
    input: schema<Types.AuthUsersUpdateInput>(AuthUsersUpdateRequestSchema),
    output: schema<Types.AuthUsersUpdateOutput>(AuthUsersUpdateResponseSchema),
    callerCapabilities: ["trellis.auth::users.mutate"] as const,
    errors: ["AuthError", "UnexpectedError", "ValidationError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "UnexpectedError",
      "ValidationError",
    ] as const,
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthUsersUpdate",
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesResolve = operationAction(
  API_ID,
  "Auth.DeviceUserAuthorities.Resolve",
  {
    subject: "operations.v1.Auth.DeviceUserAuthorities.Resolve",
    permissions: Object.freeze({
      invoke: Object.freeze({
        apiId: "trellis.auth@v1",
        apiVersion: "v1",
        surfaceKind: "operation",
        surfaceName: "Auth.DeviceUserAuthorities.Resolve",
        action: "invoke",
      }),
      observe: Object.freeze({
        apiId: "trellis.auth@v1",
        apiVersion: "v1",
        surfaceKind: "operation",
        surfaceName: "Auth.DeviceUserAuthorities.Resolve",
        action: "observe",
      }),
      cancel: Object.freeze({
        apiId: "trellis.auth@v1",
        apiVersion: "v1",
        surfaceKind: "operation",
        surfaceName: "Auth.DeviceUserAuthorities.Resolve",
        action: "cancel",
      }),
      control: Object.freeze({}),
    }),
    input: schema<Types.AuthDeviceUserAuthoritiesResolveInput>(
      AuthDeviceUserAuthoritiesResolveRequestSchema,
    ),
    progress: schema<Types.AuthDeviceUserAuthoritiesResolveProgress>(
      AuthDeviceUserAuthoritiesResolveProgressSchema,
    ),
    output: schema<Types.AuthDeviceUserAuthoritiesResolveOutput>(
      AuthDeviceUserAuthoritiesResolveResponseSchema,
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
    runtimeErrors: [
      {
        type: "AuthError",
        schema: schema<Types.AuthErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.AuthError.fromSerializable,
      },
      {
        type: "UnexpectedError",
        schema: schema<Types.UnexpectedErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.UnexpectedError.fromSerializable,
      },
      {
        type: "ValidationError",
        schema: schema<Types.ValidationErrorData>(AuthErrorDetailsSchema),
        fromSerializable: Types.ValidationError.fromSerializable,
      },
    ] as const,
  },
  "AuthDeviceUserAuthoritiesResolve",
  ACTION_SOURCE,
);

export const AuthConnectionsClosed = eventActions(
  API_ID,
  "Auth.Connections.Closed",
  {
    subject: "events.v1.Auth.Connections.Closed",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Connections.Closed",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Connections.Closed",
      action: "subscribe",
    }),
    event: schema<Types.AuthConnectionsClosedEvent>(
      AuthConnectionsClosedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthConnectionsClosed",
  false,
  ACTION_SOURCE,
);

export const AuthConnectionsKicked = eventActions(
  API_ID,
  "Auth.Connections.Kicked",
  {
    subject: "events.v1.Auth.Connections.Kicked",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Connections.Kicked",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Connections.Kicked",
      action: "subscribe",
    }),
    event: schema<Types.AuthConnectionsKickedEvent>(
      AuthConnectionsKickedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthConnectionsKicked",
  false,
  ACTION_SOURCE,
);

export const AuthConnectionsOpened = eventActions(
  API_ID,
  "Auth.Connections.Opened",
  {
    subject: "events.v1.Auth.Connections.Opened",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Connections.Opened",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Connections.Opened",
      action: "subscribe",
    }),
    event: schema<Types.AuthConnectionsOpenedEvent>(
      AuthConnectionsOpenedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthConnectionsOpened",
  false,
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesApproved = eventActions(
  API_ID,
  "Auth.DeviceUserAuthorities.Approved",
  {
    subject: "events.v1.Auth.DeviceUserAuthorities.Approved",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.Approved",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.Approved",
      action: "subscribe",
    }),
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesApprovedEvent>(
      AuthDeviceUserAuthoritiesApprovedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthDeviceUserAuthoritiesApproved",
  false,
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesRequested = eventActions(
  API_ID,
  "Auth.DeviceUserAuthorities.Requested",
  {
    subject: "events.v1.Auth.DeviceUserAuthorities.Requested",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.Requested",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.Requested",
      action: "subscribe",
    }),
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesRequestedEvent>(
      AuthDeviceUserAuthoritiesRequestedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthDeviceUserAuthoritiesRequested",
  false,
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesResolved = eventActions(
  API_ID,
  "Auth.DeviceUserAuthorities.Resolved",
  {
    subject: "events.v1.Auth.DeviceUserAuthorities.Resolved",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.Resolved",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.Resolved",
      action: "subscribe",
    }),
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesResolvedEvent>(
      AuthDeviceUserAuthoritiesResolvedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthDeviceUserAuthoritiesResolved",
  false,
  ACTION_SOURCE,
);

export const AuthDeviceUserAuthoritiesReviewRequested = eventActions(
  API_ID,
  "Auth.DeviceUserAuthorities.ReviewRequested",
  {
    subject: "events.v1.Auth.DeviceUserAuthorities.ReviewRequested",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.ReviewRequested",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.DeviceUserAuthorities.ReviewRequested",
      action: "subscribe",
    }),
    params: ["/deploymentId"] as const,
    event: schema<Types.AuthDeviceUserAuthoritiesReviewRequestedEvent>(
      AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthDeviceUserAuthoritiesReviewRequested",
  false,
  ACTION_SOURCE,
);

export const AuthSessionsRevoked = eventActions(
  API_ID,
  "Auth.Sessions.Revoked",
  {
    subject: "events.v1.Auth.Sessions.Revoked",
    publishPermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Sessions.Revoked",
      action: "publish",
    }),
    subscribePermission: Object.freeze({
      apiId: "trellis.auth@v1",
      apiVersion: "v1",
      surfaceKind: "event",
      surfaceName: "Auth.Sessions.Revoked",
      action: "subscribe",
    }),
    event: schema<Types.AuthSessionsRevokedEvent>(
      AuthSessionsRevokedEventSchema,
    ),
    publishCapabilities: [] as const,
    subscribeCapabilities: ["trellis.auth::events.stream"] as const,
  },
  "AuthSessionsRevoked",
  false,
  ACTION_SOURCE,
);
