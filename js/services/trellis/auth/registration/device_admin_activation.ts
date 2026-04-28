import {
  authDecideDeviceActivationReviewHandler,
  authListDeviceActivationReviewsHandler,
  authListDeviceActivationsHandler,
  authListDeviceDeploymentsHandler,
  authListDeviceInstancesHandler,
  authRevokeDeviceActivationHandler,
  createAuthApplyDeviceDeploymentContractHandler,
  createAuthCreateDeviceDeploymentHandler,
  createAuthDisableDeviceDeploymentHandler,
  createAuthDisableDeviceInstanceHandler,
  createAuthEnableDeviceDeploymentHandler,
  createAuthEnableDeviceInstanceHandler,
  createAuthProvisionDeviceInstanceHandler,
  createAuthRemoveDeviceDeploymentHandler,
  createAuthRemoveDeviceInstanceHandler,
  createAuthUnapplyDeviceDeploymentContractHandler,
  setAdminRpcDeps,
} from "../admin/rpc.ts";
import { createKick } from "../callout/kick.ts";
import {
  createActivateDeviceHandler,
  createGetDeviceConnectInfoHandler,
} from "../device_activation/operation.ts";
import { createEffectiveGrantPolicyLoader } from "../grants/store.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { AuthContractsRuntime, AuthRuntime } from "./types.ts";

export async function registerDeviceAdminAndActivation(
  deps:
    & {
      trellis: AuthRuntime;
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
  setAdminRpcDeps({
    ...deps,
    kick: createKick(deps),
    loadEffectiveGrantPolicies: createEffectiveGrantPolicyLoader(deps),
  });
  await deps.trellis.mount(
    "Auth.CreateDeviceDeployment",
    createAuthCreateDeviceDeploymentHandler({
      installDeviceContract: deps.contracts.installDeviceContract,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.ApplyDeviceDeploymentContract",
    createAuthApplyDeviceDeploymentContractHandler({
      installDeviceContract: deps.contracts.installDeviceContract,
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.UnapplyDeviceDeploymentContract",
    createAuthUnapplyDeviceDeploymentContractHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceDeployments",
    authListDeviceDeploymentsHandler,
  );
  await deps.trellis.mount(
    "Auth.DisableDeviceDeployment",
    createAuthDisableDeviceDeploymentHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceDeployment",
    createAuthEnableDeviceDeploymentHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceDeployment",
    createAuthRemoveDeviceDeploymentHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
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
    createAuthDisableDeviceInstanceHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.EnableDeviceInstance",
    createAuthEnableDeviceInstanceHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
  );
  await deps.trellis.mount(
    "Auth.RemoveDeviceInstance",
    createAuthRemoveDeviceInstanceHandler({
      refreshActiveContracts: deps.contracts.refreshActiveContracts,
    }),
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
    createActivateDeviceHandler(deps),
  );
  await deps.trellis.mount(
    "Auth.GetDeviceConnectInfo",
    createGetDeviceConnectInfoHandler(deps),
  );
  await deps.trellis.mount(
    "Auth.ListDeviceActivationReviews",
    authListDeviceActivationReviewsHandler,
  );
  await deps.trellis.mount(
    "Auth.DecideDeviceActivationReview",
    authDecideDeviceActivationReviewHandler,
  );
}
