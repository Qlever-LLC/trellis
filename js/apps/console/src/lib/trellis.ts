import type { BaseError, Result } from "@qlever-llc/result";
import type {
  AuthClearDevicePortalSelectionInput,
  AuthClearDevicePortalSelectionOutput,
  AuthClearLoginPortalSelectionInput,
  AuthClearLoginPortalSelectionOutput,
  AuthCreateDeviceProfileInput,
  AuthCreateDeviceProfileOutput,
  AuthCreatePortalInput,
  AuthCreatePortalOutput,
  AuthDecideDeviceActivationReviewInput,
  AuthDecideDeviceActivationReviewOutput,
  AuthDisableDeviceInstanceInput,
  AuthDisableDeviceInstanceOutput,
  AuthDisableInstanceGrantPolicyInput,
  AuthDisableInstanceGrantPolicyOutput,
  AuthDisableDeviceProfileInput,
  AuthDisableDeviceProfileOutput,
  AuthDisablePortalInput,
  AuthDisablePortalOutput,
  AuthGetDevicePortalDefaultInput,
  AuthGetDevicePortalDefaultOutput,
  AuthGetInstalledContractInput,
  AuthGetInstalledContractOutput,
  AuthGetLoginPortalDefaultInput,
  AuthGetLoginPortalDefaultOutput,
  AuthInstallServiceInput,
  AuthInstallServiceOutput,
  AuthKickConnectionInput,
  AuthKickConnectionOutput,
  AuthListApprovalsInput,
  AuthListApprovalsOutput,
  AuthListConnectionsInput,
  AuthListConnectionsOutput,
  AuthListDeviceActivationReviewsInput,
  AuthListDeviceActivationReviewsOutput,
  AuthListDeviceActivationsInput,
  AuthListDeviceActivationsOutput,
  AuthListDeviceInstancesInput,
  AuthListDeviceInstancesOutput,
  AuthListInstanceGrantPoliciesInput,
  AuthListInstanceGrantPoliciesOutput,
  AuthListDevicePortalSelectionsInput,
  AuthListDevicePortalSelectionsOutput,
  AuthListDeviceProfilesInput,
  AuthListDeviceProfilesOutput,
  AuthListInstalledContractsInput,
  AuthListInstalledContractsOutput,
  AuthListLoginPortalSelectionsInput,
  AuthListLoginPortalSelectionsOutput,
  AuthListPortalsInput,
  AuthListPortalsOutput,
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
  AuthProvisionDeviceInstanceInput,
  AuthProvisionDeviceInstanceOutput,
  AuthRevokeApprovalInput,
  AuthRevokeApprovalOutput,
  AuthRevokeDeviceActivationInput,
  AuthRevokeDeviceActivationOutput,
  AuthRevokeSessionInput,
  AuthRevokeSessionOutput,
  AuthSetDevicePortalDefaultInput,
  AuthSetDevicePortalDefaultOutput,
  AuthSetDevicePortalSelectionInput,
  AuthSetDevicePortalSelectionOutput,
  AuthUpsertInstanceGrantPolicyInput,
  AuthUpsertInstanceGrantPolicyOutput,
  AuthSetLoginPortalDefaultInput,
  AuthSetLoginPortalDefaultOutput,
  AuthSetLoginPortalSelectionInput,
  AuthSetLoginPortalSelectionOutput,
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
  requestOrThrow(method: "Auth.ClearDevicePortalSelection", input: AuthClearDevicePortalSelectionInput, opts?: RequestOpts): Promise<AuthClearDevicePortalSelectionOutput>;
  requestOrThrow(method: "Auth.ClearLoginPortalSelection", input: AuthClearLoginPortalSelectionInput, opts?: RequestOpts): Promise<AuthClearLoginPortalSelectionOutput>;
  requestOrThrow(method: "Auth.CreateDeviceProfile", input: AuthCreateDeviceProfileInput, opts?: RequestOpts): Promise<AuthCreateDeviceProfileOutput>;
  requestOrThrow(method: "Auth.CreatePortal", input: AuthCreatePortalInput, opts?: RequestOpts): Promise<AuthCreatePortalOutput>;
  requestOrThrow(method: "Auth.DecideDeviceActivationReview", input: AuthDecideDeviceActivationReviewInput, opts?: RequestOpts): Promise<AuthDecideDeviceActivationReviewOutput>;
  requestOrThrow(method: "Auth.DisableDeviceInstance", input: AuthDisableDeviceInstanceInput, opts?: RequestOpts): Promise<AuthDisableDeviceInstanceOutput>;
  requestOrThrow(method: "Auth.DisableInstanceGrantPolicy", input: AuthDisableInstanceGrantPolicyInput, opts?: RequestOpts): Promise<AuthDisableInstanceGrantPolicyOutput>;
  requestOrThrow(method: "Auth.DisableDeviceProfile", input: AuthDisableDeviceProfileInput, opts?: RequestOpts): Promise<AuthDisableDeviceProfileOutput>;
  requestOrThrow(method: "Auth.DisablePortal", input: AuthDisablePortalInput, opts?: RequestOpts): Promise<AuthDisablePortalOutput>;
  requestOrThrow(method: "Auth.GetDevicePortalDefault", input: AuthGetDevicePortalDefaultInput, opts?: RequestOpts): Promise<AuthGetDevicePortalDefaultOutput>;
  requestOrThrow(method: "Auth.Me", input: AuthMeInput, opts?: RequestOpts): Promise<AuthMeOutput>;
  requestOrThrow(method: "Auth.GetLoginPortalDefault", input: AuthGetLoginPortalDefaultInput, opts?: RequestOpts): Promise<AuthGetLoginPortalDefaultOutput>;
  requestOrThrow(method: "Auth.Logout", input: AuthLogoutInput, opts?: RequestOpts): Promise<AuthLogoutOutput>;
  requestOrThrow(method: "Auth.ListSessions", input: AuthListSessionsInput, opts?: RequestOpts): Promise<AuthListSessionsOutput>;
  requestOrThrow(method: "Auth.ListConnections", input: AuthListConnectionsInput, opts?: RequestOpts): Promise<AuthListConnectionsOutput>;
  requestOrThrow(method: "Auth.ListDeviceActivationReviews", input: AuthListDeviceActivationReviewsInput, opts?: RequestOpts): Promise<AuthListDeviceActivationReviewsOutput>;
  requestOrThrow(method: "Auth.ListDeviceActivations", input: AuthListDeviceActivationsInput, opts?: RequestOpts): Promise<AuthListDeviceActivationsOutput>;
  requestOrThrow(method: "Auth.ListDeviceInstances", input: AuthListDeviceInstancesInput, opts?: RequestOpts): Promise<AuthListDeviceInstancesOutput>;
  requestOrThrow(method: "Auth.ListInstanceGrantPolicies", input: AuthListInstanceGrantPoliciesInput, opts?: RequestOpts): Promise<AuthListInstanceGrantPoliciesOutput>;
  requestOrThrow(method: "Auth.ListDevicePortalSelections", input: AuthListDevicePortalSelectionsInput, opts?: RequestOpts): Promise<AuthListDevicePortalSelectionsOutput>;
  requestOrThrow(method: "Auth.ListDeviceProfiles", input: AuthListDeviceProfilesInput, opts?: RequestOpts): Promise<AuthListDeviceProfilesOutput>;
  requestOrThrow(method: "Auth.ListServices", input: AuthListServicesInput, opts?: RequestOpts): Promise<AuthListServicesOutput>;
  requestOrThrow(method: "Auth.ListApprovals", input: AuthListApprovalsInput, opts?: RequestOpts): Promise<AuthListApprovalsOutput>;
  requestOrThrow(method: "Auth.ListLoginPortalSelections", input: AuthListLoginPortalSelectionsInput, opts?: RequestOpts): Promise<AuthListLoginPortalSelectionsOutput>;
  requestOrThrow(method: "Auth.RevokeApproval", input: AuthRevokeApprovalInput, opts?: RequestOpts): Promise<AuthRevokeApprovalOutput>;
  requestOrThrow(method: "Auth.ListPortals", input: AuthListPortalsInput, opts?: RequestOpts): Promise<AuthListPortalsOutput>;
  requestOrThrow(method: "Auth.ListInstalledContracts", input: AuthListInstalledContractsInput, opts?: RequestOpts): Promise<AuthListInstalledContractsOutput>;
  requestOrThrow(method: "Auth.GetInstalledContract", input: AuthGetInstalledContractInput, opts?: RequestOpts): Promise<AuthGetInstalledContractOutput>;
  requestOrThrow(method: "Auth.ListUsers", input: AuthListUsersInput, opts?: RequestOpts): Promise<AuthListUsersOutput>;
  requestOrThrow(method: "Auth.ProvisionDeviceInstance", input: AuthProvisionDeviceInstanceInput, opts?: RequestOpts): Promise<AuthProvisionDeviceInstanceOutput>;
  requestOrThrow(method: "Auth.UpdateUser", input: AuthUpdateUserInput, opts?: RequestOpts): Promise<AuthUpdateUserOutput>;
  requestOrThrow(method: "Auth.RevokeDeviceActivation", input: AuthRevokeDeviceActivationInput, opts?: RequestOpts): Promise<AuthRevokeDeviceActivationOutput>;
  requestOrThrow(method: "Auth.RevokeSession", input: AuthRevokeSessionInput, opts?: RequestOpts): Promise<AuthRevokeSessionOutput>;
  requestOrThrow(method: "Auth.KickConnection", input: AuthKickConnectionInput, opts?: RequestOpts): Promise<AuthKickConnectionOutput>;
  requestOrThrow(method: "Auth.SetDevicePortalDefault", input: AuthSetDevicePortalDefaultInput, opts?: RequestOpts): Promise<AuthSetDevicePortalDefaultOutput>;
  requestOrThrow(method: "Auth.SetDevicePortalSelection", input: AuthSetDevicePortalSelectionInput, opts?: RequestOpts): Promise<AuthSetDevicePortalSelectionOutput>;
  requestOrThrow(method: "Auth.UpsertInstanceGrantPolicy", input: AuthUpsertInstanceGrantPolicyInput, opts?: RequestOpts): Promise<AuthUpsertInstanceGrantPolicyOutput>;
  requestOrThrow(method: "Auth.SetLoginPortalDefault", input: AuthSetLoginPortalDefaultInput, opts?: RequestOpts): Promise<AuthSetLoginPortalDefaultOutput>;
  requestOrThrow(method: "Auth.SetLoginPortalSelection", input: AuthSetLoginPortalSelectionInput, opts?: RequestOpts): Promise<AuthSetLoginPortalSelectionOutput>;
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
