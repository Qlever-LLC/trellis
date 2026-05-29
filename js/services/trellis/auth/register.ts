import type { Hono } from "@hono/hono";
import type { SqlContractStorageRepository } from "../catalog/storage.ts";
import { createNatsAuthorityPhysicalResourceManager } from "../catalog/resources.ts";
import type { Config } from "../config.ts";
import type { AuthRuntimeDeps } from "./runtime_deps.ts";
import { createAuthorityReconciler } from "./reconciliation/authority_reconciler.ts";
import { registerApprovalAndUserRpcs } from "./registration/approval_users.ts";
import { registerDeviceAdminAndActivation } from "./registration/device_admin_activation.ts";
import { registerAuthHttpRoutes } from "./registration/http_routes.ts";
import { registerPortalAdminRpcs } from "./registration/portals_admin.ts";
import { registerServiceAdminRpcs } from "./registration/service_admin.ts";
import { registerSessionRpcs } from "./registration/session.ts";
import type {
  AuthContractsRuntime,
  AuthRuntime,
} from "./registration/types.ts";
import type { DeploymentResourceBinding } from "./schemas.ts";
import type {
  SqlAccountFlowRepository,
  SqlAuthorityReconciliationRepository,
  SqlCapabilityGroupRepository,
  SqlDeploymentAuthorityGrantOverrideRepository,
  SqlDeploymentAuthorityPlanRepository,
  SqlDeploymentAuthorityRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlIdentityAuthorityRepository,
  SqlIdentityGrantRepository,
  SqlLocalCredentialRepository,
  SqlLoginPortalRepository,
  SqlMaterializedAuthorityRepository,
  SqlMaterializedResourceBindingRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
  SqlUserAccountRepository,
  SqlUserIdentityRepository,
  SqlUserProjectionRepository,
} from "./storage.ts";

function createMaterializedResourceBindingAdapter(
  storage: SqlMaterializedResourceBindingRepository,
) {
  return {
    async get(deploymentId: string, kind: string, alias: string) {
      return (await storage.listBindingsByDeployment(deploymentId)).find((
        binding,
      ) => binding.kind === kind && binding.alias === alias);
    },
    async put(record: DeploymentResourceBinding) {
      const current = await storage.get(record.deploymentId);
      const resourceBindings = [
        ...(current?.resourceBindings ?? []).filter((binding) =>
          binding.kind !== record.kind || binding.alias !== record.alias
        ),
        record,
      ];
      await storage.put({
        deploymentId: record.deploymentId,
        desiredVersion: current?.desiredVersion ?? record.updatedAt,
        status: current?.status ?? "pending",
        resourceBindings,
        grants: current?.grants ?? [],
        reconciledAt: current?.reconciledAt ?? null,
      });
    },
    listByDeployment: (deploymentId: string) =>
      storage.listBindingsByDeployment(deploymentId),
  };
}

type AuthRegistrationDeps =
  & {
    app: Hono;
    config: Config;
    trellis: AuthRuntime;
    contracts: AuthContractsRuntime;
    contractStorage: SqlContractStorageRepository;
    deploymentAuthorityStorage: SqlDeploymentAuthorityRepository;
    deploymentAuthorityPlanStorage: SqlDeploymentAuthorityPlanRepository;
    materializedAuthorityStorage: SqlMaterializedAuthorityRepository;
    materializedResourceBindingStorage:
      SqlMaterializedResourceBindingRepository;
    authorityReconciliationStorage: SqlAuthorityReconciliationRepository;
    implementationOfferStorage: AuthRuntimeDeps["implementationOfferStorage"];
    deploymentPortalRouteStorage: SqlDeploymentPortalRouteRepository;
    deploymentAuthorityGrantOverrideStorage:
      SqlDeploymentAuthorityGrantOverrideRepository;
    identityAuthorityStorage: SqlIdentityAuthorityRepository;
    accountFlowStorage: SqlAccountFlowRepository;
    loginPortalStorage: SqlLoginPortalRepository;
    accountStorage: SqlUserAccountRepository;
    capabilityGroupStorage: SqlCapabilityGroupRepository;
    userIdentityStorage: SqlUserIdentityRepository;
    localCredentialStorage: SqlLocalCredentialRepository;
    userStorage: SqlUserProjectionRepository;
    identityGrantStorage: SqlIdentityGrantRepository;
    deviceDeploymentStorage: SqlDeviceDeploymentRepository;
    deviceInstanceStorage: SqlDeviceInstanceRepository;
    deviceActivationStorage: SqlDeviceActivationRepository;
    serviceDeploymentStorage: SqlServiceDeploymentRepository;
    serviceInstanceStorage: SqlServiceInstanceRepository;
    sessionStorage: SqlSessionRepository;
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
    | "trellis"
    | "deviceActivationReviewStorage"
    | "deviceProvisioningSecretStorage"
  >;

/**
 * Registers auth RPCs, operations, and HTTP routes.
 */
export async function registerAuth(deps: AuthRegistrationDeps): Promise<void> {
  const authorityReconciler = createAuthorityReconciler({
    deploymentAuthorityStorage: deps.deploymentAuthorityStorage,
    materializedAuthorityStorage: deps.materializedAuthorityStorage,
    authorityReconciliationStorage: deps.authorityReconciliationStorage,
    physicalResources: {
      manager: createNatsAuthorityPhysicalResourceManager(deps.natsTrellis),
    },
  });
  const registrationDeps = {
    ...deps,
    authorityReconciler,
    deploymentResourceBindingStorage: createMaterializedResourceBindingAdapter(
      deps.materializedResourceBindingStorage,
    ),
    deploymentAuthorityGrantOverrideStorage:
      deps.deploymentAuthorityGrantOverrideStorage,
    contractApprovalStorage: deps.identityGrantStorage,
  };
  const publishSessionRevoked = async (event: {
    origin: string;
    id: string;
    sessionKey: string;
    revokedBy: string;
  }) => {
    (await deps.trellis.event.auth.sessionsRevoked.publish(event)).inspectErr(
      (error) =>
        deps.logger.warn({ error }, "Failed to publish Auth.Sessions.Revoked"),
    );
  };
  await registerServiceAdminRpcs(registrationDeps);
  await registerPortalAdminRpcs(registrationDeps);
  await registerSessionRpcs(registrationDeps);
  await registerApprovalAndUserRpcs({
    ...registrationDeps,
    publishSessionRevoked,
  });
  await registerDeviceAdminAndActivation({
    ...registrationDeps,
    publishSessionRevoked,
  });
  registerAuthHttpRoutes(registrationDeps);
}
