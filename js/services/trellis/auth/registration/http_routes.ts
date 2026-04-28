import type { Hono } from "@hono/hono";
import type { AuthContractsRuntime } from "./types.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { Config } from "../../config.ts";
import { registerBuiltinPortalStaticRoutes } from "../http/builtin_portal.ts";
import { registerHttpRoutes } from "../http/routes.ts";
import { createKick } from "../callout/kick.ts";
import { createEffectiveGrantPolicyLoader } from "../grants/store.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";

export function registerAuthHttpRoutes(
  deps:
    & {
      app: Hono;
      config: Config;
      contracts: Pick<
        AuthContractsRuntime,
        "contractStore" | "refreshActiveContracts"
      >;
      contractStorage: SqlContractStorageRepository;
      userStorage: SqlUserProjectionRepository;
      contractApprovalStorage: SqlContractApprovalRepository;
      portalStorage: SqlPortalRepository;
      portalDefaultStorage: SqlPortalDefaultRepository;
      loginPortalSelectionStorage: SqlLoginPortalSelectionRepository;
      devicePortalSelectionStorage: SqlDevicePortalSelectionRepository;
      deviceDeploymentStorage: SqlDeviceDeploymentRepository;
      deviceInstanceStorage: SqlDeviceInstanceRepository;
      deviceActivationStorage: SqlDeviceActivationRepository;
      deviceActivationReviewStorage: SqlDeviceActivationReviewRepository;
      deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
      serviceDeploymentStorage: SqlServiceDeploymentRepository;
      serviceInstanceStorage: SqlServiceInstanceRepository;
    }
    & Pick<
      AuthRuntimeDeps,
      | "browserFlowsKV"
      | "connectionsKV"
      | "logger"
      | "natsAuth"
      | "natsTrellis"
      | "oauthStateKV"
      | "pendingAuthKV"
      | "sentinelCreds"
      | "sessionStorage"
      | "instanceGrantPolicyStorage"
      | "portalProfileStorage"
    >,
): void {
  registerBuiltinPortalStaticRoutes(deps.app);
  registerHttpRoutes(deps.app, {
    contractStorage: deps.contractStorage,
    userStorage: deps.userStorage,
    contractApprovalStorage: deps.contractApprovalStorage,
    portalStorage: deps.portalStorage,
    portalDefaultStorage: deps.portalDefaultStorage,
    loginPortalSelectionStorage: deps.loginPortalSelectionStorage,
    devicePortalSelectionStorage: deps.devicePortalSelectionStorage,
    deviceDeploymentStorage: deps.deviceDeploymentStorage,
    deviceInstanceStorage: deps.deviceInstanceStorage,
    deviceActivationStorage: deps.deviceActivationStorage,
    deviceActivationReviewStorage: deps.deviceActivationReviewStorage,
    deviceProvisioningSecretStorage: deps.deviceProvisioningSecretStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    config: deps.config,
    contractStore: deps.contracts.contractStore,
    refreshActiveContracts: deps.contracts.refreshActiveContracts,
    kick: createKick(deps),
    loadEffectiveGrantPolicies: createEffectiveGrantPolicyLoader(deps),
    runtimeDeps: deps,
  });
}
