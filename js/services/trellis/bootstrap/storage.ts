import { SqlContractStorageRepository } from "../catalog/storage.ts";
import {
  SqlAccountFlowRepository,
  SqlAuthorityReconciliationRepository,
  SqlCapabilityGroupRepository,
  SqlDeploymentAuthorityCapabilityDefinitionRepository,
  SqlDeploymentAuthorityGrantOverrideRepository,
  SqlDeploymentAuthorityPlanRepository,
  SqlDeploymentAuthorityRepository,
  SqlDeploymentPortalRouteRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlIdentityAuthorityRepository,
  SqlIdentityGrantRepository,
  SqlImplementationOfferRepository,
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
} from "../auth/storage.ts";
import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { Config } from "../config.ts";

/** Opens Trellis durable storage and constructs the service repositories. */
export async function createStorage(config: Config) {
  const storage = await openTrellisStorageDb(config.storage.dbPath);
  await initializeTrellisStorageSchema(storage);

  return {
    storage,
    contractStorage: new SqlContractStorageRepository(storage.db),
    deploymentAuthorityStorage: new SqlDeploymentAuthorityRepository(
      storage.db,
    ),
    capabilityDefinitionStorage:
      new SqlDeploymentAuthorityCapabilityDefinitionRepository(storage.db),
    deploymentAuthorityPlanStorage: new SqlDeploymentAuthorityPlanRepository(
      storage.db,
    ),
    materializedAuthorityStorage: new SqlMaterializedAuthorityRepository(
      storage.db,
    ),
    materializedResourceBindingStorage:
      new SqlMaterializedResourceBindingRepository(storage.db),
    authorityReconciliationStorage: new SqlAuthorityReconciliationRepository(
      storage.db,
    ),
    implementationOfferStorage: new SqlImplementationOfferRepository(
      storage.db,
    ),
    deploymentPortalRouteStorage: new SqlDeploymentPortalRouteRepository(
      storage.db,
    ),
    deploymentAuthorityGrantOverrideStorage:
      new SqlDeploymentAuthorityGrantOverrideRepository(
        storage.db,
      ),
    identityAuthorityStorage: new SqlIdentityAuthorityRepository(
      storage.db,
    ),
    identityGrantStorage: new SqlIdentityGrantRepository(storage.db),
    userStorage: new SqlUserProjectionRepository(storage.db),
    accountStorage: new SqlUserAccountRepository(storage.db),
    capabilityGroupStorage: new SqlCapabilityGroupRepository(storage.db),
    userIdentityStorage: new SqlUserIdentityRepository(storage.db),
    localCredentialStorage: new SqlLocalCredentialRepository(storage.db),
    accountFlowStorage: new SqlAccountFlowRepository(storage.db),
    loginPortalStorage: new SqlLoginPortalRepository(storage.db),
    serviceDeploymentStorage: new SqlServiceDeploymentRepository(storage.db),
    serviceInstanceStorage: new SqlServiceInstanceRepository(storage.db),
    deviceDeploymentStorage: new SqlDeviceDeploymentRepository(storage.db),
    deviceInstanceStorage: new SqlDeviceInstanceRepository(storage.db),
    deviceProvisioningSecretStorage: new SqlDeviceProvisioningSecretRepository(
      storage.db,
    ),
    deviceActivationStorage: new SqlDeviceActivationRepository(storage.db),
    deviceActivationReviewStorage: new SqlDeviceActivationReviewRepository(
      storage.db,
    ),
    sessionStorage: new SqlSessionRepository(storage.db, {
      sessionTtlMs: config.ttlMs.sessions,
    }),
  };
}

export type StorageBootstrap = Awaited<ReturnType<typeof createStorage>>;
