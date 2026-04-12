import type { BaseError, Result } from "@qlever-llc/result";
import type {
  AuthGetInstalledContractInput,
  AuthGetInstalledContractOutput,
  AuthInstallServiceInput,
  AuthInstallServiceOutput,
  AuthKickConnectionInput,
  AuthKickConnectionOutput,
  AuthListApprovalsInput,
  AuthListApprovalsOutput,
  AuthListConnectionsInput,
  AuthListConnectionsOutput,
  AuthListInstalledContractsInput,
  AuthListInstalledContractsOutput,
  AuthListServicesInput,
  AuthListServicesOutput,
  AuthListSessionsInput,
  AuthListSessionsOutput,
  AuthListUsersInput,
  AuthListUsersOutput,
  AuthLogoutInput,
  AuthLogoutOutput,
  AuthMeInput,
  AuthMeOutput,
  AuthRevokeApprovalInput,
  AuthRevokeApprovalOutput,
  AuthRevokeSessionInput,
  AuthRevokeSessionOutput,
  AuthUpdateUserInput,
  AuthUpdateUserOutput,
  AuthUpgradeServiceContractInput,
  AuthUpgradeServiceContractOutput,
} from "@qlever-llc/trellis/sdk/auth";
import { createAuthState, getTrellis as getTrellisContext } from "@qlever-llc/trellis-svelte";
import { trellisApp } from "../../contracts/trellis_app.ts";
import { APP_CONFIG } from "./config.ts";

type RequestOpts = { timeout?: number };
type AppTrellis = {
  request(method: string, input: unknown, opts?: RequestOpts): Promise<Result<unknown, BaseError>>;
  requestOrThrow(method: "Auth.Me", input: AuthMeInput, opts?: RequestOpts): Promise<AuthMeOutput>;
  requestOrThrow(method: "Auth.Logout", input: AuthLogoutInput, opts?: RequestOpts): Promise<AuthLogoutOutput>;
  requestOrThrow(method: "Auth.ListSessions", input: AuthListSessionsInput, opts?: RequestOpts): Promise<AuthListSessionsOutput>;
  requestOrThrow(method: "Auth.ListConnections", input: AuthListConnectionsInput, opts?: RequestOpts): Promise<AuthListConnectionsOutput>;
  requestOrThrow(method: "Auth.ListServices", input: AuthListServicesInput, opts?: RequestOpts): Promise<AuthListServicesOutput>;
  requestOrThrow(method: "Auth.ListApprovals", input: AuthListApprovalsInput, opts?: RequestOpts): Promise<AuthListApprovalsOutput>;
  requestOrThrow(method: "Auth.RevokeApproval", input: AuthRevokeApprovalInput, opts?: RequestOpts): Promise<AuthRevokeApprovalOutput>;
  requestOrThrow(method: "Auth.ListInstalledContracts", input: AuthListInstalledContractsInput, opts?: RequestOpts): Promise<AuthListInstalledContractsOutput>;
  requestOrThrow(method: "Auth.GetInstalledContract", input: AuthGetInstalledContractInput, opts?: RequestOpts): Promise<AuthGetInstalledContractOutput>;
  requestOrThrow(method: "Auth.ListUsers", input: AuthListUsersInput, opts?: RequestOpts): Promise<AuthListUsersOutput>;
  requestOrThrow(method: "Auth.UpdateUser", input: AuthUpdateUserInput, opts?: RequestOpts): Promise<AuthUpdateUserOutput>;
  requestOrThrow(method: "Auth.RevokeSession", input: AuthRevokeSessionInput, opts?: RequestOpts): Promise<AuthRevokeSessionOutput>;
  requestOrThrow(method: "Auth.KickConnection", input: AuthKickConnectionInput, opts?: RequestOpts): Promise<AuthKickConnectionOutput>;
  requestOrThrow(method: "Auth.UpgradeServiceContract", input: AuthUpgradeServiceContractInput, opts?: RequestOpts): Promise<AuthUpgradeServiceContractOutput>;
  requestOrThrow(method: "Auth.InstallService", input: AuthInstallServiceInput, opts?: RequestOpts): Promise<AuthInstallServiceOutput>;
};

export const auth = createAuthState({
  authUrl: APP_CONFIG.authUrl,
  contract: trellisApp,
  loginPath: "/login",
});

export function getTrellis() {
  return getTrellisContext<AppTrellis>();
}
