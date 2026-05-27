import { and, count, eq, inArray, type SQL } from "drizzle-orm";
import type { StaticDecode } from "typebox";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import { serviceDeployments, serviceInstances } from "../../storage/schema.ts";
import { ServiceDeploymentSchema, ServiceInstanceSchema } from "../schemas.ts";
import {
  type BoundedListQuery,
  boundedListQuery,
  type ListPage,
  listPage,
  parseJsonField,
} from "./shared.ts";

type ServiceDeployment = StaticDecode<typeof ServiceDeploymentSchema>;
type ServiceInstance = StaticDecode<typeof ServiceInstanceSchema>;

type ServiceDeploymentRow = typeof serviceDeployments.$inferSelect;
type ServiceDeploymentInsert = typeof serviceDeployments.$inferInsert;
type ServiceInstanceRow = typeof serviceInstances.$inferSelect;
type ServiceInstanceInsert = typeof serviceInstances.$inferInsert;

type DisabledFilter = { disabled?: boolean };

function decodeServiceDeploymentRow(
  row: ServiceDeploymentRow,
): ServiceDeployment {
  return Value.Decode(ServiceDeploymentSchema, {
    deploymentId: row.deploymentId,
    namespaces: parseJsonField("service deployment namespaces", row.namespaces),
    contractCompatibilityMode: row.contractCompatibilityMode,
    disabled: row.disabled,
  });
}

function encodeServiceDeploymentRecord(
  record: ServiceDeployment,
): ServiceDeploymentInsert {
  return {
    deploymentId: record.deploymentId,
    namespaces: JSON.stringify(record.namespaces),
    contractCompatibilityMode: record.contractCompatibilityMode ?? "strict",
    disabled: record.disabled,
  };
}

function decodeServiceInstanceRow(row: ServiceInstanceRow): ServiceInstance {
  return Value.Decode(ServiceInstanceSchema, {
    instanceId: row.instanceId,
    deploymentId: row.deploymentId,
    instanceKey: row.instanceKey,
    disabled: row.disabled,
    capabilities: parseJsonField(
      "service instance capabilities",
      row.capabilities,
    ),
    resourceBindings: row.resourceBindings === null
      ? undefined
      : parseJsonField(
        "service instance resource bindings",
        row.resourceBindings,
      ),
    createdAt: row.createdAt,
  });
}

function encodeServiceInstanceRecord(
  record: ServiceInstance,
): ServiceInstanceInsert {
  return {
    instanceId: record.instanceId,
    deploymentId: record.deploymentId,
    instanceKey: record.instanceKey,
    disabled: record.disabled,
    capabilities: JSON.stringify(record.capabilities),
    resourceBindings: record.resourceBindings === undefined
      ? null
      : JSON.stringify(record.resourceBindings),
    createdAt: record.createdAt,
  };
}

/** Stores durable service deployment records in SQL. */
export class SqlServiceDeploymentRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a service deployment repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a service deployment by deployment id, or undefined when absent. */
  async get(deploymentId: string): Promise<ServiceDeployment | undefined> {
    const rows = await this.#db.select().from(serviceDeployments).where(
      eq(serviceDeployments.deploymentId, deploymentId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeServiceDeploymentRow(row);
  }

  /** Inserts or replaces a service deployment keyed by deployment id. */
  async put(record: ServiceDeployment): Promise<void> {
    const row = encodeServiceDeploymentRecord(record);
    await this.#db.insert(serviceDeployments).values(row).onConflictDoUpdate({
      target: serviceDeployments.deploymentId,
      set: {
        namespaces: row.namespaces,
        contractCompatibilityMode: row.contractCompatibilityMode,
        disabled: row.disabled,
      },
    });
  }

  /** Deletes a service deployment by deployment id. */
  async delete(deploymentId: string): Promise<void> {
    await this.#db.delete(serviceDeployments).where(
      eq(serviceDeployments.deploymentId, deploymentId),
    );
  }

  /** Returns a bounded page of service deployments ordered by deployment id. */
  async listPage(query: BoundedListQuery): Promise<ServiceDeployment[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(serviceDeployments).orderBy(
      serviceDeployments.deploymentId,
    ).limit(limit).offset(offset);
    return rows.map((row: ServiceDeploymentRow) =>
      decodeServiceDeploymentRow(row)
    );
  }

  /** Returns service deployments for requested deployment ids. */
  async listByDeploymentIds(
    deploymentIds: Iterable<string>,
    filters: DisabledFilter = {},
  ): Promise<ServiceDeployment[]> {
    const requested = [...new Set(deploymentIds)];
    if (requested.length === 0) return [];
    const conditions: SQL[] = [
      inArray(serviceDeployments.deploymentId, requested),
    ];
    if (filters.disabled !== undefined) {
      conditions.push(eq(serviceDeployments.disabled, filters.disabled));
    }
    const rows = await this.#db.select().from(serviceDeployments).where(
      and(...conditions),
    ).orderBy(serviceDeployments.deploymentId);
    return rows.map((row: ServiceDeploymentRow) =>
      decodeServiceDeploymentRow(row)
    );
  }

  /** Returns service deployments matching simple indexed filters. */
  async listFiltered(
    filters: DisabledFilter,
    query: BoundedListQuery,
  ): Promise<ServiceDeployment[]> {
    const { offset, limit } = boundedListQuery(query);
    if (filters.disabled === undefined) return await this.listPage(query);
    const rows = await this.#db.select().from(serviceDeployments).where(
      eq(serviceDeployments.disabled, filters.disabled),
    ).orderBy(serviceDeployments.deploymentId).limit(limit).offset(offset);
    return rows.map((row: ServiceDeploymentRow) =>
      decodeServiceDeploymentRow(row)
    );
  }

  /** Returns a counted page of service deployments matching simple indexed filters. */
  async listFilteredPage(
    filters: DisabledFilter,
    query: BoundedListQuery,
  ): Promise<ListPage<ServiceDeployment>> {
    const conditions: SQL[] = [];
    if (filters.disabled !== undefined) {
      conditions.push(eq(serviceDeployments.disabled, filters.disabled));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      serviceDeployments,
    ).where(where);
    const rows = await this.#db.select().from(serviceDeployments).where(where)
      .orderBy(serviceDeployments.deploymentId).limit(limit).offset(offset);
    return listPage(
      rows.map((row: ServiceDeploymentRow) => decodeServiceDeploymentRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }
}

/** Stores durable service instance records in SQL. */
export class SqlServiceInstanceRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a service instance repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a service instance by instance id, or undefined when absent. */
  async get(instanceId: string): Promise<ServiceInstance | undefined> {
    const rows = await this.#db.select().from(serviceInstances).where(
      eq(serviceInstances.instanceId, instanceId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeServiceInstanceRow(row);
  }

  /** Returns a service instance by instance key, or undefined. */
  async getByInstanceKey(
    instanceKey: string,
  ): Promise<ServiceInstance | undefined> {
    const rows = await this.#db.select().from(serviceInstances).where(
      eq(serviceInstances.instanceKey, instanceKey),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeServiceInstanceRow(row);
  }

  /** Inserts or replaces a service instance keyed by instance id. */
  async put(record: ServiceInstance): Promise<void> {
    const row = encodeServiceInstanceRecord(record);
    await this.#db.insert(serviceInstances).values(row).onConflictDoUpdate({
      target: serviceInstances.instanceId,
      set: {
        deploymentId: row.deploymentId,
        instanceKey: row.instanceKey,
        disabled: row.disabled,
        capabilities: row.capabilities,
        resourceBindings: row.resourceBindings,
        createdAt: row.createdAt,
      },
    });
  }

  /** Deletes a service instance by instance id. */
  async delete(instanceId: string): Promise<void> {
    await this.#db.delete(serviceInstances).where(
      eq(serviceInstances.instanceId, instanceId),
    );
  }

  /** Returns a bounded page of service instances ordered by instance id. */
  async listPage(query: BoundedListQuery): Promise<ServiceInstance[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(serviceInstances).orderBy(
      serviceInstances.instanceId,
    ).limit(limit).offset(offset);
    return rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row));
  }

  /** Returns service instances matching simple indexed filters. */
  async listFiltered(
    filters: DisabledFilter,
    query: BoundedListQuery,
  ): Promise<ServiceInstance[]> {
    const { offset, limit } = boundedListQuery(query);
    if (filters.disabled === undefined) return await this.listPage(query);
    const rows = await this.#db.select().from(serviceInstances).where(
      eq(serviceInstances.disabled, filters.disabled),
    ).orderBy(serviceInstances.instanceId).limit(limit).offset(offset);
    return rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row));
  }

  /** Returns a counted page of service instances matching simple indexed filters. */
  async listFilteredPage(
    filters: DisabledFilter & { deploymentId?: string },
    query: BoundedListQuery,
  ): Promise<ListPage<ServiceInstance>> {
    const conditions: SQL[] = [];
    if (filters.deploymentId !== undefined) {
      conditions.push(eq(serviceInstances.deploymentId, filters.deploymentId));
    }
    if (filters.disabled !== undefined) {
      conditions.push(eq(serviceInstances.disabled, filters.disabled));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      serviceInstances,
    ).where(where);
    const rows = await this.#db.select().from(serviceInstances).where(where)
      .orderBy(serviceInstances.instanceId).limit(limit).offset(offset);
    return listPage(
      rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Returns service instances for one deployment ordered by instance id. */
  async listByDeployment(
    deploymentId: string,
    filters: DisabledFilter = {},
  ): Promise<ServiceInstance[]> {
    const conditions: SQL[] = [eq(serviceInstances.deploymentId, deploymentId)];
    if (filters.disabled !== undefined) {
      conditions.push(eq(serviceInstances.disabled, filters.disabled));
    }
    const rows = await this.#db.select().from(serviceInstances).where(
      and(...conditions),
    ).orderBy(serviceInstances.instanceId);
    return rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row));
  }

  /** Returns instances for deployments ordered by deployment and instance id. */
  async listByDeployments(
    deploymentIds: Iterable<string>,
    filters: DisabledFilter = {},
  ): Promise<ServiceInstance[]> {
    const requestedDeployments = [...new Set(deploymentIds)];
    if (requestedDeployments.length === 0) return [];
    const conditions: SQL[] = [
      inArray(serviceInstances.deploymentId, requestedDeployments),
    ];
    if (filters.disabled !== undefined) {
      conditions.push(eq(serviceInstances.disabled, filters.disabled));
    }
    const rows = await this.#db.select().from(serviceInstances).where(
      and(...conditions),
    ).orderBy(
      serviceInstances.deploymentId,
      serviceInstances.instanceId,
    );
    return rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row));
  }
}
