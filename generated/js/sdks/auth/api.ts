// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import type { TrellisAPI } from "@qlever-llc/trellis-contracts";
import { schema } from "@qlever-llc/trellis-contracts";
import * as Types from "./types.ts";
import { SCHEMAS } from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Auth.GetInstalledContract": {
      subject: "rpc.v1.Auth.GetInstalledContract",
      input: schema<Types.AuthGetInstalledContractInput>(SCHEMAS.rpc["Auth.GetInstalledContract"].input),
      output: schema<Types.AuthGetInstalledContractOutput>(SCHEMAS.rpc["Auth.GetInstalledContract"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.Health": {
      subject: "rpc.v1.Auth.Health",
      input: schema<Types.AuthHealthInput>(SCHEMAS.rpc["Auth.Health"].input),
      output: schema<Types.AuthHealthOutput>(SCHEMAS.rpc["Auth.Health"].output),
      callerCapabilities: [],
      errors: ["UnexpectedError"] as const,
    },
    "Auth.InstallService": {
      subject: "rpc.v1.Auth.InstallService",
      input: schema<Types.AuthInstallServiceInput>(SCHEMAS.rpc["Auth.InstallService"].input),
      output: schema<Types.AuthInstallServiceOutput>(SCHEMAS.rpc["Auth.InstallService"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.KickConnection": {
      subject: "rpc.v1.Auth.KickConnection",
      input: schema<Types.AuthKickConnectionInput>(SCHEMAS.rpc["Auth.KickConnection"].input),
      output: schema<Types.AuthKickConnectionOutput>(SCHEMAS.rpc["Auth.KickConnection"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.ListApprovals": {
      subject: "rpc.v1.Auth.ListApprovals",
      input: schema<Types.AuthListApprovalsInput>(SCHEMAS.rpc["Auth.ListApprovals"].input),
      output: schema<Types.AuthListApprovalsOutput>(SCHEMAS.rpc["Auth.ListApprovals"].output),
      callerCapabilities: [],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.ListConnections": {
      subject: "rpc.v1.Auth.ListConnections",
      input: schema<Types.AuthListConnectionsInput>(SCHEMAS.rpc["Auth.ListConnections"].input),
      output: schema<Types.AuthListConnectionsOutput>(SCHEMAS.rpc["Auth.ListConnections"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.ListInstalledContracts": {
      subject: "rpc.v1.Auth.ListInstalledContracts",
      input: schema<Types.AuthListInstalledContractsInput>(SCHEMAS.rpc["Auth.ListInstalledContracts"].input),
      output: schema<Types.AuthListInstalledContractsOutput>(SCHEMAS.rpc["Auth.ListInstalledContracts"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.ListServices": {
      subject: "rpc.v1.Auth.ListServices",
      input: schema<Types.AuthListServicesInput>(SCHEMAS.rpc["Auth.ListServices"].input),
      output: schema<Types.AuthListServicesOutput>(SCHEMAS.rpc["Auth.ListServices"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.ListSessions": {
      subject: "rpc.v1.Auth.ListSessions",
      input: schema<Types.AuthListSessionsInput>(SCHEMAS.rpc["Auth.ListSessions"].input),
      output: schema<Types.AuthListSessionsOutput>(SCHEMAS.rpc["Auth.ListSessions"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.ListUsers": {
      subject: "rpc.v1.Auth.ListUsers",
      input: schema<Types.AuthListUsersInput>(SCHEMAS.rpc["Auth.ListUsers"].input),
      output: schema<Types.AuthListUsersOutput>(SCHEMAS.rpc["Auth.ListUsers"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.Logout": {
      subject: "rpc.v1.Auth.Logout",
      input: schema<Types.AuthLogoutInput>(SCHEMAS.rpc["Auth.Logout"].input),
      output: schema<Types.AuthLogoutOutput>(SCHEMAS.rpc["Auth.Logout"].output),
      callerCapabilities: [],
      errors: ["AuthError","UnexpectedError"] as const,
    },
    "Auth.Me": {
      subject: "rpc.v1.Auth.Me",
      input: schema<Types.AuthMeInput>(SCHEMAS.rpc["Auth.Me"].input),
      output: schema<Types.AuthMeOutput>(SCHEMAS.rpc["Auth.Me"].output),
      callerCapabilities: [],
      errors: ["AuthError","UnexpectedError"] as const,
    },
    "Auth.RenewBindingToken": {
      subject: "rpc.v1.Auth.RenewBindingToken",
      input: schema<Types.AuthRenewBindingTokenInput>(SCHEMAS.rpc["Auth.RenewBindingToken"].input),
      output: schema<Types.AuthRenewBindingTokenOutput>(SCHEMAS.rpc["Auth.RenewBindingToken"].output),
      callerCapabilities: [],
      errors: ["AuthError","UnexpectedError"] as const,
    },
    "Auth.RevokeApproval": {
      subject: "rpc.v1.Auth.RevokeApproval",
      input: schema<Types.AuthRevokeApprovalInput>(SCHEMAS.rpc["Auth.RevokeApproval"].input),
      output: schema<Types.AuthRevokeApprovalOutput>(SCHEMAS.rpc["Auth.RevokeApproval"].output),
      callerCapabilities: [],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.RevokeSession": {
      subject: "rpc.v1.Auth.RevokeSession",
      input: schema<Types.AuthRevokeSessionInput>(SCHEMAS.rpc["Auth.RevokeSession"].input),
      output: schema<Types.AuthRevokeSessionOutput>(SCHEMAS.rpc["Auth.RevokeSession"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.UpdateUser": {
      subject: "rpc.v1.Auth.UpdateUser",
      input: schema<Types.AuthUpdateUserInput>(SCHEMAS.rpc["Auth.UpdateUser"].input),
      output: schema<Types.AuthUpdateUserOutput>(SCHEMAS.rpc["Auth.UpdateUser"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.UpgradeServiceContract": {
      subject: "rpc.v1.Auth.UpgradeServiceContract",
      input: schema<Types.AuthUpgradeServiceContractInput>(SCHEMAS.rpc["Auth.UpgradeServiceContract"].input),
      output: schema<Types.AuthUpgradeServiceContractOutput>(SCHEMAS.rpc["Auth.UpgradeServiceContract"].output),
      callerCapabilities: ["admin"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
    "Auth.ValidateRequest": {
      subject: "rpc.v1.Auth.ValidateRequest",
      input: schema<Types.AuthValidateRequestInput>(SCHEMAS.rpc["Auth.ValidateRequest"].input),
      output: schema<Types.AuthValidateRequestOutput>(SCHEMAS.rpc["Auth.ValidateRequest"].output),
      callerCapabilities: ["service"],
      errors: ["AuthError","ValidationError","UnexpectedError"] as const,
    },
  },
  events: {
    "Auth.Connect": {
      subject: "events.v1.Auth.Connect",
      event: schema<Types.AuthConnectEvent>(SCHEMAS.events["Auth.Connect"].event),
      publishCapabilities: ["service:events:auth"],
      subscribeCapabilities: ["service:events:auth"],
    },
    "Auth.ConnectionKicked": {
      subject: "events.v1.Auth.ConnectionKicked",
      event: schema<Types.AuthConnectionKickedEvent>(SCHEMAS.events["Auth.ConnectionKicked"].event),
      publishCapabilities: ["service:events:auth"],
      subscribeCapabilities: ["service:events:auth"],
    },
    "Auth.Disconnect": {
      subject: "events.v1.Auth.Disconnect",
      event: schema<Types.AuthDisconnectEvent>(SCHEMAS.events["Auth.Disconnect"].event),
      publishCapabilities: ["service:events:auth"],
      subscribeCapabilities: ["service:events:auth"],
    },
    "Auth.SessionRevoked": {
      subject: "events.v1.Auth.SessionRevoked",
      event: schema<Types.AuthSessionRevokedEvent>(SCHEMAS.events["Auth.SessionRevoked"].event),
      publishCapabilities: ["service:events:auth"],
      subscribeCapabilities: ["service:events:auth"],
    },
  },
  subjects: {
  },
} satisfies TrellisAPI;

const EMPTY_API = { rpc: {}, events: {}, subjects: {} } as const satisfies TrellisAPI;

export const API = {
  owned: OWNED_API,
  used: EMPTY_API,
  trellis: OWNED_API,
} as const;

export type OwnedApi = typeof API.owned;
export type Api = typeof API.trellis;
export type ApiViews = typeof API;

