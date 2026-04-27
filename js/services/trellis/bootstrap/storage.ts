import { SqlContractStorageRepository } from "../catalog/storage.ts";
import {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlInstanceGrantPolicyRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalProfileRepository,
  SqlPortalRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
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
    userStorage: new SqlUserProjectionRepository(storage.db),
    contractApprovalStorage: new SqlContractApprovalRepository(storage.db),
    portalStorage: new SqlPortalRepository(storage.db),
    portalProfileStorage: new SqlPortalProfileRepository(storage.db),
    portalDefaultStorage: new SqlPortalDefaultRepository(storage.db),
    loginPortalSelectionStorage: new SqlLoginPortalSelectionRepository(
      storage.db,
    ),
    devicePortalSelectionStorage: new SqlDevicePortalSelectionRepository(
      storage.db,
    ),
    instanceGrantPolicyStorage: new SqlInstanceGrantPolicyRepository(
      storage.db,
    ),
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
