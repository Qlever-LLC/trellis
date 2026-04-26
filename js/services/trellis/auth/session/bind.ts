import {
  AsyncResult,
  BaseError,
  type BaseErrorOptions,
  isErr,
  Result,
} from "@qlever-llc/result";
import Type, { type Static } from "typebox";
import type { Connection, Session, UserSession } from "../../state/schemas.ts";
import { connectionFilterForSession } from "./connections.ts";

type Taken<T> = T | Result<never, BaseError>;

type KVLike<V> = {
  keys: (
    filter: string | string[],
  ) => AsyncResult<Taken<AsyncIterable<string>>, BaseError>;
  get: (key: string) => AsyncResult<Taken<{ value: V } | V>, BaseError>;
  create?: (key: string, value: V) => AsyncResult<Taken<void>, BaseError>;
  put: (key: string, value: V) => AsyncResult<Taken<void>, BaseError>;
  delete: (key: string) => AsyncResult<Taken<void>, BaseError>;
};

type SessionStore = {
  listEntriesBySessionKey: (
    sessionKey: string,
  ) => Promise<
    Array<{ sessionKey: string; trellisId: string; session: Session }>
  >;
  get: (sessionKey: string, trellisId: string) => Promise<Session | undefined>;
  put: (sessionKey: string, session: Session) => Promise<void>;
  delete: (sessionKey: string, trellisId: string) => Promise<void>;
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
    Type.Literal("storage_error"),
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
      : "Session storage operation failed";
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
 * - Existing identity matches are treated as recovery and update mutable fields.
 */
export async function ensureBoundUserSession(args: {
  sessionStorage: SessionStore;
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
  participantKind: UserSession["participantKind"];
  contractDigest: string;
  contractId: string;
  contractDisplayName: string;
  contractDescription: string;
  app?: UserSession["app"];
  appOrigin?: string;
  approvalSource?: UserSession["approvalSource"];
  delegatedCapabilities: string[];
  delegatedPublishSubjects: string[];
  delegatedSubscribeSubjects: string[];
}): Promise<Result<{ createdAt: Date }, EnsureBoundUserSessionError>> {
  const sessionKeyId = `${args.sessionKey}.${args.trellisId}`;

  let existingEntries: Array<{
    sessionKey: string;
    trellisId: string;
    session: Session;
  }>;
  try {
    existingEntries = await args.sessionStorage.listEntriesBySessionKey(
      args.sessionKey,
    );
  } catch (error) {
    return Result.err(
      new EnsureBoundUserSessionError("storage_error", {
        context: { op: "listEntriesBySessionKey", error },
      }),
    );
  }

  const expectedIdentityMatches = (s: Session): s is UserSession =>
    s.type === "user" &&
    s.trellisId === args.trellisId &&
    s.origin === args.origin &&
    s.id === args.id;

  const existingKeyMismatch = existingEntries.some((entry) =>
    `${entry.sessionKey}.${entry.trellisId}` !== sessionKeyId
  );
  const needsReset = existingEntries.length > 1 || existingKeyMismatch;

  if (needsReset) {
    // Kick and delete any tracked connections for this sessionKey.
    const connKeys = await args.connectionsKV.keys(
      connectionFilterForSession(args.sessionKey),
    )
      .take();
    if (isErr(connKeys)) {
      return Result.err(
        new EnsureBoundUserSessionError("kv_error", {
          context: {
            op: "connections_keys",
            prefix: connectionFilterForSession(args.sessionKey),
          },
        }),
      );
    }
    for await (const key of connKeys) {
      const entry = await args.connectionsKV.get(key).take();
      if (isErr(entry)) {
        return Result.err(
          new EnsureBoundUserSessionError("storage_error", {
            context: { op: "connection_get", key },
          }),
        );
      }
      const v = unwrapValue(entry as { value: Connection } | Connection);
      await args.kick(v.serverId, v.clientId);
      const deleteConnection = await args.connectionsKV.delete(key).take();
      if (isErr(deleteConnection)) {
        return Result.err(
          new EnsureBoundUserSessionError("kv_error", {
            context: { op: "connection_delete", key },
          }),
        );
      }
    }

    // Delete all existing session entries for this sessionKey prefix.
    for (const entry of existingEntries) {
      try {
        await args.sessionStorage.delete(entry.sessionKey, entry.trellisId);
      } catch (error) {
        return Result.err(
          new EnsureBoundUserSessionError("storage_error", {
            context: {
              op: "session_delete",
              sessionKey: entry.sessionKey,
              trellisId: entry.trellisId,
              error,
            },
          }),
        );
      }
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
    participantKind: args.participantKind,
    contractDigest: args.contractDigest,
    contractId: args.contractId,
    contractDisplayName: args.contractDisplayName,
    contractDescription: args.contractDescription,
    ...(args.app ? { app: args.app } : {}),
    ...(args.appOrigin ? { appOrigin: args.appOrigin } : {}),
    ...(args.approvalSource ? { approvalSource: args.approvalSource } : {}),
    delegatedCapabilities: args.delegatedCapabilities,
    delegatedPublishSubjects: args.delegatedPublishSubjects,
    delegatedSubscribeSubjects: args.delegatedSubscribeSubjects,
    createdAt: args.now,
    lastAuth: args.now,
  };

  if (existingEntries.length === 0 || needsReset) {
    try {
      await args.sessionStorage.put(args.sessionKey, session);
      return Result.ok({ createdAt: args.now });
    } catch (error) {
      return Result.err(
        new EnsureBoundUserSessionError("storage_error", {
          context: { op: "put", key: sessionKeyId, error },
        }),
      );
    }
  }

  const existingSession = await args.sessionStorage.get(
    args.sessionKey,
    args.trellisId,
  );
  if (!existingSession) {
    return Result.err(
      new EnsureBoundUserSessionError("storage_error", {
        context: { op: "get", key: sessionKeyId },
      }),
    );
  }
  if (!expectedIdentityMatches(existingSession)) {
    return Result.err(new EnsureBoundUserSessionError("session_already_bound"));
  }

  // Update lastAuth + user fields, but preserve createdAt.
  const {
    app: _existingApp,
    appOrigin: _existingAppOrigin,
    ...existingSessionBase
  } = existingSession;
  const updated: UserSession = {
    ...existingSessionBase,
    email: args.email,
    name: args.name,
    ...(args.image ? { image: args.image } : {}),
    participantKind: args.participantKind,
    contractDigest: args.contractDigest,
    contractId: args.contractId,
    contractDisplayName: args.contractDisplayName,
    contractDescription: args.contractDescription,
    ...(args.app ? { app: args.app } : {}),
    ...(args.appOrigin ? { appOrigin: args.appOrigin } : {}),
    ...(args.approvalSource ? { approvalSource: args.approvalSource } : {}),
    delegatedCapabilities: args.delegatedCapabilities,
    delegatedPublishSubjects: args.delegatedPublishSubjects,
    delegatedSubscribeSubjects: args.delegatedSubscribeSubjects,
    lastAuth: args.now,
  };
  try {
    await args.sessionStorage.put(args.sessionKey, updated);
  } catch (error) {
    return Result.err(
      new EnsureBoundUserSessionError("storage_error", {
        context: { op: "put", key: sessionKeyId, error },
      }),
    );
  }

  return Result.ok({ createdAt: updated.createdAt });
}
