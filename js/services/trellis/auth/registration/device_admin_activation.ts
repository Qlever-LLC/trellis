import { createDeviceAdminHandlers } from "../admin/rpc.ts";
import { createKick } from "../callout/kick.ts";
import {
  createActivateDeviceHandler,
  createGetDeviceConnectInfoHandler,
} from "../device_activation/operation.ts";
import { createEffectiveGrantPolicyLoader } from "../grants/store.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { AuthContractsRuntime, AuthRuntime } from "./types.ts";
import type { Config } from "../../config.ts";

export async function registerDeviceAdminAndActivation(
  deps:
    & {
      trellis: AuthRuntime;
      config: Config;
      contracts: Pick<
        AuthContractsRuntime,
        "installDeviceContract" | "refreshActiveContracts"
      >;
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
      | "sentinelCreds"
      | "sessionStorage"
      | "userStorage"
    >,
): Promise<void> {
  const handlers = createDeviceAdminHandlers({
    ...deps,
    kick: createKick(deps),
    loadEffectiveGrantPolicies: createEffectiveGrantPolicyLoader(deps),
    installDeviceContract: deps.contracts.installDeviceContract,
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
  });
  await deps.trellis.mount(
    "Auth.CreateDeviceDeployment",
    handlers.createDeviceDeployment,
  );
  await deps.trellis.mount(
    "Auth.ApplyDeviceDeploymentContract",
    handlers.applyDeviceDeploymentContract,
  );
  await deps.trellis.mount(
    "Auth.UnapplyDeviceDeploymentContract",
    handlers.unapplyDeviceDeploymentContract,
  );
  await deps.trellis.mount(
    "Auth.ListDeviceDeployments",
    handlers.listDeviceDeployments,
  );
  await deps.trellis.mount(
    "Auth.DisableDeviceDeployment",
    handlers.disableDeviceDeployment,
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceDeployment",
    handlers.enableDeviceDeployment,
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceDeployment",
    handlers.removeDeviceDeployment,
  );
  await deps.trellis.mount(
    "Auth.ProvisionDeviceInstance",
    handlers.provisionDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.ListDeviceInstances",
    handlers.listDeviceInstances,
  );
  await deps.trellis.mount(
    "Auth.DisableDeviceInstance",
    handlers.disableDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceInstance",
    handlers.enableDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceInstance",
    handlers.removeDeviceInstance,
  );
  await deps.trellis.mount(
    "Auth.ListDeviceActivations",
    handlers.listDeviceActivations,
  );
  await deps.trellis.mount(
    "Auth.RevokeDeviceActivation",
    handlers.revokeDeviceActivation,
  );
  await deps.trellis.operation("Auth.ActivateDevice").handle(
    createActivateDeviceHandler(deps),
  );
  await deps.trellis.mount(
    "Auth.GetDeviceConnectInfo",
    createGetDeviceConnectInfoHandler(deps),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceActivationReviews",
    handlers.listDeviceActivationReviews,
  );
  await deps.trellis.mount(
    "Auth.DecideDeviceActivationReview",
    handlers.decideDeviceActivationReview,
  );
}
