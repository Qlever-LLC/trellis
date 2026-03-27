// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
export const CONTRACT_ID = "trellis.auth@v1" as const;
export const CONTRACT_DIGEST = "kvbbx076xrzMY1F2PCYXJtStwPeWsqVDdIUbDHyE3YU" as const;

export type AuthGetInstalledContractInput = { digest: string; };
export type AuthGetInstalledContractOutput = { contract: { analysis?: { events: { events: Array<{ key: string; publishCapabilities: Array<string>; subject: string; subscribeCapabilities: Array<string>; wildcardSubject: string; }>; }; namespaces: Array<string>; nats: { publish: Array<{ kind: string; requiredCapabilities: Array<string>; subject: string; wildcardSubject: string; }>; subscribe: Array<{ kind: string; requiredCapabilities: Array<string>; subject: string; wildcardSubject: string; }>; }; resources: { kv: Array<{ alias: string; history: number; maxValueBytes?: number; purpose: string; required: boolean; ttlMs: number; }>; }; rpc: { methods: Array<{ callerCapabilities: Array<string>; key: string; subject: string; wildcardSubject: string; }>; }; subjects?: { subjects: Array<{ key: string; publishCapabilities: Array<string>; subject: string; subscribeCapabilities: Array<string>; }>; }; }; analysisSummary?: { events: number; kvResources: number; namespaces: Array<string>; natsPublish: number; natsSubscribe: number; rpcMethods: number; }; contract: {  }; description: string; digest: string; displayName: string; id: string; installedAt: string; kind: string; resourceBindings?: { kv?: {  }; }; resources?: { kv?: {  }; }; sessionKey?: string; }; };

export type AuthHealthInput = {  };
export type AuthHealthOutput = { checks: Array<{ error?: string; latencyMs: number; name: string; status: ("ok" | "failed"); }>; service: string; status: ("healthy" | "unhealthy" | "degraded"); timestamp: string; };

export type AuthInstallServiceInput = { active?: boolean; contract: {  }; description: string; displayName: string; namespaces: Array<string>; sessionKey: string; };
export type AuthInstallServiceOutput = { contractDigest: string; contractId: string; resourceBindings: { kv?: {  }; }; sessionKey: string; success: boolean; };

export type AuthKickConnectionInput = { userNkey: string; };
export type AuthKickConnectionOutput = { success: boolean; };

export type AuthListApprovalsInput = { digest?: string; user?: string; };
export type AuthListApprovalsOutput = { approvals: Array<{ answer: ("approved" | "denied"); answeredAt: string; approval: { capabilities: Array<string>; contractDigest: string; contractId: string; description: string; displayName: string; kind: string; }; updatedAt: string; user: string; }>; };

export type AuthListConnectionsInput = { sessionKey?: string; user?: string; };
export type AuthListConnectionsOutput = { connections: Array<{ clientId: number; connectedAt: string; key: string; serverId: string; }>; };

export type AuthListInstalledContractsInput = { sessionKey?: string; };
export type AuthListInstalledContractsOutput = { contracts: Array<{ analysisSummary?: { events: number; kvResources: number; namespaces: Array<string>; natsPublish: number; natsSubscribe: number; rpcMethods: number; }; description: string; digest: string; displayName: string; id: string; installedAt: string; kind: string; resourceBindings?: { kv?: {  }; }; sessionKey?: string; }>; };

export type AuthListServicesInput = {  };
export type AuthListServicesOutput = { services: Array<{ active: boolean; capabilities: Array<string>; contractDigest?: string; contractId?: string; createdAt: string; description: string; displayName: string; namespaces: Array<string>; resourceBindings?: { kv?: {  }; }; sessionKey: string; }>; };

export type AuthListSessionsInput = { user?: string; };
export type AuthListSessionsOutput = { sessions: Array<{ createdAt: string; key: string; lastAuth: string; type: ("user" | "service"); }>; };

export type AuthListUsersInput = {  };
export type AuthListUsersOutput = { users: Array<{ active: boolean; capabilities: Array<string>; email?: string; id: string; name?: string; origin: string; }>; };

export type AuthLogoutInput = {  };
export type AuthLogoutOutput = { success: boolean; };

export type AuthMeInput = {  };
export type AuthMeOutput = { user: { active: boolean; capabilities: Array<string>; email: string; id: string; image?: string; lastLogin?: string; name: string; origin: string; }; };

export type AuthRenewBindingTokenInput = {  };
export type AuthRenewBindingTokenOutput = { bindingToken: string; expires: string; inboxPrefix: string; natsServers: Array<string>; sentinel: { jwt: string; seed: string; }; status: "bound"; };

export type AuthRevokeApprovalInput = { contractDigest: string; user?: string; };
export type AuthRevokeApprovalOutput = { success: boolean; };

export type AuthRevokeSessionInput = { sessionKey: string; };
export type AuthRevokeSessionOutput = { success: boolean; };

export type AuthUpdateUserInput = { active?: boolean; capabilities?: Array<string>; id: string; origin: string; };
export type AuthUpdateUserOutput = { success: boolean; };

export type AuthUpgradeServiceContractInput = { contract: {  }; sessionKey: string; };
export type AuthUpgradeServiceContractOutput = { contractDigest: string; contractId: string; resourceBindings: { kv?: {  }; }; sessionKey: string; success: boolean; };

export type AuthValidateRequestInput = { capabilities?: Array<string>; payloadHash: string; proof: string; sessionKey: string; subject: string; };
export type AuthValidateRequestOutput = { allowed: boolean; inboxPrefix: string; user: { active: boolean; capabilities: Array<string>; email: string; id: string; image?: string; lastLogin?: string; name: string; origin: string; }; };

export type AuthConnectEvent = ({ header: { id: string; time: string; }; } & { id: string; origin: string; sessionKey: string; userNkey: string; });

export type AuthConnectionKickedEvent = ({ header: { id: string; time: string; }; } & { id: string; kickedBy: string; origin: string; userNkey: string; });

export type AuthDisconnectEvent = ({ header: { id: string; time: string; }; } & { id: string; origin: string; sessionKey: string; userNkey: string; });

export type AuthSessionRevokedEvent = ({ header: { id: string; time: string; }; } & { id: string; origin: string; revokedBy: string; sessionKey: string; });

export interface RpcMap {
  "Auth.GetInstalledContract": { input: AuthGetInstalledContractInput; output: AuthGetInstalledContractOutput; };
  "Auth.Health": { input: AuthHealthInput; output: AuthHealthOutput; };
  "Auth.InstallService": { input: AuthInstallServiceInput; output: AuthInstallServiceOutput; };
  "Auth.KickConnection": { input: AuthKickConnectionInput; output: AuthKickConnectionOutput; };
  "Auth.ListApprovals": { input: AuthListApprovalsInput; output: AuthListApprovalsOutput; };
  "Auth.ListConnections": { input: AuthListConnectionsInput; output: AuthListConnectionsOutput; };
  "Auth.ListInstalledContracts": { input: AuthListInstalledContractsInput; output: AuthListInstalledContractsOutput; };
  "Auth.ListServices": { input: AuthListServicesInput; output: AuthListServicesOutput; };
  "Auth.ListSessions": { input: AuthListSessionsInput; output: AuthListSessionsOutput; };
  "Auth.ListUsers": { input: AuthListUsersInput; output: AuthListUsersOutput; };
  "Auth.Logout": { input: AuthLogoutInput; output: AuthLogoutOutput; };
  "Auth.Me": { input: AuthMeInput; output: AuthMeOutput; };
  "Auth.RenewBindingToken": { input: AuthRenewBindingTokenInput; output: AuthRenewBindingTokenOutput; };
  "Auth.RevokeApproval": { input: AuthRevokeApprovalInput; output: AuthRevokeApprovalOutput; };
  "Auth.RevokeSession": { input: AuthRevokeSessionInput; output: AuthRevokeSessionOutput; };
  "Auth.UpdateUser": { input: AuthUpdateUserInput; output: AuthUpdateUserOutput; };
  "Auth.UpgradeServiceContract": { input: AuthUpgradeServiceContractInput; output: AuthUpgradeServiceContractOutput; };
  "Auth.ValidateRequest": { input: AuthValidateRequestInput; output: AuthValidateRequestOutput; };
}

export interface EventMap {
  "Auth.Connect": { event: AuthConnectEvent; };
  "Auth.ConnectionKicked": { event: AuthConnectionKickedEvent; };
  "Auth.Disconnect": { event: AuthDisconnectEvent; };
  "Auth.SessionRevoked": { event: AuthSessionRevokedEvent; };
}

export interface SubjectMap {
}

