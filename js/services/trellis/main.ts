import { Hono } from "@hono/hono";
import { initTracing } from "@qlever-llc/trellis/tracing";
import {
  authListApprovalsHandler,
  authListUserGrantsHandler,
  authRevokeUserGrantHandler,
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
  authRevokeSessionHandler,
  authValidateRequestHandler,
  createAuthKickConnectionHandler,
} from "./auth/session/rpc.ts";
import {
  createActivateDeviceHandler,
  createGetDeviceConnectInfoHandler,
} from "./auth/device_activation/operation.ts";
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
  contractStore: contracts.contractStore,
});

await contracts.refreshActiveContracts();

await trellis.mount(
  "Trellis.Catalog",
  createTrellisCatalogHandler(contracts.contractStore),
);
await trellis.mount(
  "Trellis.Contract.Get",
  ({ input }) =>
    createTrellisContractGetHandler(contracts.contractStore)(input),
);
await trellis.mount(
  "Trellis.Bindings.Get",
  ({ input, context }) => trellisBindingsGetHandler(input, context),
);
await trellis.mount(
  "State.Get",
  ({ input, context }) => stateHandlers.get(input, context),
);
await trellis.mount(
  "State.Put",
  ({ input, context }) => stateHandlers.put(input, context),
);
await trellis.mount(
  "State.Delete",
  ({ input, context }) => stateHandlers.delete(input, context),
);
await trellis.mount(
  "State.List",
  ({ input, context }) => stateHandlers.list(input, context),
);
await trellis.mount(
  "State.Admin.Get",
  ({ input, context }) => stateHandlers.adminGet(input, context),
);
await trellis.mount(
  "State.Admin.List",
  ({ input, context }) => stateHandlers.adminList(input, context),
);
await trellis.mount(
  "State.Admin.Delete",
  ({ input, context }) => stateHandlers.adminDelete(input, context),
);
await trellis.mount(
  "Auth.ListInstalledContracts",
  authListInstalledContractsHandler,
);
await trellis.mount(
  "Auth.GetInstalledContract",
  ({ input }) => authGetInstalledContractHandler(input),
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
  ({ input, context }) => authRevokeSessionHandler(input, context),
);
await trellis.mount("Auth.ListConnections", authListConnectionsHandler);
await trellis.mount(
  "Auth.KickConnection",
  createAuthKickConnectionHandler({ kick }),
);

await trellis.mount("Auth.ListApprovals", authListApprovalsHandler);
await trellis.mount("Auth.ListUserGrants", authListUserGrantsHandler);
await trellis.mount(
  "Auth.RevokeApproval",
  createAuthRevokeApprovalHandler({ kick }),
);
await trellis.mount("Auth.RevokeUserGrant", authRevokeUserGrantHandler);

await trellis.mount("Auth.ListUsers", authListUsersHandler);
await trellis.mount("Auth.UpdateUser", authUpdateUserHandler);
await trellis.mount("Auth.CreatePortal", createAuthCreatePortalHandler());
await trellis.mount("Auth.ListPortals", authListPortalsHandler);
await trellis.mount("Auth.DisablePortal", authDisablePortalHandler);
await trellis.mount("Auth.ListPortalProfiles", authListPortalProfilesHandler);
await trellis.mount(
  "Auth.SetPortalProfile",
  createAuthSetPortalProfileHandler({ contractStore: contracts.contractStore }),
);
await trellis.mount(
  "Auth.DisablePortalProfile",
  authDisablePortalProfileHandler,
);
await trellis.mount(
  "Auth.GetLoginPortalDefault",
  authGetLoginPortalDefaultHandler,
);
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
await trellis.mount(
  "Auth.SetLoginPortalDefault",
  authSetLoginPortalDefaultHandler,
);
await trellis.mount(
  "Auth.ListLoginPortalSelections",
  authListLoginPortalSelectionsHandler,
);
await trellis.mount(
  "Auth.SetLoginPortalSelection",
  authSetLoginPortalSelectionHandler,
);
await trellis.mount(
  "Auth.ClearLoginPortalSelection",
  authClearLoginPortalSelectionHandler,
);
await trellis.mount(
  "Auth.GetDevicePortalDefault",
  authGetDevicePortalDefaultHandler,
);
await trellis.mount(
  "Auth.SetDevicePortalDefault",
  authSetDevicePortalDefaultHandler,
);
await trellis.mount(
  "Auth.ListDevicePortalSelections",
  authListDevicePortalSelectionsHandler,
);
await trellis.mount(
  "Auth.SetDevicePortalSelection",
  authSetDevicePortalSelectionHandler,
);
await trellis.mount(
  "Auth.ClearDevicePortalSelection",
  authClearDevicePortalSelectionHandler,
);
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
await trellis.operation("Auth.ActivateDevice").handle(
  createActivateDeviceHandler(),
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

const SERVER_DRAIN_TIMEOUT_MS = 5_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 10_000;

async function waitForServerDrain(): Promise<void> {
  let timeoutId: number | undefined;

  try {
    await Promise.race([
      server.finished,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, SERVER_DRAIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

let shuttingDown: Promise<void> | null = null;

function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return shuttingDown;
  }

  shuttingDown = (async () => {
    logger.info({ signal }, "Shutting down Trellis service");
    serverAbort.abort();
    await backgroundTasks.stop();
    await shutdownGlobals();
    await waitForServerDrain();
    logger.info({ signal }, "Trellis service stopped");
  })();

  return shuttingDown;
}

async function shutdownForSignal(signal: string): Promise<void> {
  let timeoutId: number | undefined;

  try {
    await Promise.race([
      shutdown(signal),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new Error(
                `Trellis shutdown timed out after ${PROCESS_SHUTDOWN_TIMEOUT_MS}ms`,
              ),
            ),
          PROCESS_SHUTDOWN_TIMEOUT_MS,
        );
      }),
    ]);
    Deno.exit(0);
  } catch (error) {
    logger.error({ error, signal }, "Failed during Trellis shutdown");
    Deno.exit(1);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(signal, () => {
    void shutdownForSignal(signal);
  });
}
