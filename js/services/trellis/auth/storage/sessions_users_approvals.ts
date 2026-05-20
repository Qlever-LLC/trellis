import { and, count, eq, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import type {
  CompleteAccountFlowOAuthResult,
  CompleteAdminBootstrapOAuthAtomicRecord,
  CompleteTargetAccountOAuthAtomicRecord,
} from "../account_flows/oauth_completion.ts";
import type {
  CompleteAdminBootstrapLocalPasswordAtomicRecord,
  CompleteAdminBootstrapLocalPasswordResult,
  CompleteIdentityLinkLocalPasswordAtomicRecord,
} from "../account_flows/local_password_completion.ts";
import { resolvesActiveAdmin } from "../capability_groups.ts";
import {
  accountFlows,
  capabilityGroups,
  identityEnvelopes,
  localCredentials,
  sessions,
  userIdentities,
  users,
} from "../../storage/schema.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import {
  type AccountFlow,
  AccountFlowSchema,
  type CapabilityGroup,
  CapabilityGroupSchema,
  type IdentityEnvelopeRecord,
  IdentityEnvelopeRecordSchema,
  type LocalCredential,
  LocalCredentialSchema,
  type Session,
  SessionSchema,
  type UserAccount,
  UserAccountSchema,
  type UserIdentity,
  UserIdentitySchema,
  type UserProjectionEntry,
  UserProjectionSchema,
} from "../schemas.ts";
import {
  type BoundedListQuery,
  boundedListQuery,
  isoString,
  type ListPage,
  listPage,
  parseJsonField,
} from "./shared.ts";

type UserRow = typeof users.$inferSelect;
type UserInsert = typeof users.$inferInsert;
type UserIdentityRow = typeof userIdentities.$inferSelect;
type UserIdentityInsert = typeof userIdentities.$inferInsert;
type LocalCredentialRow = typeof localCredentials.$inferSelect;
type LocalCredentialInsert = typeof localCredentials.$inferInsert;
type AccountFlowRow = typeof accountFlows.$inferSelect;
type AccountFlowInsert = typeof accountFlows.$inferInsert;
type CapabilityGroupRow = typeof capabilityGroups.$inferSelect;
type CapabilityGroupInsert = typeof capabilityGroups.$inferInsert;
type IdentityEnvelopeRow = typeof identityEnvelopes.$inferSelect;
type IdentityEnvelopeInsert = typeof identityEnvelopes.$inferInsert;
type SessionRow = typeof sessions.$inferSelect;
type SessionInsert = typeof sessions.$inferInsert;

export type SessionStorageEntry = {
  sessionKey: string;
  principalId: string;
  session: Session;
};

function decodeUserRow(row: UserRow): UserProjectionEntry {
  return Value.Decode(UserProjectionSchema, {
    origin: "account",
    id: row.userId,
    name: row.name ?? undefined,
    email: row.email ?? undefined,
    active: row.active,
    capabilities: parseJsonField("user capabilities", row.capabilities),
    capabilityGroups: parseJsonField(
      "user capability groups",
      row.capabilityGroups,
    ),
  });
}

function encodeUserRecord(
  trellisId: string,
  record: UserProjectionEntry,
): UserInsert {
  return {
    userId: trellisId,
    name: record.name ?? null,
    email: record.email ?? null,
    active: record.active,
    capabilities: JSON.stringify(record.capabilities),
    capabilityGroups: JSON.stringify(record.capabilityGroups),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function decodeUserAccountRow(row: UserRow): UserAccount {
  return Value.Decode(UserAccountSchema, {
    userId: row.userId,
    name: row.name,
    email: row.email,
    active: row.active,
    capabilities: parseJsonField("user account capabilities", row.capabilities),
    capabilityGroups: parseJsonField(
      "user account capability groups",
      row.capabilityGroups,
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function encodeUserAccount(record: UserAccount): UserInsert {
  return {
    userId: record.userId,
    name: record.name,
    email: record.email,
    active: record.active,
    capabilities: JSON.stringify(record.capabilities),
    capabilityGroups: JSON.stringify(record.capabilityGroups),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function decodeCapabilityGroupRow(row: CapabilityGroupRow): CapabilityGroup {
  return Value.Decode(CapabilityGroupSchema, {
    groupKey: row.groupKey,
    displayName: row.displayName,
    description: row.description,
    capabilities: parseJsonField(
      "capability group capabilities",
      row.capabilities,
    ),
    includedGroups: parseJsonField(
      "capability group included groups",
      row.includedGroups,
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function encodeCapabilityGroup(record: CapabilityGroup): CapabilityGroupInsert {
  return {
    groupKey: record.groupKey,
    displayName: record.displayName,
    description: record.description,
    capabilities: JSON.stringify(record.capabilities),
    includedGroups: JSON.stringify(record.includedGroups),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function hasActiveAdminRow(
  rows: UserRow[],
  getGroup: (groupKey: string) => Promise<CapabilityGroup | undefined>,
): Promise<boolean> {
  const checks = await Promise.all(
    rows.map((row) =>
      resolvesActiveAdmin(decodeUserAccountRow(row), {
        get: getGroup,
      })
    ),
  );
  return checks.some((isAdmin) => isAdmin);
}

function decodeUserIdentityRow(row: UserIdentityRow): UserIdentity {
  return Value.Decode(UserIdentitySchema, {
    identityId: row.identityId,
    userId: row.userId,
    provider: row.provider,
    subject: row.subject,
    displayName: row.displayName,
    email: row.email,
    emailVerified: row.emailVerified,
    linkedAt: row.linkedAt,
    lastLoginAt: row.lastLoginAt,
  });
}

function encodeUserIdentity(record: UserIdentity): UserIdentityInsert {
  return {
    identityId: record.identityId,
    userId: record.userId,
    provider: record.provider,
    subject: record.subject,
    displayName: record.displayName,
    email: record.email,
    emailVerified: record.emailVerified,
    linkedAt: record.linkedAt,
    lastLoginAt: record.lastLoginAt,
  };
}

function decodeLocalCredentialRow(row: LocalCredentialRow): LocalCredential {
  return Value.Decode(LocalCredentialSchema, {
    identityId: row.identityId,
    passwordHash: row.passwordHash,
    passwordAlgorithm: row.passwordAlgorithm,
    passwordParams: parseJsonField(
      "local credential password params",
      row.passwordParams,
    ),
    passwordSetAt: row.passwordSetAt,
    mustChangePassword: row.mustChangePassword,
    failedLoginCount: row.failedLoginCount,
    lockedUntil: row.lockedUntil,
    updatedAt: row.updatedAt,
  });
}

function encodeLocalCredential(record: LocalCredential): LocalCredentialInsert {
  return {
    identityId: record.identityId,
    passwordHash: record.passwordHash,
    passwordAlgorithm: record.passwordAlgorithm,
    passwordParams: JSON.stringify(record.passwordParams),
    passwordSetAt: record.passwordSetAt,
    mustChangePassword: record.mustChangePassword,
    failedLoginCount: record.failedLoginCount,
    lockedUntil: record.lockedUntil,
    updatedAt: record.updatedAt,
  };
}

function decodeAccountFlowRow(row: AccountFlowRow): AccountFlow {
  return Value.Decode(AccountFlowSchema, {
    flowIdHash: row.flowIdHash,
    kind: row.kind,
    targetUserId: row.targetUserId,
    createdByUserId: row.createdByUserId,
    allowedProviders: row.allowedProviders === null
      ? null
      : parseJsonField("account flow allowed providers", row.allowedProviders),
    capabilities: row.capabilities === null
      ? null
      : parseJsonField("account flow capabilities", row.capabilities),
    profileHint: row.profileHint === null
      ? null
      : parseJsonField("account flow profile hint", row.profileHint),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  });
}

function encodeAccountFlow(record: AccountFlow): AccountFlowInsert {
  return {
    flowIdHash: record.flowIdHash,
    kind: record.kind,
    targetUserId: record.targetUserId,
    createdByUserId: record.createdByUserId,
    allowedProviders: record.allowedProviders === null
      ? null
      : JSON.stringify(record.allowedProviders),
    capabilities: record.capabilities === null
      ? null
      : JSON.stringify(record.capabilities),
    profileHint: record.profileHint === null
      ? null
      : JSON.stringify(record.profileHint),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
  };
}

function decodeIdentityEnvelopeRow(
  row: IdentityEnvelopeRow,
): IdentityEnvelopeRecord {
  return Value.Decode(IdentityEnvelopeRecordSchema, {
    identityEnvelopeId: row.identityEnvelopeId,
    userTrellisId: row.userTrellisId,
    origin: row.origin,
    id: row.externalId,
    identityAnchor: parseJsonField(
      "identity envelope anchor",
      row.identityAnchor,
    ),
    answer: row.answer,
    answeredAt: row.answeredAt,
    updatedAt: row.updatedAt,
    approvalEvidence: parseJsonField(
      "identity envelope approval evidence",
      row.approvalEvidence,
    ),
    publishSubjects: parseJsonField(
      "identity envelope publish subjects",
      row.publishSubjects,
    ),
    subscribeSubjects: parseJsonField(
      "identity envelope subscribe subjects",
      row.subscribeSubjects,
    ),
  });
}

function encodeIdentityEnvelopeRecord(
  record: IdentityEnvelopeRecord,
): IdentityEnvelopeInsert {
  return {
    identityEnvelopeId: record.identityEnvelopeId,
    userTrellisId: record.userTrellisId,
    origin: record.origin,
    externalId: record.id,
    identityAnchorKind: record.identityAnchor.kind,
    identityAnchor: JSON.stringify(record.identityAnchor),
    evidenceContractDigest: record.approvalEvidence.contractDigest,
    contractId: record.approvalEvidence.contractId,
    participantKind: record.approvalEvidence.participantKind,
    answer: record.answer,
    answeredAt: record.answeredAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    approvalEvidence: JSON.stringify(record.approvalEvidence),
    publishSubjects: JSON.stringify(record.publishSubjects),
    subscribeSubjects: JSON.stringify(record.subscribeSubjects),
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
    principalId: row.trellisId,
    session: decodeSessionRow(row),
  };
}

function sessionPrincipalId(session: Session): string {
  if (session.type === "user") return session.userId;
  return session.type === "device" ? session.instanceId : session.trellisId;
}

function encodeSessionRecord(
  sessionKey: string,
  session: Session,
): SessionInsert {
  const common = {
    sessionKey,
    trellisId: sessionPrincipalId(session),
    type: session.type,
    createdAt: isoString(session.createdAt),
    lastAuth: isoString(session.lastAuth),
    session: JSON.stringify(session),
  };

  switch (session.type) {
    case "user":
      return {
        ...common,
        origin: session.identity.provider,
        externalId: session.identity.subject,
        identityEnvelopeId: session.identityEnvelopeId,
        contractDigest: session.contractDigest,
        contractId: session.contractId,
        participantKind: session.participantKind,
        instanceId: null,
        deploymentId: null,
        instanceKey: null,
        publicIdentityKey: null,
        revokedAt: null,
      };
    case "service":
      return {
        ...common,
        origin: session.origin,
        externalId: session.id,
        identityEnvelopeId: null,
        contractDigest: session.currentContractDigest,
        contractId: session.currentContractId,
        participantKind: null,
        instanceId: session.instanceId,
        deploymentId: session.deploymentId,
        instanceKey: session.instanceKey,
        publicIdentityKey: null,
        revokedAt: null,
      };
    case "device":
      return {
        ...common,
        origin: null,
        externalId: null,
        identityEnvelopeId: null,
        contractDigest: session.contractDigest,
        contractId: session.contractId,
        participantKind: null,
        instanceId: session.instanceId,
        deploymentId: session.deploymentId,
        instanceKey: null,
        publicIdentityKey: session.publicIdentityKey,
        revokedAt: session.revokedAt === null
          ? null
          : isoString(session.revokedAt),
      };
  }
}

/** Stores durable auth-local user accounts in SQL. */
export class SqlUserAccountRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a user account repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns one user account by canonical user id. */
  async get(userId: string): Promise<UserAccount | undefined> {
    const rows = await this.#db.select().from(users).where(
      eq(users.userId, userId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeUserAccountRow(row);
  }

  /** Inserts or replaces a user account keyed by canonical user id. */
  async put(record: UserAccount): Promise<void> {
    const row = encodeUserAccount(record);
    await this.#db.insert(users).values(row).onConflictDoUpdate({
      target: users.userId,
      set: {
        name: row.name,
        email: row.email,
        active: row.active,
        capabilities: row.capabilities,
        capabilityGroups: row.capabilityGroups,
        updatedAt: row.updatedAt,
      },
    });
  }

  /** Inserts a new user account and returns false when the user id already exists. */
  async create(record: UserAccount): Promise<boolean> {
    const row = encodeUserAccount(record);
    const inserted = await this.#db.insert(users).values(row)
      .onConflictDoNothing({ target: users.userId })
      .returning({ userId: users.userId });
    return inserted.length > 0;
  }

  /** Returns a bounded page of user accounts ordered by canonical user id. */
  async listPage(query: BoundedListQuery): Promise<UserAccount[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(users).orderBy(users.userId)
      .limit(limit).offset(offset);
    return rows.map((row: UserRow) => decodeUserAccountRow(row));
  }

  /** Returns a counted page of user accounts ordered by canonical user id. */
  async listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<UserAccount>> {
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(users);
    const rows = await this.#db.select().from(users).orderBy(users.userId)
      .limit(limit).offset(offset);
    return listPage(
      rows.map((row: UserRow) => decodeUserAccountRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }
}

/** Stores durable links from sign-in identities to user accounts in SQL. */
export class SqlUserIdentityRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a user identity repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns one linked identity by stable identity id. */
  async get(identityId: string): Promise<UserIdentity | undefined> {
    const rows = await this.#db.select().from(userIdentities).where(
      eq(userIdentities.identityId, identityId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeUserIdentityRow(row);
  }

  /** Returns one linked identity by provider and subject. */
  async getByProviderSubject(
    provider: string,
    subject: string,
  ): Promise<UserIdentity | undefined> {
    const rows = await this.#db.select().from(userIdentities).where(and(
      eq(userIdentities.provider, provider),
      eq(userIdentities.subject, subject),
    )).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeUserIdentityRow(row);
  }

  /** Inserts or replaces an identity link keyed by provider and subject. */
  async put(record: UserIdentity): Promise<void> {
    const row = encodeUserIdentity(record);
    await this.#db.insert(userIdentities).values(row).onConflictDoUpdate({
      target: [userIdentities.provider, userIdentities.subject],
      set: {
        identityId: row.identityId,
        userId: row.userId,
        displayName: row.displayName,
        email: row.email,
        emailVerified: row.emailVerified,
        linkedAt: row.linkedAt,
        lastLoginAt: row.lastLoginAt,
      },
    });
  }

  /** Returns identity links for one user ordered by identity id. */
  async listByUser(userId: string): Promise<UserIdentity[]> {
    const rows = await this.#db.select().from(userIdentities).where(
      eq(userIdentities.userId, userId),
    ).orderBy(userIdentities.identityId);
    return rows.map((row: UserIdentityRow) => decodeUserIdentityRow(row));
  }

  /** Returns a counted page of identity links for one user ordered by identity id. */
  async listPageByUser(
    userId: string,
    query: BoundedListQuery,
  ): Promise<ListPage<UserIdentity>> {
    const { offset, limit } = boundedListQuery(query);
    const where = eq(userIdentities.userId, userId);
    const [countRow] = await this.#db.select({ count: count() }).from(
      userIdentities,
    ).where(where);
    const rows = await this.#db.select().from(userIdentities).where(where)
      .orderBy(userIdentities.identityId).limit(limit).offset(offset);
    return listPage(
      rows.map((row: UserIdentityRow) => decodeUserIdentityRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Removes one identity link from a user account. */
  async unlink(userId: string, identityId: string): Promise<boolean> {
    const rows = await this.#db.delete(userIdentities).where(and(
      eq(userIdentities.userId, userId),
      eq(userIdentities.identityId, identityId),
    )).returning({ identityId: userIdentities.identityId });
    return rows.length > 0;
  }
}

/** Stores durable local password credential metadata in SQL. */
export class SqlLocalCredentialRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a local credential repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns one local credential by identity id. */
  async get(identityId: string): Promise<LocalCredential | undefined> {
    const rows = await this.#db.select().from(localCredentials).where(
      eq(localCredentials.identityId, identityId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeLocalCredentialRow(row);
  }

  /** Inserts or replaces local credential material keyed by identity id. */
  async put(record: LocalCredential): Promise<void> {
    const row = encodeLocalCredential(record);
    await this.#db.insert(localCredentials).values(row).onConflictDoUpdate({
      target: localCredentials.identityId,
      set: {
        passwordHash: row.passwordHash,
        passwordAlgorithm: row.passwordAlgorithm,
        passwordParams: row.passwordParams,
        passwordSetAt: row.passwordSetAt,
        mustChangePassword: row.mustChangePassword,
        failedLoginCount: row.failedLoginCount,
        lockedUntil: row.lockedUntil,
        updatedAt: row.updatedAt,
      },
    });
  }
}

/** Stores durable one-time account management flows in SQL. */
export class SqlAccountFlowRepository {
  readonly #db: TrellisStorageDb;

  /** Creates an account flow repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns one account flow by durable flow id hash. */
  async get(flowIdHash: string): Promise<AccountFlow | undefined> {
    const rows = await this.#db.select().from(accountFlows).where(
      eq(accountFlows.flowIdHash, flowIdHash),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeAccountFlowRow(row);
  }

  /** Inserts or replaces an account flow keyed by durable flow id hash. */
  async put(record: AccountFlow): Promise<void> {
    const row = encodeAccountFlow(record);
    await this.#db.insert(accountFlows).values(row).onConflictDoUpdate({
      target: accountFlows.flowIdHash,
      set: {
        kind: row.kind,
        targetUserId: row.targetUserId,
        createdByUserId: row.createdByUserId,
        allowedProviders: row.allowedProviders,
        capabilities: row.capabilities,
        profileHint: row.profileHint,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        consumedAt: row.consumedAt,
      },
    });
  }

  /** Marks an unconsumed account flow as consumed and returns whether it changed. */
  async consume(flowIdHash: string, consumedAt: string): Promise<boolean> {
    const rows = await this.#db.update(accountFlows).set({ consumedAt }).where(
      and(
        eq(accountFlows.flowIdHash, flowIdHash),
        isNull(accountFlows.consumedAt),
      ),
    ).returning({ flowIdHash: accountFlows.flowIdHash });
    return rows.length > 0;
  }

  /** Atomically completes an admin bootstrap flow with the first local-password admin. */
  async completeAdminBootstrapLocalPassword(
    record: CompleteAdminBootstrapLocalPasswordAtomicRecord,
  ): Promise<CompleteAdminBootstrapLocalPasswordResult> {
    const nowIso = record.now.toISOString();

    return await this.#db.transaction(async (tx) => {
      const flowRows = await tx.select().from(accountFlows).where(
        eq(accountFlows.flowIdHash, record.flowIdHash),
      ).limit(1);
      const flowRow = flowRows[0];
      if (flowRow === undefined) return { ok: false, error: "flow_not_found" };

      const flow = decodeAccountFlowRow(flowRow);
      if (flow.kind !== "admin_bootstrap") {
        return { ok: false, error: "flow_wrong_kind" };
      }
      if (flow.consumedAt !== null) {
        return { ok: false, error: "flow_already_consumed" };
      }
      if (new Date(flow.expiresAt).getTime() <= record.now.getTime()) {
        return { ok: false, error: "flow_expired" };
      }
      if (!flow.capabilities?.includes("admin")) {
        return { ok: false, error: "flow_missing_admin_capability" };
      }

      const activeUserRows = await tx.select().from(users).where(
        eq(users.active, true),
      );
      const hasActiveAdmin = await hasActiveAdminRow(
        activeUserRows,
        async (groupKey) => {
          const rows = await tx.select().from(capabilityGroups).where(
            eq(capabilityGroups.groupKey, groupKey),
          ).limit(1);
          const row = rows[0];
          return row === undefined ? undefined : decodeCapabilityGroupRow(row);
        },
      );
      if (hasActiveAdmin) {
        return { ok: false, error: "admin_already_exists" };
      }

      const identityRows = await tx.select().from(userIdentities).where(and(
        eq(userIdentities.provider, record.identity.provider),
        eq(userIdentities.subject, record.identity.subject),
      )).limit(1);
      if (identityRows.length > 0) {
        return { ok: false, error: "local_identity_exists" };
      }

      const consumed = await tx.update(accountFlows).set({ consumedAt: nowIso })
        .where(and(
          eq(accountFlows.flowIdHash, record.flowIdHash),
          isNull(accountFlows.consumedAt),
        )).returning({ flowIdHash: accountFlows.flowIdHash });
      if (consumed.length === 0) {
        return { ok: false, error: "flow_consume_conflict" };
      }

      await tx.insert(users).values(encodeUserAccount(record.account));
      await tx.insert(userIdentities).values(
        encodeUserIdentity(record.identity),
      );
      await tx.insert(localCredentials).values(
        encodeLocalCredential(record.credential),
      );

      return { ok: true, userId: record.account.userId };
    });
  }

  /** Atomically completes a local-password identity link for an existing account. */
  async completeIdentityLinkLocalPassword(
    record: CompleteIdentityLinkLocalPasswordAtomicRecord,
  ): Promise<CompleteAdminBootstrapLocalPasswordResult> {
    const nowIso = record.now.toISOString();

    return await this.#db.transaction(async (tx) => {
      const flowRows = await tx.select().from(accountFlows).where(
        eq(accountFlows.flowIdHash, record.flowIdHash),
      ).limit(1);
      const flowRow = flowRows[0];
      if (flowRow === undefined) return { ok: false, error: "flow_not_found" };

      const flow = decodeAccountFlowRow(flowRow);
      if (flow.kind !== "identity_link") {
        return { ok: false, error: "flow_wrong_kind" };
      }
      if (flow.consumedAt !== null) {
        return { ok: false, error: "flow_already_consumed" };
      }
      if (new Date(flow.expiresAt).getTime() <= record.now.getTime()) {
        return { ok: false, error: "flow_expired" };
      }
      if (
        flow.allowedProviders !== null &&
        !flow.allowedProviders.includes("local")
      ) {
        return { ok: false, error: "local_provider_not_allowed" };
      }
      if (flow.targetUserId === null) {
        return { ok: false, error: "flow_missing_target_user" };
      }

      const targetRows = await tx.select().from(users).where(
        eq(users.userId, flow.targetUserId),
      ).limit(1);
      const targetRow = targetRows[0];
      if (targetRow === undefined) {
        return { ok: false, error: "target_user_not_found" };
      }
      const targetAccount = decodeUserAccountRow(targetRow);
      if (!targetAccount.active) {
        return { ok: false, error: "target_user_inactive" };
      }

      const identityRows = await tx.select().from(userIdentities).where(and(
        eq(userIdentities.provider, "local"),
        eq(userIdentities.subject, record.identity.subject),
      )).limit(1);
      const existingIdentityRow = identityRows[0];
      const existingIdentity = existingIdentityRow === undefined
        ? undefined
        : decodeUserIdentityRow(existingIdentityRow);
      if (
        existingIdentity !== undefined &&
        existingIdentity.userId !== targetAccount.userId
      ) {
        return { ok: false, error: "local_identity_exists" };
      }

      const localIdentityRows = await tx.select().from(userIdentities).where(
        and(
          eq(userIdentities.userId, targetAccount.userId),
          eq(userIdentities.provider, "local"),
        ),
      ).limit(1);
      const existingTargetLocalIdentityRow = localIdentityRows[0];
      if (
        existingTargetLocalIdentityRow !== undefined &&
        existingTargetLocalIdentityRow.identityId !==
          existingIdentity?.identityId
      ) {
        return { ok: false, error: "local_identity_exists" };
      }

      const consumed = await tx.update(accountFlows).set({ consumedAt: nowIso })
        .where(and(
          eq(accountFlows.flowIdHash, record.flowIdHash),
          isNull(accountFlows.consumedAt),
        )).returning({ flowIdHash: accountFlows.flowIdHash });
      if (consumed.length === 0) {
        return { ok: false, error: "flow_consume_conflict" };
      }

      if (existingIdentity === undefined) {
        await tx.insert(userIdentities).values(
          encodeUserIdentity(record.identity),
        );
      }
      const credential = encodeLocalCredential(record.credential);
      await tx.insert(localCredentials).values(credential).onConflictDoUpdate({
        target: localCredentials.identityId,
        set: {
          passwordHash: credential.passwordHash,
          passwordAlgorithm: credential.passwordAlgorithm,
          passwordParams: credential.passwordParams,
          passwordSetAt: credential.passwordSetAt,
          mustChangePassword: credential.mustChangePassword,
          failedLoginCount: credential.failedLoginCount,
          lockedUntil: credential.lockedUntil,
          updatedAt: credential.updatedAt,
        },
      });

      return { ok: true, userId: targetAccount.userId };
    });
  }

  /** Atomically completes an admin bootstrap flow with the first OAuth/OIDC admin. */
  async completeAdminBootstrapOAuth(
    record: CompleteAdminBootstrapOAuthAtomicRecord,
  ): Promise<CompleteAccountFlowOAuthResult> {
    const nowIso = record.now.toISOString();

    return await this.#db.transaction(async (tx) => {
      const flowRows = await tx.select().from(accountFlows).where(
        eq(accountFlows.flowIdHash, record.flowIdHash),
      ).limit(1);
      const flowRow = flowRows[0];
      if (flowRow === undefined) return { ok: false, error: "flow_not_found" };

      const flow = decodeAccountFlowRow(flowRow);
      if (flow.kind !== "admin_bootstrap") {
        return { ok: false, error: "flow_wrong_kind" };
      }
      if (flow.consumedAt !== null) {
        return { ok: false, error: "flow_already_consumed" };
      }
      if (new Date(flow.expiresAt).getTime() <= record.now.getTime()) {
        return { ok: false, error: "flow_expired" };
      }
      if (!flow.capabilities?.includes("admin")) {
        return { ok: false, error: "flow_missing_admin_capability" };
      }
      if (
        flow.allowedProviders !== null &&
        !flow.allowedProviders.includes(record.provider)
      ) {
        return { ok: false, error: "provider_not_allowed" };
      }

      const activeUserRows = await tx.select().from(users).where(
        eq(users.active, true),
      );
      const hasActiveAdmin = await hasActiveAdminRow(
        activeUserRows,
        async (groupKey) => {
          const rows = await tx.select().from(capabilityGroups).where(
            eq(capabilityGroups.groupKey, groupKey),
          ).limit(1);
          const row = rows[0];
          return row === undefined ? undefined : decodeCapabilityGroupRow(row);
        },
      );
      if (hasActiveAdmin) {
        return { ok: false, error: "admin_already_exists" };
      }

      const identityRows = await tx.select().from(userIdentities).where(and(
        eq(userIdentities.provider, record.identity.provider),
        eq(userIdentities.subject, record.identity.subject),
      )).limit(1);
      if (identityRows.length > 0) {
        return { ok: false, error: "identity_conflict" };
      }

      const consumed = await tx.update(accountFlows).set({ consumedAt: nowIso })
        .where(and(
          eq(accountFlows.flowIdHash, record.flowIdHash),
          isNull(accountFlows.consumedAt),
        )).returning({ flowIdHash: accountFlows.flowIdHash });
      if (consumed.length === 0) {
        return { ok: false, error: "flow_consume_conflict" };
      }

      await tx.insert(users).values(encodeUserAccount(record.account));
      await tx.insert(userIdentities).values(
        encodeUserIdentity(record.identity),
      );

      return { ok: true, userId: record.account.userId };
    });
  }

  /** Atomically completes an OAuth/OIDC flow for an existing target account. */
  async completeTargetAccountOAuth(
    record: CompleteTargetAccountOAuthAtomicRecord,
  ): Promise<CompleteAccountFlowOAuthResult> {
    const nowIso = record.now.toISOString();

    return await this.#db.transaction(async (tx) => {
      const flowRows = await tx.select().from(accountFlows).where(
        eq(accountFlows.flowIdHash, record.flowIdHash),
      ).limit(1);
      const flowRow = flowRows[0];
      if (flowRow === undefined) return { ok: false, error: "flow_not_found" };

      const flow = decodeAccountFlowRow(flowRow);
      if (flow.kind !== "account_invite" && flow.kind !== "identity_link") {
        return { ok: false, error: "flow_wrong_kind" };
      }
      if (flow.consumedAt !== null) {
        return { ok: false, error: "flow_already_consumed" };
      }
      if (new Date(flow.expiresAt).getTime() <= record.now.getTime()) {
        return { ok: false, error: "flow_expired" };
      }
      if (
        flow.allowedProviders !== null &&
        !flow.allowedProviders.includes(record.provider)
      ) {
        return { ok: false, error: "provider_not_allowed" };
      }
      if (flow.targetUserId === null) {
        return { ok: false, error: "flow_missing_target_user" };
      }

      const targetRows = await tx.select().from(users).where(
        eq(users.userId, flow.targetUserId),
      ).limit(1);
      const targetRow = targetRows[0];
      if (targetRow === undefined) {
        return { ok: false, error: "target_user_not_found" };
      }
      const targetAccount = decodeUserAccountRow(targetRow);
      if (!targetAccount.active) {
        return { ok: false, error: "target_user_inactive" };
      }

      const identityRows = await tx.select().from(userIdentities).where(and(
        eq(userIdentities.provider, record.provider),
        eq(userIdentities.subject, record.user.id),
      )).limit(1);
      const existingIdentityRow = identityRows[0];
      const existingIdentity = existingIdentityRow === undefined
        ? undefined
        : decodeUserIdentityRow(existingIdentityRow);
      if (
        existingIdentity !== undefined &&
        existingIdentity.userId !== targetAccount.userId
      ) {
        return { ok: false, error: "identity_conflict" };
      }

      const consumed = await tx.update(accountFlows).set({ consumedAt: nowIso })
        .where(and(
          eq(accountFlows.flowIdHash, record.flowIdHash),
          isNull(accountFlows.consumedAt),
        )).returning({ flowIdHash: accountFlows.flowIdHash });
      if (consumed.length === 0) {
        return { ok: false, error: "flow_consume_conflict" };
      }

      const identity = encodeUserIdentity({
        identityId: existingIdentity?.identityId ??
          identityIdForProviderSubject(record.provider, record.user.id),
        userId: targetAccount.userId,
        provider: record.provider,
        subject: record.user.id,
        displayName: record.user.name ?? null,
        email: record.user.email ?? null,
        emailVerified: record.user.emailVerified,
        linkedAt: existingIdentity?.linkedAt ?? nowIso,
        lastLoginAt: nowIso,
      });

      if (existingIdentity === undefined) {
        await tx.insert(userIdentities).values(identity);
      } else {
        await tx.update(userIdentities).set({
          userId: identity.userId,
          displayName: identity.displayName,
          email: identity.email,
          emailVerified: identity.emailVerified,
          lastLoginAt: identity.lastLoginAt,
        }).where(and(
          eq(userIdentities.provider, record.provider),
          eq(userIdentities.subject, record.user.id),
        ));
      }

      return { ok: true, userId: targetAccount.userId };
    });
  }

  /** Returns unconsumed expired account flows ordered by expiry time. */
  async listExpired(
    now: string,
    query: BoundedListQuery,
  ): Promise<AccountFlow[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(accountFlows).where(and(
      lt(accountFlows.expiresAt, now),
      isNull(accountFlows.consumedAt),
    )).orderBy(accountFlows.expiresAt).limit(limit).offset(offset);
    return rows.map((row: AccountFlowRow) => decodeAccountFlowRow(row));
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
      eq(users.userId, trellisId),
    ).limit(1);

    const row = rows[0];
    return row === undefined ? undefined : decodeUserRow(row);
  }

  /** Inserts or replaces a user projection keyed by Trellis id. */
  async put(trellisId: string, record: UserProjectionEntry): Promise<void> {
    const row = encodeUserRecord(trellisId, record);
    await this.#db.insert(users).values(row).onConflictDoUpdate({
      target: users.userId,
      set: {
        name: row.name,
        email: row.email,
        active: row.active,
        capabilities: row.capabilities,
        capabilityGroups: row.capabilityGroups,
        updatedAt: row.updatedAt,
      },
    });
  }

  /** Returns a bounded page of user projections ordered by Trellis id. */
  async listPage(query: BoundedListQuery): Promise<UserProjectionEntry[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(users).orderBy(users.userId)
      .limit(limit).offset(offset);
    return rows.map((row: UserRow) => decodeUserRow(row));
  }
}

/** Stores durable auth capability groups in SQL. */
export class SqlCapabilityGroupRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a capability group repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns one capability group by stable group key. */
  async get(groupKey: string): Promise<CapabilityGroup | undefined> {
    const rows = await this.#db.select().from(capabilityGroups).where(
      eq(capabilityGroups.groupKey, groupKey),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeCapabilityGroupRow(row);
  }

  /** Returns a bounded page of capability groups ordered by group key. */
  async listPage(query: BoundedListQuery): Promise<CapabilityGroup[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(capabilityGroups).orderBy(
      capabilityGroups.groupKey,
    ).limit(limit).offset(offset);
    return rows.map((row: CapabilityGroupRow) => decodeCapabilityGroupRow(row));
  }

  /** Returns a counted page of capability groups ordered by group key. */
  async listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<CapabilityGroup>> {
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      capabilityGroups,
    );
    const rows = await this.#db.select().from(capabilityGroups).orderBy(
      capabilityGroups.groupKey,
    ).limit(limit).offset(offset);
    return listPage(
      rows.map((row: CapabilityGroupRow) => decodeCapabilityGroupRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Inserts or replaces a capability group keyed by group key. */
  async put(record: CapabilityGroup): Promise<void> {
    const row = encodeCapabilityGroup(record);
    await this.#db.insert(capabilityGroups).values(row).onConflictDoUpdate({
      target: capabilityGroups.groupKey,
      set: {
        displayName: row.displayName,
        description: row.description,
        capabilities: row.capabilities,
        includedGroups: row.includedGroups,
        updatedAt: row.updatedAt,
      },
    });
  }

  /** Deletes one capability group by stable group key. */
  async delete(groupKey: string): Promise<void> {
    await this.#db.delete(capabilityGroups).where(
      eq(capabilityGroups.groupKey, groupKey),
    );
  }
}

/** Stores durable user identity envelopes and grants in SQL. */
export class SqlIdentityEnvelopeRepository {
  readonly #db: TrellisStorageDb;

  /** Creates an identity envelope repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Returns one identity envelope by stable id. */
  async get(
    identityEnvelopeId: string,
  ): Promise<IdentityEnvelopeRecord | undefined> {
    const rows = await this.#db.select().from(identityEnvelopes).where(
      eq(identityEnvelopes.identityEnvelopeId, identityEnvelopeId),
    ).limit(1);

    const row = rows[0];
    return row === undefined ? undefined : decodeIdentityEnvelopeRow(row);
  }

  /** Inserts or replaces an envelope keyed by stable identity envelope id. */
  async put(record: IdentityEnvelopeRecord): Promise<void> {
    const row = encodeIdentityEnvelopeRecord(record);
    await this.#db.insert(identityEnvelopes).values(row).onConflictDoUpdate({
      target: [
        identityEnvelopes.userTrellisId,
        identityEnvelopes.identityAnchorKind,
        identityEnvelopes.identityAnchor,
      ],
      set: {
        identityEnvelopeId: row.identityEnvelopeId,
        origin: row.origin,
        externalId: row.externalId,
        evidenceContractDigest: row.evidenceContractDigest,
        contractId: row.contractId,
        participantKind: row.participantKind,
        answer: row.answer,
        answeredAt: row.answeredAt,
        updatedAt: row.updatedAt,
        approvalEvidence: row.approvalEvidence,
        publishSubjects: row.publishSubjects,
        subscribeSubjects: row.subscribeSubjects,
      },
    });
  }

  /** Deletes one identity envelope by stable id. */
  async delete(identityEnvelopeId: string): Promise<void> {
    await this.#db.delete(identityEnvelopes).where(
      eq(identityEnvelopes.identityEnvelopeId, identityEnvelopeId),
    );
  }

  /** Returns identity envelopes for one user ordered by envelope id. */
  async listByUser(userTrellisId: string): Promise<IdentityEnvelopeRecord[]> {
    const rows = await this.#db.select().from(identityEnvelopes).where(
      eq(identityEnvelopes.userTrellisId, userTrellisId),
    ).orderBy(identityEnvelopes.identityEnvelopeId);
    return rows.map((row: IdentityEnvelopeRow) =>
      decodeIdentityEnvelopeRow(row)
    );
  }

  /** Returns a bounded page of identity envelopes for one user ordered by envelope id. */
  async listPageByUser(
    userTrellisId: string,
    query: BoundedListQuery,
  ): Promise<IdentityEnvelopeRecord[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(identityEnvelopes).where(
      eq(identityEnvelopes.userTrellisId, userTrellisId),
    ).orderBy(identityEnvelopes.identityEnvelopeId).limit(limit).offset(offset);
    return rows.map((row: IdentityEnvelopeRow) =>
      decodeIdentityEnvelopeRow(row)
    );
  }

  /** Returns a counted page of identity envelopes for one user ordered by envelope id. */
  async listCountedPageByUser(
    userTrellisId: string,
    query: BoundedListQuery,
  ): Promise<ListPage<IdentityEnvelopeRecord>> {
    const where = eq(identityEnvelopes.userTrellisId, userTrellisId);
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      identityEnvelopes,
    ).where(where);
    const rows = await this.#db.select().from(identityEnvelopes).where(where)
      .orderBy(identityEnvelopes.identityEnvelopeId).limit(limit).offset(
        offset,
      );
    return listPage(
      rows.map((row: IdentityEnvelopeRow) => decodeIdentityEnvelopeRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Returns a bounded page of approved identity envelopes for one user ordered by envelope id. */
  async listApprovedPageByUser(
    userTrellisId: string,
    query: BoundedListQuery,
  ): Promise<IdentityEnvelopeRecord[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(identityEnvelopes).where(
      and(
        eq(identityEnvelopes.userTrellisId, userTrellisId),
        eq(identityEnvelopes.answer, "approved"),
      ),
    ).orderBy(identityEnvelopes.identityEnvelopeId).limit(limit).offset(offset);
    return rows.map((row: IdentityEnvelopeRow) =>
      decodeIdentityEnvelopeRow(row)
    );
  }

  /** Returns a counted page of approved identity envelopes for one user. */
  async listApprovedCountedPageByUser(
    userTrellisId: string,
    query: BoundedListQuery,
  ): Promise<ListPage<IdentityEnvelopeRecord>> {
    const where = and(
      eq(identityEnvelopes.userTrellisId, userTrellisId),
      eq(identityEnvelopes.answer, "approved"),
    );
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      identityEnvelopes,
    ).where(where);
    const rows = await this.#db.select().from(identityEnvelopes).where(where)
      .orderBy(identityEnvelopes.identityEnvelopeId).limit(limit).offset(
        offset,
      );
    return listPage(
      rows.map((row: IdentityEnvelopeRow) => decodeIdentityEnvelopeRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Returns a bounded page of identity envelopes ordered by user Trellis id and envelope id. */
  async listPage(query: BoundedListQuery): Promise<IdentityEnvelopeRecord[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(identityEnvelopes).orderBy(
      identityEnvelopes.userTrellisId,
      identityEnvelopes.identityEnvelopeId,
    ).limit(limit).offset(offset);
    return rows.map((row: IdentityEnvelopeRow) =>
      decodeIdentityEnvelopeRow(row)
    );
  }

  /** Returns a counted page of identity envelopes ordered by user and envelope id. */
  async listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<IdentityEnvelopeRecord>> {
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      identityEnvelopes,
    );
    const rows = await this.#db.select().from(identityEnvelopes).orderBy(
      identityEnvelopes.userTrellisId,
      identityEnvelopes.identityEnvelopeId,
    ).limit(limit).offset(offset);
    return listPage(
      rows.map((row: IdentityEnvelopeRow) => decodeIdentityEnvelopeRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Returns a counted page of identity envelopes matching simple indexed filters. */
  async listFilteredPage(
    filters: { userTrellisId?: string; answer?: "approved" | "denied" },
    query: BoundedListQuery,
  ): Promise<ListPage<IdentityEnvelopeRecord>> {
    const conditions: SQL[] = [];
    if (filters.userTrellisId !== undefined) {
      conditions.push(
        eq(identityEnvelopes.userTrellisId, filters.userTrellisId),
      );
    }
    if (filters.answer !== undefined) {
      conditions.push(eq(identityEnvelopes.answer, filters.answer));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      identityEnvelopes,
    ).where(where);
    const rows = await this.#db.select().from(identityEnvelopes).where(where)
      .orderBy(
        identityEnvelopes.userTrellisId,
        identityEnvelopes.identityEnvelopeId,
      )
      .limit(limit).offset(offset);
    return listPage(
      rows.map((row: IdentityEnvelopeRow) => decodeIdentityEnvelopeRow(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Returns approved identity envelopes ordered by user Trellis id and envelope id. */
  async listApproved(): Promise<IdentityEnvelopeRecord[]> {
    const rows = await this.#db.select().from(identityEnvelopes).where(
      eq(identityEnvelopes.answer, "approved"),
    ).orderBy(
      identityEnvelopes.userTrellisId,
      identityEnvelopes.identityEnvelopeId,
    );
    return rows.map((row: IdentityEnvelopeRow) =>
      decodeIdentityEnvelopeRow(row)
    );
  }

  /** Returns identity envelopes approved by one of the requested contract digests. */
  async listByApprovalEvidenceContractDigests(
    contractDigests: Iterable<string>,
  ): Promise<IdentityEnvelopeRecord[]> {
    const requested = [...new Set(contractDigests)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(identityEnvelopes).where(
      and(
        eq(identityEnvelopes.answer, "approved"),
        inArray(identityEnvelopes.evidenceContractDigest, requested),
      ),
    ).orderBy(
      identityEnvelopes.evidenceContractDigest,
      identityEnvelopes.userTrellisId,
      identityEnvelopes.identityEnvelopeId,
    );
    return rows.map((row: IdentityEnvelopeRow) =>
      decodeIdentityEnvelopeRow(row)
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

  /** Returns the only session for a session key, or undefined when absent. */
  async getOneBySessionKey(sessionKey: string): Promise<Session | undefined> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      eq(sessions.sessionKey, sessionKey),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeSessionRow(row);
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
        identityEnvelopeId: row.identityEnvelopeId,
        contractDigest: row.contractDigest,
        contractId: row.contractId,
        participantKind: row.participantKind,
        instanceId: row.instanceId,
        deploymentId: row.deploymentId,
        instanceKey: row.instanceKey,
        publicIdentityKey: row.publicIdentityKey,
        createdAt: row.createdAt,
        lastAuth: row.lastAuth,
        revokedAt: row.revokedAt,
        session: row.session,
      },
    });
  }

  /** Deletes the session for a session key. */
  async deleteBySessionKey(sessionKey: string): Promise<void> {
    await this.#db.delete(sessions).where(eq(sessions.sessionKey, sessionKey));
  }

  /** Deletes all sessions for one canonical user id. */
  async deleteByUser(userId: string): Promise<void> {
    await this.#db.delete(sessions).where(eq(sessions.trellisId, userId));
  }

  /** Deletes all service sessions for one service instance key. */
  async deleteByInstanceKey(instanceKey: string): Promise<void> {
    await this.#db.delete(sessions).where(
      eq(sessions.instanceKey, instanceKey),
    );
  }

  /** Deletes all device sessions for one public identity key. */
  async deleteByPublicIdentityKey(publicIdentityKey: string): Promise<void> {
    await this.#db.delete(sessions).where(
      eq(sessions.publicIdentityKey, publicIdentityKey),
    );
  }

  /** Returns a bounded page of sessions ordered by session key and principal id. */
  async listPage(query: BoundedListQuery): Promise<Session[]> {
    await this.#deleteExpiredSessions();
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(sessions).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    ).limit(limit).offset(offset);
    return rows.map((row: SessionRow) => decodeSessionRow(row));
  }

  /** Returns a bounded page of session entries ordered by session key and principal id. */
  async listEntries(query: BoundedListQuery): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(sessions).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    ).limit(limit).offset(offset);
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
  }

  /** Returns a counted page of session entries ordered by session key and principal id. */
  async listEntriesPage(
    query: BoundedListQuery,
  ): Promise<ListPage<SessionStorageEntry>> {
    await this.#deleteExpiredSessions();
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(sessions);
    const rows = await this.#db.select().from(sessions).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    ).limit(limit).offset(offset);
    return listPage(
      rows.map((row: SessionRow) => decodeSessionEntry(row)),
      countRow?.count ?? 0,
      query,
    );
  }

  /** Returns sessions affected by previewing one deployment envelope change. */
  async listEntriesForDeploymentEnvelopePreview(
    deploymentId: string,
  ): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      or(eq(sessions.deploymentId, deploymentId), eq(sessions.type, "user")),
    ).orderBy(sessions.sessionKey, sessions.trellisId);
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
  }

  /** Returns sessions for one canonical user id ordered by session key. */
  async listByUser(userId: string): Promise<Session[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      eq(sessions.trellisId, userId),
    ).orderBy(sessions.sessionKey);
    return rows.map((row: SessionRow) => decodeSessionRow(row));
  }

  /** Returns session entries for one canonical user id ordered by session key. */
  async listEntriesByUser(userId: string): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const rows = await this.#db.select().from(sessions).where(
      eq(sessions.trellisId, userId),
    ).orderBy(sessions.sessionKey);
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
  }

  /** Returns a counted page of session entries for one canonical user id. */
  async listEntriesPageByUser(
    userId: string,
    query: BoundedListQuery,
  ): Promise<ListPage<SessionStorageEntry>> {
    await this.#deleteExpiredSessions();
    const where = eq(sessions.trellisId, userId);
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(sessions)
      .where(where);
    const rows = await this.#db.select().from(sessions).where(where).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    ).limit(limit).offset(offset);
    return listPage(
      rows.map((row: SessionRow) => decodeSessionEntry(row)),
      countRow?.count ?? 0,
      query,
    );
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

  /** Returns session entries for requested contract digests ordered by digest and key. */
  async listEntriesByContractDigests(
    contractDigests: Iterable<string>,
  ): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const requested = [...new Set(contractDigests)];
    if (requested.length === 0) return [];
    const rows = await this.#db.select().from(sessions).where(
      inArray(sessions.contractDigest, requested),
    ).orderBy(sessions.contractDigest, sessions.sessionKey, sessions.trellisId);
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
  }
}
