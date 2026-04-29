import { eq } from "drizzle-orm";
import type { StaticDecode } from "typebox";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import { serviceDeployments, serviceInstances } from "../../storage/schema.ts";
import { ServiceDeploymentSchema, ServiceInstanceSchema } from "../schemas.ts";
import { parseJsonField } from "./shared.ts";

type ServiceDeployment = StaticDecode<typeof ServiceDeploymentSchema>;
type ServiceInstance = StaticDecode<typeof ServiceInstanceSchema>;

type ServiceDeploymentRow = typeof serviceDeployments.$inferSelect;
type ServiceDeploymentInsert = typeof serviceDeployments.$inferInsert;
type ServiceInstanceRow = typeof serviceInstances.$inferSelect;
type ServiceInstanceInsert = typeof serviceInstances.$inferInsert;

function decodeServiceDeploymentRow(
  row: ServiceDeploymentRow,
): ServiceDeployment {
  return Value.Decode(ServiceDeploymentSchema, {
    deploymentId: row.deploymentId,
    namespaces: parseJsonField("service deployment namespaces", row.namespaces),
    disabled: row.disabled,
    appliedContracts: parseJsonField(
      "service deployment applied contracts",
      row.appliedContracts,
    ),
  });
}

function encodeServiceDeploymentRecord(
  record: ServiceDeployment,
): ServiceDeploymentInsert {
  return {
    deploymentId: record.deploymentId,
    namespaces: JSON.stringify(record.namespaces),
    disabled: record.disabled,
    appliedContracts: JSON.stringify(record.appliedContracts),
  };
}

function decodeServiceInstanceRow(row: ServiceInstanceRow): ServiceInstance {
  return Value.Decode(ServiceInstanceSchema, {
    instanceId: row.instanceId,
    deploymentId: row.deploymentId,
    instanceKey: row.instanceKey,
    disabled: row.disabled,
    currentContractId: row.currentContractId ?? undefined,
    currentContractDigest: row.currentContractDigest ?? undefined,
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
    currentContractId: record.currentContractId ?? null,
    currentContractDigest: record.currentContractDigest ?? null,
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
        disabled: row.disabled,
        appliedContracts: row.appliedContracts,
      },
    });
  }

  /** Deletes a service deployment by deployment id. */
  async delete(deploymentId: string): Promise<void> {
    await this.#db.delete(serviceDeployments).where(
      eq(serviceDeployments.deploymentId, deploymentId),
    );
  }

  /** Returns service deployments ordered by deployment id. */
  async list(): Promise<ServiceDeployment[]> {
    const rows = await this.#db.select().from(serviceDeployments).orderBy(
      serviceDeployments.deploymentId,
    );
    return rows.map((row: ServiceDeploymentRow) =>
      decodeServiceDeploymentRow(row)
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
        currentContractId: row.currentContractId,
        currentContractDigest: row.currentContractDigest,
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

  /** Returns service instances ordered by instance id. */
  async list(): Promise<ServiceInstance[]> {
    const rows = await this.#db.select().from(serviceInstances).orderBy(
      serviceInstances.instanceId,
    );
    return rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row));
  }

  /** Returns service instances for one deployment ordered by instance id. */
  async listByDeployment(deploymentId: string): Promise<ServiceInstance[]> {
    const rows = await this.#db.select().from(serviceInstances).where(
      eq(serviceInstances.deploymentId, deploymentId),
    ).orderBy(serviceInstances.instanceId);
    return rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row));
  }
}
