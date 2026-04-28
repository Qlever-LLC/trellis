import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { AuthLogger } from "../runtime_deps.ts";
import type { ContractApprovalRecord } from "../schemas.ts";
import type { SqlContractApprovalRepository } from "../storage.ts";
import {
  type ApprovalKVLike,
  type ApprovalSessionStore,
  createAuthListUserGrantsHandler,
  createAuthRevokeUserGrantHandler,
  formatOriginId,
  requireUserCaller,
  revokeGrantSessions,
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

function parseOriginId(value: string): { origin: string; id: string } | null {
  const idx = value.indexOf(".");
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { origin: value.slice(0, idx), id: value.slice(idx + 1) };
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

/** Creates the Auth.ListApprovals RPC handler backed by SQL approval storage. */
export function createAuthListApprovalsHandler(deps: {
  contractApprovalStorage: SqlContractApprovalRepository;
  logger: Pick<AuthLogger, "trace">;
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
    deps.logger.trace(
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
  connectionsKV: ApprovalKVLike;
  contractApprovalStorage: SqlContractApprovalRepository;
  kick: (serverId: string, clientId: number) => Promise<void>;
  logger: Pick<AuthLogger, "trace" | "warn">;
  publishSessionRevoked: (event: {
    origin: string;
    id: string;
    sessionKey: string;
    revokedBy: string;
  }) => Promise<void>;
  sessionStorage: ApprovalSessionStore;
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
    opts.logger.trace({
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
      await revokeGrantSessions({
        userTrellisId: target.trellisId,
        contractDigest: req.contractDigest,
        sessionStorage: opts.sessionStorage,
        connectionsKV: opts.connectionsKV,
        kick: opts.kick,
        publishSessionRevoked: opts.publishSessionRevoked,
        revokedBy: formatOriginId(user.origin, user.id),
      });
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
  connectionsKV: ApprovalKVLike;
  contractApprovalStorage: SqlContractApprovalRepository;
  kick: (serverId: string, clientId: number) => Promise<void>;
  logger: Pick<AuthLogger, "warn">;
  publishSessionRevoked: (event: {
    origin: string;
    id: string;
    sessionKey: string;
    revokedBy: string;
  }) => Promise<void>;
  sessionStorage: ApprovalSessionStore;
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
