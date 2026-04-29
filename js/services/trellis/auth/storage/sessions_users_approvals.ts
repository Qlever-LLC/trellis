import { and, eq, lt } from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import { contractApprovals, sessions, users } from "../../storage/schema.ts";
import {
  type ContractApprovalRecord,
  ContractApprovalRecordSchema,
  type Session,
  SessionSchema,
  type UserProjectionEntry,
  UserProjectionSchema,
} from "../schemas.ts";
import { isoString, parseJsonField } from "./shared.ts";

type UserRow = typeof users.$inferSelect;
type UserInsert = typeof users.$inferInsert;
type ContractApprovalRow = typeof contractApprovals.$inferSelect;
type ContractApprovalInsert = typeof contractApprovals.$inferInsert;
type SessionRow = typeof sessions.$inferSelect;
type SessionInsert = typeof sessions.$inferInsert;

export type SessionStorageEntry = {
  sessionKey: string;
  trellisId: string;
  session: Session;
};

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
