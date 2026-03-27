import { trellisIdFromOriginId } from "@qlever-llc/trellis-auth";
import { isErr, Result } from "@qlever-llc/trellis-result";
import { AuthError } from "@qlever-llc/trellis";

import {
  connectionsKV,
  contractApprovalsKV,
  logger,
  sessionKV,
  trellis,
} from "../../bootstrap/globals.ts";

type RpcUser = {
  origin: string;
  id: string;
  capabilities?: string[];
};

type ListApprovalsRequest = { user?: string; digest?: string };
type RevokeApprovalRequest = { contractDigest: string; user?: string };

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

async function resolveTargetUser(
  reqUser: string | undefined,
  caller: RpcUser,
): Promise<{
  trellisId: string;
}> {
  if (!reqUser) {
    return {
      trellisId: await trellisIdFromOriginId(caller.origin, caller.id),
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
  kick: (serverId: string, clientId: number) => Promise<void>,
): Promise<void> {
  const iter = (await sessionKV.keys(`>.${userTrellisId}`)).take();
  if (isErr(iter)) return;

  for await (const key of iter) {
    const entry = (await sessionKV.get(key)).take();
    if (isErr(entry)) continue;
    if (entry.value.type !== "user") continue;
    if (entry.value.contractDigest !== contractDigest) continue;

    const sessionKey = key.split(".")[0];
    if (!sessionKey) continue;

    const connIter =
      (await connectionsKV.keys(`${sessionKey}.${userTrellisId}.>`)).take();
    if (!isErr(connIter)) {
      for await (const connKey of connIter) {
        const connection = (await connectionsKV.get(connKey)).take();
        if (!isErr(connection)) {
          await kick(connection.value.serverId, connection.value.clientId);
        }
        await connectionsKV.delete(connKey);
      }
    }

    await sessionKV.delete(key);
  }
}

export const authListApprovalsHandler = async (
  req: ListApprovalsRequest,
  { user }: { user: RpcUser },
) => {
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
      : await trellisIdFromOriginId(user.origin, user.id);
    const approvals = [] as Array<{
      user: string;
      answer: "approved" | "denied";
      answeredAt: string;
      updatedAt: string;
      approval: {
        contractDigest: string;
        contractId: string;
        displayName: string;
        description: string;
        kind: string;
        capabilities: string[];
      };
    }>;

    const target = req.user ? await resolveTargetUser(req.user, user) : null;
    const iter = target
      ? (await contractApprovalsKV.keys(`${target.trellisId}.>`)).take()
      : (await contractApprovalsKV.keys(">")).take();

    if (isErr(iter)) {
      return Result.ok({ approvals: [] });
    }

    for await (const key of iter) {
      const entry = (await contractApprovalsKV.get(key)).take();
      if (isErr(entry)) continue;

      if (
        !target && callerTrellisId &&
        entry.value.userTrellisId !== callerTrellisId
      ) {
        continue;
      }
      if (req.digest && entry.value.approval.contractDigest !== req.digest) {
        continue;
      }

      approvals.push({
        user: formatOriginId(entry.value.origin, entry.value.id),
        answer: entry.value.answer,
        answeredAt: entry.value.answeredAt.toISOString(),
        updatedAt: entry.value.updatedAt.toISOString(),
        approval: entry.value.approval,
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
  return async (req: RevokeApprovalRequest, { user }: { user: RpcUser }) => {
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
      const existing = (await contractApprovalsKV.get(approvalKey)).take();
      if (isErr(existing)) {
        return Result.ok({ success: false });
      }

      await contractApprovalsKV.delete(approvalKey);
      await revokeApprovalSessions(
        target.trellisId,
        req.contractDigest,
        opts.kick,
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
