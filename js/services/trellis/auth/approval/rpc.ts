import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { type AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import {
  connectionsKV,
  contractApprovalsKV,
  logger,
  sessionKV,
  trellis,
} from "../../bootstrap/globals.ts";
import type { Connection, ContractApprovalRecord, Session } from "../../state/schemas.ts";
import {
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
  keys: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
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
  if (caller.type !== "user" || !caller.trellisId || !caller.origin || !caller.id) {
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
    sessionKV: KVLike<Session>;
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
  const iter = await takeValue(deps.sessionKV.keys(`>.${userTrellisId}`));
  if (isErr(iter)) return;

  for await (const key of iter as AsyncIterable<string>) {
    const entry = await takeValue(deps.sessionKV.get(key));
    if (isErr(entry)) continue;
    const session = unwrapValue(entry) as Session;
    if (session.type !== "user") continue;
    if (session.contractDigest !== contractDigest) continue;

    const sessionKey = key.split(".")[0];
    if (!sessionKey) continue;

    const connIter =
      await takeValue(deps.connectionsKV.keys(`${sessionKey}.${userTrellisId}.>`));
    if (!isErr(connIter)) {
      for await (const connKey of connIter as AsyncIterable<string>) {
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
    await deps.sessionKV.delete(key);
  }
}

export const authListApprovalsHandler = async (
  req: ListApprovalsRequest,
  { caller }: { caller: { type: string; trellisId?: string; origin?: string; id?: string; capabilities?: string[] } },
) => {
  const user = requireUserCaller(caller);
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
    const callerTrellisId = isAdmin(user)
      ? null
      : user.trellisId;
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
    const iter = target
      ? await takeValue(contractApprovalsKV.keys(`${target.trellisId}.>`))
      : await takeValue(contractApprovalsKV.keys(">"));

    if (isErr(iter)) {
      return Result.ok({ approvals: [] });
    }

    for await (const key of iter as AsyncIterable<string>) {
      const entry = await takeValue(contractApprovalsKV.get(key));
      if (isErr(entry)) continue;
      const approval = unwrapValue(entry) as ContractApprovalRecord;

      if (
        !target && callerTrellisId &&
        approval.userTrellisId !== callerTrellisId
      ) {
        continue;
      }
      if (req.digest && approval.approval.contractDigest !== req.digest) {
        continue;
      }

      const contractApproval = approval.approval as ContractApprovalRecord["approval"] & {
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

export function createAuthRevokeApprovalHandler(opts: {
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async (
    req: RevokeApprovalRequest,
    { caller }: { caller: { type: string; trellisId?: string; origin?: string; id?: string; capabilities?: string[] } },
  ) => {
    const user = requireUserCaller(caller);
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
      const approvalKey = `${target.trellisId}.${req.contractDigest}`;
      const existing = await takeValue(contractApprovalsKV.get(approvalKey));
      if (isErr(existing)) {
        return Result.ok({ success: false });
      }

      await contractApprovalsKV.delete(approvalKey);
      await revokeApprovalSessions(
        target.trellisId,
        req.contractDigest,
        {
          sessionKV,
          connectionsKV,
          kick: opts.kick,
          publishSessionRevoked: async (event) => {
            await trellis.publish("Auth.SessionRevoked", event).inspectErr((error) =>
              logger.warn({ error }, "Failed to publish Auth.SessionRevoked"));
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

export const authListUserGrantsHandler = createAuthListUserGrantsHandler({
  contractApprovalsKV,
});

export const authRevokeUserGrantHandler = createAuthRevokeUserGrantHandler({
  contractApprovalsKV,
  sessionKV,
  connectionsKV,
  kick: async (serverId, clientId) => {
    await import("../callout/kick.ts").then(({ kick }) => kick(serverId, clientId));
  },
  publishSessionRevoked: async (event) => {
    await trellis.publish("Auth.SessionRevoked", event).inspectErr((error) =>
      logger.warn({ error }, "Failed to publish Auth.SessionRevoked"));
  },
});
