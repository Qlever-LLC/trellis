import { createPortalPolicyAdminHandlers } from "../admin/rpc.ts";
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
  const handlers = createPortalPolicyAdminHandlers({
    ...deps,
    kick: createKick(deps),
    loadEffectiveGrantPolicies: createEffectiveGrantPolicyLoader(deps),
    contractStore: deps.contracts.contractStore,
  });
  await deps.trellis.mount(
    "Auth.CreatePortal",
    handlers.createPortal,
  );
  await deps.trellis.mount("Auth.ListPortals", handlers.listPortals);
  await deps.trellis.mount("Auth.DisablePortal", handlers.disablePortal);
  await deps.trellis.mount(
    "Auth.ListPortalProfiles",
    handlers.listPortalProfiles,
  );
  await deps.trellis.mount(
    "Auth.SetPortalProfile",
    handlers.setPortalProfile,
  );
  await deps.trellis.mount(
    "Auth.DisablePortalProfile",
    handlers.disablePortalProfile,
  );
  await deps.trellis.mount(
    "Auth.GetLoginPortalDefault",
    handlers.getLoginPortalDefault,
  );
  await deps.trellis.mount(
    "Auth.ListInstanceGrantPolicies",
    handlers.listInstanceGrantPolicies,
  );
  await deps.trellis.mount(
    "Auth.UpsertInstanceGrantPolicy",
    handlers.upsertInstanceGrantPolicy,
  );
  await deps.trellis.mount(
    "Auth.DisableInstanceGrantPolicy",
    handlers.disableInstanceGrantPolicy,
  );
  await deps.trellis.mount(
    "Auth.SetLoginPortalDefault",
    handlers.setLoginPortalDefault,
  );
  await deps.trellis.mount(
    "Auth.ListLoginPortalSelections",
    handlers.listLoginPortalSelections,
  );
  await deps.trellis.mount(
    "Auth.SetLoginPortalSelection",
    handlers.setLoginPortalSelection,
  );
  await deps.trellis.mount(
    "Auth.ClearLoginPortalSelection",
    handlers.clearLoginPortalSelection,
  );
  await deps.trellis.mount(
    "Auth.GetDevicePortalDefault",
    handlers.getDevicePortalDefault,
  );
  await deps.trellis.mount(
    "Auth.SetDevicePortalDefault",
    handlers.setDevicePortalDefault,
  );
  await deps.trellis.mount(
    "Auth.ListDevicePortalSelections",
    handlers.listDevicePortalSelections,
  );
  await deps.trellis.mount(
    "Auth.SetDevicePortalSelection",
    handlers.setDevicePortalSelection,
  );
  await deps.trellis.mount(
    "Auth.ClearDevicePortalSelection",
    handlers.clearDevicePortalSelection,
  );
}
