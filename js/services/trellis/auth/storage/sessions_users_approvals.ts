import { and, eq, inArray, lt, or } from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import { identityEnvelopes, sessions, users } from "../../storage/schema.ts";
import {
  type IdentityEnvelopeRecord,
  IdentityEnvelopeRecordSchema,
  type Session,
  SessionSchema,
  type UserProjectionEntry,
  UserProjectionSchema,
} from "../schemas.ts";
import {
  type BoundedListQuery,
  boundedListQuery,
  isoString,
  parseJsonField,
} from "./shared.ts";

type UserRow = typeof users.$inferSelect;
type UserInsert = typeof users.$inferInsert;
type IdentityEnvelopeRow = typeof identityEnvelopes.$inferSelect;
type IdentityEnvelopeInsert = typeof identityEnvelopes.$inferInsert;
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

  /** Returns a bounded page of user projections ordered by Trellis id. */
  async listPage(query: BoundedListQuery): Promise<UserProjectionEntry[]> {
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(users).orderBy(users.trellisId)
      .limit(limit).offset(offset);
    return rows.map((row: UserRow) => decodeUserRow(row));
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

  /** Returns a bounded page of sessions ordered by session key and Trellis/session id. */
  async listPage(query: BoundedListQuery): Promise<Session[]> {
    await this.#deleteExpiredSessions();
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(sessions).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    ).limit(limit).offset(offset);
    return rows.map((row: SessionRow) => decodeSessionRow(row));
  }

  /** Returns a bounded page of session entries ordered by session key and Trellis/session id. */
  async listEntries(query: BoundedListQuery): Promise<SessionStorageEntry[]> {
    await this.#deleteExpiredSessions();
    const { offset, limit } = boundedListQuery(query);
    const rows = await this.#db.select().from(sessions).orderBy(
      sessions.sessionKey,
      sessions.trellisId,
    ).limit(limit).offset(offset);
    return rows.map((row: SessionRow) => decodeSessionEntry(row));
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
