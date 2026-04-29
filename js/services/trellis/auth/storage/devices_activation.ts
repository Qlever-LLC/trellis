import { eq } from "drizzle-orm";
import type { StaticDecode } from "typebox";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import {
  deviceActivationReviews,
  deviceActivations,
  deviceDeployments,
  deviceInstances,
  deviceProvisioningSecrets,
} from "../../storage/schema.ts";
import {
  DeviceActivationRecordSchema,
  type DeviceActivationReviewRecord,
  DeviceActivationReviewRecordSchema,
  DeviceDeploymentSchema,
  type DeviceProvisioningSecret,
  DeviceProvisioningSecretSchema,
  DeviceSchema,
} from "../schemas.ts";
import { isoString, parseJsonField } from "./shared.ts";

type DeviceDeployment = StaticDecode<typeof DeviceDeploymentSchema>;
type DeviceInstance = StaticDecode<typeof DeviceSchema>;
type DeviceActivation = StaticDecode<typeof DeviceActivationRecordSchema>;

type DeviceDeploymentRow = typeof deviceDeployments.$inferSelect;
type DeviceDeploymentInsert = typeof deviceDeployments.$inferInsert;
type DeviceInstanceRow = typeof deviceInstances.$inferSelect;
type DeviceInstanceInsert = typeof deviceInstances.$inferInsert;
type DeviceProvisioningSecretRow =
  typeof deviceProvisioningSecrets.$inferSelect;
type DeviceProvisioningSecretInsert =
  typeof deviceProvisioningSecrets.$inferInsert;
type DeviceActivationRow = typeof deviceActivations.$inferSelect;
type DeviceActivationInsert = typeof deviceActivations.$inferInsert;
type DeviceActivationReviewRow = typeof deviceActivationReviews.$inferSelect;
type DeviceActivationReviewInsert = typeof deviceActivationReviews.$inferInsert;

function decodeDeviceDeploymentRow(row: DeviceDeploymentRow): DeviceDeployment {
  return Value.Decode(DeviceDeploymentSchema, {
    deploymentId: row.deploymentId,
    reviewMode: row.reviewMode ?? undefined,
    disabled: row.disabled,
    appliedContracts: parseJsonField(
      "device deployment applied contracts",
      row.appliedContracts,
    ),
  });
}

function encodeDeviceDeploymentRecord(
  record: DeviceDeployment,
): DeviceDeploymentInsert {
  return {
    deploymentId: record.deploymentId,
    reviewMode: record.reviewMode ?? null,
    disabled: record.disabled,
    appliedContracts: JSON.stringify(record.appliedContracts),
  };
}

function decodeDeviceInstanceRow(row: DeviceInstanceRow): DeviceInstance {
  return Value.Decode(DeviceSchema, {
    instanceId: row.instanceId,
    publicIdentityKey: row.publicIdentityKey,
    deploymentId: row.deploymentId,
    metadata: row.metadata === null
      ? undefined
      : parseJsonField("device instance metadata", row.metadata),
    state: row.state,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    revokedAt: row.revokedAt,
  });
}

function encodeDeviceInstanceRecord(
  record: DeviceInstance,
): DeviceInstanceInsert {
  return {
    instanceId: record.instanceId,
    publicIdentityKey: record.publicIdentityKey,
    deploymentId: record.deploymentId,
    metadata: record.metadata === undefined
      ? null
      : JSON.stringify(record.metadata),
    state: record.state,
    createdAt: record.createdAt,
    activatedAt: record.activatedAt,
    revokedAt: record.revokedAt,
  };
}

function decodeDeviceProvisioningSecretRow(
  row: DeviceProvisioningSecretRow,
): DeviceProvisioningSecret {
  return Value.Decode(DeviceProvisioningSecretSchema, {
    instanceId: row.instanceId,
    activationKey: row.activationKey,
    createdAt: row.createdAt,
  });
}

function encodeDeviceProvisioningSecretRecord(
  record: DeviceProvisioningSecret,
): DeviceProvisioningSecretInsert {
  return {
    instanceId: record.instanceId,
    activationKey: record.activationKey,
    createdAt: isoString(record.createdAt),
  };
}

function decodeDeviceActivationRow(row: DeviceActivationRow): DeviceActivation {
  return Value.Decode(DeviceActivationRecordSchema, {
    instanceId: row.instanceId,
    publicIdentityKey: row.publicIdentityKey,
    deploymentId: row.deploymentId,
    activatedBy: row.activatedBy === null
      ? undefined
      : parseJsonField("device activation actor", row.activatedBy),
    state: row.state,
    activatedAt: row.activatedAt,
    revokedAt: row.revokedAt,
  });
}

function encodeDeviceActivationRecord(
  record: DeviceActivation,
): DeviceActivationInsert {
  return {
    instanceId: record.instanceId,
    publicIdentityKey: record.publicIdentityKey,
    deploymentId: record.deploymentId,
    activatedBy: record.activatedBy === undefined
      ? null
      : JSON.stringify(record.activatedBy),
    state: record.state,
    activatedAt: record.activatedAt,
    revokedAt: record.revokedAt,
  };
}

function decodeDeviceActivationReviewRow(
  row: DeviceActivationReviewRow,
): DeviceActivationReviewRecord {
  const record = Value.Decode(DeviceActivationReviewRecordSchema, {
    reviewId: row.reviewId,
    operationId: row.operationId,
    flowId: row.flowId,
    instanceId: row.instanceId,
    publicIdentityKey: row.publicIdentityKey,
    deploymentId: row.deploymentId,
    requestedBy: parseJsonField(
      "device activation review requested by",
      row.requestedBy,
    ),
    state: row.state,
    requestedAt: row.requestedAt,
    decidedAt: row.decidedAt,
  });
  if (row.reason === null) {
    const { reason: _reason, ...withoutReason } = record;
    return withoutReason;
  }
  return { ...record, reason: row.reason };
}

function encodeDeviceActivationReviewRecord(
  record: DeviceActivationReviewRecord,
): DeviceActivationReviewInsert {
  return {
    reviewId: record.reviewId,
    operationId: record.operationId,
    flowId: record.flowId,
    instanceId: record.instanceId,
    publicIdentityKey: record.publicIdentityKey,
    deploymentId: record.deploymentId,
    requestedBy: JSON.stringify(record.requestedBy),
    state: record.state,
    requestedAt: isoString(record.requestedAt),
    decidedAt: record.decidedAt === null ? null : isoString(record.decidedAt),
    reason: record.reason ?? null,
  };
}

/** Stores durable device deployment records in SQL. */
export class SqlDeviceDeploymentRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a device deployment repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a device deployment by deployment id, or undefined when absent. */
  async get(deploymentId: string): Promise<DeviceDeployment | undefined> {
    const rows = await this.#db.select().from(deviceDeployments).where(
      eq(deviceDeployments.deploymentId, deploymentId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDeviceDeploymentRow(row);
  }

  /** Inserts or replaces a device deployment keyed by deployment id. */
  async put(record: DeviceDeployment): Promise<void> {
    const row = encodeDeviceDeploymentRecord(record);
    await this.#db.insert(deviceDeployments).values(row).onConflictDoUpdate({
      target: deviceDeployments.deploymentId,
      set: {
        reviewMode: row.reviewMode,
        disabled: row.disabled,
        appliedContracts: row.appliedContracts,
      },
    });
  }

  /** Deletes a device deployment by deployment id. */
  async delete(deploymentId: string): Promise<void> {
    await this.#db.delete(deviceDeployments).where(
      eq(deviceDeployments.deploymentId, deploymentId),
    );
  }

  /** Returns device deployments ordered by deployment id. */
  async list(): Promise<DeviceDeployment[]> {
    const rows = await this.#db.select().from(deviceDeployments).orderBy(
      deviceDeployments.deploymentId,
    );
    return rows.map((row: DeviceDeploymentRow) =>
      decodeDeviceDeploymentRow(row)
    );
  }
}

/** Stores durable device instance records in SQL. */
export class SqlDeviceInstanceRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a device instance repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a device instance by instance id, or undefined when absent. */
  async get(instanceId: string): Promise<DeviceInstance | undefined> {
    const rows = await this.#db.select().from(deviceInstances).where(
      eq(deviceInstances.instanceId, instanceId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDeviceInstanceRow(row);
  }

  /** Inserts or replaces a device instance keyed by instance id. */
  async put(record: DeviceInstance): Promise<void> {
    const row = encodeDeviceInstanceRecord(record);
    await this.#db.insert(deviceInstances).values(row).onConflictDoUpdate({
      target: deviceInstances.instanceId,
      set: {
        publicIdentityKey: row.publicIdentityKey,
        deploymentId: row.deploymentId,
        metadata: row.metadata,
        state: row.state,
        createdAt: row.createdAt,
        activatedAt: row.activatedAt,
        revokedAt: row.revokedAt,
      },
    });
  }

  /** Deletes a device instance by instance id. */
  async delete(instanceId: string): Promise<void> {
    await this.#db.delete(deviceInstances).where(
      eq(deviceInstances.instanceId, instanceId),
    );
  }

  /** Returns device instances ordered by instance id. */
  async list(): Promise<DeviceInstance[]> {
    const rows = await this.#db.select().from(deviceInstances).orderBy(
      deviceInstances.instanceId,
    );
    return rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row));
  }

  /** Returns device instances for one deployment ordered by instance id. */
  async listByDeployment(deploymentId: string): Promise<DeviceInstance[]> {
    const rows = await this.#db.select().from(deviceInstances).where(
      eq(deviceInstances.deploymentId, deploymentId),
    ).orderBy(deviceInstances.instanceId);
    return rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row));
  }
}

/** Stores durable device provisioning secrets in SQL. */
export class SqlDeviceProvisioningSecretRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a device provisioning secret repository backed by storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a provisioning secret by instance id, or undefined when absent. */
  async get(instanceId: string): Promise<DeviceProvisioningSecret | undefined> {
    const rows = await this.#db.select().from(deviceProvisioningSecrets).where(
      eq(deviceProvisioningSecrets.instanceId, instanceId),
    ).limit(1);
    const row = rows[0];
    return row === undefined
      ? undefined
      : decodeDeviceProvisioningSecretRow(row);
  }

  /** Inserts or replaces a provisioning secret keyed by instance id. */
  async put(record: DeviceProvisioningSecret): Promise<void> {
    const row = encodeDeviceProvisioningSecretRecord(record);
    await this.#db.insert(deviceProvisioningSecrets).values(row)
      .onConflictDoUpdate({
        target: deviceProvisioningSecrets.instanceId,
        set: {
          activationKey: row.activationKey,
          createdAt: row.createdAt,
        },
      });
  }

  /** Deletes a provisioning secret by instance id. */
  async delete(instanceId: string): Promise<void> {
    await this.#db.delete(deviceProvisioningSecrets).where(
      eq(deviceProvisioningSecrets.instanceId, instanceId),
    );
  }
}

/** Stores durable device activation records in SQL. */
export class SqlDeviceActivationRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a device activation repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a device activation by instance id, or undefined when absent. */
  async get(instanceId: string): Promise<DeviceActivation | undefined> {
    const rows = await this.#db.select().from(deviceActivations).where(
      eq(deviceActivations.instanceId, instanceId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDeviceActivationRow(row);
  }

  /** Inserts or replaces a device activation keyed by instance id. */
  async put(record: DeviceActivation): Promise<void> {
    const row = encodeDeviceActivationRecord(record);
    await this.#db.insert(deviceActivations).values(row).onConflictDoUpdate({
      target: deviceActivations.instanceId,
      set: {
        publicIdentityKey: row.publicIdentityKey,
        deploymentId: row.deploymentId,
        activatedBy: row.activatedBy,
        state: row.state,
        activatedAt: row.activatedAt,
        revokedAt: row.revokedAt,
      },
    });
  }

  /** Deletes a device activation by instance id. */
  async delete(instanceId: string): Promise<void> {
    await this.#db.delete(deviceActivations).where(
      eq(deviceActivations.instanceId, instanceId),
    );
  }

  /** Returns device activations ordered by instance id. */
  async list(): Promise<DeviceActivation[]> {
    const rows = await this.#db.select().from(deviceActivations).orderBy(
      deviceActivations.instanceId,
    );
    return rows.map((row: DeviceActivationRow) =>
      decodeDeviceActivationRow(row)
    );
  }
}

/** Stores durable device activation review records in SQL. */
export class SqlDeviceActivationReviewRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a device activation review repository backed by storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a device activation review by review id, or undefined. */
  async get(
    reviewId: string,
  ): Promise<DeviceActivationReviewRecord | undefined> {
    const rows = await this.#db.select().from(deviceActivationReviews).where(
      eq(deviceActivationReviews.reviewId, reviewId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDeviceActivationReviewRow(row);
  }

  /** Returns a device activation review by flow id, or undefined. */
  async getByFlowId(
    flowId: string,
  ): Promise<DeviceActivationReviewRecord | undefined> {
    const rows = await this.#db.select().from(deviceActivationReviews).where(
      eq(deviceActivationReviews.flowId, flowId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDeviceActivationReviewRow(row);
  }

  /** Inserts or replaces a device activation review keyed by review id. */
  async put(record: DeviceActivationReviewRecord): Promise<void> {
    const row = encodeDeviceActivationReviewRecord(record);
    await this.#db.insert(deviceActivationReviews).values(row)
      .onConflictDoUpdate({
        target: deviceActivationReviews.reviewId,
        set: {
          flowId: row.flowId,
          operationId: row.operationId,
          instanceId: row.instanceId,
          publicIdentityKey: row.publicIdentityKey,
          deploymentId: row.deploymentId,
          requestedBy: row.requestedBy,
          state: row.state,
          requestedAt: row.requestedAt,
          decidedAt: row.decidedAt,
          reason: row.reason,
        },
      });
  }

  /** Deletes a device activation review by review id. */
  async delete(reviewId: string): Promise<void> {
    await this.#db.delete(deviceActivationReviews).where(
      eq(deviceActivationReviews.reviewId, reviewId),
    );
  }

  /** Returns device activation reviews ordered by review id. */
  async list(): Promise<DeviceActivationReviewRecord[]> {
    const rows = await this.#db.select().from(deviceActivationReviews).orderBy(
      deviceActivationReviews.reviewId,
    );
    return rows.map((row: DeviceActivationReviewRow) =>
      decodeDeviceActivationReviewRow(row)
    );
  }
}
