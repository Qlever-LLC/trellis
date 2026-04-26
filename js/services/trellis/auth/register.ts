import type { Hono } from "@hono/hono";
import type { trellis as trellisRuntime } from "../bootstrap/globals.ts";
import {
  createAuthGetInstalledContractHandler,
  createAuthListInstalledContractsHandler,
  type createContractsModule,
} from "../catalog/rpc.ts";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import {
  createAuthListApprovalsHandler,
  createAuthListUserGrantsHandler,
  createAuthRevokeApprovalHandler,
  createAuthRevokeUserGrantRpcHandler,
} from "./approval/rpc.ts";
import { kick } from "./callout/kick.ts";
import {
  authClearDevicePortalSelectionHandler,
  authClearLoginPortalSelectionHandler,
  authDecideDeviceActivationReviewHandler,
  authDisableDeviceInstanceHandler,
  authDisableDeviceProfileHandler,
  authDisableInstanceGrantPolicyHandler,
  authDisablePortalHandler,
  authDisablePortalProfileHandler,
  authEnableDeviceInstanceHandler,
  authEnableDeviceProfileHandler,
  authGetDevicePortalDefaultHandler,
  authGetLoginPortalDefaultHandler,
  authListDeviceActivationReviewsHandler,
  authListDeviceActivationsHandler,
  authListDeviceInstancesHandler,
  authListDevicePortalSelectionsHandler,
  authListDeviceProfilesHandler,
  authListInstanceGrantPoliciesHandler,
  authListLoginPortalSelectionsHandler,
  authListPortalProfilesHandler,
  authListPortalsHandler,
  authRemoveDeviceInstanceHandler,
  authRemoveDeviceProfileHandler,
  authRevokeDeviceActivationHandler,
  authSetDevicePortalDefaultHandler,
  authSetDevicePortalSelectionHandler,
  authSetLoginPortalDefaultHandler,
  authSetLoginPortalSelectionHandler,
  authUpsertInstanceGrantPolicyHandler,
  createAuthApplyDeviceProfileContractHandler,
  createAuthCreateDeviceProfileHandler,
  createAuthCreatePortalHandler,
  createAuthProvisionDeviceInstanceHandler,
  createAuthSetPortalProfileHandler,
  createAuthUnapplyDeviceProfileContractHandler,
} from "./admin/rpc.ts";
import {
  authListServiceInstancesHandler,
  authListServiceProfilesHandler,
  createAuthApplyServiceProfileContractHandler,
  createAuthCreateServiceProfileHandler,
  createAuthDisableServiceInstanceHandler,
  createAuthDisableServiceProfileHandler,
  createAuthEnableServiceInstanceHandler,
  createAuthEnableServiceProfileHandler,
  createAuthProvisionServiceInstanceHandler,
  createAuthRemoveServiceInstanceHandler,
  createAuthRemoveServiceProfileHandler,
  createAuthUnapplyServiceProfileContractHandler,
} from "./admin/service_rpc.ts";
import {
  createActivateDeviceHandler,
  createGetDeviceConnectInfoHandler,
} from "./device_activation/operation.ts";
import { registerBuiltinPortalStaticRoutes } from "./http/builtin_portal.ts";
import { registerHttpRoutes } from "./http/routes.ts";
import {
  authListConnectionsHandler,
  authListSessionsHandler,
  authLogoutHandler,
  authMeHandler,
  authRevokeSessionHandler,
  createAuthKickConnectionHandler,
  createAuthValidateRequestHandler,
} from "./session/rpc.ts";
import {
  createAuthListUsersHandler,
  createAuthUpdateUserHandler,
} from "./session/users.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlDeviceProfileRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalRepository,
  SqlServiceInstanceRepository,
  SqlServiceProfileRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "./storage.ts";

type TrellisRuntime = typeof trellisRuntime;
type ContractsModule = ReturnType<typeof createContractsModule>;

type AuthRegistrationDeps = {
  app: Hono;
  trellis: TrellisRuntime;
  contracts: ContractsModule;
  contractStorage: SqlContractStorageRepository;
  userStorage: SqlUserProjectionRepository;
  contractApprovalStorage: SqlContractApprovalRepository;
  portalStorage: SqlPortalRepository;
  portalDefaultStorage: SqlPortalDefaultRepository;
  loginPortalSelectionStorage: SqlLoginPortalSelectionRepository;
  devicePortalSelectionStorage: SqlDevicePortalSelectionRepository;
  deviceProfileStorage: SqlDeviceProfileRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  deviceActivationStorage: SqlDeviceActivationRepository;
  serviceProfileStorage: SqlServiceProfileRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  sessionStorage: SqlSessionRepository;
};

/**
 * Registers auth RPCs, operations, and HTTP routes.
 */
export async function registerAuth(deps: AuthRegistrationDeps): Promise<void> {
  await deps.trellis.mount(
    "Auth.ListInstalledContracts",
    createAuthListInstalledContractsHandler(deps.contractStorage),
  );
  await deps.trellis.mount(
    "Auth.GetInstalledContract",
    ({ input }) =>
      createAuthGetInstalledContractHandler(deps.contractStorage)(input),
  );

  await deps.trellis.mount(
    "Auth.CreateServiceProfile",
    createAuthCreateServiceProfileHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListServiceProfiles",
    authListServiceProfilesHandler,
  );
  await deps.trellis.mount(
    "Auth.ApplyServiceProfileContract",
    createAuthApplyServiceProfileContractHandler({
      installServiceContract: deps.contracts.installServiceContract,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.UnapplyServiceProfileContract",
    createAuthUnapplyServiceProfileContractHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.DisableServiceProfile",
    createAuthDisableServiceProfileHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceProfile",
    createAuthEnableServiceProfileHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceProfile",
    createAuthRemoveServiceProfileHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.ProvisionServiceInstance",
    createAuthProvisionServiceInstanceHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListServiceInstances",
    authListServiceInstancesHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableServiceInstance",
    createAuthDisableServiceInstanceHandler({ kick }),
  );
  await deps.trellis.mount(
    "Auth.EnableServiceInstance",
    createAuthEnableServiceInstanceHandler({ kick }),
  );
  await deps.trellis.mount(
    "Auth.RemoveServiceInstance",
    createAuthRemoveServiceInstanceHandler({
      kick,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );

  await deps.trellis.mount("Auth.Me", authMeHandler);
  await deps.trellis.mount(
    "Auth.ValidateRequest",
    createAuthValidateRequestHandler({
      sessionStorage: deps.sessionStorage,
      userStorage: deps.userStorage,
      contractApprovalStorage: deps.contractApprovalStorage,
    }),
  );
  await deps.trellis.mount("Auth.Logout", authLogoutHandler);
  await deps.trellis.mount("Auth.ListSessions", authListSessionsHandler);
  await deps.trellis.mount(
    "Auth.RevokeSession",
    ({ input, context }) => authRevokeSessionHandler(input, context),
  );
  await deps.trellis.mount("Auth.ListConnections", authListConnectionsHandler);
  await deps.trellis.mount(
    "Auth.KickConnection",
    createAuthKickConnectionHandler({ kick }),
  );

  await deps.trellis.mount(
    "Auth.ListApprovals",
    createAuthListApprovalsHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.ListUserGrants",
    createAuthListUserGrantsHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
    }),
  );
  await deps.trellis.mount(
    "Auth.RevokeApproval",
    createAuthRevokeApprovalHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
      kick,
    }),
  );
  await deps.trellis.mount(
    "Auth.RevokeUserGrant",
    createAuthRevokeUserGrantRpcHandler({
      contractApprovalStorage: deps.contractApprovalStorage,
      kick,
    }),
  );

  await deps.trellis.mount(
    "Auth.ListUsers",
    createAuthListUsersHandler(deps.userStorage),
  );
  await deps.trellis.mount(
    "Auth.UpdateUser",
    createAuthUpdateUserHandler(deps.userStorage),
  );
  await deps.trellis.mount(
    "Auth.CreatePortal",
    createAuthCreatePortalHandler(),
  );
  await deps.trellis.mount("Auth.ListPortals", authListPortalsHandler);
  await deps.trellis.mount("Auth.DisablePortal", authDisablePortalHandler);
  await deps.trellis.mount(
    "Auth.ListPortalProfiles",
    authListPortalProfilesHandler,
  );
  await deps.trellis.mount(
    "Auth.SetPortalProfile",
    createAuthSetPortalProfileHandler({
      contractStorage: deps.contractStorage,
      contractStore: deps.contracts.contractStore,
    }),
  );
  await deps.trellis.mount(
    "Auth.DisablePortalProfile",
    authDisablePortalProfileHandler,
  );
  await deps.trellis.mount(
    "Auth.GetLoginPortalDefault",
    authGetLoginPortalDefaultHandler,
  );
  await deps.trellis.mount(
    "Auth.ListInstanceGrantPolicies",
    authListInstanceGrantPoliciesHandler,
  );
  await deps.trellis.mount(
    "Auth.UpsertInstanceGrantPolicy",
    authUpsertInstanceGrantPolicyHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableInstanceGrantPolicy",
    authDisableInstanceGrantPolicyHandler,
  );
  await deps.trellis.mount(
    "Auth.SetLoginPortalDefault",
    authSetLoginPortalDefaultHandler,
  );
  await deps.trellis.mount(
    "Auth.ListLoginPortalSelections",
    authListLoginPortalSelectionsHandler,
  );
  await deps.trellis.mount(
    "Auth.SetLoginPortalSelection",
    authSetLoginPortalSelectionHandler,
  );
  await deps.trellis.mount(
    "Auth.ClearLoginPortalSelection",
    authClearLoginPortalSelectionHandler,
  );
  await deps.trellis.mount(
    "Auth.GetDevicePortalDefault",
    authGetDevicePortalDefaultHandler,
  );
  await deps.trellis.mount(
    "Auth.SetDevicePortalDefault",
    authSetDevicePortalDefaultHandler,
  );
  await deps.trellis.mount(
    "Auth.ListDevicePortalSelections",
    authListDevicePortalSelectionsHandler,
  );
  await deps.trellis.mount(
    "Auth.SetDevicePortalSelection",
    authSetDevicePortalSelectionHandler,
  );
  await deps.trellis.mount(
    "Auth.ClearDevicePortalSelection",
    authClearDevicePortalSelectionHandler,
  );
  await deps.trellis.mount(
    "Auth.CreateDeviceProfile",
    createAuthCreateDeviceProfileHandler({
      installDeviceContract: deps.contracts.installDeviceContract,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.ApplyDeviceProfileContract",
    createAuthApplyDeviceProfileContractHandler({
      installDeviceContract: deps.contracts.installDeviceContract,
    }),
  );
  await deps.trellis.mount(
    "Auth.UnapplyDeviceProfileContract",
    createAuthUnapplyDeviceProfileContractHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceProfiles",
    authListDeviceProfilesHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableDeviceProfile",
    authDisableDeviceProfileHandler,
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceProfile",
    authEnableDeviceProfileHandler,
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceProfile",
    authRemoveDeviceProfileHandler,
  );
  await deps.trellis.mount(
    "Auth.ProvisionDeviceInstance",
    createAuthProvisionDeviceInstanceHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceInstances",
    authListDeviceInstancesHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableDeviceInstance",
    authDisableDeviceInstanceHandler,
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceInstance",
    authEnableDeviceInstanceHandler,
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceInstance",
    authRemoveDeviceInstanceHandler,
  );
  await deps.trellis.mount(
    "Auth.ListDeviceActivations",
    authListDeviceActivationsHandler,
  );
  await deps.trellis.mount(
    "Auth.RevokeDeviceActivation",
    authRevokeDeviceActivationHandler,
  );
  await deps.trellis.operation("Auth.ActivateDevice").handle(
    createActivateDeviceHandler(),
  );
  await deps.trellis.mount(
    "Auth.GetDeviceConnectInfo",
    createGetDeviceConnectInfoHandler(),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceActivationReviews",
    authListDeviceActivationReviewsHandler,
  );
  await deps.trellis.mount(
    "Auth.DecideDeviceActivationReview",
    authDecideDeviceActivationReviewHandler,
  );

  registerBuiltinPortalStaticRoutes(deps.app);
  registerHttpRoutes(deps.app, {
    contractStorage: deps.contractStorage,
    userStorage: deps.userStorage,
    contractApprovalStorage: deps.contractApprovalStorage,
    portalStorage: deps.portalStorage,
    portalDefaultStorage: deps.portalDefaultStorage,
    loginPortalSelectionStorage: deps.loginPortalSelectionStorage,
    devicePortalSelectionStorage: deps.devicePortalSelectionStorage,
    deviceProfileStorage: deps.deviceProfileStorage,
    deviceInstanceStorage: deps.deviceInstanceStorage,
    deviceActivationStorage: deps.deviceActivationStorage,
    serviceProfileStorage: deps.serviceProfileStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    contractStore: deps.contracts.contractStore,
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
  });
}
