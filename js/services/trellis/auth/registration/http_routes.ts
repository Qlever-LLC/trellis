import type { Hono } from "@hono/hono";
import type { AuthContractsRuntime } from "./types.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { Config } from "../../config.ts";
import { registerBuiltinPortalStaticRoutes } from "../http/builtin_portal.ts";
import { registerHttpRoutes } from "../http/routes.ts";
import { createKick } from "../callout/kick.ts";
import type {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeploymentGrantOverrideRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeploymentResourceBindingRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlEnvelopeExpansionRequestRepository,
  SqlIdentityEnvelopeRepository,
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
        | "getActiveEntries"
        | "getActiveContractsById"
        | "getContract"
        | "getKnownContract"
        | "getKnownContractsById"
        | "refreshActiveContracts"
        | "validateActiveCatalog"
        | "validateContract"
      >;
      contractStorage: SqlContractStorageRepository;
      userStorage: SqlUserProjectionRepository;
      contractApprovalStorage: SqlIdentityEnvelopeRepository;
      deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
      deviceDeploymentStorage: SqlDeviceDeploymentRepository;
      deviceInstanceStorage: SqlDeviceInstanceRepository;
      deviceActivationStorage: SqlDeviceActivationRepository;
      deviceActivationReviewStorage: SqlDeviceActivationReviewRepository;
      deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
      deploymentEnvelopeStorage: SqlDeploymentEnvelopeRepository;
      deploymentGrantOverrideStorage: SqlDeploymentGrantOverrideRepository;
      deploymentResourceBindingStorage: SqlDeploymentResourceBindingRepository;
      deploymentContractEvidenceStorage:
        SqlDeploymentContractEvidenceRepository;
      envelopeExpansionRequestStorage: SqlEnvelopeExpansionRequestRepository;
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
    >,
): void {
  registerBuiltinPortalStaticRoutes(deps.app);
  registerHttpRoutes(deps.app, {
    contractStorage: deps.contractStorage,
    userStorage: deps.userStorage,
    contractApprovalStorage: deps.contractApprovalStorage,
    deploymentPortalRouteStorage: deps.deploymentPortalRouteStorage,
    deviceDeploymentStorage: deps.deviceDeploymentStorage,
    deviceInstanceStorage: deps.deviceInstanceStorage,
    deviceActivationStorage: deps.deviceActivationStorage,
    deviceActivationReviewStorage: deps.deviceActivationReviewStorage,
    deviceProvisioningSecretStorage: deps.deviceProvisioningSecretStorage,
    deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
    deploymentGrantOverrideStorage: deps.deploymentGrantOverrideStorage,
    deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
    deploymentContractEvidenceStorage: deps.deploymentContractEvidenceStorage,
    envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    config: deps.config,
    contracts: deps.contracts,
    kick: createKick(deps),
    runtimeDeps: deps,
  });
}
