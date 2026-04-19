import { Hono } from "@hono/hono";
import { initTracing } from "@qlever-llc/trellis/tracing";
import {
  authListApprovalsHandler,
  createAuthRevokeApprovalHandler,
} from "./auth/approval/rpc.ts";
import { kick } from "./auth/callout/kick.ts";
import { registerHttpRoutes } from "./auth/http/routes.ts";
import { registerBuiltinPortalStaticRoutes } from "./auth/http/builtin_portal.ts";
import {
  authListConnectionsHandler,
  authListSessionsHandler,
  authLogoutHandler,
  authMeHandler,
  authValidateRequestHandler,
  createAuthKickConnectionHandler,
  createAuthRevokeSessionHandler,
} from "./auth/session/rpc.ts";
import {
  createActivateDeviceHandler,
  createGetDeviceActivationStatusHandler,
  createGetDeviceConnectInfoHandler,
} from "./auth/device_activation/operation.ts";
import {
  authEnableDeviceInstanceHandler,
  authEnableDeviceProfileHandler,
  authDisablePortalHandler,
  authDisableInstanceGrantPolicyHandler,
  authClearLoginPortalSelectionHandler,
  authClearDevicePortalSelectionHandler,
  createAuthApplyDeviceProfileContractHandler,
  authDecideDeviceActivationReviewHandler,
  authDisableDeviceInstanceHandler,
  authDisableDeviceProfileHandler,
  authGetLoginPortalDefaultHandler,
  authGetDevicePortalDefaultHandler,
  authRemoveDeviceInstanceHandler,
  authRemoveDeviceProfileHandler,
  authListInstanceGrantPoliciesHandler,
  authListLoginPortalSelectionsHandler,
  authListPortalsHandler,
  authListDeviceActivationReviewsHandler,
  authListDevicePortalSelectionsHandler,
  authListDeviceActivationsHandler,
  authListDeviceInstancesHandler,
  authListDeviceProfilesHandler,
  authRevokeDeviceActivationHandler,
  createAuthCreatePortalHandler,
  createAuthCreateDeviceProfileHandler,
  createAuthProvisionDeviceInstanceHandler,
  createAuthUnapplyDeviceProfileContractHandler,
  authSetLoginPortalDefaultHandler,
  authUpsertInstanceGrantPolicyHandler,
  authSetLoginPortalSelectionHandler,
  authSetDevicePortalDefaultHandler,
  authSetDevicePortalSelectionHandler,
} from "./auth/admin/rpc.ts";
import {
  authEnableServiceProfileHandler,
  authListServiceInstancesHandler,
  authListServiceProfilesHandler,
  authRemoveServiceProfileHandler,
  createAuthApplyServiceProfileContractHandler,
  createAuthCreateServiceProfileHandler,
  createAuthDisableServiceInstanceHandler,
  createAuthDisableServiceProfileHandler,
  createAuthEnableServiceInstanceHandler,
  createAuthProvisionServiceInstanceHandler,
  createAuthRemoveServiceInstanceHandler,
  createAuthUnapplyServiceProfileContractHandler,
} from "./auth/admin/service_rpc.ts";
import {
  authListUsersHandler,
  authUpdateUserHandler,
} from "./auth/session/users.ts";
import {
  resolveBuiltinContracts,
  startControlPlaneBackgroundTasks,
} from "./bootstrap/control_plane.ts";
import { logger, shutdownGlobals, trellis } from "./bootstrap/globals.ts";
import { sessionKV, stateKV } from "./bootstrap/globals.ts";
import {
  authGetInstalledContractHandler,
  authListInstalledContractsHandler,
  createContractsModule,
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
  trellisBindingsGetHandler,
} from "./catalog/rpc.ts";
import { getConfig } from "./config.ts";
import { createStateHandlers } from "./state/rpc.ts";
import { createStateKvAdapter, StateStore } from "./state/storage.ts";

initTracing("trellis");

const config = getConfig();
const app = new Hono();

const contracts = createContractsModule({
  builtinContracts: await resolveBuiltinContracts(),
});

const stateHandlers = createStateHandlers({
  sessionKV,
  state: new StateStore({ kv: createStateKvAdapter(stateKV) }),
});

await contracts.refreshActiveContracts();

await trellis.mount(
  "Trellis.Catalog",
  createTrellisCatalogHandler(contracts.contractStore),
);
await trellis.mount(
  "Trellis.Contract.Get",
  createTrellisContractGetHandler(contracts.contractStore),
);
await trellis.mount("Trellis.Bindings.Get", trellisBindingsGetHandler);
await trellis.mount("State.Get", stateHandlers.get);
await trellis.mount("State.Put", stateHandlers.put);
await trellis.mount("State.Delete", stateHandlers.delete);
await trellis.mount("State.CompareAndSet", stateHandlers.compareAndSet);
await trellis.mount("State.List", stateHandlers.list);
await trellis.mount("State.Admin.Get", stateHandlers.adminGet);
await trellis.mount("State.Admin.List", stateHandlers.adminList);
await trellis.mount("State.Admin.Delete", stateHandlers.adminDelete);
await trellis.mount(
  "Auth.ListInstalledContracts",
  authListInstalledContractsHandler,
);
await trellis.mount(
  "Auth.GetInstalledContract",
  authGetInstalledContractHandler,
);

await trellis.mount(
  "Auth.CreateServiceProfile",
  createAuthCreateServiceProfileHandler(),
);
await trellis.mount(
  "Auth.ListServiceProfiles",
  authListServiceProfilesHandler,
);
await trellis.mount(
  "Auth.ApplyServiceProfileContract",
  createAuthApplyServiceProfileContractHandler({
    installServiceContract: contracts.installServiceContract,
  }),
);
await trellis.mount(
  "Auth.UnapplyServiceProfileContract",
  createAuthUnapplyServiceProfileContractHandler({ kick }),
);
await trellis.mount(
  "Auth.DisableServiceProfile",
  createAuthDisableServiceProfileHandler({ kick }),
);
await trellis.mount(
  "Auth.EnableServiceProfile",
  authEnableServiceProfileHandler,
);
await trellis.mount(
  "Auth.RemoveServiceProfile",
  authRemoveServiceProfileHandler,
);
await trellis.mount(
  "Auth.ProvisionServiceInstance",
  createAuthProvisionServiceInstanceHandler(),
);
await trellis.mount(
  "Auth.ListServiceInstances",
  authListServiceInstancesHandler,
);
await trellis.mount(
  "Auth.DisableServiceInstance",
  createAuthDisableServiceInstanceHandler({ kick }),
);
await trellis.mount(
  "Auth.EnableServiceInstance",
  createAuthEnableServiceInstanceHandler({ kick }),
);
await trellis.mount(
  "Auth.RemoveServiceInstance",
  createAuthRemoveServiceInstanceHandler({
    kick,
    refreshActiveContracts: contracts.refreshActiveContracts,
  }),
);

await trellis.mount("Auth.Me", authMeHandler);
await trellis.mount("Auth.ValidateRequest", authValidateRequestHandler);
await trellis.mount("Auth.Logout", authLogoutHandler);
await trellis.mount("Auth.ListSessions", authListSessionsHandler);
await trellis.mount(
  "Auth.RevokeSession",
  createAuthRevokeSessionHandler({ kick }),
);
await trellis.mount("Auth.ListConnections", authListConnectionsHandler);
await trellis.mount(
  "Auth.KickConnection",
  createAuthKickConnectionHandler({ kick }),
);

await trellis.mount("Auth.ListApprovals", authListApprovalsHandler);
await trellis.mount(
  "Auth.RevokeApproval",
  createAuthRevokeApprovalHandler({ kick }),
);

await trellis.mount("Auth.ListUsers", authListUsersHandler);
await trellis.mount("Auth.UpdateUser", authUpdateUserHandler);
await trellis.mount("Auth.CreatePortal", createAuthCreatePortalHandler());
await trellis.mount("Auth.ListPortals", authListPortalsHandler);
await trellis.mount("Auth.DisablePortal", authDisablePortalHandler);
await trellis.mount("Auth.GetLoginPortalDefault", authGetLoginPortalDefaultHandler);
await trellis.mount(
  "Auth.ListInstanceGrantPolicies",
  authListInstanceGrantPoliciesHandler,
);
await trellis.mount(
  "Auth.UpsertInstanceGrantPolicy",
  authUpsertInstanceGrantPolicyHandler,
);
await trellis.mount(
  "Auth.DisableInstanceGrantPolicy",
  authDisableInstanceGrantPolicyHandler,
);
await trellis.mount("Auth.SetLoginPortalDefault", authSetLoginPortalDefaultHandler);
await trellis.mount("Auth.ListLoginPortalSelections", authListLoginPortalSelectionsHandler);
await trellis.mount("Auth.SetLoginPortalSelection", authSetLoginPortalSelectionHandler);
await trellis.mount("Auth.ClearLoginPortalSelection", authClearLoginPortalSelectionHandler);
await trellis.mount("Auth.GetDevicePortalDefault", authGetDevicePortalDefaultHandler);
await trellis.mount("Auth.SetDevicePortalDefault", authSetDevicePortalDefaultHandler);
await trellis.mount("Auth.ListDevicePortalSelections", authListDevicePortalSelectionsHandler);
await trellis.mount("Auth.SetDevicePortalSelection", authSetDevicePortalSelectionHandler);
await trellis.mount("Auth.ClearDevicePortalSelection", authClearDevicePortalSelectionHandler);
await trellis.mount(
  "Auth.CreateDeviceProfile",
  createAuthCreateDeviceProfileHandler({
    installDeviceContract: contracts.installDeviceContract,
    refreshActiveContracts: contracts.refreshActiveContracts,
  }),
);
await trellis.mount(
  "Auth.ApplyDeviceProfileContract",
  createAuthApplyDeviceProfileContractHandler({
    installDeviceContract: contracts.installDeviceContract,
  }),
);
await trellis.mount(
  "Auth.UnapplyDeviceProfileContract",
  createAuthUnapplyDeviceProfileContractHandler(),
);
await trellis.mount(
  "Auth.ListDeviceProfiles",
  authListDeviceProfilesHandler,
);
await trellis.mount(
  "Auth.DisableDeviceProfile",
  authDisableDeviceProfileHandler,
);
await trellis.mount(
  "Auth.EnableDeviceProfile",
  authEnableDeviceProfileHandler,
);
await trellis.mount(
  "Auth.RemoveDeviceProfile",
  authRemoveDeviceProfileHandler,
);
await trellis.mount(
  "Auth.ProvisionDeviceInstance",
  createAuthProvisionDeviceInstanceHandler(),
);
await trellis.mount(
  "Auth.ListDeviceInstances",
  authListDeviceInstancesHandler,
);
await trellis.mount(
  "Auth.DisableDeviceInstance",
  authDisableDeviceInstanceHandler,
);
await trellis.mount(
  "Auth.EnableDeviceInstance",
  authEnableDeviceInstanceHandler,
);
await trellis.mount(
  "Auth.RemoveDeviceInstance",
  authRemoveDeviceInstanceHandler,
);
await trellis.mount(
  "Auth.ListDeviceActivations",
  authListDeviceActivationsHandler,
);
await trellis.mount(
  "Auth.RevokeDeviceActivation",
  authRevokeDeviceActivationHandler,
);
await trellis.mount("Auth.ActivateDevice", createActivateDeviceHandler());
await trellis.mount(
  "Auth.GetDeviceActivationStatus",
  createGetDeviceActivationStatusHandler(),
);
await trellis.mount(
  "Auth.GetDeviceConnectInfo",
  createGetDeviceConnectInfoHandler(),
);
await trellis.mount(
  "Auth.ListDeviceActivationReviews",
  authListDeviceActivationReviewsHandler,
);
await trellis.mount(
  "Auth.DecideDeviceActivationReview",
  authDecideDeviceActivationReviewHandler,
);

registerBuiltinPortalStaticRoutes(app);
registerHttpRoutes(app, {
  contractStore: contracts.contractStore,
  refreshActiveContracts: contracts.refreshActiveContracts,
});

const backgroundTasks = startControlPlaneBackgroundTasks({
  contractStore: contracts.contractStore,
});

const serverAbort = new AbortController();
const server = Deno.serve(
  {
    port: config.port,
    signal: serverAbort.signal,
  },
  app.fetch,
);

let shuttingDown: Promise<void> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return shuttingDown;
  }

  shuttingDown = (async () => {
    logger.info({ signal }, "Shutting down Trellis service");
    serverAbort.abort();
    await backgroundTasks.stop();
    await shutdownGlobals();
    await server.finished;
    logger.info({ signal }, "Trellis service stopped");
  })();

  return shuttingDown;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    void shutdown(signal).catch((error) => {
      logger.error({ error, signal }, "Failed during Trellis shutdown");
    });
  });
}
