import { and, eq, lt } from "drizzle-orm";
import Value from "typebox/value";
import type { StaticDecode } from "typebox";

import type { TrellisStorageDb } from "../storage/db.ts";
import {
  contractApprovals,
  deviceActivationReviews,
  deviceActivations,
  deviceInstances,
  devicePortalSelections,
  deviceProfiles,
  deviceProvisioningSecrets,
  instanceGrantPolicies,
  loginPortalSelections,
  portalDefaults,
  portalProfiles,
  portals,
  serviceInstances,
  serviceProfiles,
  sessions,
  users,
} from "../storage/schema.ts";
import {
  type ContractApprovalRecord,
  ContractApprovalRecordSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewRecordSchema,
  DevicePortalDefaultSchema,
  DevicePortalSelectionSchema,
  DeviceProfileSchema,
  DeviceProvisioningSecretSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  PortalProfileSchema,
  PortalSchema,
  ServiceInstanceSchema,
  ServiceProfileSchema,
  type Session,
  SessionSchema,
  type UserProjectionEntry,
  UserProjectionSchema,
} from "../state/schemas.ts";

type Portal = StaticDecode<typeof PortalSchema>;
type PortalProfile = StaticDecode<typeof PortalProfileSchema>;
type LoginPortalDefault = StaticDecode<typeof LoginPortalDefaultSchema>;
type DevicePortalDefault = StaticDecode<typeof DevicePortalDefaultSchema>;
type LoginPortalSelection = StaticDecode<typeof LoginPortalSelectionSchema>;
type DevicePortalSelection = StaticDecode<typeof DevicePortalSelectionSchema>;
type InstanceGrantPolicy = StaticDecode<typeof InstanceGrantPolicySchema>;
type ServiceProfile = StaticDecode<typeof ServiceProfileSchema>;
type ServiceInstance = StaticDecode<typeof ServiceInstanceSchema>;
type DeviceProfile = StaticDecode<typeof DeviceProfileSchema>;
type DeviceInstance = StaticDecode<typeof DeviceSchema>;
type DeviceProvisioningSecret = {
  instanceId: string;
  activationKey: string;
  createdAt: string | Date;
};
type DeviceActivation = StaticDecode<typeof DeviceActivationRecordSchema>;
type DeviceActivationReviewRecord = {
  reviewId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  requestedBy: { origin: string; id: string };
  state: "pending" | "approved" | "rejected";
  requestedAt: string | Date;
  decidedAt: string | Date | null;
  reason?: string;
};

type UserRow = typeof users.$inferSelect;
type UserInsert = typeof users.$inferInsert;
type ContractApprovalRow = typeof contractApprovals.$inferSelect;
type ContractApprovalInsert = typeof contractApprovals.$inferInsert;
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
type ServiceProfileRow = typeof serviceProfiles.$inferSelect;
type ServiceProfileInsert = typeof serviceProfiles.$inferInsert;
type ServiceInstanceRow = typeof serviceInstances.$inferSelect;
type ServiceInstanceInsert = typeof serviceInstances.$inferInsert;
type DeviceProfileRow = typeof deviceProfiles.$inferSelect;
type DeviceProfileInsert = typeof deviceProfiles.$inferInsert;
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
type SessionRow = typeof sessions.$inferSelect;
type SessionInsert = typeof sessions.$inferInsert;

export type SessionStorageEntry = {
  sessionKey: string;
  trellisId: string;
  session: Session;
};

const LOGIN_DEFAULT_KEY = "login.default";
const DEVICE_DEFAULT_KEY = "device.default";

function parseJsonField(name: string, value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch (cause) {
    throw new Error(`Invalid JSON stored for auth ${name}`, { cause });
  }
}

function decodeUserRow(row: UserRow): UserProjectionEntry {
  return Value.Decode(UserProjectionSchema, {
    origin: row.origin,
    id: row.externalId,
    name: row.name ?? undefined,
    email: row.email ?? undefined,
    active: row.active,
    capabilities: parseJsonField("user capabilities", row.capabilities),
  });
}

function encodeUserRecord(
  trellisId: string,
  record: UserProjectionEntry,
): UserInsert {
  return {
    trellisId,
    origin: record.origin,
    externalId: record.id,
    name: record.name ?? null,
    email: record.email ?? null,
    active: record.active,
    capabilities: JSON.stringify(record.capabilities),
  };
}

function decodeContractApprovalRow(
  row: ContractApprovalRow,
): ContractApprovalRecord {
  return Value.Decode(ContractApprovalRecordSchema, {
    userTrellisId: row.userTrellisId,
    origin: row.origin,
    id: row.externalId,
    answer: row.answer,
    answeredAt: row.answeredAt,
    updatedAt: row.updatedAt,
    approval: parseJsonField("contract approval", row.approval),
    publishSubjects: parseJsonField(
      "contract approval publish subjects",
      row.publishSubjects,
    ),
    subscribeSubjects: parseJsonField(
      "contract approval subscribe subjects",
      row.subscribeSubjects,
    ),
  });
}

function encodeContractApprovalRecord(
  record: ContractApprovalRecord,
): ContractApprovalInsert {
  return {
    userTrellisId: record.userTrellisId,
    origin: record.origin,
    externalId: record.id,
    contractDigest: record.approval.contractDigest,
    contractId: record.approval.contractId,
    participantKind: record.approval.participantKind,
    answer: record.answer,
    answeredAt: record.answeredAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    approval: JSON.stringify(record.approval),
    publishSubjects: JSON.stringify(record.publishSubjects),
    subscribeSubjects: JSON.stringify(record.subscribeSubjects),
  };
}

function decodeStringArrayField(name: string, value: string): string[] {
  const decoded = parseJsonField(name, value);
  if (!Array.isArray(decoded)) {
    throw new Error(`Invalid JSON array stored for auth ${name}`);
  }
  return decoded.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`Invalid JSON array entry stored for auth ${name}`);
    }
    return entry;
  });
}

function optionalJsonStringArray(
  name: string,
  value: string | null,
): string[] | undefined {
  return value === null ? undefined : decodeStringArrayField(name, value);
}

function loginSelectionKey(contractId: string): string {
  return `contract.${contractId}`;
}

function deviceSelectionKey(profileId: string): string {
  return `profile.${profileId}`;
}

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
    selectionKey: loginSelectionKey(record.contractId),
    contractId: record.contractId,
    portalId: record.portalId,
  };
}

function decodeDevicePortalSelectionRow(
  row: DevicePortalSelectionRow,
): DevicePortalSelection {
  return Value.Decode(DevicePortalSelectionSchema, {
    profileId: row.profileId,
    portalId: row.portalId,
  });
}

function encodeDevicePortalSelectionRecord(
  record: DevicePortalSelection,
): DevicePortalSelectionInsert {
  return {
    selectionKey: deviceSelectionKey(record.profileId),
    profileId: record.profileId,
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

function decodeServiceProfileRow(row: ServiceProfileRow): ServiceProfile {
  return Value.Decode(ServiceProfileSchema, {
    profileId: row.profileId,
    namespaces: parseJsonField("service profile namespaces", row.namespaces),
    disabled: row.disabled,
    appliedContracts: parseJsonField(
      "service profile applied contracts",
      row.appliedContracts,
    ),
  });
}

function encodeServiceProfileRecord(
  record: ServiceProfile,
): ServiceProfileInsert {
  return {
    profileId: record.profileId,
    namespaces: JSON.stringify(record.namespaces),
    disabled: record.disabled,
    appliedContracts: JSON.stringify(record.appliedContracts),
  };
}

function decodeServiceInstanceRow(row: ServiceInstanceRow): ServiceInstance {
  return Value.Decode(ServiceInstanceSchema, {
    instanceId: row.instanceId,
    profileId: row.profileId,
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
    profileId: record.profileId,
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

function decodeDeviceProfileRow(row: DeviceProfileRow): DeviceProfile {
  return Value.Decode(DeviceProfileSchema, {
    profileId: row.profileId,
    reviewMode: row.reviewMode ?? undefined,
    disabled: row.disabled,
    appliedContracts: parseJsonField(
      "device profile applied contracts",
      row.appliedContracts,
    ),
  });
}

function encodeDeviceProfileRecord(
  record: DeviceProfile,
): DeviceProfileInsert {
  return {
    profileId: record.profileId,
    reviewMode: record.reviewMode ?? null,
    disabled: record.disabled,
    appliedContracts: JSON.stringify(record.appliedContracts),
  };
}

function decodeDeviceInstanceRow(row: DeviceInstanceRow): DeviceInstance {
  return Value.Decode(DeviceSchema, {
    instanceId: row.instanceId,
    publicIdentityKey: row.publicIdentityKey,
    profileId: row.profileId,
    metadata: row.metadata === null
      ? undefined
      : parseJsonField("device instance metadata", row.metadata),
    state: row.state,
    currentContractId: row.currentContractId ?? undefined,
    currentContractDigest: row.currentContractDigest ?? undefined,
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
    profileId: record.profileId,
    metadata: record.metadata === undefined
      ? null
      : JSON.stringify(record.metadata),
    state: record.state,
    currentContractId: record.currentContractId ?? null,
    currentContractDigest: record.currentContractDigest ?? null,
    createdAt: record.createdAt,
    activatedAt: record.activatedAt,
    revokedAt: record.revokedAt,
  };
}

function isoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
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
    profileId: row.profileId,
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
    profileId: record.profileId,
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
    flowId: row.flowId,
    instanceId: row.instanceId,
    publicIdentityKey: row.publicIdentityKey,
    profileId: row.profileId,
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
    flowId: record.flowId,
    instanceId: record.instanceId,
    publicIdentityKey: record.publicIdentityKey,
    profileId: record.profileId,
    requestedBy: JSON.stringify(record.requestedBy),
    state: record.state,
    requestedAt: isoString(record.requestedAt),
    decidedAt: record.decidedAt === null ? null : isoString(record.decidedAt),
    reason: record.reason ?? null,
  };
}

function decodeSessionRow(row: SessionRow): Session {
  return Value.Decode(
    SessionSchema,
    parseJsonField("session", row.session),
  );
}

function decodeSessionEntry(row: SessionRow): SessionStorageEntry {
  return {
    sessionKey: row.sessionKey,
    trellisId: row.trellisId,
    session: decodeSessionRow(row),
  };
}

function sessionTrellisId(session: Session): string {
  return session.type === "device" ? session.instanceId : session.trellisId;
}

function encodeSessionRecord(
  sessionKey: string,
  session: Session,
): SessionInsert {
  const common = {
    sessionKey,
    trellisId: sessionTrellisId(session),
    type: session.type,
    createdAt: isoString(session.createdAt),
    lastAuth: isoString(session.lastAuth),
    session: JSON.stringify(session),
  };

  switch (session.type) {
    case "user":
      return {
        ...common,
        origin: session.origin,
        externalId: session.id,
        contractDigest: session.contractDigest,
        contractId: session.contractId,
        participantKind: session.participantKind,
        instanceId: null,
        profileId: null,
        instanceKey: null,
        publicIdentityKey: null,
        revokedAt: null,
      };
    case "service":
      return {
        ...common,
        origin: session.origin,
        externalId: session.id,
        contractDigest: session.currentContractDigest,
        contractId: session.currentContractId,
        participantKind: null,
        instanceId: session.instanceId,
        profileId: session.profileId,
        instanceKey: session.instanceKey,
        publicIdentityKey: null,
        revokedAt: null,
      };
    case "device":
      return {
        ...common,
        origin: null,
        externalId: null,
        contractDigest: session.contractDigest,
        contractId: session.contractId,
        participantKind: null,
        instanceId: session.instanceId,
        profileId: session.profileId,
        instanceKey: null,
        publicIdentityKey: session.publicIdentityKey,
        revokedAt: session.revokedAt === null
          ? null
          : isoString(session.revokedAt),
      };
  }
}

/** Stores durable auth-local user projections in SQL. */
export class SqlUserProjectionRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a user projection repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns the user projection for a Trellis id, or undefined when absent. */
  async get(trellisId: string): Promise<UserProjectionEntry | undefined> {
    const rows = await this.#db.select().from(users).where(
      eq(users.trellisId, trellisId),
    ).limit(1);

    const row = rows[0];
    return row === undefined ? undefined : decodeUserRow(row);
  }

  /** Inserts or replaces a user projection keyed by Trellis id. */
  async put(trellisId: string, record: UserProjectionEntry): Promise<void> {
    const row = encodeUserRecord(trellisId, record);
    await this.#db.insert(users).values(row).onConflictDoUpdate({
      target: users.trellisId,
      set: {
        origin: row.origin,
        externalId: row.externalId,
        name: row.name,
        email: row.email,
        active: row.active,
        capabilities: row.capabilities,
      },
    });
  }

  /** Returns all stored user projections ordered by Trellis id. */
  async list(): Promise<UserProjectionEntry[]> {
    const rows = await this.#db.select().from(users).orderBy(users.trellisId);
    return rows.map((row: UserRow) => decodeUserRow(row));
  }
}

/** Stores durable user contract approvals and grants in SQL. */
export class SqlContractApprovalRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a contract approval repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns one approval by user Trellis id and contract digest. */
  async get(
    userTrellisId: string,
    contractDigest: string,
  ): Promise<ContractApprovalRecord | undefined> {
    const rows = await this.#db.select().from(contractApprovals).where(
      and(
        eq(contractApprovals.userTrellisId, userTrellisId),
        eq(contractApprovals.contractDigest, contractDigest),
      ),
    ).limit(1);

    const row = rows[0];
    return row === undefined ? undefined : decodeContractApprovalRow(row);
  }

  /** Inserts or replaces an approval keyed by user Trellis id and digest. */
  async put(record: ContractApprovalRecord): Promise<void> {
    const row = encodeContractApprovalRecord(record);
    await this.#db.insert(contractApprovals).values(row).onConflictDoUpdate({
      target: [
        contractApprovals.userTrellisId,
        contractApprovals.contractDigest,
      ],
      set: {
        origin: row.origin,
        externalId: row.externalId,
        contractId: row.contractId,
        participantKind: row.participantKind,
        answer: row.answer,
        answeredAt: row.answeredAt,
        updatedAt: row.updatedAt,
        approval: row.approval,
        publishSubjects: row.publishSubjects,
        subscribeSubjects: row.subscribeSubjects,
      },
    });
  }

  /** Deletes one approval by user Trellis id and contract digest. */
  async delete(userTrellisId: string, contractDigest: string): Promise<void> {
    await this.#db.delete(contractApprovals).where(
      and(
        eq(contractApprovals.userTrellisId, userTrellisId),
        eq(contractApprovals.contractDigest, contractDigest),
      ),
    );
  }

  /** Returns approvals for one user ordered by contract digest. */
  async listByUser(userTrellisId: string): Promise<ContractApprovalRecord[]> {
    const rows = await this.#db.select().from(contractApprovals).where(
      eq(contractApprovals.userTrellisId, userTrellisId),
    ).orderBy(contractApprovals.contractDigest);
    return rows.map((row: ContractApprovalRow) =>
      decodeContractApprovalRow(row)
    );
  }

  /** Returns approvals for one contract digest ordered by user Trellis id. */
  async listByDigest(
    contractDigest: string,
  ): Promise<ContractApprovalRecord[]> {
    const rows = await this.#db.select().from(contractApprovals).where(
      eq(contractApprovals.contractDigest, contractDigest),
    ).orderBy(contractApprovals.userTrellisId);
    return rows.map((row: ContractApprovalRow) =>
      decodeContractApprovalRow(row)
    );
  }

  /** Returns all approvals ordered by user Trellis id and contract digest. */
  async list(): Promise<ContractApprovalRecord[]> {
    const rows = await this.#db.select().from(contractApprovals).orderBy(
      contractApprovals.userTrellisId,
      contractApprovals.contractDigest,
    );
    return rows.map((row: ContractApprovalRow) =>
      decodeContractApprovalRow(row)
    );
  }
}

/** Stores durable auth sessions in SQL with one active session per session key. */
export class SqlSessionRepository {
  readonly #db: TrellisStorageDb;
  readonly #sessionTtlMs: number;
  readonly #now: () => Date;

  /** Creates a session repository backed by a Trellis storage DB. */
  constructor(
    db: TrellisStorageDb,
    options: { sessionTtlMs?: number; now?: () => Date } = {},
  ) {
    this.#db = db;
    this.#sessionTtlMs = options.sessionTtlMs ?? 0;
    this.#now = options.now ?? (() => new Date());
  }

  async #deleteExpiredSessions(): Promise<void> {
    if (this.#sessionTtlMs <= 0) return;
    const cutoff = new Date(this.#now().getTime() - this.#sessionTtlMs);
    await this.#db.delete(sessions).where(
      lt(sessions.lastAuth, isoString(cutoff)),
    );
  }

  /** Returns one session by session key and Trellis/session id. */
  async get(
    sessionKey: string,
    trellisId: string,
  ): Promise<Session | undefined> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      and(
        eq(sessions.sessionKey, sessionKey),
        eq(sessions.trellisId, trellisId),
      ),
    ).limit(1);

    const row = rows[0];
    return row === undefined ? undefined : decodeSessionRow(row);
  }

  /** Returns the only session for a session key, or undefined when absent. */
  async getOneBySessionKey(sessionKey: string): Promise<Session | undefined> {
    const rows = await this.listEntriesBySessionKey(sessionKey, 2);

    const row = rows[0];
    return row === undefined ? undefined : row.session;
  }

  /** Returns sessions for one session key ordered by Trellis/session id. */
  async listEntriesBySessionKey(
    sessionKey: string,
    limit?: number,
  ): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const rows = limit === undefined
      ? await this.#db.select().from(sessions).where(
        eq(sessions.sessionKey, sessionKey),
      ).orderBy(sessions.trellisId)
      : await this.#db.select().from(sessions).where(
        eq(sessions.sessionKey, sessionKey),
      ).orderBy(sessions.trellisId).limit(limit);
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
  }

  /** Inserts or replaces a session keyed by session key. */
  async put(sessionKey: string, session: Session): Promise<void> {
    const row = encodeSessionRecord(sessionKey, session);
    await this.#db.insert(sessions).values(row).onConflictDoUpdate({
      target: sessions.sessionKey,
      set: {
        trellisId: row.trellisId,
        type: row.type,
        origin: row.origin,
        externalId: row.externalId,
        contractDigest: row.contractDigest,
        contractId: row.contractId,
        participantKind: row.participantKind,
        instanceId: row.instanceId,
        profileId: row.profileId,
        instanceKey: row.instanceKey,
        publicIdentityKey: row.publicIdentityKey,
        createdAt: row.createdAt,
        lastAuth: row.lastAuth,
        revokedAt: row.revokedAt,
        session: row.session,
      },
    });
  }

  /** Deletes one session by session key and Trellis/session id. */
  async delete(sessionKey: string, trellisId: string): Promise<void> {
    await this.#db.delete(sessions).where(
      and(
        eq(sessions.sessionKey, sessionKey),
        eq(sessions.trellisId, trellisId),
      ),
    );
  }

  /** Deletes all sessions for a session key. */
  async deleteBySessionKey(sessionKey: string): Promise<void> {
    await this.#db.delete(sessions).where(eq(sessions.sessionKey, sessionKey));
  }

  /** Deletes all service sessions for one service instance key. */
  async deleteByInstanceKey(instanceKey: string): Promise<void> {
    await this.#db.delete(sessions).where(
      eq(sessions.instanceKey, instanceKey),
    );
  }

  /** Returns all sessions ordered by session key and Trellis/session id. */
  async list(): Promise<Session[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    );
    return rows.map((row: SessionRow) => decodeSessionRow(row));
  }

  /** Returns all session entries ordered by session key and Trellis/session id. */
  async listEntries(): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    );
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
  }

  /** Returns sessions for one user Trellis id ordered by session key. */
  async listByUser(trellisId: string): Promise<Session[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      eq(sessions.trellisId, trellisId),
    ).orderBy(sessions.sessionKey);
    return rows.map((row: SessionRow) => decodeSessionRow(row));
  }

  /** Returns session entries for one user Trellis id ordered by session key. */
  async listEntriesByUser(trellisId: string): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      eq(sessions.trellisId, trellisId),
    ).orderBy(sessions.sessionKey);
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
  }

  /** Returns sessions for one service instance key ordered by session key. */
  async listByInstanceKey(instanceKey: string): Promise<Session[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      eq(sessions.instanceKey, instanceKey),
    ).orderBy(sessions.sessionKey);
    return rows.map((row: SessionRow) => decodeSessionRow(row));
  }

  /** Returns sessions for one contract digest ordered by session key. */
  async listByContractDigest(contractDigest: string): Promise<Session[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      eq(sessions.contractDigest, contractDigest),
    ).orderBy(sessions.sessionKey, sessions.trellisId);
    return rows.map((row: SessionRow) => decodeSessionRow(row));
  }
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

  /** Disables a portal profile by portal id and returns the updated record. */
  async disable(
    portalId: string,
    updatedAt: string,
  ): Promise<PortalProfile | undefined> {
    const existing = await this.get(portalId);
    if (existing === undefined) return undefined;
    const disabled = { ...existing, disabled: true, updatedAt };
    await this.put(disabled);
    return disabled;
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
      eq(loginPortalSelections.selectionKey, loginSelectionKey(contractId)),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeLoginPortalSelectionRow(row);
  }

  /** Inserts or replaces a login portal selection keyed by contract id. */
  async put(record: LoginPortalSelection): Promise<void> {
    const row = encodeLoginPortalSelectionRecord(record);
    await this.#db.insert(loginPortalSelections).values(row)
      .onConflictDoUpdate({
        target: loginPortalSelections.selectionKey,
        set: {
          contractId: row.contractId,
          portalId: row.portalId,
        },
      });
  }

  /** Deletes a login portal selection by contract id. */
  async delete(contractId: string): Promise<void> {
    await this.#db.delete(loginPortalSelections).where(
      eq(loginPortalSelections.selectionKey, loginSelectionKey(contractId)),
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

  /** Returns a device portal selection by profile id, or undefined when absent. */
  async get(profileId: string): Promise<DevicePortalSelection | undefined> {
    const rows = await this.#db.select().from(devicePortalSelections).where(
      eq(devicePortalSelections.selectionKey, deviceSelectionKey(profileId)),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDevicePortalSelectionRow(row);
  }

  /** Inserts or replaces a device portal selection keyed by profile id. */
  async put(record: DevicePortalSelection): Promise<void> {
    const row = encodeDevicePortalSelectionRecord(record);
    await this.#db.insert(devicePortalSelections).values(row)
      .onConflictDoUpdate({
        target: devicePortalSelections.selectionKey,
        set: {
          profileId: row.profileId,
          portalId: row.portalId,
        },
      });
  }

  /** Deletes a device portal selection by profile id. */
  async delete(profileId: string): Promise<void> {
    await this.#db.delete(devicePortalSelections).where(
      eq(devicePortalSelections.selectionKey, deviceSelectionKey(profileId)),
    );
  }

  /** Returns device portal selections ordered by profile id. */
  async list(): Promise<DevicePortalSelection[]> {
    const rows = await this.#db.select().from(devicePortalSelections).orderBy(
      devicePortalSelections.profileId,
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

  /** Disables an instance grant policy by contract id and returns the updated record. */
  async disable(
    contractId: string,
    updatedAt: string,
  ): Promise<InstanceGrantPolicy | undefined> {
    const existing = await this.get(contractId);
    if (existing === undefined) return undefined;
    const disabled = { ...existing, disabled: true, updatedAt };
    await this.put(disabled);
    return disabled;
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

/** Stores durable service profile records in SQL. */
export class SqlServiceProfileRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a service profile repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a service profile by profile id, or undefined when absent. */
  async get(profileId: string): Promise<ServiceProfile | undefined> {
    const rows = await this.#db.select().from(serviceProfiles).where(
      eq(serviceProfiles.profileId, profileId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeServiceProfileRow(row);
  }

  /** Inserts or replaces a service profile keyed by profile id. */
  async put(record: ServiceProfile): Promise<void> {
    const row = encodeServiceProfileRecord(record);
    await this.#db.insert(serviceProfiles).values(row).onConflictDoUpdate({
      target: serviceProfiles.profileId,
      set: {
        namespaces: row.namespaces,
        disabled: row.disabled,
        appliedContracts: row.appliedContracts,
      },
    });
  }

  /** Deletes a service profile by profile id. */
  async delete(profileId: string): Promise<void> {
    await this.#db.delete(serviceProfiles).where(
      eq(serviceProfiles.profileId, profileId),
    );
  }

  /** Returns service profiles ordered by profile id. */
  async list(): Promise<ServiceProfile[]> {
    const rows = await this.#db.select().from(serviceProfiles).orderBy(
      serviceProfiles.profileId,
    );
    return rows.map((row: ServiceProfileRow) => decodeServiceProfileRow(row));
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

  /** Returns a service instance by instance key/session key, or undefined. */
  async getByInstanceKey(
    instanceKey: string,
  ): Promise<ServiceInstance | undefined> {
    const rows = await this.#db.select().from(serviceInstances).where(
      eq(serviceInstances.instanceKey, instanceKey),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeServiceInstanceRow(row);
  }

  /** Returns a service instance by session key, or undefined when absent. */
  async getBySessionKey(
    sessionKey: string,
  ): Promise<ServiceInstance | undefined> {
    return await this.getByInstanceKey(sessionKey);
  }

  /** Inserts or replaces a service instance keyed by instance id. */
  async put(record: ServiceInstance): Promise<void> {
    const row = encodeServiceInstanceRecord(record);
    await this.#db.insert(serviceInstances).values(row).onConflictDoUpdate({
      target: serviceInstances.instanceId,
      set: {
        profileId: row.profileId,
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

  /** Returns service instances for one profile ordered by instance id. */
  async listByProfile(profileId: string): Promise<ServiceInstance[]> {
    const rows = await this.#db.select().from(serviceInstances).where(
      eq(serviceInstances.profileId, profileId),
    ).orderBy(serviceInstances.instanceId);
    return rows.map((row: ServiceInstanceRow) => decodeServiceInstanceRow(row));
  }
}

/** Stores durable device profile records in SQL. */
export class SqlDeviceProfileRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a device profile repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns a device profile by profile id, or undefined when absent. */
  async get(profileId: string): Promise<DeviceProfile | undefined> {
    const rows = await this.#db.select().from(deviceProfiles).where(
      eq(deviceProfiles.profileId, profileId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeDeviceProfileRow(row);
  }

  /** Inserts or replaces a device profile keyed by profile id. */
  async put(record: DeviceProfile): Promise<void> {
    const row = encodeDeviceProfileRecord(record);
    await this.#db.insert(deviceProfiles).values(row).onConflictDoUpdate({
      target: deviceProfiles.profileId,
      set: {
        reviewMode: row.reviewMode,
        disabled: row.disabled,
        appliedContracts: row.appliedContracts,
      },
    });
  }

  /** Deletes a device profile by profile id. */
  async delete(profileId: string): Promise<void> {
    await this.#db.delete(deviceProfiles).where(
      eq(deviceProfiles.profileId, profileId),
    );
  }

  /** Returns device profiles ordered by profile id. */
  async list(): Promise<DeviceProfile[]> {
    const rows = await this.#db.select().from(deviceProfiles).orderBy(
      deviceProfiles.profileId,
    );
    return rows.map((row: DeviceProfileRow) => decodeDeviceProfileRow(row));
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

  /** Returns a device instance by public identity key, or undefined. */
  async getByPublicIdentityKey(
    publicIdentityKey: string,
  ): Promise<DeviceInstance | undefined> {
    const rows = await this.#db.select().from(deviceInstances).where(
      eq(deviceInstances.publicIdentityKey, publicIdentityKey),
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
        profileId: row.profileId,
        metadata: row.metadata,
        state: row.state,
        currentContractId: row.currentContractId,
        currentContractDigest: row.currentContractDigest,
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

  /** Returns device instances for one profile ordered by instance id. */
  async listByProfile(profileId: string): Promise<DeviceInstance[]> {
    const rows = await this.#db.select().from(deviceInstances).where(
      eq(deviceInstances.profileId, profileId),
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

  /** Returns a device activation by public identity key, or undefined. */
  async getByPublicIdentityKey(
    publicIdentityKey: string,
  ): Promise<DeviceActivation | undefined> {
    const rows = await this.#db.select().from(deviceActivations).where(
      eq(deviceActivations.publicIdentityKey, publicIdentityKey),
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
        profileId: row.profileId,
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
          instanceId: row.instanceId,
          publicIdentityKey: row.publicIdentityKey,
          profileId: row.profileId,
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
