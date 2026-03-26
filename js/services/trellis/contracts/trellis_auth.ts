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
export const TRELLIS_AUTH_RPC = {
  "Auth.Health": {
    version: "v1",
    inputSchema: HealthRpcSchema,
    outputSchema: HealthResponseSchema,
    capabilities: { call: [] },
    errors: ["UnexpectedError"],
  },
  "Auth.KickConnection": {
    version: "v1",
    inputSchema: AuthKickConnectionSchema,
    outputSchema: AuthKickConnectionResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListConnections": {
    version: "v1",
    inputSchema: AuthListConnectionsSchema,
    outputSchema: AuthListConnectionsResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListSessions": {
    version: "v1",
    inputSchema: AuthListSessionsSchema,
    outputSchema: AuthListSessionsResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.Logout": {
    version: "v1",
    inputSchema: AuthLogoutSchema,
    outputSchema: AuthLogoutResponseSchema,
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.Me": {
    version: "v1",
    inputSchema: AuthMeSchema,
    outputSchema: AuthMeResponseSchema,
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.RenewBindingToken": {
    version: "v1",
    inputSchema: AuthRenewBindingTokenSchema,
    outputSchema: AuthRenewBindingTokenResponseSchema,
    capabilities: { call: [] },
    errors: ["AuthError", "UnexpectedError"],
  },
  "Auth.RevokeSession": {
    version: "v1",
    inputSchema: AuthRevokeSessionSchema,
    outputSchema: AuthRevokeSessionResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ValidateRequest": {
    version: "v1",
    inputSchema: AuthValidateRequestSchema,
    outputSchema: AuthValidateRequestResponseSchema,
    capabilities: { call: ["service"] },
    authRequired: false,
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListServices": {
    version: "v1",
    inputSchema: AuthListServicesSchema,
    outputSchema: AuthListServicesResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.InstallService": {
    version: "v1",
    inputSchema: AuthInstallServiceSchema,
    outputSchema: AuthInstallServiceResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UpgradeServiceContract": {
    version: "v1",
    inputSchema: AuthUpgradeServiceContractSchema,
    outputSchema: AuthUpgradeServiceContractResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListInstalledContracts": {
    version: "v1",
    inputSchema: AuthListInstalledContractsSchema,
    outputSchema: AuthListInstalledContractsResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.GetInstalledContract": {
    version: "v1",
    inputSchema: AuthGetInstalledContractSchema,
    outputSchema: AuthGetInstalledContractResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListApprovals": {
    version: "v1",
    inputSchema: AuthListApprovalsSchema,
    outputSchema: AuthListApprovalsResponseSchema,
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.RevokeApproval": {
    version: "v1",
    inputSchema: AuthRevokeApprovalSchema,
    outputSchema: AuthRevokeApprovalResponseSchema,
    capabilities: { call: [] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.ListUsers": {
    version: "v1",
    inputSchema: AuthListUsersSchema,
    outputSchema: AuthListUsersResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
  "Auth.UpdateUser": {
    version: "v1",
    inputSchema: AuthUpdateUserSchema,
    outputSchema: AuthUpdateUserResponseSchema,
    capabilities: { call: ["admin"] },
    errors: ["AuthError", "ValidationError", "UnexpectedError"],
  },
} as const;

export const TRELLIS_AUTH_EVENTS = {
  "Auth.Connect": {
    version: "v1",
    eventSchema: AuthConnectEventSchema,
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["service:events:auth"],
    },
  },
  "Auth.ConnectionKicked": {
    version: "v1",
    eventSchema: AuthConnectionKickedEventSchema,
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["service:events:auth"],
    },
  },
  "Auth.Disconnect": {
    version: "v1",
    eventSchema: AuthDisconnectEventSchema,
    capabilities: {
      publish: ["service:events:auth"],
      subscribe: ["service:events:auth"],
    },
  },
  "Auth.SessionRevoked": {
    version: "v1",
    eventSchema: AuthSessionRevokedEventSchema,
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
  rpc: TRELLIS_AUTH_RPC,
  events: TRELLIS_AUTH_EVENTS,
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisAuth;
export type Api = typeof API;
