import {
  AuthGetInstalledContractResponseSchema,
  AuthGetInstalledContractSchema,
  AuthInstallServiceResponseSchema,
  AuthInstallServiceSchema,
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
  AuthUpgradeServiceContractResponseSchema,
  AuthUpgradeServiceContractSchema,
  AuthValidateRequestResponseSchema,
  AuthValidateRequestSchema,
  PortalFlowStateSchema,
} from "@qlever-llc/trellis/auth";
import {
  AuthActivateWorkloadResponseSchema,
  AuthActivateWorkloadSchema,
  AuthClearLoginPortalSelectionResponseSchema,
  AuthClearLoginPortalSelectionSchema,
  AuthClearWorkloadPortalSelectionResponseSchema,
  AuthClearWorkloadPortalSelectionSchema,
  AuthCreatePortalResponseSchema,
  AuthCreatePortalSchema,
  AuthCreateWorkloadProfileResponseSchema,
  AuthCreateWorkloadProfileSchema,
  AuthDisablePortalResponseSchema,
  AuthDisablePortalSchema,
  AuthDisableWorkloadInstanceResponseSchema,
  AuthDisableWorkloadInstanceSchema,
  AuthDisableWorkloadProfileResponseSchema,
  AuthDisableWorkloadProfileSchema,
  AuthDecideWorkloadActivationReviewResponseSchema,
  AuthDecideWorkloadActivationReviewSchema,
  AuthGetLoginPortalDefaultResponseSchema,
  AuthGetLoginPortalDefaultSchema,
  AuthGetWorkloadActivationStatusResponseSchema,
  AuthGetWorkloadActivationStatusSchema,
  AuthGetWorkloadConnectInfoResponseSchema,
  AuthGetWorkloadConnectInfoSchema,
  AuthGetWorkloadPortalDefaultResponseSchema,
  AuthGetWorkloadPortalDefaultSchema,
  AuthListLoginPortalSelectionsResponseSchema,
  AuthListLoginPortalSelectionsSchema,
  AuthListPortalsResponseSchema,
  AuthListPortalsSchema,
  AuthListWorkloadActivationReviewsResponseSchema,
  AuthListWorkloadActivationReviewsSchema,
  AuthListWorkloadPortalSelectionsResponseSchema,
  AuthListWorkloadPortalSelectionsSchema,
  AuthListWorkloadActivationsResponseSchema,
  AuthListWorkloadActivationsSchema,
  AuthListWorkloadInstancesResponseSchema,
  AuthListWorkloadInstancesSchema,
  AuthListWorkloadProfilesResponseSchema,
  AuthListWorkloadProfilesSchema,
  AuthProvisionWorkloadInstanceResponseSchema,
  AuthProvisionWorkloadInstanceSchema,
  AuthRevokeWorkloadActivationResponseSchema,
  AuthRevokeWorkloadActivationSchema,
  AuthWorkloadActivationReviewRequestedEventSchema,
  AuthSetLoginPortalDefaultResponseSchema,
  AuthSetLoginPortalDefaultSchema,
  AuthSetLoginPortalSelectionResponseSchema,
  AuthSetLoginPortalSelectionSchema,
  AuthSetWorkloadPortalDefaultResponseSchema,
  AuthSetWorkloadPortalDefaultSchema,
  AuthSetWorkloadPortalSelectionResponseSchema,
  AuthSetWorkloadPortalSelectionSchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  PortalSchema,
  WorkloadActivationRecordSchema,
  WorkloadConnectInfoSchema,
  WorkloadPortalDefaultSchema,
  WorkloadPortalSelectionSchema,
  WorkloadProfileSchema,
  WorkloadActivationReviewSchema,
  WorkloadSchema,
} from "../../../../packages/auth/protocol.ts";
import {
  type ContractDependencyUse,
  defineContract,
  type UseSpec,
} from "@qlever-llc/trellis";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis/server";
import {
  type AuthConnectEvent,
  AuthConnectEventSchema,
} from "../../../../packages/trellis/models/auth/events/AuthConnect.ts";
import {
  type AuthConnectionKickedEvent,
  AuthConnectionKickedEventSchema,
} from "../../../../packages/trellis/models/auth/events/AuthConnectionKicked.ts";
import {
  type AuthDisconnectEvent,
  AuthDisconnectEventSchema,
} from "../../../../packages/trellis/models/auth/events/AuthDisconnect.ts";
import {
  type AuthSessionRevokedEvent,
  AuthSessionRevokedEventSchema,
} from "../../../../packages/trellis/models/auth/events/AuthSessionRevoked.ts";
import {
  AuthKickConnectionResponseSchema,
  AuthKickConnectionSchema,
} from "../../../../packages/trellis/models/auth/rpc/KickConnection.ts";
import {
  AuthListConnectionsResponseSchema,
  AuthListConnectionsSchema,
} from "../../../../packages/trellis/models/auth/rpc/ListConnections.ts";
import {
  AuthListSessionsResponseSchema,
  AuthListSessionsSchema,
} from "../../../../packages/trellis/models/auth/rpc/ListSessions.ts";
import {
  AuthLogoutResponseSchema,
  AuthLogoutSchema,
} from "../../../../packages/trellis/models/auth/rpc/Logout.ts";
import {
  AuthRenewBindingTokenResponseSchema,
  AuthRenewBindingTokenSchema,
} from "../../../../packages/trellis/models/auth/rpc/RenewBindingToken.ts";
import {
  AuthRevokeSessionResponseSchema,
  AuthRevokeSessionSchema,
} from "../../../../packages/trellis/models/auth/rpc/RevokeSession.ts";

const schemas = {
  AuthCreatePortalRequest: AuthCreatePortalSchema,
  AuthCreatePortalResponse: AuthCreatePortalResponseSchema,
  AuthDisablePortalRequest: AuthDisablePortalSchema,
  AuthDisablePortalResponse: AuthDisablePortalResponseSchema,
  AuthGetLoginPortalDefaultRequest: AuthGetLoginPortalDefaultSchema,
  AuthGetLoginPortalDefaultResponse: AuthGetLoginPortalDefaultResponseSchema,
  AuthSetLoginPortalDefaultRequest: AuthSetLoginPortalDefaultSchema,
  AuthSetLoginPortalDefaultResponse: AuthSetLoginPortalDefaultResponseSchema,
  AuthListLoginPortalSelectionsRequest: AuthListLoginPortalSelectionsSchema,
  AuthListLoginPortalSelectionsResponse: AuthListLoginPortalSelectionsResponseSchema,
  AuthSetLoginPortalSelectionRequest: AuthSetLoginPortalSelectionSchema,
  AuthSetLoginPortalSelectionResponse: AuthSetLoginPortalSelectionResponseSchema,
  AuthClearLoginPortalSelectionRequest: AuthClearLoginPortalSelectionSchema,
  AuthClearLoginPortalSelectionResponse: AuthClearLoginPortalSelectionResponseSchema,
  AuthGetWorkloadPortalDefaultRequest: AuthGetWorkloadPortalDefaultSchema,
  AuthGetWorkloadPortalDefaultResponse: AuthGetWorkloadPortalDefaultResponseSchema,
  AuthSetWorkloadPortalDefaultRequest: AuthSetWorkloadPortalDefaultSchema,
  AuthSetWorkloadPortalDefaultResponse: AuthSetWorkloadPortalDefaultResponseSchema,
  AuthListWorkloadPortalSelectionsRequest: AuthListWorkloadPortalSelectionsSchema,
  AuthListWorkloadPortalSelectionsResponse: AuthListWorkloadPortalSelectionsResponseSchema,
  AuthSetWorkloadPortalSelectionRequest: AuthSetWorkloadPortalSelectionSchema,
  AuthSetWorkloadPortalSelectionResponse: AuthSetWorkloadPortalSelectionResponseSchema,
  AuthClearWorkloadPortalSelectionRequest: AuthClearWorkloadPortalSelectionSchema,
  AuthClearWorkloadPortalSelectionResponse: AuthClearWorkloadPortalSelectionResponseSchema,
  AuthCreateWorkloadProfileRequest: AuthCreateWorkloadProfileSchema,
  AuthCreateWorkloadProfileResponse: AuthCreateWorkloadProfileResponseSchema,
  AuthDisableWorkloadProfileRequest: AuthDisableWorkloadProfileSchema,
  AuthDisableWorkloadProfileResponse: AuthDisableWorkloadProfileResponseSchema,
  AuthDecideWorkloadActivationReviewRequest: AuthDecideWorkloadActivationReviewSchema,
  AuthDecideWorkloadActivationReviewResponse: AuthDecideWorkloadActivationReviewResponseSchema,
  AuthListPortalsRequest: AuthListPortalsSchema,
  AuthListPortalsResponse: AuthListPortalsResponseSchema,
  AuthGetWorkloadActivationStatusRequest: AuthGetWorkloadActivationStatusSchema,
  AuthGetWorkloadActivationStatusResponse: AuthGetWorkloadActivationStatusResponseSchema,
  AuthListWorkloadActivationReviewsRequest: AuthListWorkloadActivationReviewsSchema,
  AuthListWorkloadActivationReviewsResponse: AuthListWorkloadActivationReviewsResponseSchema,
  AuthListWorkloadProfilesRequest: AuthListWorkloadProfilesSchema,
  AuthListWorkloadProfilesResponse: AuthListWorkloadProfilesResponseSchema,
  AuthProvisionWorkloadInstanceRequest: AuthProvisionWorkloadInstanceSchema,
  AuthProvisionWorkloadInstanceResponse: AuthProvisionWorkloadInstanceResponseSchema,
  AuthListWorkloadInstancesRequest: AuthListWorkloadInstancesSchema,
  AuthListWorkloadInstancesResponse: AuthListWorkloadInstancesResponseSchema,
  AuthDisableWorkloadInstanceRequest: AuthDisableWorkloadInstanceSchema,
  AuthDisableWorkloadInstanceResponse: AuthDisableWorkloadInstanceResponseSchema,
  AuthActivateWorkloadRequest: AuthActivateWorkloadSchema,
  AuthActivateWorkloadResponse: AuthActivateWorkloadResponseSchema,
  AuthGetWorkloadConnectInfoRequest: AuthGetWorkloadConnectInfoSchema,
  AuthGetWorkloadConnectInfoResponse: AuthGetWorkloadConnectInfoResponseSchema,
  AuthListWorkloadActivationsRequest: AuthListWorkloadActivationsSchema,
  AuthListWorkloadActivationsResponse: AuthListWorkloadActivationsResponseSchema,
  AuthRevokeWorkloadActivationRequest: AuthRevokeWorkloadActivationSchema,
  AuthRevokeWorkloadActivationResponse: AuthRevokeWorkloadActivationResponseSchema,
  LoginPortalDefault: LoginPortalDefaultSchema,
  LoginPortalSelection: LoginPortalSelectionSchema,
  Portal: PortalSchema,
  PortalFlowState: PortalFlowStateSchema,
  Workload: WorkloadSchema,
  WorkloadPortalDefault: WorkloadPortalDefaultSchema,
  WorkloadPortalSelection: WorkloadPortalSelectionSchema,
  WorkloadProfile: WorkloadProfileSchema,
  WorkloadActivationReview: WorkloadActivationReviewSchema,
  WorkloadActivationRecord: WorkloadActivationRecordSchema,
  WorkloadConnectInfo: WorkloadConnectInfoSchema,
  AuthWorkloadActivationReviewRequestedEvent: AuthWorkloadActivationReviewRequestedEventSchema,
  AuthGetInstalledContractRequest: AuthGetInstalledContractSchema,
  AuthGetInstalledContractResponse: AuthGetInstalledContractResponseSchema,
  AuthInstallServiceRequest: AuthInstallServiceSchema,
  AuthInstallServiceResponse: AuthInstallServiceResponseSchema,
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
  AuthRevokeApprovalRequest: AuthRevokeApprovalSchema,
  AuthRevokeApprovalResponse: AuthRevokeApprovalResponseSchema,
  AuthUpdateUserRequest: AuthUpdateUserSchema,
  AuthUpdateUserResponse: AuthUpdateUserResponseSchema,
  AuthUpgradeServiceContractRequest: AuthUpgradeServiceContractSchema,
  AuthUpgradeServiceContractResponse: AuthUpgradeServiceContractResponseSchema,
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
  "Auth.ListServices": {
    version: "v1",
    input: schemaRef("AuthListServicesRequest"),
    output: schemaRef("AuthListServicesResponse"),
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
  "Auth.GetWorkloadPortalDefault": {
    version: "v1",
    input: schemaRef("AuthGetWorkloadPortalDefaultRequest"),
    output: schemaRef("AuthGetWorkloadPortalDefaultResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.SetWorkloadPortalDefault": {
    version: "v1",
    input: schemaRef("AuthSetWorkloadPortalDefaultRequest"),
    output: schemaRef("AuthSetWorkloadPortalDefaultResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListWorkloadPortalSelections": {
    version: "v1",
    input: schemaRef("AuthListWorkloadPortalSelectionsRequest"),
    output: schemaRef("AuthListWorkloadPortalSelectionsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.SetWorkloadPortalSelection": {
    version: "v1",
    input: schemaRef("AuthSetWorkloadPortalSelectionRequest"),
    output: schemaRef("AuthSetWorkloadPortalSelectionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ClearWorkloadPortalSelection": {
    version: "v1",
    input: schemaRef("AuthClearWorkloadPortalSelectionRequest"),
    output: schemaRef("AuthClearWorkloadPortalSelectionResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.CreateWorkloadProfile": {
    version: "v1",
    input: schemaRef("AuthCreateWorkloadProfileRequest"),
    output: schemaRef("AuthCreateWorkloadProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisableWorkloadProfile": {
    version: "v1",
    input: schemaRef("AuthDisableWorkloadProfileRequest"),
    output: schemaRef("AuthDisableWorkloadProfileResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListWorkloadActivations": {
    version: "v1",
    input: schemaRef("AuthListWorkloadActivationsRequest"),
    output: schemaRef("AuthListWorkloadActivationsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListWorkloadProfiles": {
    version: "v1",
    input: schemaRef("AuthListWorkloadProfilesRequest"),
    output: schemaRef("AuthListWorkloadProfilesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ProvisionWorkloadInstance": {
    version: "v1",
    input: schemaRef("AuthProvisionWorkloadInstanceRequest"),
    output: schemaRef("AuthProvisionWorkloadInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListWorkloadInstances": {
    version: "v1",
    input: schemaRef("AuthListWorkloadInstancesRequest"),
    output: schemaRef("AuthListWorkloadInstancesResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DisableWorkloadInstance": {
    version: "v1",
    input: schemaRef("AuthDisableWorkloadInstanceRequest"),
    output: schemaRef("AuthDisableWorkloadInstanceResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ActivateWorkload": {
    version: "v1",
    input: schemaRef("AuthActivateWorkloadRequest"),
    output: schemaRef("AuthActivateWorkloadResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetWorkloadActivationStatus": {
    version: "v1",
    input: schemaRef("AuthGetWorkloadActivationStatusRequest"),
    output: schemaRef("AuthGetWorkloadActivationStatusResponse"),
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetWorkloadConnectInfo": {
    version: "v1",
    input: schemaRef("AuthGetWorkloadConnectInfoRequest"),
    output: schemaRef("AuthGetWorkloadConnectInfoResponse"),
    capabilities: { call: [] },
    authRequired: false,
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RevokeWorkloadActivation": {
    version: "v1",
    input: schemaRef("AuthRevokeWorkloadActivationRequest"),
    output: schemaRef("AuthRevokeWorkloadActivationResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListWorkloadActivationReviews": {
    version: "v1",
    input: schemaRef("AuthListWorkloadActivationReviewsRequest"),
    output: schemaRef("AuthListWorkloadActivationReviewsResponse"),
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.DecideWorkloadActivationReview": {
    version: "v1",
    input: schemaRef("AuthDecideWorkloadActivationReviewRequest"),
    output: schemaRef("AuthDecideWorkloadActivationReviewResponse"),
    capabilities: { call: ["admin", "workload.review"] },
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
  "Auth.WorkloadActivationReviewRequested": {
    version: "v1",
    event: schemaRef("AuthWorkloadActivationReviewRequestedEvent"),
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["workload.review"],
    },
  },
} as const;

const baseTrellisAuth = defineContract({
  id: "trellis.auth@v1",
  displayName: "Trellis Auth",
  description:
    "Provide Trellis authentication, session, service install, and admin RPCs.",
  schemas,
  rpc: TRELLIS_AUTH_RPC,
  operations: TRELLIS_AUTH_OPERATIONS,
  events: TRELLIS_AUTH_EVENTS,
});

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
  (TSpec extends TrellisAuthUseSpec ? Omit<TSpec, "rpc"> : {}) & {
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

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use, useDefaults } = trellisAuth;
export type Api = typeof API;
