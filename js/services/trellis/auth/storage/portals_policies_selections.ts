import { eq } from "drizzle-orm";
import type { StaticDecode } from "typebox";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import {
  devicePortalSelections,
  instanceGrantPolicies,
  loginPortalSelections,
  portalDefaults,
  portalProfiles,
  portals,
} from "../../storage/schema.ts";
import {
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  type InstanceGrantPolicy,
  InstanceGrantPolicySchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  type PortalProfile,
  PortalProfileSchema,
  PortalSchema,
} from "../schemas.ts";
import {
  decodeStringArrayField,
  optionalJsonStringArray,
  parseJsonField,
} from "./shared.ts";

type Portal = StaticDecode<typeof PortalSchema>;
type LoginPortalDefault = StaticDecode<typeof LoginPortalDefaultSchema>;
type DevicePortalDefault = StaticDecode<typeof DevicePortalDefaultSchema>;
type LoginPortalSelection = StaticDecode<typeof LoginPortalSelectionSchema>;
type DevicePortalSelection = StaticDecode<typeof DevicePortalSelectionSchema>;

type PortalRow = typeof portals.$inferSelect;
type PortalInsert = typeof portals.$inferInsert;
type PortalProfileRow = typeof portalProfiles.$inferSelect;
type PortalProfileInsert = typeof portalProfiles.$inferInsert;
type PortalDefaultRow = typeof portalDefaults.$inferSelect;
type PortalDefaultInsert = typeof portalDefaults.$inferInsert;
type LoginPortalSelectionRow = typeof loginPortalSelections.$inferSelect;
type LoginPortalSelectionInsert = typeof loginPortalSelections.$inferInsert;
type DevicePortalSelectionRow = typeof devicePortalSelections.$inferSelect;
type DevicePortalSelectionInsert = typeof devicePortalSelections.$inferInsert;
type InstanceGrantPolicyRow = typeof instanceGrantPolicies.$inferSelect;
type InstanceGrantPolicyInsert = typeof instanceGrantPolicies.$inferInsert;

const LOGIN_DEFAULT_KEY = "login.default";
const DEVICE_DEFAULT_KEY = "device.default";

function decodePortalRow(row: PortalRow): Portal {
  return Value.Decode(PortalSchema, {
    portalId: row.portalId,
    entryUrl: row.entryUrl,
    disabled: row.disabled,
  });
}

function encodePortalRecord(record: Portal): PortalInsert {
  return {
    portalId: record.portalId,
    entryUrl: record.entryUrl,
    disabled: record.disabled,
  };
}

function decodePortalProfileRow(row: PortalProfileRow): PortalProfile {
  return Value.Decode(PortalProfileSchema, {
    portalId: row.portalId,
    entryUrl: row.entryUrl,
    contractId: row.contractId,
    allowedOrigins: optionalJsonStringArray(
      "portal profile allowed origins",
      row.allowedOrigins,
    ),
    impliedCapabilities: decodeStringArrayField(
      "portal profile implied capabilities",
      row.impliedCapabilities,
    ),
    disabled: row.disabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function encodePortalProfileRecord(record: PortalProfile): PortalProfileInsert {
  return {
    portalId: record.portalId,
    entryUrl: record.entryUrl,
    contractId: record.contractId,
    allowedOrigins: record.allowedOrigins === undefined
      ? null
      : JSON.stringify(record.allowedOrigins),
    impliedCapabilities: JSON.stringify(record.impliedCapabilities),
    disabled: record.disabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function decodeLoginPortalDefaultRow(
  row: PortalDefaultRow,
): LoginPortalDefault {
  return Value.Decode(LoginPortalDefaultSchema, { portalId: row.portalId });
}

function decodeDevicePortalDefaultRow(
  row: PortalDefaultRow,
): DevicePortalDefault {
  return Value.Decode(DevicePortalDefaultSchema, { portalId: row.portalId });
}

function encodePortalDefaultRecord(
  defaultKey: string,
  record: LoginPortalDefault,
): PortalDefaultInsert {
  return { defaultKey, portalId: record.portalId };
}

function decodeLoginPortalSelectionRow(
  row: LoginPortalSelectionRow,
): LoginPortalSelection {
  return Value.Decode(LoginPortalSelectionSchema, {
    contractId: row.contractId,
    portalId: row.portalId,
  });
}

function encodeLoginPortalSelectionRecord(
  record: LoginPortalSelection,
): LoginPortalSelectionInsert {
  return {
    contractId: record.contractId,
    portalId: record.portalId,
  };
}

function decodeDevicePortalSelectionRow(
  row: DevicePortalSelectionRow,
): DevicePortalSelection {
  return Value.Decode(DevicePortalSelectionSchema, {
    deploymentId: row.deploymentId,
    portalId: row.portalId,
  });
}

function encodeDevicePortalSelectionRecord(
  record: DevicePortalSelection,
): DevicePortalSelectionInsert {
  return {
    deploymentId: record.deploymentId,
    portalId: record.portalId,
  };
}

function decodeInstanceGrantPolicyRow(
  row: InstanceGrantPolicyRow,
): InstanceGrantPolicy {
  return Value.Decode(InstanceGrantPolicySchema, {
    contractId: row.contractId,
    allowedOrigins: optionalJsonStringArray(
      "instance grant policy allowed origins",
      row.allowedOrigins,
    ),
    impliedCapabilities: decodeStringArrayField(
      "instance grant policy implied capabilities",
      row.impliedCapabilities,
    ),
    disabled: row.disabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: parseJsonField("instance grant policy source", row.source),
  });
}

function encodeInstanceGrantPolicyRecord(
  record: InstanceGrantPolicy,
): InstanceGrantPolicyInsert {
  return {
    contractId: record.contractId,
    allowedOrigins: record.allowedOrigins === undefined
      ? null
      : JSON.stringify(record.allowedOrigins),
    impliedCapabilities: JSON.stringify(record.impliedCapabilities),
    disabled: record.disabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: JSON.stringify(record.source),
  };
}

/** Stores durable portal records in SQL. */
export class SqlPortalRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a portal repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a portal by portal id, or undefined when absent. */
  async get(portalId: string): Promise<Portal | undefined> {
    const rows = await this.#db.select().from(portals).where(
      eq(portals.portalId, portalId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodePortalRow(row);
  }

  /** Inserts or replaces a portal keyed by portal id. */
  async put(record: Portal): Promise<void> {
    const row = encodePortalRecord(record);
    await this.#db.insert(portals).values(row).onConflictDoUpdate({
      target: portals.portalId,
      set: {
        entryUrl: row.entryUrl,
        disabled: row.disabled,
      },
    });
  }

  /** Returns portals ordered by portal id. */
  async list(): Promise<Portal[]> {
    const rows = await this.#db.select().from(portals).orderBy(
      portals.portalId,
    );
    return rows.map((row: PortalRow) => decodePortalRow(row));
  }
}

/** Stores durable portal profile records in SQL. */
export class SqlPortalProfileRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a portal profile repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a portal profile by portal id, or undefined when absent. */
  async get(portalId: string): Promise<PortalProfile | undefined> {
    const rows = await this.#db.select().from(portalProfiles).where(
      eq(portalProfiles.portalId, portalId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodePortalProfileRow(row);
  }

  /** Inserts or replaces a portal profile keyed by portal id. */
  async put(record: PortalProfile): Promise<void> {
    const row = encodePortalProfileRecord(record);
    await this.#db.insert(portalProfiles).values(row).onConflictDoUpdate({
      target: portalProfiles.portalId,
      set: {
        entryUrl: row.entryUrl,
        contractId: row.contractId,
        allowedOrigins: row.allowedOrigins,
        impliedCapabilities: row.impliedCapabilities,
        disabled: row.disabled,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  }

  /** Deletes a portal profile by portal id. */
  async delete(portalId: string): Promise<void> {
    await this.#db.delete(portalProfiles).where(
      eq(portalProfiles.portalId, portalId),
    );
  }

  /** Returns portal profiles ordered by portal id. */
  async list(): Promise<PortalProfile[]> {
    const rows = await this.#db.select().from(portalProfiles).orderBy(
      portalProfiles.portalId,
    );
    return rows.map((row: PortalProfileRow) => decodePortalProfileRow(row));
  }
}

/** Stores durable login and device portal defaults in SQL. */
export class SqlPortalDefaultRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a portal default repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns the login portal default, or undefined when absent. */
  async getLogin(): Promise<LoginPortalDefault | undefined> {
    const rows = await this.#db.select().from(portalDefaults).where(
      eq(portalDefaults.defaultKey, LOGIN_DEFAULT_KEY),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeLoginPortalDefaultRow(row);
  }

  /** Inserts or replaces the login portal default. */
  async putLogin(record: LoginPortalDefault): Promise<void> {
    const row = encodePortalDefaultRecord(LOGIN_DEFAULT_KEY, record);
    await this.#db.insert(portalDefaults).values(row).onConflictDoUpdate({
      target: portalDefaults.defaultKey,
      set: { portalId: row.portalId },
    });
  }

  /** Returns the device portal default, or undefined when absent. */
  async getDevice(): Promise<DevicePortalDefault | undefined> {
    const rows = await this.#db.select().from(portalDefaults).where(
      eq(portalDefaults.defaultKey, DEVICE_DEFAULT_KEY),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDevicePortalDefaultRow(row);
  }

  /** Inserts or replaces the device portal default. */
  async putDevice(record: DevicePortalDefault): Promise<void> {
    const row = encodePortalDefaultRecord(DEVICE_DEFAULT_KEY, record);
    await this.#db.insert(portalDefaults).values(row).onConflictDoUpdate({
      target: portalDefaults.defaultKey,
      set: { portalId: row.portalId },
    });
  }
}

/** Stores durable login portal selections in SQL. */
export class SqlLoginPortalSelectionRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a login portal selection repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a login portal selection by contract id, or undefined when absent. */
  async get(contractId: string): Promise<LoginPortalSelection | undefined> {
    const rows = await this.#db.select().from(loginPortalSelections).where(
      eq(loginPortalSelections.contractId, contractId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeLoginPortalSelectionRow(row);
  }

  /** Inserts or replaces a login portal selection keyed by contract id. */
  async put(record: LoginPortalSelection): Promise<void> {
    const row = encodeLoginPortalSelectionRecord(record);
    await this.#db.insert(loginPortalSelections).values(row)
      .onConflictDoUpdate({
        target: loginPortalSelections.contractId,
        set: {
          portalId: row.portalId,
        },
      });
  }

  /** Deletes a login portal selection by contract id. */
  async delete(contractId: string): Promise<void> {
    await this.#db.delete(loginPortalSelections).where(
      eq(loginPortalSelections.contractId, contractId),
    );
  }

  /** Returns login portal selections ordered by contract id. */
  async list(): Promise<LoginPortalSelection[]> {
    const rows = await this.#db.select().from(loginPortalSelections).orderBy(
      loginPortalSelections.contractId,
    );
    return rows.map((row: LoginPortalSelectionRow) =>
      decodeLoginPortalSelectionRow(row)
    );
  }
}

/** Stores durable device portal selections in SQL. */
export class SqlDevicePortalSelectionRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a device portal selection repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a device portal selection by deployment id, or undefined when absent. */
  async get(deploymentId: string): Promise<DevicePortalSelection | undefined> {
    const rows = await this.#db.select().from(devicePortalSelections).where(
      eq(devicePortalSelections.deploymentId, deploymentId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDevicePortalSelectionRow(row);
  }

  /** Inserts or replaces a device portal selection keyed by deployment id. */
  async put(record: DevicePortalSelection): Promise<void> {
    const row = encodeDevicePortalSelectionRecord(record);
    await this.#db.insert(devicePortalSelections).values(row)
      .onConflictDoUpdate({
        target: devicePortalSelections.deploymentId,
        set: {
          portalId: row.portalId,
        },
      });
  }

  /** Deletes a device portal selection by deployment id. */
  async delete(deploymentId: string): Promise<void> {
    await this.#db.delete(devicePortalSelections).where(
      eq(devicePortalSelections.deploymentId, deploymentId),
    );
  }

  /** Returns device portal selections ordered by deployment id. */
  async list(): Promise<DevicePortalSelection[]> {
    const rows = await this.#db.select().from(devicePortalSelections).orderBy(
      devicePortalSelections.deploymentId,
    );
    return rows.map((row: DevicePortalSelectionRow) =>
      decodeDevicePortalSelectionRow(row)
    );
  }
}

/** Stores durable instance grant policies in SQL. */
export class SqlInstanceGrantPolicyRepository {
  readonly #db: TrellisStorageDb;

  /** Creates an instance grant policy repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns an instance grant policy by contract id, or undefined when absent. */
  async get(contractId: string): Promise<InstanceGrantPolicy | undefined> {
    const rows = await this.#db.select().from(instanceGrantPolicies).where(
      eq(instanceGrantPolicies.contractId, contractId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeInstanceGrantPolicyRow(row);
  }

  /** Inserts or replaces an instance grant policy keyed by contract id. */
  async put(record: InstanceGrantPolicy): Promise<void> {
    const row = encodeInstanceGrantPolicyRecord(record);
    await this.#db.insert(instanceGrantPolicies).values(row)
      .onConflictDoUpdate({
        target: instanceGrantPolicies.contractId,
        set: {
          allowedOrigins: row.allowedOrigins,
          impliedCapabilities: row.impliedCapabilities,
          disabled: row.disabled,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          source: row.source,
        },
      });
  }

  /** Deletes an instance grant policy by contract id. */
  async delete(contractId: string): Promise<void> {
    await this.#db.delete(instanceGrantPolicies).where(
      eq(instanceGrantPolicies.contractId, contractId),
    );
  }

  /** Returns instance grant policies ordered by contract id. */
  async list(): Promise<InstanceGrantPolicy[]> {
    const rows = await this.#db.select().from(instanceGrantPolicies).orderBy(
      instanceGrantPolicies.contractId,
    );
    return rows.map((row: InstanceGrantPolicyRow) =>
      decodeInstanceGrantPolicyRow(row)
    );
  }
}
