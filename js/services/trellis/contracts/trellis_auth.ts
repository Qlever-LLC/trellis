import {
  AuthGetInstalledContractResponseSchema,
  AuthGetInstalledContractSchema,
  AuthListApprovalsResponseSchema,
  AuthListApprovalsSchema,
  AuthListInstalledContractsResponseSchema,
  AuthListInstalledContractsSchema,
  AuthListServicesResponseSchema,
  AuthListServicesSchema,
  AuthListUsersResponseSchema,
  AuthListUsersSchema,
  AuthMeResponseSchema,
  AuthMeSchema,
  AuthRevokeApprovalResponseSchema,
  AuthRevokeApprovalSchema,
  AuthUpdateUserResponseSchema,
  AuthUpdateUserSchema,
  AuthValidateRequestResponseSchema,
  AuthValidateRequestSchema,
  PortalFlowStateSchema,
} from "@qlever-llc/trellis/auth";
import {
  AuthActivateDeviceResponseSchema,
  AuthActivateDeviceSchema,
  AuthClearDevicePortalSelectionResponseSchema,
  AuthClearDevicePortalSelectionSchema,
  AuthClearLoginPortalSelectionResponseSchema,
  AuthClearLoginPortalSelectionSchema,
  AuthCreateDeviceProfileResponseSchema,
  AuthCreateDeviceProfileSchema,
  AuthCreateServiceProfileResponseSchema,
  AuthCreateServiceProfileSchema,
  AuthApplyDeviceProfileContractResponseSchema,
  AuthApplyDeviceProfileContractSchema,
  AuthApplyServiceProfileContractResponseSchema,
  AuthApplyServiceProfileContractSchema,
  AuthCreatePortalResponseSchema,
  AuthCreatePortalSchema,
  AuthDecideDeviceActivationReviewResponseSchema,
  AuthDecideDeviceActivationReviewSchema,
  AuthDeviceActivationReviewRequestedEventSchema,
  AuthDisableDeviceInstanceResponseSchema,
  AuthDisableDeviceInstanceSchema,
  AuthDisableInstanceGrantPolicyResponseSchema,
  AuthDisableInstanceGrantPolicySchema,
  AuthDisableDeviceProfileResponseSchema,
  AuthDisableDeviceProfileSchema,
  AuthDisableServiceInstanceResponseSchema,
  AuthDisableServiceInstanceSchema,
  AuthDisableServiceProfileResponseSchema,
  AuthDisableServiceProfileSchema,
  AuthEnableDeviceInstanceResponseSchema,
  AuthEnableDeviceInstanceSchema,
  AuthEnableDeviceProfileResponseSchema,
  AuthEnableDeviceProfileSchema,
  AuthEnableServiceInstanceResponseSchema,
  AuthEnableServiceInstanceSchema,
  AuthEnableServiceProfileResponseSchema,
  AuthEnableServiceProfileSchema,
  AuthDisablePortalResponseSchema,
  AuthDisablePortalSchema,
  AuthGetDeviceActivationStatusResponseSchema,
  AuthGetDeviceActivationStatusSchema,
  AuthGetDeviceConnectInfoResponseSchema,
  AuthGetDeviceConnectInfoSchema,
  AuthGetDevicePortalDefaultResponseSchema,
  AuthGetDevicePortalDefaultSchema,
  AuthGetLoginPortalDefaultResponseSchema,
  AuthGetLoginPortalDefaultSchema,
  AuthInstallServiceResponseSchema,
  AuthInstallServiceSchema,
  AuthListDeviceActivationReviewsResponseSchema,
  AuthListDeviceActivationReviewsSchema,
  AuthListDeviceActivationsResponseSchema,
  AuthListDeviceActivationsSchema,
  AuthListDeviceInstancesResponseSchema,
  AuthListDeviceInstancesSchema,
  AuthListServiceInstancesResponseSchema,
  AuthListServiceInstancesSchema,
  AuthListInstanceGrantPoliciesResponseSchema,
  AuthListInstanceGrantPoliciesSchema,
  AuthListDevicePortalSelectionsResponseSchema,
  AuthListDevicePortalSelectionsSchema,
  AuthListDeviceProfilesResponseSchema,
  AuthListDeviceProfilesSchema,
  AuthListServiceProfilesResponseSchema,
  AuthListServiceProfilesSchema,
  AuthListLoginPortalSelectionsResponseSchema,
  AuthListLoginPortalSelectionsSchema,
  AuthListPortalsResponseSchema,
  AuthListPortalsSchema,
  AuthProvisionDeviceInstanceResponseSchema,
  AuthProvisionDeviceInstanceSchema,
  AuthProvisionServiceInstanceResponseSchema,
  AuthProvisionServiceInstanceSchema,
  AuthRemoveServiceResponseSchema,
  AuthRemoveServiceSchema,
  AuthRemoveDeviceInstanceResponseSchema,
  AuthRemoveDeviceInstanceSchema,
  AuthRemoveDeviceProfileResponseSchema,
  AuthRemoveDeviceProfileSchema,
  AuthRemoveServiceInstanceResponseSchema,
  AuthRemoveServiceInstanceSchema,
  AuthRemoveServiceProfileResponseSchema,
  AuthRemoveServiceProfileSchema,
  AuthRevokeDeviceActivationResponseSchema,
  AuthRevokeDeviceActivationSchema,
  AuthSetDevicePortalDefaultResponseSchema,
  AuthSetDevicePortalDefaultSchema,
  AuthSetDevicePortalSelectionResponseSchema,
  AuthSetDevicePortalSelectionSchema,
  AuthUpsertInstanceGrantPolicyResponseSchema,
  AuthUpsertInstanceGrantPolicySchema,
  AuthSetLoginPortalDefaultResponseSchema,
  AuthSetLoginPortalDefaultSchema,
  AuthSetLoginPortalSelectionResponseSchema,
  AuthSetLoginPortalSelectionSchema,
  AuthUnapplyDeviceProfileContractResponseSchema,
  AuthUnapplyDeviceProfileContractSchema,
  AuthUnapplyServiceProfileContractResponseSchema,
  AuthUnapplyServiceProfileContractSchema,
  AuthUpgradeServiceContractResponseSchema,
  AuthUpgradeServiceContractSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewSchema,
  DeviceConnectInfoSchema,
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  DeviceProfileSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  PortalSchema,
  ServiceInstanceSchema,
  ServiceProfileSchema,
} from "../../../packages/trellis/auth/protocol.ts";
import {
  type ContractDependencyUse,
  defineServiceContract,
  type UseSpec,
} from "@qlever-llc/trellis/contracts";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/health";
import {
  type AuthConnectEvent,
  AuthConnectEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthConnect.ts";
import {
  type AuthConnectionKickedEvent,
  AuthConnectionKickedEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthConnectionKicked.ts";
import {
  type AuthDisconnectEvent,
  AuthDisconnectEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthDisconnect.ts";
import {
  type AuthSessionRevokedEvent,
  AuthSessionRevokedEventSchema,
} from "../../../packages/trellis/models/auth/events/AuthSessionRevoked.ts";
import {
  AuthKickConnectionResponseSchema,
  AuthKickConnectionSchema,
} from "../../../packages/trellis/models/auth/rpc/KickConnection.ts";
import {
  AuthListConnectionsResponseSchema,
  AuthListConnectionsSchema,
} from "../../../packages/trellis/models/auth/rpc/ListConnections.ts";
import {
  AuthListSessionsResponseSchema,
  AuthListSessionsSchema,
} from "../../../packages/trellis/models/auth/rpc/ListSessions.ts";
import {
  AuthLogoutResponseSchema,
  AuthLogoutSchema,
} from "../../../packages/trellis/models/auth/rpc/Logout.ts";
import {
  AuthRenewBindingTokenResponseSchema,
  AuthRenewBindingTokenSchema,
} from "../../../packages/trellis/models/auth/rpc/RenewBindingToken.ts";
import {
  AuthRevokeSessionResponseSchema,
  AuthRevokeSessionSchema,
} from "../../../packages/trellis/models/auth/rpc/RevokeSession.ts";

const schemas = {
  AuthCreatePortalRequest: AuthCreatePortalSchema,
  AuthCreatePortalResponse: AuthCreatePortalResponseSchema,
  AuthDisablePortalRequest: AuthDisablePortalSchema,
  AuthDisablePortalResponse: AuthDisablePortalResponseSchema,
  AuthGetLoginPortalDefaultRequest: AuthGetLoginPortalDefaultSchema,
  AuthGetLoginPortalDefaultResponse: AuthGetLoginPortalDefaultResponseSchema,
  AuthListInstanceGrantPoliciesRequest: AuthListInstanceGrantPoliciesSchema,
  AuthListInstanceGrantPoliciesResponse:
    AuthListInstanceGrantPoliciesResponseSchema,
  AuthUpsertInstanceGrantPolicyRequest: AuthUpsertInstanceGrantPolicySchema,
  AuthUpsertInstanceGrantPolicyResponse:
    AuthUpsertInstanceGrantPolicyResponseSchema,
  AuthDisableInstanceGrantPolicyRequest: AuthDisableInstanceGrantPolicySchema,
  AuthDisableInstanceGrantPolicyResponse:
    AuthDisableInstanceGrantPolicyResponseSchema,
  AuthSetLoginPortalDefaultRequest: AuthSetLoginPortalDefaultSchema,
  AuthSetLoginPortalDefaultResponse: AuthSetLoginPortalDefaultResponseSchema,
  AuthListLoginPortalSelectionsRequest: AuthListLoginPortalSelectionsSchema,
  AuthListLoginPortalSelectionsResponse:
    AuthListLoginPortalSelectionsResponseSchema,
  AuthSetLoginPortalSelectionRequest: AuthSetLoginPortalSelectionSchema,
  AuthSetLoginPortalSelectionResponse:
    AuthSetLoginPortalSelectionResponseSchema,
  AuthClearLoginPortalSelectionRequest: AuthClearLoginPortalSelectionSchema,
  AuthClearLoginPortalSelectionResponse:
    AuthClearLoginPortalSelectionResponseSchema,
  AuthGetDevicePortalDefaultRequest: AuthGetDevicePortalDefaultSchema,
  AuthGetDevicePortalDefaultResponse: AuthGetDevicePortalDefaultResponseSchema,
  AuthSetDevicePortalDefaultRequest: AuthSetDevicePortalDefaultSchema,
  AuthSetDevicePortalDefaultResponse: AuthSetDevicePortalDefaultResponseSchema,
  AuthListDevicePortalSelectionsRequest: AuthListDevicePortalSelectionsSchema,
  AuthListDevicePortalSelectionsResponse:
    AuthListDevicePortalSelectionsResponseSchema,
  AuthSetDevicePortalSelectionRequest: AuthSetDevicePortalSelectionSchema,
  AuthSetDevicePortalSelectionResponse:
    AuthSetDevicePortalSelectionResponseSchema,
  AuthClearDevicePortalSelectionRequest: AuthClearDevicePortalSelectionSchema,
  AuthClearDevicePortalSelectionResponse:
    AuthClearDevicePortalSelectionResponseSchema,
  AuthCreateDeviceProfileRequest: AuthCreateDeviceProfileSchema,
  AuthCreateDeviceProfileResponse: AuthCreateDeviceProfileResponseSchema,
  AuthDisableDeviceProfileRequest: AuthDisableDeviceProfileSchema,
  AuthDisableDeviceProfileResponse: AuthDisableDeviceProfileResponseSchema,
  AuthDecideDeviceActivationReviewRequest:
    AuthDecideDeviceActivationReviewSchema,
  AuthDecideDeviceActivationReviewResponse:
    AuthDecideDeviceActivationReviewResponseSchema,
  AuthListPortalsRequest: AuthListPortalsSchema,
  AuthListPortalsResponse: AuthListPortalsResponseSchema,
  AuthGetDeviceActivationStatusRequest: AuthGetDeviceActivationStatusSchema,
  AuthGetDeviceActivationStatusResponse:
    AuthGetDeviceActivationStatusResponseSchema,
  AuthListDeviceActivationReviewsRequest: AuthListDeviceActivationReviewsSchema,
  AuthListDeviceActivationReviewsResponse:
    AuthListDeviceActivationReviewsResponseSchema,
  AuthListDeviceProfilesRequest: AuthListDeviceProfilesSchema,
  AuthListDeviceProfilesResponse: AuthListDeviceProfilesResponseSchema,
  AuthProvisionDeviceInstanceRequest: AuthProvisionDeviceInstanceSchema,
  AuthProvisionDeviceInstanceResponse:
    AuthProvisionDeviceInstanceResponseSchema,
  AuthListDeviceInstancesRequest: AuthListDeviceInstancesSchema,
  AuthListDeviceInstancesResponse: AuthListDeviceInstancesResponseSchema,
  AuthDisableDeviceInstanceRequest: AuthDisableDeviceInstanceSchema,
  AuthDisableDeviceInstanceResponse: AuthDisableDeviceInstanceResponseSchema,
  AuthActivateDeviceRequest: AuthActivateDeviceSchema,
  AuthActivateDeviceResponse: AuthActivateDeviceResponseSchema,
  AuthGetDeviceConnectInfoRequest: AuthGetDeviceConnectInfoSchema,
  AuthGetDeviceConnectInfoResponse: AuthGetDeviceConnectInfoResponseSchema,
  AuthListDeviceActivationsRequest: AuthListDeviceActivationsSchema,
  AuthListDeviceActivationsResponse: AuthListDeviceActivationsResponseSchema,
  AuthRevokeDeviceActivationRequest: AuthRevokeDeviceActivationSchema,
  AuthRevokeDeviceActivationResponse: AuthRevokeDeviceActivationResponseSchema,
  LoginPortalDefault: LoginPortalDefaultSchema,
  LoginPortalSelection: LoginPortalSelectionSchema,
  Portal: PortalSchema,
  PortalFlowState: PortalFlowStateSchema,
  Device: DeviceSchema,
  DevicePortalDefault: DevicePortalDefaultSchema,
  DevicePortalSelection: DevicePortalSelectionSchema,
  DeviceProfile: DeviceProfileSchema,
  ServiceProfile: ServiceProfileSchema,
  ServiceInstance: ServiceInstanceSchema,
  DeviceActivationReview: DeviceActivationReviewSchema,
  DeviceActivationRecord: DeviceActivationRecordSchema,
  DeviceConnectInfo: DeviceConnectInfoSchema,
  InstanceGrantPolicy: InstanceGrantPolicySchema,
  AuthDeviceActivationReviewRequestedEvent:
    AuthDeviceActivationReviewRequestedEventSchema,
  AuthGetInstalledContractRequest: AuthGetInstalledContractSchema,
  AuthGetInstalledContractResponse: AuthGetInstalledContractResponseSchema,
  AuthInstallServiceRequest: AuthInstallServiceSchema,
  AuthInstallServiceResponse: AuthInstallServiceResponseSchema,
  AuthCreateServiceProfileRequest: AuthCreateServiceProfileSchema,
  AuthCreateServiceProfileResponse: AuthCreateServiceProfileResponseSchema,
  AuthListServiceProfilesRequest: AuthListServiceProfilesSchema,
  AuthListServiceProfilesResponse: AuthListServiceProfilesResponseSchema,
  AuthApplyServiceProfileContractRequest: AuthApplyServiceProfileContractSchema,
  AuthApplyServiceProfileContractResponse: AuthApplyServiceProfileContractResponseSchema,
  AuthUnapplyServiceProfileContractRequest: AuthUnapplyServiceProfileContractSchema,
  AuthUnapplyServiceProfileContractResponse: AuthUnapplyServiceProfileContractResponseSchema,
  AuthDisableServiceProfileRequest: AuthDisableServiceProfileSchema,
  AuthDisableServiceProfileResponse: AuthDisableServiceProfileResponseSchema,
  AuthEnableServiceProfileRequest: AuthEnableServiceProfileSchema,
  AuthEnableServiceProfileResponse: AuthEnableServiceProfileResponseSchema,
  AuthRemoveServiceProfileRequest: AuthRemoveServiceProfileSchema,
  AuthRemoveServiceProfileResponse: AuthRemoveServiceProfileResponseSchema,
  AuthProvisionServiceInstanceRequest: AuthProvisionServiceInstanceSchema,
  AuthProvisionServiceInstanceResponse: AuthProvisionServiceInstanceResponseSchema,
  AuthRemoveServiceRequest: AuthRemoveServiceSchema,
  AuthRemoveServiceResponse: AuthRemoveServiceResponseSchema,
  AuthListServiceInstancesRequest: AuthListServiceInstancesSchema,
  AuthListServiceInstancesResponse: AuthListServiceInstancesResponseSchema,
  AuthDisableServiceInstanceRequest: AuthDisableServiceInstanceSchema,
  AuthDisableServiceInstanceResponse: AuthDisableServiceInstanceResponseSchema,
  AuthEnableServiceInstanceRequest: AuthEnableServiceInstanceSchema,
  AuthEnableServiceInstanceResponse: AuthEnableServiceInstanceResponseSchema,
  AuthRemoveServiceInstanceRequest: AuthRemoveServiceInstanceSchema,
  AuthRemoveServiceInstanceResponse: AuthRemoveServiceInstanceResponseSchema,
  AuthListApprovalsRequest: AuthListApprovalsSchema,
  AuthListApprovalsResponse: AuthListApprovalsResponseSchema,
  AuthListInstalledContractsRequest: AuthListInstalledContractsSchema,
  AuthListInstalledContractsResponse: AuthListInstalledContractsResponseSchema,
  AuthListServicesRequest: AuthListServicesSchema,
  AuthListServicesResponse: AuthListServicesResponseSchema,
  AuthListUsersRequest: AuthListUsersSchema,
  AuthListUsersResponse: AuthListUsersResponseSchema,
  AuthMeRequest: AuthMeSchema,
  AuthMeResponse: AuthMeResponseSchema,
  AuthUpgradeServiceContractRequest: AuthUpgradeServiceContractSchema,
  AuthUpgradeServiceContractResponse: AuthUpgradeServiceContractResponseSchema,
  AuthRevokeApprovalRequest: AuthRevokeApprovalSchema,
  AuthRevokeApprovalResponse: AuthRevokeApprovalResponseSchema,
  AuthUpdateUserRequest: AuthUpdateUserSchema,
  AuthUpdateUserResponse: AuthUpdateUserResponseSchema,
  AuthApplyDeviceProfileContractRequest: AuthApplyDeviceProfileContractSchema,
  AuthApplyDeviceProfileContractResponse: AuthApplyDeviceProfileContractResponseSchema,
  AuthUnapplyDeviceProfileContractRequest: AuthUnapplyDeviceProfileContractSchema,
  AuthUnapplyDeviceProfileContractResponse: AuthUnapplyDeviceProfileContractResponseSchema,
  AuthEnableDeviceProfileRequest: AuthEnableDeviceProfileSchema,
  AuthEnableDeviceProfileResponse: AuthEnableDeviceProfileResponseSchema,
  AuthRemoveDeviceProfileRequest: AuthRemoveDeviceProfileSchema,
  AuthRemoveDeviceProfileResponse: AuthRemoveDeviceProfileResponseSchema,
  AuthEnableDeviceInstanceRequest: AuthEnableDeviceInstanceSchema,
  AuthEnableDeviceInstanceResponse: AuthEnableDeviceInstanceResponseSchema,
  AuthRemoveDeviceInstanceRequest: AuthRemoveDeviceInstanceSchema,
  AuthRemoveDeviceInstanceResponse: AuthRemoveDeviceInstanceResponseSchema,
  AuthValidateRequestRequest: AuthValidateRequestSchema,
  AuthValidateRequestResponse: AuthValidateRequestResponseSchema,
  HealthRequest: HealthRpcSchema,
  HealthResponse: HealthResponseSchema,
  AuthConnectEvent: AuthConnectEventSchema,
  AuthConnectionKickedEvent: AuthConnectionKickedEventSchema,
  AuthDisconnectEvent: AuthDisconnectEventSchema,
  AuthSessionRevokedEvent: AuthSessionRevokedEventSchema,
  AuthKickConnectionRequest: AuthKickConnectionSchema,
  AuthKickConnectionResponse: AuthKickConnectionResponseSchema,
  AuthListConnectionsRequest: AuthListConnectionsSchema,
  AuthListConnectionsResponse: AuthListConnectionsResponseSchema,
  AuthListSessionsRequest: AuthListSessionsSchema,
  AuthListSessionsResponse: AuthListSessionsResponseSchema,
  AuthLogoutRequest: AuthLogoutSchema,
  AuthLogoutResponse: AuthLogoutResponseSchema,
  AuthRenewBindingTokenRequest: AuthRenewBindingTokenSchema,
  AuthRenewBindingTokenResponse: AuthRenewBindingTokenResponseSchema,
  AuthRevokeSessionRequest: AuthRevokeSessionSchema,
  AuthRevokeSessionResponse: AuthRevokeSessionResponseSchema,
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(
  schema: TName,
) {
  return { schema } as const;
}

export const TRELLIS_AUTH_RPC = {
  "Auth.Health": {
    version: "v1",
    input: schemaRef("HealthRequest"),
    output: schemaRef("HealthResponse"),
    capabilities: { call: [] },
    errors: ["UnexpectedError"],
  },
  "Auth.KickConnection": {
    version: "v1",
    input: schemaRef("AuthKickConnectionRequest"),
    output: schemaRef("AuthKickConnectionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListConnections": {
    version: "v1",
    input: schemaRef("AuthListConnectionsRequest"),
    output: schemaRef("AuthListConnectionsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListSessions": {
    version: "v1",
    input: schemaRef("AuthListSessionsRequest"),
    output: schemaRef("AuthListSessionsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Logout": {
    version: "v1",
    input: schemaRef("AuthLogoutRequest"),
    output: schemaRef("AuthLogoutResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.Me": {
    version: "v1",
    input: schemaRef("AuthMeRequest"),
    output: schemaRef("AuthMeResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.RenewBindingToken": {
    version: "v1",
    input: schemaRef("AuthRenewBindingTokenRequest"),
    output: schemaRef("AuthRenewBindingTokenResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.RevokeSession": {
    version: "v1",
    input: schemaRef("AuthRevokeSessionRequest"),
    output: schemaRef("AuthRevokeSessionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ValidateRequest": {
    version: "v1",
    input: schemaRef("AuthValidateRequestRequest"),
    output: schemaRef("AuthValidateRequestResponse"),
    capabilities: { call: ["service"] },
    authRequired: false,
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CreateServiceProfile": {
    version: "v1",
    input: schemaRef("AuthCreateServiceProfileRequest"),
    output: schemaRef("AuthCreateServiceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListServiceProfiles": {
    version: "v1",
    input: schemaRef("AuthListServiceProfilesRequest"),
    output: schemaRef("AuthListServiceProfilesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ApplyServiceProfileContract": {
    version: "v1",
    input: schemaRef("AuthApplyServiceProfileContractRequest"),
    output: schemaRef("AuthApplyServiceProfileContractResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UnapplyServiceProfileContract": {
    version: "v1",
    input: schemaRef("AuthUnapplyServiceProfileContractRequest"),
    output: schemaRef("AuthUnapplyServiceProfileContractResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisableServiceProfile": {
    version: "v1",
    input: schemaRef("AuthDisableServiceProfileRequest"),
    output: schemaRef("AuthDisableServiceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.EnableServiceProfile": {
    version: "v1",
    input: schemaRef("AuthEnableServiceProfileRequest"),
    output: schemaRef("AuthEnableServiceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RemoveServiceProfile": {
    version: "v1",
    input: schemaRef("AuthRemoveServiceProfileRequest"),
    output: schemaRef("AuthRemoveServiceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ProvisionServiceInstance": {
    version: "v1",
    input: schemaRef("AuthProvisionServiceInstanceRequest"),
    output: schemaRef("AuthProvisionServiceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListServiceInstances": {
    version: "v1",
    input: schemaRef("AuthListServiceInstancesRequest"),
    output: schemaRef("AuthListServiceInstancesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisableServiceInstance": {
    version: "v1",
    input: schemaRef("AuthDisableServiceInstanceRequest"),
    output: schemaRef("AuthDisableServiceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.EnableServiceInstance": {
    version: "v1",
    input: schemaRef("AuthEnableServiceInstanceRequest"),
    output: schemaRef("AuthEnableServiceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RemoveServiceInstance": {
    version: "v1",
    input: schemaRef("AuthRemoveServiceInstanceRequest"),
    output: schemaRef("AuthRemoveServiceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListInstalledContracts": {
    version: "v1",
    input: schemaRef("AuthListInstalledContractsRequest"),
    output: schemaRef("AuthListInstalledContractsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetInstalledContract": {
    version: "v1",
    input: schemaRef("AuthGetInstalledContractRequest"),
    output: schemaRef("AuthGetInstalledContractResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.InstallService": {
    version: "v1",
    input: schemaRef("AuthInstallServiceRequest"),
    output: schemaRef("AuthInstallServiceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UpgradeServiceContract": {
    version: "v1",
    input: schemaRef("AuthUpgradeServiceContractRequest"),
    output: schemaRef("AuthUpgradeServiceContractResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RemoveService": {
    version: "v1",
    input: schemaRef("AuthRemoveServiceRequest"),
    output: schemaRef("AuthRemoveServiceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListServices": {
    version: "v1",
    input: schemaRef("AuthListServicesRequest"),
    output: schemaRef("AuthListServicesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListApprovals": {
    version: "v1",
    input: schemaRef("AuthListApprovalsRequest"),
    output: schemaRef("AuthListApprovalsResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RevokeApproval": {
    version: "v1",
    input: schemaRef("AuthRevokeApprovalRequest"),
    output: schemaRef("AuthRevokeApprovalResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CreatePortal": {
    version: "v1",
    input: schemaRef("AuthCreatePortalRequest"),
    output: schemaRef("AuthCreatePortalResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListPortals": {
    version: "v1",
    input: schemaRef("AuthListPortalsRequest"),
    output: schemaRef("AuthListPortalsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisablePortal": {
    version: "v1",
    input: schemaRef("AuthDisablePortalRequest"),
    output: schemaRef("AuthDisablePortalResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetLoginPortalDefault": {
    version: "v1",
    input: schemaRef("AuthGetLoginPortalDefaultRequest"),
    output: schemaRef("AuthGetLoginPortalDefaultResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListInstanceGrantPolicies": {
    version: "v1",
    input: schemaRef("AuthListInstanceGrantPoliciesRequest"),
    output: schemaRef("AuthListInstanceGrantPoliciesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UpsertInstanceGrantPolicy": {
    version: "v1",
    input: schemaRef("AuthUpsertInstanceGrantPolicyRequest"),
    output: schemaRef("AuthUpsertInstanceGrantPolicyResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisableInstanceGrantPolicy": {
    version: "v1",
    input: schemaRef("AuthDisableInstanceGrantPolicyRequest"),
    output: schemaRef("AuthDisableInstanceGrantPolicyResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.SetLoginPortalDefault": {
    version: "v1",
    input: schemaRef("AuthSetLoginPortalDefaultRequest"),
    output: schemaRef("AuthSetLoginPortalDefaultResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListLoginPortalSelections": {
    version: "v1",
    input: schemaRef("AuthListLoginPortalSelectionsRequest"),
    output: schemaRef("AuthListLoginPortalSelectionsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.SetLoginPortalSelection": {
    version: "v1",
    input: schemaRef("AuthSetLoginPortalSelectionRequest"),
    output: schemaRef("AuthSetLoginPortalSelectionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ClearLoginPortalSelection": {
    version: "v1",
    input: schemaRef("AuthClearLoginPortalSelectionRequest"),
    output: schemaRef("AuthClearLoginPortalSelectionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetDevicePortalDefault": {
    version: "v1",
    input: schemaRef("AuthGetDevicePortalDefaultRequest"),
    output: schemaRef("AuthGetDevicePortalDefaultResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.SetDevicePortalDefault": {
    version: "v1",
    input: schemaRef("AuthSetDevicePortalDefaultRequest"),
    output: schemaRef("AuthSetDevicePortalDefaultResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListDevicePortalSelections": {
    version: "v1",
    input: schemaRef("AuthListDevicePortalSelectionsRequest"),
    output: schemaRef("AuthListDevicePortalSelectionsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.SetDevicePortalSelection": {
    version: "v1",
    input: schemaRef("AuthSetDevicePortalSelectionRequest"),
    output: schemaRef("AuthSetDevicePortalSelectionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ClearDevicePortalSelection": {
    version: "v1",
    input: schemaRef("AuthClearDevicePortalSelectionRequest"),
    output: schemaRef("AuthClearDevicePortalSelectionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CreateDeviceProfile": {
    version: "v1",
    input: schemaRef("AuthCreateDeviceProfileRequest"),
    output: schemaRef("AuthCreateDeviceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ApplyDeviceProfileContract": {
    version: "v1",
    input: schemaRef("AuthApplyDeviceProfileContractRequest"),
    output: schemaRef("AuthApplyDeviceProfileContractResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UnapplyDeviceProfileContract": {
    version: "v1",
    input: schemaRef("AuthUnapplyDeviceProfileContractRequest"),
    output: schemaRef("AuthUnapplyDeviceProfileContractResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisableDeviceProfile": {
    version: "v1",
    input: schemaRef("AuthDisableDeviceProfileRequest"),
    output: schemaRef("AuthDisableDeviceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.EnableDeviceProfile": {
    version: "v1",
    input: schemaRef("AuthEnableDeviceProfileRequest"),
    output: schemaRef("AuthEnableDeviceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RemoveDeviceProfile": {
    version: "v1",
    input: schemaRef("AuthRemoveDeviceProfileRequest"),
    output: schemaRef("AuthRemoveDeviceProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListDeviceActivations": {
    version: "v1",
    input: schemaRef("AuthListDeviceActivationsRequest"),
    output: schemaRef("AuthListDeviceActivationsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListDeviceProfiles": {
    version: "v1",
    input: schemaRef("AuthListDeviceProfilesRequest"),
    output: schemaRef("AuthListDeviceProfilesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ProvisionDeviceInstance": {
    version: "v1",
    input: schemaRef("AuthProvisionDeviceInstanceRequest"),
    output: schemaRef("AuthProvisionDeviceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListDeviceInstances": {
    version: "v1",
    input: schemaRef("AuthListDeviceInstancesRequest"),
    output: schemaRef("AuthListDeviceInstancesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisableDeviceInstance": {
    version: "v1",
    input: schemaRef("AuthDisableDeviceInstanceRequest"),
    output: schemaRef("AuthDisableDeviceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.EnableDeviceInstance": {
    version: "v1",
    input: schemaRef("AuthEnableDeviceInstanceRequest"),
    output: schemaRef("AuthEnableDeviceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RemoveDeviceInstance": {
    version: "v1",
    input: schemaRef("AuthRemoveDeviceInstanceRequest"),
    output: schemaRef("AuthRemoveDeviceInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ActivateDevice": {
    version: "v1",
    input: schemaRef("AuthActivateDeviceRequest"),
    output: schemaRef("AuthActivateDeviceResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetDeviceActivationStatus": {
    version: "v1",
    input: schemaRef("AuthGetDeviceActivationStatusRequest"),
    output: schemaRef("AuthGetDeviceActivationStatusResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetDeviceConnectInfo": {
    version: "v1",
    input: schemaRef("AuthGetDeviceConnectInfoRequest"),
    output: schemaRef("AuthGetDeviceConnectInfoResponse"),
    capabilities: { call: [] },
    authRequired: false,
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RevokeDeviceActivation": {
    version: "v1",
    input: schemaRef("AuthRevokeDeviceActivationRequest"),
    output: schemaRef("AuthRevokeDeviceActivationResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListDeviceActivationReviews": {
    version: "v1",
    input: schemaRef("AuthListDeviceActivationReviewsRequest"),
    output: schemaRef("AuthListDeviceActivationReviewsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DecideDeviceActivationReview": {
    version: "v1",
    input: schemaRef("AuthDecideDeviceActivationReviewRequest"),
    output: schemaRef("AuthDecideDeviceActivationReviewResponse"),
    capabilities: { call: ["admin", "device.review"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListUsers": {
    version: "v1",
    input: schemaRef("AuthListUsersRequest"),
    output: schemaRef("AuthListUsersResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UpdateUser": {
    version: "v1",
    input: schemaRef("AuthUpdateUserRequest"),
    output: schemaRef("AuthUpdateUserResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
} as const;

export const TRELLIS_AUTH_OPERATIONS = {} as const;

export const TRELLIS_AUTH_EVENTS = {
  "Auth.Connect": {
    version: "v1",
    event: schemaRef("AuthConnectEvent"),
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["service:events:auth"],
    },
  },
  "Auth.ConnectionKicked": {
    version: "v1",
    event: schemaRef("AuthConnectionKickedEvent"),
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["service:events:auth"],
    },
  },
  "Auth.Disconnect": {
    version: "v1",
    event: schemaRef("AuthDisconnectEvent"),
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["service:events:auth"],
    },
  },
  "Auth.SessionRevoked": {
    version: "v1",
    event: schemaRef("AuthSessionRevokedEvent"),
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["service:events:auth"],
    },
  },
  "Auth.DeviceActivationReviewRequested": {
    version: "v1",
    event: schemaRef("AuthDeviceActivationReviewRequestedEvent"),
    params: ["/profileId"],
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["device.review"],
    },
  },
} as const;

const baseTrellisAuth = defineServiceContract(
  { schemas },
  () => ({
    id: "trellis.auth@v1",
    displayName: "Trellis Auth",
    description:
      "Provide Trellis authentication, session, profile, instance, and admin RPCs.",
    rpc: TRELLIS_AUTH_RPC,
    operations: TRELLIS_AUTH_OPERATIONS,
    events: TRELLIS_AUTH_EVENTS,
  }),
);

const DEFAULT_AUTH_RPC_CALL = [
  "Auth.Me",
  "Auth.Logout",
  "Auth.RenewBindingToken",
] as const;

type TrellisAuthOwnedApi = typeof baseTrellisAuth.API.owned;
type TrellisAuthDefaultRpcCall = typeof DEFAULT_AUTH_RPC_CALL;
type TrellisAuthUseSpec = UseSpec<TrellisAuthOwnedApi>;

type WithDefaultAuthRpcCall<TSpec extends TrellisAuthUseSpec | undefined> =
  TSpec extends { rpc?: { call?: infer TCall extends readonly string[] } }
    ? readonly [...TrellisAuthDefaultRpcCall, ...TCall]
    : TrellisAuthDefaultRpcCall;

type WithDefaultAuthUseSpec<TSpec extends TrellisAuthUseSpec | undefined> =
  & (TSpec extends TrellisAuthUseSpec ? Omit<TSpec, "rpc"> : {})
  & {
    rpc: {
      call: WithDefaultAuthRpcCall<TSpec>;
    };
  };

type TrellisAuthUseDefaultsFn = <
  const TSpec extends TrellisAuthUseSpec | undefined = undefined,
>(
  spec?: TSpec,
) => ContractDependencyUse<
  typeof baseTrellisAuth.CONTRACT_ID,
  TrellisAuthOwnedApi,
  WithDefaultAuthUseSpec<TSpec>
>;

type TrellisAuthModule = typeof baseTrellisAuth & {
  useDefaults: TrellisAuthUseDefaultsFn;
};

function mergeAuthUseDefaults(
  spec?: TrellisAuthUseSpec,
): TrellisAuthUseSpec {
  const rpcCall = [...DEFAULT_AUTH_RPC_CALL];
  for (const key of spec?.rpc?.call ?? []) {
    if (!rpcCall.includes(key as (typeof rpcCall)[number])) {
      rpcCall.push(key as (typeof rpcCall)[number]);
    }
  }

  return {
    ...spec,
    rpc: {
      ...spec?.rpc,
      call: rpcCall,
    },
  };
}

export const trellisAuth: TrellisAuthModule = Object.assign(baseTrellisAuth, {
  useDefaults: ((spec?: TrellisAuthUseSpec) => {
    return baseTrellisAuth.use(mergeAuthUseDefaults(spec));
  }) as TrellisAuthUseDefaultsFn,
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use, useDefaults } =
  trellisAuth;
export type Api = typeof API;
export default trellisAuth;
