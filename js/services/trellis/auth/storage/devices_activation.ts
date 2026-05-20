import { and, count, eq, inArray, type SQL } from "drizzle-orm";
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
import {
  type BoundedListQuery,
  boundedListQuery,
  isoString,
  type ListPage,
  listPage,
  parseJsonField,
} from "./shared.ts";

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

type DisabledFilter = { disabled?: boolean };

function decodeDeviceDeploymentRow(row: DeviceDeploymentRow): DeviceDeployment {
  return Value.Decode(DeviceDeploymentSchema, {
    deploymentId: row.deploymentId,
    reviewMode: row.reviewMode ?? undefined,
    disabled: row.disabled,
  });
}

function encodeDeviceDeploymentRecord(
  record: DeviceDeployment,
): DeviceDeploymentInsert {
  return {
    deploymentId: record.deploymentId,
    reviewMode: record.reviewMode ?? null,
    disabled: record.disabled,
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
      },
    });
  }

  /** Deletes a device deployment by deployment id. */
  async delete(deploymentId: string): Promise<void> {
    await this.#db.delete(deviceDeployments).where(
      eq(deviceDeployments.deploymentId, deploymentId),
    );
  }

  /** Returns a bounded page of device deployments ordered by deployment id. */
  async listPage(query: BoundedListQuery): Promise<DeviceDeployment[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deviceDeployments).orderBy(
      deviceDeployments.deploymentId,
    ).limit(limit).offset(offset);
    return rows.map((row: DeviceDeploymentRow) =>
      decodeDeviceDeploymentRow(row)
    );
  }

  /** Returns device deployments for requested deployment ids. */
  async listByDeploymentIds(
    deploymentIds: Iterable<string>,
    filters: DisabledFilter = {},
  ): Promise<DeviceDeployment[]> {
    const requested = [...new Set(deploymentIds)];
    if (requested.length === 0) return [];
    const conditions: SQL[] = [
      inArray(deviceDeployments.deploymentId, requested),
    ];
    if (filters.disabled !== undefined) {
      conditions.push(eq(deviceDeployments.disabled, filters.disabled));
    }
    const rows = await this.#db.select().from(deviceDeployments).where(
      and(...conditions),
    ).orderBy(deviceDeployments.deploymentId);
    return rows.map((row: DeviceDeploymentRow) =>
      decodeDeviceDeploymentRow(row)
    );
  }

  /** Returns device deployments matching simple indexed filters. */
  async listFiltered(
    filters: DisabledFilter,
    query: BoundedListQuery,
  ): Promise<DeviceDeployment[]> {
    const { offset, limit } = boundedListQuery(query);
    if (filters.disabled === undefined) return await this.listPage(query);
    const rows = await this.#db.select().from(deviceDeployments).where(
      eq(deviceDeployments.disabled, filters.disabled),
    ).orderBy(deviceDeployments.deploymentId).limit(limit).offset(offset);
    return rows.map((row: DeviceDeploymentRow) =>
      decodeDeviceDeploymentRow(row)
    );
  }

  /** Returns a counted page of device deployments matching simple indexed filters. */
  async listFilteredPage(
    filters: DisabledFilter,
    query: BoundedListQuery,
  ): Promise<ListPage<DeviceDeployment>> {
    const conditions: SQL[] = [];
    if (filters.disabled !== undefined) {
      conditions.push(eq(deviceDeployments.disabled, filters.disabled));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      deviceDeployments,
    ).where(where);
    const rows = await this.#db.select().from(deviceDeployments).where(where)
      .orderBy(deviceDeployments.deploymentId).limit(limit).offset(offset);
    return listPage(
      rows.map((row: DeviceDeploymentRow) => decodeDeviceDeploymentRow(row)),
      countRow?.count ?? 0,
      query,
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

  /** Returns a bounded page of device instances ordered by instance id. */
  async listPage(query: BoundedListQuery): Promise<DeviceInstance[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deviceInstances).orderBy(
      deviceInstances.instanceId,
    ).limit(limit).offset(offset);
    return rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row));
  }

  /** Returns device instances for one deployment ordered by instance id. */
  async listByDeployment(deploymentId: string): Promise<DeviceInstance[]> {
    const rows = await this.#db.select().from(deviceInstances).where(
      eq(deviceInstances.deploymentId, deploymentId),
    ).orderBy(deviceInstances.instanceId);
    return rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row));
  }

  /** Returns device instances for requested deployments ordered by deployment and instance id. */
  async listByDeployments(
    deploymentIds: Iterable<string>,
  ): Promise<DeviceInstance[]> {
    const requested = [...new Set(deploymentIds)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(deviceInstances).where(
      inArray(deviceInstances.deploymentId, requested),
    ).orderBy(deviceInstances.deploymentId, deviceInstances.instanceId);
    return rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row));
  }

  /** Returns device instances in one of the requested states ordered by state and instance id. */
  async listByStates(states: Iterable<string>): Promise<DeviceInstance[]> {
    const requested = [...new Set(states)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(deviceInstances).where(
      inArray(deviceInstances.state, requested),
    ).orderBy(deviceInstances.state, deviceInstances.instanceId);
    return rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row));
  }

  /** Returns device instances for deployments and states using indexed predicates. */
  async listByDeploymentsAndStates(
    deploymentIds: Iterable<string>,
    states: Iterable<string>,
  ): Promise<DeviceInstance[]> {
    const requestedDeployments = [...new Set(deploymentIds)];
    const requestedStates = [...new Set(states)];
    if (requestedDeployments.length === 0 || requestedStates.length === 0) {
      return [];
    }
    const rows = await this.#db.select().from(deviceInstances).where(
      and(
        inArray(deviceInstances.deploymentId, requestedDeployments),
        inArray(deviceInstances.state, requestedStates),
      ),
    ).orderBy(
      deviceInstances.deploymentId,
      deviceInstances.state,
      deviceInstances.instanceId,
    );
    return rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row));
  }

  /** Returns a counted page of device instances matching simple indexed filters. */
  async listFilteredPage(
    filters: { deploymentId?: string; state?: string },
    query: BoundedListQuery,
  ): Promise<ListPage<DeviceInstance>> {
    const conditions: SQL[] = [];
    if (filters.deploymentId !== undefined) {
      conditions.push(eq(deviceInstances.deploymentId, filters.deploymentId));
    }
    if (filters.state !== undefined) {
      conditions.push(eq(deviceInstances.state, filters.state));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      deviceInstances,
    ).where(where);
    const rows = await this.#db.select().from(deviceInstances).where(where)
      .orderBy(deviceInstances.instanceId).limit(limit).offset(offset);
    return listPage(
      rows.map((row: DeviceInstanceRow) => decodeDeviceInstanceRow(row)),
      countRow?.count ?? 0,
      query,
    );
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

  /** Returns a bounded page of device activations ordered by instance id. */
  async listPage(query: BoundedListQuery): Promise<DeviceActivation[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deviceActivations).orderBy(
      deviceActivations.instanceId,
    ).limit(limit).offset(offset);
    return rows.map((row: DeviceActivationRow) =>
      decodeDeviceActivationRow(row)
    );
  }

  /** Returns device activations matching simple indexed filters. */
  async listFiltered(filters: {
    instanceId?: string;
    deploymentId?: string;
    state?: string;
  }, query: BoundedListQuery): Promise<DeviceActivation[]> {
    const { offset, limit } = boundedListQuery(query);
    const conditions: SQL[] = [];
    if (filters.instanceId !== undefined) {
      conditions.push(eq(deviceActivations.instanceId, filters.instanceId));
    }
    if (filters.deploymentId !== undefined) {
      conditions.push(eq(deviceActivations.deploymentId, filters.deploymentId));
    }
    if (filters.state !== undefined) {
      conditions.push(eq(deviceActivations.state, filters.state));
    }
    if (conditions.length === 0) return await this.listPage(query);
    const rows = await this.#db.select().from(deviceActivations).where(
      and(...conditions),
    ).orderBy(deviceActivations.instanceId).limit(limit).offset(offset);
    return rows.map((row: DeviceActivationRow) =>
      decodeDeviceActivationRow(row)
    );
  }

  /** Returns a counted page of device activations matching simple indexed filters. */
  async listFilteredPage(filters: {
    instanceId?: string;
    deploymentId?: string;
    state?: string;
  }, query: BoundedListQuery): Promise<ListPage<DeviceActivation>> {
    const conditions: SQL[] = [];
    if (filters.instanceId !== undefined) {
      conditions.push(eq(deviceActivations.instanceId, filters.instanceId));
    }
    if (filters.deploymentId !== undefined) {
      conditions.push(eq(deviceActivations.deploymentId, filters.deploymentId));
    }
    if (filters.state !== undefined) {
      conditions.push(eq(deviceActivations.state, filters.state));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      deviceActivations,
    ).where(where);
    const rows = await this.#db.select().from(deviceActivations).where(where)
      .orderBy(deviceActivations.instanceId).limit(limit).offset(offset);
    return listPage(
      rows.map((row: DeviceActivationRow) => decodeDeviceActivationRow(row)),
      countRow?.count ?? 0,
      query,
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

  /** Returns a bounded page of device activation reviews ordered by review id. */
  async listPage(
    query: BoundedListQuery,
  ): Promise<DeviceActivationReviewRecord[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(deviceActivationReviews).orderBy(
      deviceActivationReviews.reviewId,
    ).limit(limit).offset(offset);
    return rows.map((row: DeviceActivationReviewRow) =>
      decodeDeviceActivationReviewRow(row)
    );
  }

  /** Returns device activation reviews matching simple indexed filters. */
  async listFiltered(filters: {
    instanceId?: string;
    deploymentId?: string;
    state?: string;
    deploymentIds?: Iterable<string>;
  }, query: BoundedListQuery): Promise<DeviceActivationReviewRecord[]> {
    const { offset, limit } = boundedListQuery(query);
    const conditions: SQL[] = [];
    if (filters.instanceId !== undefined) {
      conditions.push(
        eq(deviceActivationReviews.instanceId, filters.instanceId),
      );
    }
    if (filters.deploymentId !== undefined) {
      conditions.push(
        eq(deviceActivationReviews.deploymentId, filters.deploymentId),
      );
    }
    if (filters.deploymentIds !== undefined) {
      const requested = [...new Set(filters.deploymentIds)];
      if (requested.length === 0) return [];
      conditions.push(inArray(deviceActivationReviews.deploymentId, requested));
    }
    if (filters.state !== undefined) {
      conditions.push(eq(deviceActivationReviews.state, filters.state));
    }
    if (conditions.length === 0) return await this.listPage(query);
    const rows = await this.#db.select().from(deviceActivationReviews).where(
      and(...conditions),
    ).orderBy(
      deviceActivationReviews.requestedAt,
      deviceActivationReviews.reviewId,
    ).limit(limit).offset(offset);
    return rows.map((row: DeviceActivationReviewRow) =>
      decodeDeviceActivationReviewRow(row)
    );
  }

  /** Returns a counted page of device activation reviews matching simple indexed filters. */
  async listFilteredPage(filters: {
    instanceId?: string;
    deploymentId?: string;
    state?: string;
    deploymentIds?: Iterable<string>;
  }, query: BoundedListQuery): Promise<ListPage<DeviceActivationReviewRecord>> {
    const conditions: SQL[] = [];
    if (filters.instanceId !== undefined) {
      conditions.push(
        eq(deviceActivationReviews.instanceId, filters.instanceId),
      );
    }
    if (filters.deploymentId !== undefined) {
      conditions.push(
        eq(deviceActivationReviews.deploymentId, filters.deploymentId),
      );
    }
    if (filters.deploymentIds !== undefined) {
      const requested = [...new Set(filters.deploymentIds)];
      if (requested.length === 0) return listPage([], 0, query);
      conditions.push(inArray(deviceActivationReviews.deploymentId, requested));
    }
    if (filters.state !== undefined) {
      conditions.push(eq(deviceActivationReviews.state, filters.state));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      deviceActivationReviews,
    ).where(where);
    const rows = await this.#db.select().from(deviceActivationReviews).where(
      where,
    )
      .orderBy(
        deviceActivationReviews.requestedAt,
        deviceActivationReviews.reviewId,
      )
      .limit(limit).offset(offset);
    return listPage(
      rows.map((row: DeviceActivationReviewRow) =>
        decodeDeviceActivationReviewRow(row)
      ),
      countRow?.count ?? 0,
      query,
    );
  }
}
