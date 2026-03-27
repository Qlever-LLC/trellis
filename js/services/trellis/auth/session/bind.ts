import { BaseError, type BaseErrorOptions, isErr, Result } from "@qlever-llc/trellis-result";
import Type, { type Static } from "typebox";
import type { Connection, Session, UserSession } from "../../state/schemas.ts";

type KVResult<T> = { take(): T };

type Taken<T> = T | Result<never, BaseError>;

type KVLike<V> = {
  keys: (filter: string | string[]) => Promise<KVResult<Taken<AsyncIterable<string>>>>;
  get: (key: string) => Promise<KVResult<Taken<{ value: V } | V>>>;
  create?: (key: string, value: V) => Promise<KVResult<Taken<void>>>;
  put: (key: string, value: V) => Promise<KVResult<Taken<void>>>;
  delete: (key: string) => Promise<KVResult<Taken<void>>>;
};

function unwrapValue<V>(entry: { value: V } | V): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return (entry as { value: V }).value;
  }
  return entry as V;
}

export const EnsureBoundUserSessionErrorDataSchema = Type.Object({
  id: Type.String(),
  type: Type.Literal("EnsureBoundUserSessionError"),
  message: Type.String(),
  context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String()),
  reason: Type.Union([
    Type.Literal("session_already_bound"),
    Type.Literal("kv_error"),
  ]),
});
export type EnsureBoundUserSessionErrorData = Static<
  typeof EnsureBoundUserSessionErrorDataSchema
>;

export class EnsureBoundUserSessionError extends BaseError<
  EnsureBoundUserSessionErrorData
> {
  override readonly name = "EnsureBoundUserSessionError" as const;

  constructor(
    readonly reason: EnsureBoundUserSessionErrorData["reason"],
    options?: BaseErrorOptions,
  ) {
    const msg = reason === "session_already_bound"
      ? "Session key already bound"
      : "KV operation failed";
    super(msg, options);
  }

  override toSerializable(): EnsureBoundUserSessionErrorData {
    return {
      ...(this.baseSerializable() as EnsureBoundUserSessionErrorData),
      reason: this.reason,
    };
  }
}

/**
 * Ensures a single active session entry exists for a given `sessionKey`, bound to
 * the provided user identity (`trellisId`).
 *
 * This implements the ADR's bind semantics:
 * - Only one active session per `sessionKey` prefix.
 * - If a different user is currently bound: kick connections + delete sessions, then create.
 * - Atomic create (`revision=0`) via KV `create`; on conflict, treat it as recovery if identity matches.
 */
export async function ensureBoundUserSession(args: {
  sessionKV: KVLike<Session>;
  connectionsKV: KVLike<Connection>;
  kick: (serverId: string, clientId: number) => Promise<void>;
  now: Date;
  sessionKey: string;
  trellisId: string;
  origin: string;
  id: string;
  email: string;
  name: string;
  image?: string;
  contractDigest: string;
  contractId: string;
  contractDisplayName: string;
  contractDescription: string;
  contractKind: string;
  delegatedCapabilities: string[];
  delegatedPublishSubjects: string[];
  delegatedSubscribeSubjects: string[];
}): Promise<Result<{ createdAt: Date }, EnsureBoundUserSessionError>> {
  const sessionKeyId = `${args.sessionKey}.${args.trellisId}`;

  const existingIter = (await args.sessionKV.keys(`${args.sessionKey}.>`)).take();
  const existingKeys: string[] = [];
  if (!isErr(existingIter)) {
    for await (const key of existingIter) existingKeys.push(key);
  }

  const expectedIdentityMatches = (s: Session): s is UserSession =>
    s.type === "user" &&
    s.trellisId === args.trellisId &&
    s.origin === args.origin &&
    s.id === args.id;

  const existingKeyMismatch = existingKeys.some((k) => k !== sessionKeyId);
  const needsReset = existingKeys.length > 1 || existingKeyMismatch;

  if (needsReset) {
    // Kick and delete any tracked connections for this sessionKey.
    const connKeys = (await args.connectionsKV.keys(`${args.sessionKey}.>.>`)).take();
    if (!isErr(connKeys)) {
      for await (const key of connKeys) {
        const entry = (await args.connectionsKV.get(key)).take();
        if (!isErr(entry)) {
          const v = unwrapValue(entry as { value: Connection } | Connection);
          await args.kick(v.serverId, v.clientId);
        }
        await args.connectionsKV.delete(key);
      }
    }

    // Delete all existing session entries for this sessionKey prefix.
    for (const key of existingKeys) {
      await args.sessionKV.delete(key);
    }
  }

  const session: UserSession = {
    type: "user",
    trellisId: args.trellisId,
    origin: args.origin,
    id: args.id,
    email: args.email,
    name: args.name,
    ...(args.image ? { image: args.image } : {}),
    contractDigest: args.contractDigest,
    contractId: args.contractId,
    contractDisplayName: args.contractDisplayName,
    contractDescription: args.contractDescription,
    contractKind: args.contractKind,
    delegatedCapabilities: args.delegatedCapabilities,
    delegatedPublishSubjects: args.delegatedPublishSubjects,
    delegatedSubscribeSubjects: args.delegatedSubscribeSubjects,
    createdAt: args.now,
    lastAuth: args.now,
  };

  if (typeof args.sessionKV.create === "function") {
    const created = (await args.sessionKV.create(sessionKeyId, session)).take();
    if (!isErr(created)) {
      return Result.ok({ createdAt: args.now });
    }
  } else {
    // Should not happen in production; `TypedKV` supports create().
    return Result.err(
      new EnsureBoundUserSessionError("kv_error", {
        context: { op: "create_missing" },
      }),
    );
  }

  // If create failed, treat it as session recovery *only if* the existing session matches.
  const existing = (await args.sessionKV.get(sessionKeyId)).take();
  if (isErr(existing)) {
    return Result.err(
      new EnsureBoundUserSessionError("kv_error", {
        context: { op: "get", key: sessionKeyId },
      }),
    );
  }

  const existingSession = unwrapValue(existing as { value: Session } | Session);
  if (!expectedIdentityMatches(existingSession)) {
    return Result.err(new EnsureBoundUserSessionError("session_already_bound"));
  }

  // Update lastAuth + user fields, but preserve createdAt.
  const updated: UserSession = {
    ...existingSession,
    email: args.email,
    name: args.name,
    ...(args.image ? { image: args.image } : {}),
    contractDigest: args.contractDigest,
    contractId: args.contractId,
    contractDisplayName: args.contractDisplayName,
    contractDescription: args.contractDescription,
    contractKind: args.contractKind,
    delegatedCapabilities: args.delegatedCapabilities,
    delegatedPublishSubjects: args.delegatedPublishSubjects,
    delegatedSubscribeSubjects: args.delegatedSubscribeSubjects,
    lastAuth: args.now,
  };
  const putRes = (await args.sessionKV.put(sessionKeyId, updated)).take();
  if (isErr(putRes)) {
    return Result.err(
      new EnsureBoundUserSessionError("kv_error", {
        context: { op: "put", key: sessionKeyId },
      }),
    );
  }

  return Result.ok({ createdAt: updated.createdAt });
}
