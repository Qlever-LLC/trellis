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
} from "@qlever-llc/trellis-auth";
import { defineContract } from "@qlever-llc/trellis-contracts";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis-server";
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

function schemaRef<const TName extends keyof typeof schemas & string>(schema: TName) {
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
} as const;

export const trellisAuth = defineContract({
  id: "trellis.auth@v1",
  displayName: "Trellis Auth",
  description: "Provide Trellis authentication, session, service install, and admin RPCs.",
  kind: "service",
  schemas,
  rpc: TRELLIS_AUTH_RPC,
  events: TRELLIS_AUTH_EVENTS,
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisAuth;
export type Api = typeof API;
