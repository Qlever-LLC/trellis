import {
  AuthCapabilitiesListResponseSchema,
  AuthCapabilitiesListSchema,
  AuthCapabilityGroupsDeleteResponseSchema,
  AuthCapabilityGroupsDeleteSchema,
  AuthCapabilityGroupsGetResponseSchema,
  AuthCapabilityGroupsGetSchema,
  AuthCapabilityGroupsListResponseSchema,
  AuthCapabilityGroupsListSchema,
  AuthCapabilityGroupsPutResponseSchema,
  AuthCapabilityGroupsPutSchema,
  AuthIdentitiesListResponseSchema,
  AuthIdentitiesListSchema,
  AuthRequestsValidateResponseSchema,
  AuthRequestsValidateSchema,
  AuthSessionsMeResponseSchema,
  AuthSessionsMeSchema,
  AuthUserIdentitiesListResponseSchema,
  AuthUserIdentitiesListSchema,
  AuthUserIdentitiesUnlinkResponseSchema,
  AuthUserIdentitiesUnlinkSchema,
  AuthUsersAccountFlowCreateResponseSchema,
  AuthUsersCreateResponseSchema,
  AuthUsersCreateSchema,
  AuthUsersGetResponseSchema,
  AuthUsersGetSchema,
  AuthUsersIdentityLinkCreateSchema,
  AuthUsersListResponseSchema,
  AuthUsersListSchema,
  AuthUsersPasswordChangeResponseSchema,
  AuthUsersPasswordChangeSchema,
  AuthUsersPasswordResetCreateSchema,
  AuthUsersUpdateResponseSchema,
  AuthUsersUpdateSchema,
  PortalFlowStateSchema,
} from "@qlever-llc/trellis/auth";
import {
  AuthCatalogIssuesResolveResponseSchema,
  AuthCatalogIssuesResolveSchema,
  AuthDeploymentAuthorityAcceptMigrationSchema,
  AuthDeploymentAuthorityAcceptResponseSchema,
  AuthDeploymentAuthorityAcceptUpdateSchema,
  AuthDeploymentAuthorityGetResponseSchema,
  AuthDeploymentAuthorityGetSchema,
  AuthDeploymentAuthorityGrantOverridesListResponseSchema,
  AuthDeploymentAuthorityGrantOverridesListSchema,
  AuthDeploymentAuthorityGrantOverridesPutSchema,
  AuthDeploymentAuthorityGrantOverridesRemoveSchema,
  AuthDeploymentAuthorityGrantOverridesResponseSchema,
  AuthDeploymentAuthorityListResponseSchema,
  AuthDeploymentAuthorityListSchema,
  AuthDeploymentAuthorityPlanResponseSchema,
  AuthDeploymentAuthorityPlanSchema,
  AuthDeploymentAuthorityPlansGetResponseSchema,
  AuthDeploymentAuthorityPlansGetSchema,
  AuthDeploymentAuthorityPlansListResponseSchema,
  AuthDeploymentAuthorityPlansListSchema,
  AuthDeploymentAuthorityReconcileResponseSchema,
  AuthDeploymentAuthorityReconcileSchema,
  AuthDeploymentAuthorityRejectResponseSchema,
  AuthDeploymentAuthorityRejectSchema,
  AuthDeploymentSchema,
  AuthDeploymentsCreateResponseSchema,
  AuthDeploymentsCreateSchema,
  AuthDeploymentsDisableResponseSchema,
  AuthDeploymentsDisableSchema,
  AuthDeploymentsEnableResponseSchema,
  AuthDeploymentsEnableSchema,
  AuthDeploymentsListResponseSchema,
  AuthDeploymentsListSchema,
  AuthDeploymentsRemoveResponseSchema,
  AuthDeploymentsRemoveSchema,
  AuthDevicesConnectInfoGetResponseSchema,
  AuthDevicesConnectInfoGetSchema,
  AuthDevicesDisableResponseSchema,
  AuthDevicesDisableSchema,
  AuthDevicesEnableResponseSchema,
  AuthDevicesEnableSchema,
  AuthDevicesListResponseSchema,
  AuthDevicesListSchema,
  AuthDevicesProvisionResponseSchema,
  AuthDevicesProvisionSchema,
  AuthDevicesRemoveResponseSchema,
  AuthDevicesRemoveSchema,
  AuthDeviceUserAuthoritiesApprovedEventSchema,
  AuthDeviceUserAuthoritiesListResponseSchema,
  AuthDeviceUserAuthoritiesListSchema,
  AuthDeviceUserAuthoritiesRequestedEventSchema,
  AuthDeviceUserAuthoritiesResolvedEventSchema,
  AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
  AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
  AuthDeviceUserAuthoritiesReviewsDecideSchema,
  AuthDeviceUserAuthoritiesReviewsListResponseSchema,
  AuthDeviceUserAuthoritiesReviewsListSchema,
  AuthDeviceUserAuthoritiesRevokeResponseSchema,
  AuthDeviceUserAuthoritiesRevokeSchema,
  AuthIdentityGrantsListResponseSchema,
  AuthIdentityGrantsListSchema,
  AuthIdentityGrantsRevokeResponseSchema,
  AuthIdentityGrantsRevokeSchema,
  AuthPortalsGetResponseSchema,
  AuthPortalsGetSchema,
  AuthPortalsListResponseSchema,
  AuthPortalsListSchema,
  AuthPortalsLoginSettingsGetSchema,
  AuthPortalsLoginSettingsResponseSchema,
  AuthPortalsLoginSettingsUpdateSchema,
  AuthPortalsPutResponseSchema,
  AuthPortalsPutSchema,
  AuthPortalsRemoveResponseSchema,
  AuthPortalsRemoveSchema,
  AuthPortalsRoutesPutResponseSchema,
  AuthPortalsRoutesPutSchema,
  AuthPortalsRoutesRemoveResponseSchema,
  AuthPortalsRoutesRemoveSchema,
  AuthResolveDeviceUserAuthoritiesProgressSchema,
  AuthResolveDeviceUserAuthoritiesResponseSchema,
  AuthResolveDeviceUserAuthoritiesSchema,
  AuthServiceInstancesDisableResponseSchema,
  AuthServiceInstancesDisableSchema,
  AuthServiceInstancesEnableResponseSchema,
  AuthServiceInstancesEnableSchema,
  AuthServiceInstancesListResponseSchema,
  AuthServiceInstancesListSchema,
  AuthServiceInstancesProvisionResponseSchema,
  AuthServiceInstancesProvisionSchema,
  AuthServiceInstancesRemoveResponseSchema,
  AuthServiceInstancesRemoveSchema,
  DeploymentAuthorityCapabilityNeedSchema,
  DeploymentAuthorityContractNeedSchema,
  DeploymentAuthorityGrantOverrideSchema,
  DeploymentAuthorityMaterializationSchema,
  DeploymentAuthorityMigrationSchema,
  DeploymentAuthorityNeedsSchema,
  DeploymentAuthorityProposalSchema,
  DeploymentAuthorityReconciliationStatusSchema,
  DeploymentAuthorityResourceNeedSchema,
  DeploymentAuthorityResourceSchema,
  DeploymentAuthoritySchema,
  DeploymentAuthoritySurfaceNeedSchema,
  DeploymentAuthoritySurfaceSchema,
  DeploymentAuthorityUpdateSchema,
  DeploymentPortalRouteSchema,
  DeploymentResourceBindingSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewSchema,
  DeviceConnectInfoSchema,
  DeviceDeploymentSchema,
  DeviceSchema,
  ImplementationOfferSchema,
  ServiceDeploymentSchema,
  ServiceInstanceSchema,
} from "../../../packages/trellis/auth/protocol.ts";
import { defineServiceContract } from "@qlever-llc/trellis";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/health";
import {
  type AuthConnectionsOpenedEvent,
  AuthConnectionsOpenedEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthConnect.ts";
import {
  type AuthConnectionsKickedEvent,
  AuthConnectionsKickedEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthConnectionKicked.ts";
import {
  type AuthConnectionsClosedEvent,
  AuthConnectionsClosedEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthDisconnect.ts";
import {
  type AuthSessionsRevokedEvent,
  AuthSessionsRevokedEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthSessionRevoked.ts";
import {
  AuthConnectionsKickResponseSchema,
  AuthConnectionsKickSchema,
} from "../../../packages/trellis/models/auth/rpc/KickConnection.ts";
import {
  AuthConnectionsListResponseSchema,
  AuthConnectionsListSchema,
} from "../../../packages/trellis/models/auth/rpc/ListConnections.ts";
import {
  AuthSessionsListResponseSchema,
  AuthSessionsListSchema,
} from "../../../packages/trellis/models/auth/rpc/ListSessions.ts";
import {
  AuthSessionsLogoutResponseSchema,
  AuthSessionsLogoutSchema,
} from "../../../packages/trellis/models/auth/rpc/Logout.ts";
import {
  AuthSessionsRevokeResponseSchema,
  AuthSessionsRevokeSchema,
} from "../../../packages/trellis/models/auth/rpc/RevokeSession.ts";

const schemas = {
  AuthDeviceUserAuthoritiesReviewsDecideRequest:
    AuthDeviceUserAuthoritiesReviewsDecideSchema,
  AuthDeviceUserAuthoritiesReviewsDecideResponse:
    AuthDeviceUserAuthoritiesReviewsDecideResponseSchema,
  AuthDeviceUserAuthoritiesReviewsListRequest:
    AuthDeviceUserAuthoritiesReviewsListSchema,
  AuthDeviceUserAuthoritiesReviewsListResponse:
    AuthDeviceUserAuthoritiesReviewsListResponseSchema,
  AuthDevicesProvisionRequest: AuthDevicesProvisionSchema,
  AuthDevicesProvisionResponse: AuthDevicesProvisionResponseSchema,
  AuthDevicesListRequest: AuthDevicesListSchema,
  AuthDevicesListResponse: AuthDevicesListResponseSchema,
  AuthDevicesDisableRequest: AuthDevicesDisableSchema,
  AuthDevicesDisableResponse: AuthDevicesDisableResponseSchema,
  AuthResolveDeviceUserAuthoritiesRequest:
    AuthResolveDeviceUserAuthoritiesSchema,
  AuthResolveDeviceUserAuthoritiesProgress:
    AuthResolveDeviceUserAuthoritiesProgressSchema,
  AuthResolveDeviceUserAuthoritiesResponse:
    AuthResolveDeviceUserAuthoritiesResponseSchema,
  AuthDevicesConnectInfoGetRequest: AuthDevicesConnectInfoGetSchema,
  AuthDevicesConnectInfoGetResponse: AuthDevicesConnectInfoGetResponseSchema,
  AuthDeviceUserAuthoritiesListRequest: AuthDeviceUserAuthoritiesListSchema,
  AuthDeviceUserAuthoritiesListResponse:
    AuthDeviceUserAuthoritiesListResponseSchema,
  AuthDeviceUserAuthoritiesRevokeRequest: AuthDeviceUserAuthoritiesRevokeSchema,
  AuthDeviceUserAuthoritiesRevokeResponse:
    AuthDeviceUserAuthoritiesRevokeResponseSchema,
  PortalFlowState: PortalFlowStateSchema,
  Device: DeviceSchema,
  DeviceDeployment: DeviceDeploymentSchema,
  ServiceDeployment: ServiceDeploymentSchema,
  AuthDeployment: AuthDeploymentSchema,
  ServiceInstance: ServiceInstanceSchema,
  DeploymentAuthority: DeploymentAuthoritySchema,
  DeploymentAuthorityNeeds: DeploymentAuthorityNeedsSchema,
  DeploymentAuthorityContractNeed: DeploymentAuthorityContractNeedSchema,
  DeploymentAuthoritySurfaceNeed: DeploymentAuthoritySurfaceNeedSchema,
  DeploymentAuthorityCapabilityNeed: DeploymentAuthorityCapabilityNeedSchema,
  DeploymentAuthorityResourceNeed: DeploymentAuthorityResourceNeedSchema,
  DeploymentAuthorityResource: DeploymentAuthorityResourceSchema,
  DeploymentAuthoritySurface: DeploymentAuthoritySurfaceSchema,
  DeploymentAuthorityUpdate: DeploymentAuthorityUpdateSchema,
  DeploymentAuthorityMigration: DeploymentAuthorityMigrationSchema,
  DeploymentAuthorityProposal: DeploymentAuthorityProposalSchema,
  DeploymentAuthorityMaterialization: DeploymentAuthorityMaterializationSchema,
  DeploymentAuthorityReconciliationStatus:
    DeploymentAuthorityReconciliationStatusSchema,
  DeploymentResourceBinding: DeploymentResourceBindingSchema,
  ImplementationOffer: ImplementationOfferSchema,
  DeploymentPortalRoute: DeploymentPortalRouteSchema,
  DeploymentAuthorityGrantOverride: DeploymentAuthorityGrantOverrideSchema,
  DeviceActivationReview: DeviceActivationReviewSchema,
  DeviceActivationRecord: DeviceActivationRecordSchema,
  DeviceConnectInfo: DeviceConnectInfoSchema,
  AuthDeviceUserAuthoritiesReviewRequestedEvent:
    AuthDeviceUserAuthoritiesReviewRequestedEventSchema,
  AuthDeviceUserAuthoritiesRequestedEvent:
    AuthDeviceUserAuthoritiesRequestedEventSchema,
  AuthDeviceUserAuthoritiesApprovedEvent:
    AuthDeviceUserAuthoritiesApprovedEventSchema,
  AuthDeviceUserAuthoritiesResolvedEvent:
    AuthDeviceUserAuthoritiesResolvedEventSchema,
  AuthDeploymentsCreateRequest: AuthDeploymentsCreateSchema,
  AuthDeploymentsCreateResponse: AuthDeploymentsCreateResponseSchema,
  AuthDeploymentsListRequest: AuthDeploymentsListSchema,
  AuthDeploymentsListResponse: AuthDeploymentsListResponseSchema,
  AuthDeploymentAuthorityListRequest: AuthDeploymentAuthorityListSchema,
  AuthDeploymentAuthorityListResponse:
    AuthDeploymentAuthorityListResponseSchema,
  AuthDeploymentAuthorityGetRequest: AuthDeploymentAuthorityGetSchema,
  AuthDeploymentAuthorityGetResponse: AuthDeploymentAuthorityGetResponseSchema,
  AuthDeploymentAuthorityPlansListRequest:
    AuthDeploymentAuthorityPlansListSchema,
  AuthDeploymentAuthorityPlansListResponse:
    AuthDeploymentAuthorityPlansListResponseSchema,
  AuthDeploymentAuthorityPlansGetRequest: AuthDeploymentAuthorityPlansGetSchema,
  AuthDeploymentAuthorityPlansGetResponse:
    AuthDeploymentAuthorityPlansGetResponseSchema,
  AuthDeploymentAuthorityPlanRequest: AuthDeploymentAuthorityPlanSchema,
  AuthDeploymentAuthorityPlanResponse:
    AuthDeploymentAuthorityPlanResponseSchema,
  AuthDeploymentAuthorityAcceptUpdateRequest:
    AuthDeploymentAuthorityAcceptUpdateSchema,
  AuthDeploymentAuthorityAcceptMigrationRequest:
    AuthDeploymentAuthorityAcceptMigrationSchema,
  AuthDeploymentAuthorityAcceptResponse:
    AuthDeploymentAuthorityAcceptResponseSchema,
  AuthDeploymentAuthorityRejectRequest: AuthDeploymentAuthorityRejectSchema,
  AuthDeploymentAuthorityRejectResponse:
    AuthDeploymentAuthorityRejectResponseSchema,
  AuthDeploymentAuthorityReconcileRequest:
    AuthDeploymentAuthorityReconcileSchema,
  AuthDeploymentAuthorityReconcileResponse:
    AuthDeploymentAuthorityReconcileResponseSchema,
  AuthDeploymentAuthorityGrantOverridesPutRequest:
    AuthDeploymentAuthorityGrantOverridesPutSchema,
  AuthDeploymentAuthorityGrantOverridesListRequest:
    AuthDeploymentAuthorityGrantOverridesListSchema,
  AuthDeploymentAuthorityGrantOverridesListResponse:
    AuthDeploymentAuthorityGrantOverridesListResponseSchema,
  AuthDeploymentAuthorityGrantOverridesResponse:
    AuthDeploymentAuthorityGrantOverridesResponseSchema,
  AuthDeploymentAuthorityGrantOverridesRemoveRequest:
    AuthDeploymentAuthorityGrantOverridesRemoveSchema,
  AuthDeploymentsDisableRequest: AuthDeploymentsDisableSchema,
  AuthDeploymentsDisableResponse: AuthDeploymentsDisableResponseSchema,
  AuthCatalogIssuesResolveRequest: AuthCatalogIssuesResolveSchema,
  AuthCatalogIssuesResolveResponse: AuthCatalogIssuesResolveResponseSchema,
  AuthDeploymentsEnableRequest: AuthDeploymentsEnableSchema,
  AuthDeploymentsEnableResponse: AuthDeploymentsEnableResponseSchema,
  AuthDeploymentsRemoveRequest: AuthDeploymentsRemoveSchema,
  AuthDeploymentsRemoveResponse: AuthDeploymentsRemoveResponseSchema,
  AuthServiceInstancesProvisionRequest: AuthServiceInstancesProvisionSchema,
  AuthServiceInstancesProvisionResponse:
    AuthServiceInstancesProvisionResponseSchema,
  AuthServiceInstancesListRequest: AuthServiceInstancesListSchema,
  AuthServiceInstancesListResponse: AuthServiceInstancesListResponseSchema,
  AuthServiceInstancesDisableRequest: AuthServiceInstancesDisableSchema,
  AuthServiceInstancesDisableResponse:
    AuthServiceInstancesDisableResponseSchema,
  AuthServiceInstancesEnableRequest: AuthServiceInstancesEnableSchema,
  AuthServiceInstancesEnableResponse: AuthServiceInstancesEnableResponseSchema,
  AuthServiceInstancesRemoveRequest: AuthServiceInstancesRemoveSchema,
  AuthServiceInstancesRemoveResponse: AuthServiceInstancesRemoveResponseSchema,
  AuthIdentitiesListRequest: AuthIdentitiesListSchema,
  AuthIdentitiesListResponse: AuthIdentitiesListResponseSchema,
  AuthCapabilitiesListRequest: AuthCapabilitiesListSchema,
  AuthCapabilitiesListResponse: AuthCapabilitiesListResponseSchema,
  AuthCapabilityGroupsListRequest: AuthCapabilityGroupsListSchema,
  AuthCapabilityGroupsListResponse: AuthCapabilityGroupsListResponseSchema,
  AuthCapabilityGroupsGetRequest: AuthCapabilityGroupsGetSchema,
  AuthCapabilityGroupsGetResponse: AuthCapabilityGroupsGetResponseSchema,
  AuthCapabilityGroupsPutRequest: AuthCapabilityGroupsPutSchema,
  AuthCapabilityGroupsPutResponse: AuthCapabilityGroupsPutResponseSchema,
  AuthCapabilityGroupsDeleteRequest: AuthCapabilityGroupsDeleteSchema,
  AuthCapabilityGroupsDeleteResponse: AuthCapabilityGroupsDeleteResponseSchema,
  AuthUsersIdentityLinkCreateRequest: AuthUsersIdentityLinkCreateSchema,
  AuthUsersPasswordChangeRequest: AuthUsersPasswordChangeSchema,
  AuthUsersPasswordChangeResponse: AuthUsersPasswordChangeResponseSchema,
  AuthUsersPasswordResetCreateRequest: AuthUsersPasswordResetCreateSchema,
  AuthUsersAccountFlowCreateResponse: AuthUsersAccountFlowCreateResponseSchema,
  AuthUsersListRequest: AuthUsersListSchema,
  AuthUsersListResponse: AuthUsersListResponseSchema,
  AuthUsersGetRequest: AuthUsersGetSchema,
  AuthUsersGetResponse: AuthUsersGetResponseSchema,
  AuthUsersCreateRequest: AuthUsersCreateSchema,
  AuthUsersCreateResponse: AuthUsersCreateResponseSchema,
  AuthUserIdentitiesListRequest: AuthUserIdentitiesListSchema,
  AuthUserIdentitiesListResponse: AuthUserIdentitiesListResponseSchema,
  AuthUserIdentitiesUnlinkRequest: AuthUserIdentitiesUnlinkSchema,
  AuthUserIdentitiesUnlinkResponse: AuthUserIdentitiesUnlinkResponseSchema,
  AuthSessionsMeRequest: AuthSessionsMeSchema,
  AuthSessionsMeResponse: AuthSessionsMeResponseSchema,
  AuthIdentityGrantsRevokeRequest: AuthIdentityGrantsRevokeSchema,
  AuthIdentityGrantsRevokeResponse: AuthIdentityGrantsRevokeResponseSchema,
  AuthUsersUpdateRequest: AuthUsersUpdateSchema,
  AuthUsersUpdateResponse: AuthUsersUpdateResponseSchema,
  AuthPortalsListRequest: AuthPortalsListSchema,
  AuthPortalsListResponse: AuthPortalsListResponseSchema,
  AuthPortalsGetRequest: AuthPortalsGetSchema,
  AuthPortalsGetResponse: AuthPortalsGetResponseSchema,
  AuthPortalsPutRequest: AuthPortalsPutSchema,
  AuthPortalsPutResponse: AuthPortalsPutResponseSchema,
  AuthPortalsRemoveRequest: AuthPortalsRemoveSchema,
  AuthPortalsRemoveResponse: AuthPortalsRemoveResponseSchema,
  AuthPortalsLoginSettingsGetRequest: AuthPortalsLoginSettingsGetSchema,
  AuthPortalsLoginSettingsResponse: AuthPortalsLoginSettingsResponseSchema,
  AuthPortalsLoginSettingsUpdateRequest: AuthPortalsLoginSettingsUpdateSchema,
  AuthPortalsRoutesPutRequest: AuthPortalsRoutesPutSchema,
  AuthPortalsRoutesPutResponse: AuthPortalsRoutesPutResponseSchema,
  AuthPortalsRoutesRemoveRequest: AuthPortalsRoutesRemoveSchema,
  AuthPortalsRoutesRemoveResponse: AuthPortalsRoutesRemoveResponseSchema,
  AuthDevicesEnableRequest: AuthDevicesEnableSchema,
  AuthDevicesEnableResponse: AuthDevicesEnableResponseSchema,
  AuthDevicesRemoveRequest: AuthDevicesRemoveSchema,
  AuthDevicesRemoveResponse: AuthDevicesRemoveResponseSchema,
  AuthRequestsValidateRequest: AuthRequestsValidateSchema,
  AuthRequestsValidateResponse: AuthRequestsValidateResponseSchema,
  HealthRequest: HealthRpcSchema,
  HealthResponse: HealthResponseSchema,
  AuthConnectionsOpenedEvent: AuthConnectionsOpenedEventSchema,
  AuthConnectionsKickedEvent: AuthConnectionsKickedEventSchema,
  AuthConnectionsClosedEvent: AuthConnectionsClosedEventSchema,
  AuthSessionsRevokedEvent: AuthSessionsRevokedEventSchema,
  AuthConnectionsKickRequest: AuthConnectionsKickSchema,
  AuthConnectionsKickResponse: AuthConnectionsKickResponseSchema,
  AuthConnectionsListRequest: AuthConnectionsListSchema,
  AuthConnectionsListResponse: AuthConnectionsListResponseSchema,
  AuthSessionsListRequest: AuthSessionsListSchema,
  AuthSessionsListResponse: AuthSessionsListResponseSchema,
  AuthIdentityGrantsListRequest: AuthIdentityGrantsListSchema,
  AuthIdentityGrantsListResponse: AuthIdentityGrantsListResponseSchema,
  AuthSessionsLogoutRequest: AuthSessionsLogoutSchema,
  AuthSessionsLogoutResponse: AuthSessionsLogoutResponseSchema,
  AuthSessionsRevokeRequest: AuthSessionsRevokeSchema,
  AuthSessionsRevokeResponse: AuthSessionsRevokeResponseSchema,
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(
  schema: TName,
) {
  return { schema } as const;
}

type DocsBySurface<TSurfaces extends Record<string, object>> = {
  [TName in keyof TSurfaces]: ContractDocs;
};

type ContractDocs = { summary?: string; markdown: string };

function attachDocs<const TSurfaces extends Record<string, object>>(
  surfaces: TSurfaces,
  docsBySurface: DocsBySurface<TSurfaces>,
): { [TName in keyof TSurfaces]: TSurfaces[TName] & { docs: ContractDocs } } {
  const documented = {} as {
    [TName in keyof TSurfaces]: TSurfaces[TName] & { docs: ContractDocs };
  };
  for (const key of Object.keys(surfaces) as Array<keyof TSurfaces>) {
    documented[key] = { ...surfaces[key], docs: docsBySurface[key] };
  }
  return documented;
}

export const TRELLIS_AUTH_RPC = {
  "Auth.Health": {
    version: "v1",
    input: schemaRef("HealthRequest"),
    output: schemaRef("HealthResponse"),
    capabilities: { call: [] },
    errors: ["UnexpectedError"],
  },
  "Auth.Connections.Kick": {
    version: "v1",
    input: schemaRef("AuthConnectionsKickRequest"),
    output: schemaRef("AuthConnectionsKickResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Connections.List": {
    version: "v1",
    input: schemaRef("AuthConnectionsListRequest"),
    output: schemaRef("AuthConnectionsListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Sessions.List": {
    version: "v1",
    input: schemaRef("AuthSessionsListRequest"),
    output: schemaRef("AuthSessionsListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Sessions.Logout": {
    version: "v1",
    input: schemaRef("AuthSessionsLogoutRequest"),
    output: schemaRef("AuthSessionsLogoutResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.Sessions.Me": {
    version: "v1",
    input: schemaRef("AuthSessionsMeRequest"),
    output: schemaRef("AuthSessionsMeResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.IdentityGrants.List": {
    version: "v1",
    input: schemaRef("AuthIdentityGrantsListRequest"),
    output: schemaRef("AuthIdentityGrantsListResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.Sessions.Revoke": {
    version: "v1",
    input: schemaRef("AuthSessionsRevokeRequest"),
    output: schemaRef("AuthSessionsRevokeResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Requests.Validate": {
    version: "v1",
    input: schemaRef("AuthRequestsValidateRequest"),
    output: schemaRef("AuthRequestsValidateResponse"),
    capabilities: { call: ["service"] },
    authRequired: false,
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Deployments.Create": {
    version: "v1",
    input: schemaRef("AuthDeploymentsCreateRequest"),
    output: schemaRef("AuthDeploymentsCreateResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Deployments.List": {
    version: "v1",
    input: schemaRef("AuthDeploymentsListRequest"),
    output: schemaRef("AuthDeploymentsListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.List": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityListRequest"),
    output: schemaRef("AuthDeploymentAuthorityListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.Get": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityGetRequest"),
    output: schemaRef("AuthDeploymentAuthorityGetResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.Plans.List": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityPlansListRequest"),
    output: schemaRef("AuthDeploymentAuthorityPlansListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.Plans.Get": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityPlansGetRequest"),
    output: schemaRef("AuthDeploymentAuthorityPlansGetResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.Plan": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityPlanRequest"),
    output: schemaRef("AuthDeploymentAuthorityPlanResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.AcceptUpdate": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityAcceptUpdateRequest"),
    output: schemaRef("AuthDeploymentAuthorityAcceptResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.AcceptMigration": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityAcceptMigrationRequest"),
    output: schemaRef("AuthDeploymentAuthorityAcceptResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.Reject": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityRejectRequest"),
    output: schemaRef("AuthDeploymentAuthorityRejectResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.Reconcile": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityReconcileRequest"),
    output: schemaRef("AuthDeploymentAuthorityReconcileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.GrantOverrides.Put": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityGrantOverridesPutRequest"),
    output: schemaRef("AuthDeploymentAuthorityGrantOverridesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.GrantOverrides.List": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityGrantOverridesListRequest"),
    output: schemaRef("AuthDeploymentAuthorityGrantOverridesListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeploymentAuthority.GrantOverrides.Remove": {
    version: "v1",
    input: schemaRef("AuthDeploymentAuthorityGrantOverridesRemoveRequest"),
    output: schemaRef("AuthDeploymentAuthorityGrantOverridesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Deployments.Disable": {
    version: "v1",
    input: schemaRef("AuthDeploymentsDisableRequest"),
    output: schemaRef("AuthDeploymentsDisableResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CatalogIssues.Resolve": {
    version: "v1",
    input: schemaRef("AuthCatalogIssuesResolveRequest"),
    output: schemaRef("AuthCatalogIssuesResolveResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Deployments.Enable": {
    version: "v1",
    input: schemaRef("AuthDeploymentsEnableRequest"),
    output: schemaRef("AuthDeploymentsEnableResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Deployments.Remove": {
    version: "v1",
    input: schemaRef("AuthDeploymentsRemoveRequest"),
    output: schemaRef("AuthDeploymentsRemoveResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ServiceInstances.Provision": {
    version: "v1",
    input: schemaRef("AuthServiceInstancesProvisionRequest"),
    output: schemaRef("AuthServiceInstancesProvisionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ServiceInstances.List": {
    version: "v1",
    input: schemaRef("AuthServiceInstancesListRequest"),
    output: schemaRef("AuthServiceInstancesListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ServiceInstances.Disable": {
    version: "v1",
    input: schemaRef("AuthServiceInstancesDisableRequest"),
    output: schemaRef("AuthServiceInstancesDisableResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ServiceInstances.Enable": {
    version: "v1",
    input: schemaRef("AuthServiceInstancesEnableRequest"),
    output: schemaRef("AuthServiceInstancesEnableResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ServiceInstances.Remove": {
    version: "v1",
    input: schemaRef("AuthServiceInstancesRemoveRequest"),
    output: schemaRef("AuthServiceInstancesRemoveResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Identities.List": {
    version: "v1",
    input: schemaRef("AuthIdentitiesListRequest"),
    output: schemaRef("AuthIdentitiesListResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.IdentityGrants.Revoke": {
    version: "v1",
    input: schemaRef("AuthIdentityGrantsRevokeRequest"),
    output: schemaRef("AuthIdentityGrantsRevokeResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeviceUserAuthorities.List": {
    version: "v1",
    input: schemaRef("AuthDeviceUserAuthoritiesListRequest"),
    output: schemaRef("AuthDeviceUserAuthoritiesListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Devices.Provision": {
    version: "v1",
    input: schemaRef("AuthDevicesProvisionRequest"),
    output: schemaRef("AuthDevicesProvisionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Devices.List": {
    version: "v1",
    input: schemaRef("AuthDevicesListRequest"),
    output: schemaRef("AuthDevicesListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Devices.Disable": {
    version: "v1",
    input: schemaRef("AuthDevicesDisableRequest"),
    output: schemaRef("AuthDevicesDisableResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Devices.Enable": {
    version: "v1",
    input: schemaRef("AuthDevicesEnableRequest"),
    output: schemaRef("AuthDevicesEnableResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Devices.Remove": {
    version: "v1",
    input: schemaRef("AuthDevicesRemoveRequest"),
    output: schemaRef("AuthDevicesRemoveResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Devices.ConnectInfo.Get": {
    version: "v1",
    input: schemaRef("AuthDevicesConnectInfoGetRequest"),
    output: schemaRef("AuthDevicesConnectInfoGetResponse"),
    capabilities: { call: [] },
    authRequired: false,
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeviceUserAuthorities.Revoke": {
    version: "v1",
    input: schemaRef("AuthDeviceUserAuthoritiesRevokeRequest"),
    output: schemaRef("AuthDeviceUserAuthoritiesRevokeResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeviceUserAuthorities.Reviews.List": {
    version: "v1",
    input: schemaRef("AuthDeviceUserAuthoritiesReviewsListRequest"),
    output: schemaRef("AuthDeviceUserAuthoritiesReviewsListResponse"),
    capabilities: { call: ["device.review"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DeviceUserAuthorities.Reviews.Decide": {
    version: "v1",
    input: schemaRef("AuthDeviceUserAuthoritiesReviewsDecideRequest"),
    output: schemaRef("AuthDeviceUserAuthoritiesReviewsDecideResponse"),
    capabilities: { call: ["device.review"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Users.List": {
    version: "v1",
    input: schemaRef("AuthUsersListRequest"),
    output: schemaRef("AuthUsersListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Users.Get": {
    version: "v1",
    input: schemaRef("AuthUsersGetRequest"),
    output: schemaRef("AuthUsersGetResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Users.Create": {
    version: "v1",
    input: schemaRef("AuthUsersCreateRequest"),
    output: schemaRef("AuthUsersCreateResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Users.IdentityLink.Create": {
    version: "v1",
    input: schemaRef("AuthUsersIdentityLinkCreateRequest"),
    output: schemaRef("AuthUsersAccountFlowCreateResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Users.Password.Change": {
    version: "v1",
    input: schemaRef("AuthUsersPasswordChangeRequest"),
    output: schemaRef("AuthUsersPasswordChangeResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Users.PasswordReset.Create": {
    version: "v1",
    input: schemaRef("AuthUsersPasswordResetCreateRequest"),
    output: schemaRef("AuthUsersAccountFlowCreateResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Capabilities.List": {
    version: "v1",
    input: schemaRef("AuthCapabilitiesListRequest"),
    output: schemaRef("AuthCapabilitiesListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CapabilityGroups.List": {
    version: "v1",
    input: schemaRef("AuthCapabilityGroupsListRequest"),
    output: schemaRef("AuthCapabilityGroupsListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CapabilityGroups.Get": {
    version: "v1",
    input: schemaRef("AuthCapabilityGroupsGetRequest"),
    output: schemaRef("AuthCapabilityGroupsGetResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CapabilityGroups.Put": {
    version: "v1",
    input: schemaRef("AuthCapabilityGroupsPutRequest"),
    output: schemaRef("AuthCapabilityGroupsPutResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CapabilityGroups.Delete": {
    version: "v1",
    input: schemaRef("AuthCapabilityGroupsDeleteRequest"),
    output: schemaRef("AuthCapabilityGroupsDeleteResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Users.Update": {
    version: "v1",
    input: schemaRef("AuthUsersUpdateRequest"),
    output: schemaRef("AuthUsersUpdateResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UserIdentities.List": {
    version: "v1",
    input: schemaRef("AuthUserIdentitiesListRequest"),
    output: schemaRef("AuthUserIdentitiesListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UserIdentities.Unlink": {
    version: "v1",
    input: schemaRef("AuthUserIdentitiesUnlinkRequest"),
    output: schemaRef("AuthUserIdentitiesUnlinkResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Portals.List": {
    version: "v1",
    input: schemaRef("AuthPortalsListRequest"),
    output: schemaRef("AuthPortalsListResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.Portals.Get": {
    version: "v1",
    input: schemaRef("AuthPortalsGetRequest"),
    output: schemaRef("AuthPortalsGetResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Portals.Put": {
    version: "v1",
    input: schemaRef("AuthPortalsPutRequest"),
    output: schemaRef("AuthPortalsPutResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Portals.Remove": {
    version: "v1",
    input: schemaRef("AuthPortalsRemoveRequest"),
    output: schemaRef("AuthPortalsRemoveResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Portals.LoginSettings.Get": {
    version: "v1",
    input: schemaRef("AuthPortalsLoginSettingsGetRequest"),
    output: schemaRef("AuthPortalsLoginSettingsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Portals.LoginSettings.Update": {
    version: "v1",
    input: schemaRef("AuthPortalsLoginSettingsUpdateRequest"),
    output: schemaRef("AuthPortalsLoginSettingsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Portals.Routes.Put": {
    version: "v1",
    input: schemaRef("AuthPortalsRoutesPutRequest"),
    output: schemaRef("AuthPortalsRoutesPutResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Portals.Routes.Remove": {
    version: "v1",
    input: schemaRef("AuthPortalsRoutesRemoveRequest"),
    output: schemaRef("AuthPortalsRoutesRemoveResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
} as const;

export const TRELLIS_AUTH_OPERATIONS = {
  "Auth.DeviceUserAuthorities.Resolve": {
    version: "v1",
    input: schemaRef("AuthResolveDeviceUserAuthoritiesRequest"),
    progress: schemaRef("AuthResolveDeviceUserAuthoritiesProgress"),
    output: schemaRef("AuthResolveDeviceUserAuthoritiesResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
} as const;

export const TRELLIS_AUTH_EVENTS = {
  "Auth.Connections.Opened": {
    version: "v1",
    event: schemaRef("AuthConnectionsOpenedEvent"),
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["events.auth"],
    },
  },
  "Auth.Connections.Kicked": {
    version: "v1",
    event: schemaRef("AuthConnectionsKickedEvent"),
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["events.auth"],
    },
  },
  "Auth.Connections.Closed": {
    version: "v1",
    event: schemaRef("AuthConnectionsClosedEvent"),
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["events.auth"],
    },
  },
  "Auth.Sessions.Revoked": {
    version: "v1",
    event: schemaRef("AuthSessionsRevokedEvent"),
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["events.auth"],
    },
  },
  "Auth.DeviceUserAuthorities.ReviewRequested": {
    version: "v1",
    event: schemaRef("AuthDeviceUserAuthoritiesReviewRequestedEvent"),
    params: ["/deploymentId"],
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["device.review"],
    },
  },
  "Auth.DeviceUserAuthorities.Requested": {
    version: "v1",
    event: schemaRef("AuthDeviceUserAuthoritiesRequestedEvent"),
    params: ["/deploymentId"],
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["device.review"],
    },
  },
  "Auth.DeviceUserAuthorities.Approved": {
    version: "v1",
    event: schemaRef("AuthDeviceUserAuthoritiesApprovedEvent"),
    params: ["/deploymentId"],
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["device.review"],
    },
  },
  "Auth.DeviceUserAuthorities.Resolved": {
    version: "v1",
    event: schemaRef("AuthDeviceUserAuthoritiesResolvedEvent"),
    params: ["/deploymentId"],
    capabilities: {
      publish: ["events.auth"],
      subscribe: ["events.auth", "device.review"],
    },
  },
} as const;

const TRELLIS_AUTH_RPC_DOCS = {
  "Auth.Health": {
    summary: "Check auth service health.",
    markdown: "Returns auth service health details.",
  },
  "Auth.Connections.Kick": {
    summary: "Kick one connection.",
    markdown: "Disconnects an active authenticated connection.",
  },
  "Auth.Connections.List": {
    summary: "List active connections.",
    markdown: "Lists live authenticated connections visible to administrators.",
  },
  "Auth.Sessions.List": {
    summary: "List sessions.",
    markdown: "Lists authenticated sessions visible to administrators.",
  },
  "Auth.Sessions.Logout": {
    summary: "Log out current session.",
    markdown: "Revokes the caller's active session.",
  },
  "Auth.Sessions.Me": {
    summary: "Read current session.",
    markdown:
      "Returns identity and capability details for the caller's session.",
  },
  "Auth.IdentityGrants.List": {
    summary: "List identity grants.",
    markdown: "Lists identity grants for the caller or an admin-selected user.",
  },
  "Auth.Sessions.Revoke": {
    summary: "Revoke a session.",
    markdown: "Revokes a user session by administrative request.",
  },
  "Auth.Requests.Validate": {
    summary: "Validate request auth.",
    markdown:
      "Validates an inbound request envelope for service-side authorization.",
  },
  "Auth.Deployments.Create": {
    summary: "Create deployment.",
    markdown: "Creates a deployment boundary for services, apps, or devices.",
  },
  "Auth.Deployments.List": {
    summary: "List deployments.",
    markdown: "Lists deployment boundaries and their current state.",
  },
  "Auth.DeploymentAuthority.List": {
    summary: "List deployment authority.",
    markdown: "Lists deployment-owned desired authority.",
  },
  "Auth.DeploymentAuthority.Get": {
    summary: "Read deployment authority.",
    markdown:
      "Returns desired deployment authority and current materialized authority.",
  },
  "Auth.DeploymentAuthority.Plans.List": {
    summary: "List authority plans.",
    markdown:
      "Lists pending and historical deployment authority plans with optional filters.",
  },
  "Auth.DeploymentAuthority.Plans.Get": {
    summary: "Read authority plan.",
    markdown: "Returns one pending or historical deployment authority plan.",
  },
  "Auth.DeploymentAuthority.Plan": {
    summary: "Plan deployment authority.",
    markdown: "Builds an authority update or migration plan from a contract.",
  },
  "Auth.DeploymentAuthority.AcceptUpdate": {
    summary: "Accept authority update.",
    markdown: "Accepts a non-breaking authority update plan.",
  },
  "Auth.DeploymentAuthority.AcceptMigration": {
    summary: "Accept authority migration.",
    markdown: "Accepts an acknowledged authority migration plan.",
  },
  "Auth.DeploymentAuthority.Reject": {
    summary: "Reject authority plan.",
    markdown:
      "Rejects a pending authority plan without mutating desired state.",
  },
  "Auth.DeploymentAuthority.Reconcile": {
    summary: "Reconcile deployment authority.",
    markdown:
      "Triggers convergence from desired authority to materialized authority.",
  },
  "Auth.DeploymentAuthority.GrantOverrides.Put": {
    summary: "Set grant overrides.",
    markdown:
      "Replaces deployment authority grant overrides for one deployment.",
  },
  "Auth.DeploymentAuthority.GrantOverrides.List": {
    summary: "List grant overrides.",
    markdown: "Lists deployment authority grant overrides.",
  },
  "Auth.DeploymentAuthority.GrantOverrides.Remove": {
    summary: "Remove grant overrides.",
    markdown: "Removes matching deployment authority grant overrides.",
  },
  "Auth.Deployments.Disable": {
    summary: "Disable deployment.",
    markdown: "Disables a deployment boundary without removing it.",
  },
  "Auth.CatalogIssues.Resolve": {
    summary: "Resolve catalog issue.",
    markdown: "Marks an auth catalog issue as resolved.",
  },
  "Auth.Deployments.Enable": {
    summary: "Enable deployment.",
    markdown: "Re-enables a disabled deployment boundary.",
  },
  "Auth.Deployments.Remove": {
    summary: "Remove deployment.",
    markdown: "Removes a deployment boundary.",
  },
  "Auth.ServiceInstances.Provision": {
    summary: "Provision service instance.",
    markdown: "Creates credentials and metadata for a service instance.",
  },
  "Auth.ServiceInstances.List": {
    summary: "List service instances.",
    markdown: "Lists provisioned service instances.",
  },
  "Auth.ServiceInstances.Disable": {
    summary: "Disable service instance.",
    markdown: "Disables a provisioned service instance.",
  },
  "Auth.ServiceInstances.Enable": {
    summary: "Enable service instance.",
    markdown: "Re-enables a provisioned service instance.",
  },
  "Auth.ServiceInstances.Remove": {
    summary: "Remove service instance.",
    markdown: "Removes a provisioned service instance.",
  },
  "Auth.Identities.List": {
    summary: "List identities.",
    markdown: "Lists known authenticated identities.",
  },
  "Auth.IdentityGrants.Revoke": {
    summary: "Revoke identity grant.",
    markdown: "Revokes deployment access for one identity grant.",
  },
  "Auth.DeviceUserAuthorities.List": {
    summary: "List device authorities.",
    markdown: "Lists user authority grants for devices.",
  },
  "Auth.Devices.Provision": {
    summary: "Provision device.",
    markdown: "Creates a preregistered device record and activation material.",
  },
  "Auth.Devices.List": {
    summary: "List devices.",
    markdown: "Lists registered and activated devices.",
  },
  "Auth.Devices.Disable": {
    summary: "Disable device.",
    markdown: "Disables an activated or registered device.",
  },
  "Auth.Devices.Enable": {
    summary: "Enable device.",
    markdown: "Re-enables a disabled device.",
  },
  "Auth.Devices.Remove": {
    summary: "Remove device.",
    markdown: "Removes a device record.",
  },
  "Auth.Devices.ConnectInfo.Get": {
    summary: "Read device connect info.",
    markdown: "Returns activation connection information for a device.",
  },
  "Auth.DeviceUserAuthorities.Revoke": {
    summary: "Revoke device authority.",
    markdown: "Revokes one user authority grant for a device.",
  },
  "Auth.DeviceUserAuthorities.Reviews.List": {
    summary: "List device reviews.",
    markdown: "Lists pending device authority reviews.",
  },
  "Auth.DeviceUserAuthorities.Reviews.Decide": {
    summary: "Decide device review.",
    markdown: "Approves or rejects a device authority review.",
  },
  "Auth.Users.List": {
    summary: "List users.",
    markdown: "Lists user accounts.",
  },
  "Auth.Users.Get": {
    summary: "Read user.",
    markdown: "Returns one user account.",
  },
  "Auth.Users.Create": {
    summary: "Create user.",
    markdown: "Creates a user account.",
  },
  "Auth.Users.IdentityLink.Create": {
    summary: "Start identity link.",
    markdown: "Starts an account flow to link an external identity.",
  },
  "Auth.Users.Password.Change": {
    summary: "Change password.",
    markdown: "Changes the caller's password.",
  },
  "Auth.Users.PasswordReset.Create": {
    summary: "Start password reset.",
    markdown: "Starts an account flow to reset a user password.",
  },
  "Auth.Capabilities.List": {
    summary: "List capabilities.",
    markdown: "Lists capability definitions known to auth.",
  },
  "Auth.CapabilityGroups.List": {
    summary: "List capability groups.",
    markdown: "Lists reusable capability groups.",
  },
  "Auth.CapabilityGroups.Get": {
    summary: "Read capability group.",
    markdown: "Returns one reusable capability group.",
  },
  "Auth.CapabilityGroups.Put": {
    summary: "Write capability group.",
    markdown: "Creates or replaces a reusable capability group.",
  },
  "Auth.CapabilityGroups.Delete": {
    summary: "Delete capability group.",
    markdown: "Deletes a reusable capability group.",
  },
  "Auth.Users.Update": {
    summary: "Update user.",
    markdown: "Updates user account metadata or status.",
  },
  "Auth.UserIdentities.List": {
    summary: "List user identities.",
    markdown: "Lists external identities linked to a user.",
  },
  "Auth.UserIdentities.Unlink": {
    summary: "Unlink user identity.",
    markdown: "Removes an external identity link from a user.",
  },
  "Auth.Portals.List": {
    summary: "List portals.",
    markdown: "Lists configured authentication portals.",
  },
  "Auth.Portals.Get": {
    summary: "Read portal.",
    markdown: "Returns one authentication portal configuration.",
  },
  "Auth.Portals.Put": {
    summary: "Write portal.",
    markdown: "Creates or replaces an authentication portal configuration.",
  },
  "Auth.Portals.Remove": {
    summary: "Remove portal.",
    markdown: "Removes an authentication portal configuration.",
  },
  "Auth.Portals.LoginSettings.Get": {
    summary: "Read login settings.",
    markdown: "Returns login settings for an authentication portal.",
  },
  "Auth.Portals.LoginSettings.Update": {
    summary: "Update login settings.",
    markdown: "Updates login settings for an authentication portal.",
  },
  "Auth.Portals.Routes.Put": {
    summary: "Write portal route.",
    markdown: "Creates or replaces a route for an authentication portal.",
  },
  "Auth.Portals.Routes.Remove": {
    summary: "Remove portal route.",
    markdown: "Removes a route from an authentication portal.",
  },
} satisfies DocsBySurface<typeof TRELLIS_AUTH_RPC>;

const TRELLIS_AUTH_OPERATION_DOCS = {
  "Auth.DeviceUserAuthorities.Resolve": {
    summary: "Resolve device authorities.",
    markdown:
      "Runs the asynchronous workflow that resolves requested user authorities for a device.",
  },
} satisfies DocsBySurface<typeof TRELLIS_AUTH_OPERATIONS>;

const TRELLIS_AUTH_EVENT_DOCS = {
  "Auth.Connections.Opened": {
    summary: "Connection opened.",
    markdown: "Published when an authenticated connection opens.",
  },
  "Auth.Connections.Kicked": {
    summary: "Connection kicked.",
    markdown: "Published when auth disconnects a connection administratively.",
  },
  "Auth.Connections.Closed": {
    summary: "Connection closed.",
    markdown: "Published when an authenticated connection closes.",
  },
  "Auth.Sessions.Revoked": {
    summary: "Session revoked.",
    markdown: "Published when a user session is revoked.",
  },
  "Auth.DeviceUserAuthorities.ReviewRequested": {
    summary: "Review requested.",
    markdown: "Published when a device authority request needs review.",
  },
  "Auth.DeviceUserAuthorities.Requested": {
    summary: "Authorities requested.",
    markdown: "Published when a device requests user authorities.",
  },
  "Auth.DeviceUserAuthorities.Approved": {
    summary: "Authorities approved.",
    markdown: "Published when requested device user authorities are approved.",
  },
  "Auth.DeviceUserAuthorities.Resolved": {
    summary: "Authorities resolved.",
    markdown: "Published when a device authority resolution completes.",
  },
} satisfies DocsBySurface<typeof TRELLIS_AUTH_EVENTS>;

const baseTrellisAuth = defineServiceContract(
  { schemas },
  () => ({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description:
      "Provide Trellis authentication, session, deployment, instance, and admin RPCs.",
    docs: {
      summary: "Authentication and authorization APIs.",
      markdown:
        "Owns Trellis sessions, identity grants, deployment authority, devices, portals, capability groups, and request validation.",
    },
    capabilities: {
      "device.review": {
        displayName: "Review device activation",
        description: "Review and decide pending device activation requests.",
      },
      "events.auth": {
        displayName: "Observe auth events",
        description: "Publish or subscribe to Trellis auth lifecycle events.",
      },
    },
    rpc: attachDocs(TRELLIS_AUTH_RPC, TRELLIS_AUTH_RPC_DOCS),
    operations: attachDocs(
      TRELLIS_AUTH_OPERATIONS,
      TRELLIS_AUTH_OPERATION_DOCS,
    ),
    events: attachDocs(TRELLIS_AUTH_EVENTS, TRELLIS_AUTH_EVENT_DOCS),
  }),
);

export const trellisAuth = baseTrellisAuth;

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisAuth;
export type Api = typeof API;
export default trellisAuth;
