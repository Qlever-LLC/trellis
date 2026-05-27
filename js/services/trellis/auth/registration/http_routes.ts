import type { Hono } from "@hono/hono";
import type { AuthContractsRuntime } from "./types.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type { SqlContractStorageRepository } from "../../catalog/storage.ts";
import type { Config } from "../../config.ts";
import { registerBuiltinPortalStaticRoutes } from "../http/builtin_portal.ts";
import { registerHttpRoutes } from "../http/routes.ts";
import { createKick } from "../callout/kick.ts";
import type {
  SqlAccountFlowRepository,
  SqlCapabilityGroupRepository,
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
  SqlImplementationOfferRepository,
  SqlLocalCredentialRepository,
  SqlLoginPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
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
        | "getKnownEntriesByContractId"
        | "getKnownContractsById"
        | "refreshActiveContracts"
        | "validateActiveCatalog"
        | "validateContract"
      >;
      contractStorage: SqlContractStorageRepository;
      accountStorage: SqlUserAccountRepository;
      userIdentityStorage: SqlUserIdentityRepository;
      localCredentialStorage: SqlLocalCredentialRepository;
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
      implementationOfferStorage: SqlImplementationOfferRepository;
      envelopeExpansionRequestStorage: SqlEnvelopeExpansionRequestRepository;
      accountFlowStorage: SqlAccountFlowRepository;
      loginPortalStorage: SqlLoginPortalRepository;
      capabilityGroupStorage: SqlCapabilityGroupRepository;
      serviceDeploymentStorage: SqlServiceDeploymentRepository;
      serviceInstanceStorage: SqlServiceInstanceRepository;
    }
    & Pick<
      AuthRuntimeDeps,
      | "browserFlowsKV"
      | "connectionsKV"
      | "logger"
      | "natsAuth"
      | "natsSystem"
      | "natsTrellis"
      | "oauthStateKV"
      | "pendingAuthKV"
      | "sentinelCreds"
      | "sessionStorage"
      | "trellis"
    >,
): void {
  registerBuiltinPortalStaticRoutes(deps.app);
  registerHttpRoutes(deps.app, {
    contractStorage: deps.contractStorage,
    accountFlowStorage: deps.accountFlowStorage,
    loginPortalStorage: deps.loginPortalStorage,
    accountStorage: deps.accountStorage,
    capabilityGroupStorage: deps.capabilityGroupStorage,
    userIdentityStorage: deps.userIdentityStorage,
    localCredentialStorage: deps.localCredentialStorage,
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
    implementationOfferStorage: deps.implementationOfferStorage,
    envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    config: deps.config,
    contracts: deps.contracts,
    kick: createKick(deps),
    runtimeDeps: deps,
  });
}
