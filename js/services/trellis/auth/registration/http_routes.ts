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
  SqlDeploymentPortalRouteRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlImplementationOfferRepository,
  SqlLocalCredentialRepository,
  SqlLoginPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import type {
  DeploymentAuthority,
  DeploymentAuthorityGrantOverride,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
  DeploymentResourceBinding,
  IdentityGrantRecord,
} from "../schemas.ts";
import type { BoundedListQuery, ListPage } from "../storage.ts";

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
      contractApprovalStorage: {
        get(
          identityGrantId: string,
        ): Promise<IdentityGrantRecord | undefined>;
        put(record: IdentityGrantRecord): Promise<void>;
        listByUser(userTrellisId: string): Promise<IdentityGrantRecord[]>;
        listPage(query: BoundedListQuery): Promise<IdentityGrantRecord[]>;
      };
      deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
      deviceDeploymentStorage: SqlDeviceDeploymentRepository;
      deviceInstanceStorage: SqlDeviceInstanceRepository;
      deviceActivationStorage: SqlDeviceActivationRepository;
      deviceActivationReviewStorage: SqlDeviceActivationReviewRepository;
      deviceProvisioningSecretStorage: SqlDeviceProvisioningSecretRepository;
      deploymentAuthorityStorage: {
        get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
        listEnabled(): Promise<DeploymentAuthority[]>;
      };
      deploymentAuthorityPlanStorage: {
        put(record: DeploymentAuthorityPlan): Promise<void>;
        listFiltered(
          filters: { deploymentId?: string; state?: string },
          query: BoundedListQuery,
        ): Promise<DeploymentAuthorityPlan[]>;
      };
      materializedAuthorityStorage: {
        get(
          deploymentId: string,
        ): Promise<DeploymentAuthorityMaterialization | undefined>;
      };
      deploymentAuthorityGrantOverrideStorage: {
        listByDeployment(
          deploymentId: string,
        ): Promise<DeploymentAuthorityGrantOverride[]>;
        listCountedPage?(
          query: BoundedListQuery,
        ): Promise<ListPage<DeploymentAuthorityGrantOverride>>;
      };
      deploymentResourceBindingStorage: {
        get(
          deploymentId: string,
          kind: string,
          alias: string,
        ): Promise<DeploymentResourceBinding | undefined>;
        put(record: DeploymentResourceBinding): Promise<void>;
        listByDeployment(
          deploymentId: string,
        ): Promise<DeploymentResourceBinding[]>;
      };
      implementationOfferStorage: SqlImplementationOfferRepository;
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
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    deploymentAuthorityPlanStorage: deps.deploymentAuthorityPlanStorage,
    materializedAuthorityStorage: deps.materializedAuthorityStorage,
    deploymentAuthorityGrantOverrideStorage:
      deps.deploymentAuthorityGrantOverrideStorage,
    deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
    implementationOfferStorage: deps.implementationOfferStorage,
    serviceDeploymentStorage: deps.serviceDeploymentStorage,
    serviceInstanceStorage: deps.serviceInstanceStorage,
    config: deps.config,
    contracts: deps.contracts,
    kick: createKick(deps),
    runtimeDeps: deps,
  });
}
