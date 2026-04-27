import {
  AsyncResult,
  BaseError,
  type BaseErrorOptions,
  isErr,
  Result,
} from "@qlever-llc/result";
import Type, { type Static } from "typebox";
import type { Connection, Session, UserSession } from "../schemas.ts";
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
  getOneBySessionKey: (sessionKey: string) => Promise<Session | undefined>;
  put: (sessionKey: string, session: Session) => Promise<void>;
  deleteBySessionKey: (sessionKey: string) => Promise<void>;
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
  approvalSource?: UserSession["approvalSource"];
  delegatedCapabilities: string[];
  delegatedPublishSubjects: string[];
  delegatedSubscribeSubjects: string[];
}): Promise<Result<{ createdAt: Date }, EnsureBoundUserSessionError>> {
  let existingSession: Session | undefined;
  try {
    existingSession = await args.sessionStorage.getOneBySessionKey(
      args.sessionKey,
    );
  } catch (error) {
    return Result.err(
      new EnsureBoundUserSessionError("storage_error", {
        context: { op: "getOneBySessionKey", error },
      }),
    );
  }

  const expectedIdentityMatches = (s: Session): s is UserSession =>
    s.type === "user" &&
    s.trellisId === args.trellisId &&
    s.origin === args.origin &&
    s.id === args.id;

  const needsReset = existingSession !== undefined &&
    !expectedIdentityMatches(existingSession);

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

    try {
      await args.sessionStorage.deleteBySessionKey(args.sessionKey);
    } catch (error) {
      return Result.err(
        new EnsureBoundUserSessionError("storage_error", {
          context: {
            op: "session_delete",
            sessionKey: args.sessionKey,
            error,
          },
        }),
      );
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
    ...(args.approvalSource ? { approvalSource: args.approvalSource } : {}),
    delegatedCapabilities: args.delegatedCapabilities,
    delegatedPublishSubjects: args.delegatedPublishSubjects,
    delegatedSubscribeSubjects: args.delegatedSubscribeSubjects,
    createdAt: args.now,
    lastAuth: args.now,
  };

  if (existingSession === undefined || needsReset) {
    try {
      await args.sessionStorage.put(args.sessionKey, session);
      return Result.ok({ createdAt: args.now });
    } catch (error) {
      return Result.err(
        new EnsureBoundUserSessionError("storage_error", {
          context: { op: "put", sessionKey: args.sessionKey, error },
        }),
      );
    }
  }

  if (!expectedIdentityMatches(existingSession)) {
    return Result.err(new EnsureBoundUserSessionError("session_already_bound"));
  }

  // Update lastAuth + user fields, but preserve createdAt.
  const { app: _existingApp, ...existingSessionBase } = existingSession;
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
        context: { op: "put", sessionKey: args.sessionKey, error },
      }),
    );
  }

  return Result.ok({ createdAt: updated.createdAt });
}
