import { getConfig } from "../config.ts";
import { SqlContractStorageRepository } from "../catalog/storage.ts";
import {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceActivationReviewRepository,
  SqlDeviceInstanceRepository,
  SqlDevicePortalSelectionRepository,
  SqlDeviceProfileRepository,
  SqlDeviceProvisioningSecretRepository,
  SqlInstanceGrantPolicyRepository,
  SqlLoginPortalSelectionRepository,
  SqlPortalDefaultRepository,
  SqlPortalProfileRepository,
  SqlPortalRepository,
  SqlServiceInstanceRepository,
  SqlServiceProfileRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../auth/storage.ts";
import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";

const config = getConfig();

export const storage = await openTrellisStorageDb(config.storage.dbPath);
await initializeTrellisStorageSchema(storage);

export const contractStorage = new SqlContractStorageRepository(storage.db);
export const userStorage = new SqlUserProjectionRepository(storage.db);
export const contractApprovalStorage = new SqlContractApprovalRepository(
  storage.db,
);
export const portalStorage = new SqlPortalRepository(storage.db);
export const portalProfileStorage = new SqlPortalProfileRepository(storage.db);
export const portalDefaultStorage = new SqlPortalDefaultRepository(storage.db);
export const loginPortalSelectionStorage =
  new SqlLoginPortalSelectionRepository(storage.db);
export const devicePortalSelectionStorage =
  new SqlDevicePortalSelectionRepository(storage.db);
export const instanceGrantPolicyStorage = new SqlInstanceGrantPolicyRepository(
  storage.db,
);
export const serviceProfileStorage = new SqlServiceProfileRepository(
  storage.db,
);
export const serviceInstanceStorage = new SqlServiceInstanceRepository(
  storage.db,
);
export const deviceProfileStorage = new SqlDeviceProfileRepository(storage.db);
export const deviceInstanceStorage = new SqlDeviceInstanceRepository(
  storage.db,
);
export const deviceProvisioningSecretStorage =
  new SqlDeviceProvisioningSecretRepository(storage.db);
export const deviceActivationStorage = new SqlDeviceActivationRepository(
  storage.db,
);
export const deviceActivationReviewStorage =
  new SqlDeviceActivationReviewRepository(storage.db);
export const sessionStorage = new SqlSessionRepository(storage.db, {
  sessionTtlMs: config.ttlMs.sessions,
});
