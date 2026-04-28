import {
  authClearDevicePortalSelectionHandler,
  authClearLoginPortalSelectionHandler,
  authDisableInstanceGrantPolicyHandler,
  authDisablePortalHandler,
  authDisablePortalProfileHandler,
  authGetDevicePortalDefaultHandler,
  authGetLoginPortalDefaultHandler,
  authListDevicePortalSelectionsHandler,
  authListInstanceGrantPoliciesHandler,
  authListLoginPortalSelectionsHandler,
  authListPortalProfilesHandler,
  authListPortalsHandler,
  authSetDevicePortalDefaultHandler,
  authSetDevicePortalSelectionHandler,
  authSetLoginPortalDefaultHandler,
  authSetLoginPortalSelectionHandler,
  authUpsertInstanceGrantPolicyHandler,
  createAuthCreatePortalHandler,
  createAuthSetPortalProfileHandler,
  setAdminRpcDeps,
} from "../admin/rpc.ts";
import { createKick } from "../callout/kick.ts";
import { createEffectiveGrantPolicyLoader } from "../grants/store.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { AuthContractsRuntime, RpcRegistrar } from "./types.ts";

export async function registerPortalPolicyAdminRpcs(
  deps:
    & {
      trellis: RpcRegistrar;
      contractStorage: SqlContractStorageRepository;
      contracts: Pick<AuthContractsRuntime, "contractStore">;
      publishSessionRevoked: (
        event: {
          origin: string;
          id: string;
          sessionKey: string;
          revokedBy: string;
        },
      ) => Promise<void>;
    }
    & Pick<
      AuthRuntimeDeps,
      | "browserFlowsKV"
      | "connectionsKV"
      | "contractApprovalStorage"
      | "deviceActivationReviewStorage"
      | "deviceActivationStorage"
      | "deviceDeploymentStorage"
      | "deviceInstanceStorage"
      | "devicePortalSelectionStorage"
      | "deviceProvisioningSecretStorage"
      | "instanceGrantPolicyStorage"
      | "logger"
      | "loginPortalSelectionStorage"
      | "natsAuth"
      | "portalDefaultStorage"
      | "portalProfileStorage"
      | "portalStorage"
      | "sessionStorage"
      | "userStorage"
    >,
): Promise<void> {
  setAdminRpcDeps({
    ...deps,
    kick: createKick(deps),
    loadEffectiveGrantPolicies: createEffectiveGrantPolicyLoader(deps),
  });
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
}
