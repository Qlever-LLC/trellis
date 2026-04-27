import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import { type AuthLogger, authRuntimeDeps } from "../runtime_deps.ts";
import type {
  Connection,
  ContractApprovalRecord,
  Session,
} from "../schemas.ts";
import type {
  SqlContractApprovalRepository,
  SqlSessionRepository,
} from "../storage.ts";
import { parseConnectionKey } from "../session/connections.ts";
import {
  createAuthListUserGrantsHandler,
  createAuthRevokeUserGrantHandler,
} from "./user_grants.ts";

export {
  createAuthListUserGrantsHandler,
  createAuthRevokeUserGrantHandler,
} from "./user_grants.ts";

type RpcUser = {
  type: string;
  trellisId: string;
  origin: string;
  id: string;
  capabilities?: string[];
};

type ListApprovalsRequest = { user?: string; digest?: string };
type RevokeApprovalRequest = { contractDigest: string; user?: string };

type KVLike<V> = {
  get: (key: string) => AsyncResult<unknown, BaseError>;
  keys: (
    filter: string,
  ) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type SessionStore = {
  listEntriesByUser: SqlSessionRepository["listEntriesByUser"];
  deleteBySessionKey: SqlSessionRepository["deleteBySessionKey"];
};

async function takeValue<T>(
  value: AsyncResult<T, BaseError>,
): Promise<T | Result<never, BaseError>> {
  return await value.take();
}

function unwrapValue<V>(entry: { value: V } | V): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return entry.value;
  }
  return entry;
}

function parseOriginId(value: string): { origin: string; id: string } | null {
  const idx = value.indexOf(".");
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { origin: value.slice(0, idx), id: value.slice(idx + 1) };
}

function formatOriginId(origin: string, id: string): string {
  return `${origin}.${id}`;
}

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function requireUserCaller(caller: {
  type: string;
  trellisId?: string;
  origin?: string;
  id?: string;
  capabilities?: string[];
}): RpcUser {
  if (
    caller.type !== "user" || !caller.trellisId || !caller.origin || !caller.id
  ) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
    type: "user",
    trellisId: caller.trellisId,
    origin: caller.origin,
    id: caller.id,
    capabilities: caller.capabilities,
  };
}

async function resolveTargetUser(
  reqUser: string | undefined,
  caller: RpcUser,
): Promise<{
  trellisId: string;
}> {
  if (!reqUser) {
    return {
      trellisId: caller.trellisId,
    };
  }

  const parsed = parseOriginId(reqUser);
  if (!parsed) {
    throw new AuthError({ reason: "invalid_request" });
  }

  const self = parsed.origin === caller.origin && parsed.id === caller.id;
  if (!self && !isAdmin(caller)) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  return {
    trellisId: await trellisIdFromOriginId(parsed.origin, parsed.id),
  };
}

async function revokeApprovalSessions(
  userTrellisId: string,
  contractDigest: string,
  deps: {
    sessionStorage: SessionStore;
    connectionsKV: KVLike<Connection>;
    kick: (serverId: string, clientId: number) => Promise<void>;
    publishSessionRevoked: (event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    }) => Promise<void>;
    revokedBy: string;
  },
): Promise<void> {
  const entries = await deps.sessionStorage.listEntriesByUser(userTrellisId);
  for (const entry of entries) {
    const session = entry.session;
    if (session.type !== "user") continue;
    if (session.contractDigest !== contractDigest) continue;

    const sessionKey = entry.sessionKey;

    const connIter = await takeValue(
      deps.connectionsKV.keys(">"),
    );
    if (!isErr(connIter)) {
      for await (const connKey of connIter as AsyncIterable<string>) {
        const parsedKey = parseConnectionKey(connKey);
        if (
          !parsedKey || parsedKey.sessionKey !== sessionKey ||
          parsedKey.scopeId !== userTrellisId
        ) continue;
        const connection = await takeValue(deps.connectionsKV.get(connKey));
        if (!isErr(connection)) {
          const connectionValue = unwrapValue(connection) as Connection;
          await deps.kick(connectionValue.serverId, connectionValue.clientId);
        }
        await deps.connectionsKV.delete(connKey);
      }
    }

    await deps.publishSessionRevoked({
      origin: session.origin,
      id: session.id,
      sessionKey,
      revokedBy: deps.revokedBy,
    });
    await deps.sessionStorage.deleteBySessionKey(entry.sessionKey);
  }
}

/** Creates the Auth.ListApprovals RPC handler backed by SQL approval storage. */
export function createAuthListApprovalsHandler(deps: {
  contractApprovalStorage: SqlContractApprovalRepository;
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: ListApprovalsRequest;
      context: {
        caller: {
          type: string;
          trellisId?: string;
          origin?: string;
          id?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    const { logger } = authRuntimeDeps();
    logger.trace(
      {
        rpc: "Auth.ListApprovals",
        user: req.user,
        digest: req.digest,
        caller: formatOriginId(user.origin, user.id),
      },
      "RPC request",
    );

    try {
      const callerTrellisId = isAdmin(user) ? null : user.trellisId;
      const approvals = [] as Array<{
        user: string;
        answer: "approved" | "denied";
        answeredAt: string;
        updatedAt: string;
        participantKind: "app" | "agent";
        approval: {
          contractDigest: string;
          contractId: string;
          displayName: string;
          description: string;
          capabilities: string[];
        };
      }>;

      const target = req.user ? await resolveTargetUser(req.user, user) : null;
      const storedApprovals = await listApprovalsForRequest({
        contractApprovalStorage: deps.contractApprovalStorage,
        targetTrellisId: target?.trellisId,
        digest: req.digest,
      });

      for (const approval of storedApprovals) {
        if (
          !target && callerTrellisId &&
          approval.userTrellisId !== callerTrellisId
        ) {
          continue;
        }
        if (req.digest && approval.approval.contractDigest !== req.digest) {
          continue;
        }

        const contractApproval = approval.approval as
          & ContractApprovalRecord["approval"]
          & {
            participantKind: "app" | "agent";
          };
        approvals.push({
          user: formatOriginId(approval.origin, approval.id),
          answer: approval.answer,
          answeredAt: approval.answeredAt.toISOString(),
          updatedAt: approval.updatedAt.toISOString(),
          approval: approval.approval,
          participantKind: contractApproval.participantKind,
        });
      }

      approvals.sort((left, right) => {
        const byUser = left.user.localeCompare(right.user);
        if (byUser !== 0) return byUser;
        return left.approval.displayName.localeCompare(
          right.approval.displayName,
        );
      });

      return Result.ok({ approvals });
    } catch (error) {
      if (error instanceof AuthError) {
        return Result.err(error);
      }
      throw error;
    }
  };
}

async function listApprovalsForRequest(args: {
  contractApprovalStorage: SqlContractApprovalRepository;
  targetTrellisId?: string;
  digest?: string;
}): Promise<ContractApprovalRecord[]> {
  if (args.targetTrellisId && args.digest) {
    const approval = await args.contractApprovalStorage.get(
      args.targetTrellisId,
      args.digest,
    );
    return approval === undefined ? [] : [approval];
  }
  if (args.targetTrellisId) {
    return await args.contractApprovalStorage.listByUser(args.targetTrellisId);
  }
  if (args.digest) {
    return await args.contractApprovalStorage.listByDigest(args.digest);
  }
  return await args.contractApprovalStorage.list();
}

/** Creates the Auth.RevokeApproval RPC handler backed by SQL approval storage. */
export function createAuthRevokeApprovalHandler(opts: {
  contractApprovalStorage: SqlContractApprovalRepository;
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: RevokeApprovalRequest;
      context: {
        caller: {
          type: string;
          trellisId?: string;
          origin?: string;
          id?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    const { connectionsKV, logger, sessionStorage, trellis } =
      authRuntimeDeps();
    logger.trace({
      rpc: "Auth.RevokeApproval",
      user: req.user,
      contractDigest: req.contractDigest,
    }, "RPC request");

    if (
      typeof req.contractDigest !== "string" || req.contractDigest.length === 0
    ) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    try {
      const target = await resolveTargetUser(req.user, user);
      const existing = await opts.contractApprovalStorage.get(
        target.trellisId,
        req.contractDigest,
      );
      if (existing === undefined) {
        return Result.ok({ success: false });
      }

      await opts.contractApprovalStorage.delete(
        target.trellisId,
        req.contractDigest,
      );
      await revokeApprovalSessions(
        target.trellisId,
        req.contractDigest,
        {
          sessionStorage,
          connectionsKV,
          kick: opts.kick,
          publishSessionRevoked: async (event) => {
            (await trellis.publish("Auth.SessionRevoked", event)).inspectErr(
              (error) =>
                logger.warn({ error }, "Failed to publish Auth.SessionRevoked"),
            );
          },
          revokedBy: formatOriginId(user.origin, user.id),
        },
      );
      return Result.ok({ success: true });
    } catch (error) {
      if (error instanceof AuthError) {
        return Result.err(error);
      }
      throw error;
    }
  };
}

/** Creates the Auth.RevokeUserGrant RPC handler with KV session revocation. */
export function createAuthRevokeUserGrantRpcHandler(deps: {
  connectionsKV: KVLike<Connection>;
  contractApprovalStorage: SqlContractApprovalRepository;
  kick: (serverId: string, clientId: number) => Promise<void>;
  logger: Pick<AuthLogger, "warn">;
  publishSessionRevoked: (event: {
    origin: string;
    id: string;
    sessionKey: string;
    revokedBy: string;
  }) => Promise<void>;
  sessionStorage: SessionStore;
}) {
  return createAuthRevokeUserGrantHandler({
    connectionsKV: deps.connectionsKV,
    contractApprovalStorage: deps.contractApprovalStorage,
    kick: deps.kick,
    sessionStorage: deps.sessionStorage,
    publishSessionRevoked: async (event) => {
      await deps.publishSessionRevoked(event).catch((error) => {
        deps.logger.warn({ error }, "Failed to publish Auth.SessionRevoked");
      });
    },
  });
}
