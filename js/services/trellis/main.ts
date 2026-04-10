import { Hono } from "@hono/hono";
import { initTracing } from "@qlever-llc/trellis/tracing";
import {
  authListApprovalsHandler,
  createAuthRevokeApprovalHandler,
} from "./auth/approval/rpc.ts";
import { kick } from "./auth/callout/kick.ts";
import { hashKey, randomToken } from "./auth/crypto.ts";
import { registerHttpRoutes } from "./auth/http/routes.ts";
import { registerBuiltinPortalStaticRoutes } from "./auth/http/builtin_portal.ts";
import {
  authListConnectionsHandler,
  authListSessionsHandler,
  authLogoutHandler,
  authMeHandler,
  authValidateRequestHandler,
  createAuthKickConnectionHandler,
  createAuthRenewBindingTokenHandler,
  createAuthRevokeSessionHandler,
} from "./auth/session/rpc.ts";
import {
  createActivateWorkloadHandler,
  createGetWorkloadActivationStatusHandler,
  createGetWorkloadConnectInfoHandler,
} from "./auth/workload_activation/operation.ts";
import {
  authDisablePortalHandler,
  authClearLoginPortalSelectionHandler,
  authClearWorkloadPortalSelectionHandler,
  authDecideWorkloadActivationReviewHandler,
  authDisableWorkloadInstanceHandler,
  authDisableWorkloadProfileHandler,
  authGetLoginPortalDefaultHandler,
  authGetWorkloadPortalDefaultHandler,
  authListLoginPortalSelectionsHandler,
  authListPortalsHandler,
  authListWorkloadActivationReviewsHandler,
  authListWorkloadPortalSelectionsHandler,
  authListWorkloadActivationsHandler,
  authListWorkloadInstancesHandler,
  authListWorkloadProfilesHandler,
  authRevokeWorkloadActivationHandler,
  createAuthCreatePortalHandler,
  createAuthCreateWorkloadProfileHandler,
  createAuthProvisionWorkloadInstanceHandler,
  authSetLoginPortalDefaultHandler,
  authSetLoginPortalSelectionHandler,
  authSetWorkloadPortalDefaultHandler,
  authSetWorkloadPortalSelectionHandler,
} from "./auth/admin/rpc.ts";
import {
  authListUsersHandler,
  authUpdateUserHandler,
} from "./auth/session/users.ts";
import {
  resolveBuiltinContracts,
  startControlPlaneBackgroundTasks,
} from "./bootstrap/control_plane.ts";
import { logger, shutdownGlobals, trellis } from "./bootstrap/globals.ts";
import {
  authGetInstalledContractHandler,
  authListInstalledContractsHandler,
  createContractsModule,
  createTrellisCatalogHandler,
  createTrellisContractGetHandler,
  trellisBindingsGetHandler,
} from "./catalog/rpc.ts";
import {
  authListServicesHandler,
  createAuthInstallServiceHandler,
  createAuthUpgradeServiceContractHandler,
} from "./catalog/services.ts";
import { getConfig } from "./config.ts";

initTracing("trellis");

const config = getConfig();
const app = new Hono();

const contracts = createContractsModule({
  builtinContracts: await resolveBuiltinContracts(),
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
await trellis.mount(
  "Auth.ListInstalledContracts",
  authListInstalledContractsHandler,
);
await trellis.mount(
  "Auth.GetInstalledContract",
  authGetInstalledContractHandler,
);

await trellis.mount("Auth.ListServices", authListServicesHandler);
await trellis.mount(
  "Auth.InstallService",
  createAuthInstallServiceHandler({
    refreshActiveContracts: contracts.refreshActiveContracts,
    prepareInstalledContract: contracts.prepareInstalledContract,
  }),
);
await trellis.mount(
  "Auth.UpgradeServiceContract",
  createAuthUpgradeServiceContractHandler({
    refreshActiveContracts: contracts.refreshActiveContracts,
    prepareInstalledContract: contracts.prepareInstalledContract,
  }),
);

await trellis.mount("Auth.Me", authMeHandler);
await trellis.mount("Auth.ValidateRequest", authValidateRequestHandler);
await trellis.mount("Auth.Logout", authLogoutHandler);
await trellis.mount(
  "Auth.RenewBindingToken",
  createAuthRenewBindingTokenHandler({ randomToken, hashKey }),
);
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
await trellis.mount("Auth.SetLoginPortalDefault", authSetLoginPortalDefaultHandler);
await trellis.mount("Auth.ListLoginPortalSelections", authListLoginPortalSelectionsHandler);
await trellis.mount("Auth.SetLoginPortalSelection", authSetLoginPortalSelectionHandler);
await trellis.mount("Auth.ClearLoginPortalSelection", authClearLoginPortalSelectionHandler);
await trellis.mount("Auth.GetWorkloadPortalDefault", authGetWorkloadPortalDefaultHandler);
await trellis.mount("Auth.SetWorkloadPortalDefault", authSetWorkloadPortalDefaultHandler);
await trellis.mount("Auth.ListWorkloadPortalSelections", authListWorkloadPortalSelectionsHandler);
await trellis.mount("Auth.SetWorkloadPortalSelection", authSetWorkloadPortalSelectionHandler);
await trellis.mount("Auth.ClearWorkloadPortalSelection", authClearWorkloadPortalSelectionHandler);
await trellis.mount(
  "Auth.CreateWorkloadProfile",
  createAuthCreateWorkloadProfileHandler({
    installWorkloadContract: contracts.installWorkloadContract,
    refreshActiveContracts: contracts.refreshActiveContracts,
  }),
);
await trellis.mount(
  "Auth.ListWorkloadProfiles",
  authListWorkloadProfilesHandler,
);
await trellis.mount(
  "Auth.DisableWorkloadProfile",
  authDisableWorkloadProfileHandler,
);
await trellis.mount(
  "Auth.ProvisionWorkloadInstance",
  createAuthProvisionWorkloadInstanceHandler(),
);
await trellis.mount(
  "Auth.ListWorkloadInstances",
  authListWorkloadInstancesHandler,
);
await trellis.mount(
  "Auth.DisableWorkloadInstance",
  authDisableWorkloadInstanceHandler,
);
await trellis.mount(
  "Auth.ListWorkloadActivations",
  authListWorkloadActivationsHandler,
);
await trellis.mount(
  "Auth.RevokeWorkloadActivation",
  authRevokeWorkloadActivationHandler,
);
await trellis.mount("Auth.ActivateWorkload", createActivateWorkloadHandler());
await trellis.mount(
  "Auth.GetWorkloadActivationStatus",
  createGetWorkloadActivationStatusHandler(),
);
await trellis.mount(
  "Auth.GetWorkloadConnectInfo",
  createGetWorkloadConnectInfoHandler(),
);
await trellis.mount(
  "Auth.ListWorkloadActivationReviews",
  authListWorkloadActivationReviewsHandler,
);
await trellis.mount(
  "Auth.DecideWorkloadActivationReview",
  authDecideWorkloadActivationReviewHandler,
);

registerBuiltinPortalStaticRoutes(app);
registerHttpRoutes(app, { contractStore: contracts.contractStore });

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
