import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { AuthLogger } from "../runtime_deps.ts";
import type { IdentityGrantRecord } from "../schemas.ts";
import type { BoundedListQuery, ListPage } from "../storage.ts";
import {
  type ApprovalKVLike,
  type ApprovalSessionStore,
  createAuthIdentitiesGrantsListHandler,
  requireUserCaller,
  revokeGrantSessions,
} from "./user_grants.ts";

export { createAuthIdentitiesGrantsListHandler } from "./user_grants.ts";

type RpcUser = {
  type: string;
  userId: string;
  capabilities?: string[];
};

type ListApprovalsRequest = BoundedListQuery & { user?: string };
type RevokeApprovalRequest = { identityGrantId: string; user?: string };

type IdentityGrantStorage = {
  get(identityGrantId: string): Promise<IdentityGrantRecord | undefined>;
  delete(identityGrantId: string): Promise<void>;
  listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<IdentityGrantRecord>>;
  listCountedPageByUser(
    userTrellisId: string,
    query: BoundedListQuery,
  ): Promise<ListPage<IdentityGrantRecord>>;
};

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

async function resolveTargetUser(
  reqUser: string | undefined,
  caller: RpcUser,
): Promise<{
  userId: string;
}> {
  if (!reqUser) {
    return {
      userId: caller.userId,
    };
  }

  const self = reqUser === caller.userId;
  if (!self && !isAdmin(caller)) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  return {
    userId: reqUser,
  };
}

/** Creates the Auth.Identities.List RPC handler backed by SQL approval storage. */
export function createAuthIdentitiesListHandler(deps: {
  contractApprovalStorage: IdentityGrantStorage;
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
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    deps.logger.trace(
      {
        rpc: "Auth.Identities.List",
        user: req.user,
        caller: user.userId,
      },
      "RPC request",
    );

    try {
      const callerUserId = isAdmin(user) ? null : user.userId;
      const approvals = [] as Array<{
        user: string;
        answer: "approved" | "denied";
        answeredAt: string;
        updatedAt: string;
        participantKind: "app" | "agent";
        identityGrantId: string;
        identityAnchor: IdentityGrantRecord["identityAnchor"];
        contractEvidence: {
          contractDigest: string;
          contractId: string;
        };
        displayName: string;
        description: string;
        capabilities: IdentityGrantRecord["approvalEvidence"]["capabilities"];
      }>;

      const target = req.user ? await resolveTargetUser(req.user, user) : null;
      const storedApprovals = await listApprovalsForRequest({
        contractApprovalStorage: deps.contractApprovalStorage,
        targetUserId: target?.userId,
        query: req,
      });

      for (const grant of storedApprovals.entries) {
        if (
          !target && callerUserId &&
          grant.userTrellisId !== callerUserId
        ) {
          continue;
        }

        const approvalEvidence = grant.approvalEvidence as
          & IdentityGrantRecord["approvalEvidence"]
          & {
            participantKind: "app" | "agent";
          };
        approvals.push({
          user: grant.userTrellisId,
          answer: grant.answer,
          answeredAt: grant.answeredAt.toISOString(),
          updatedAt: grant.updatedAt.toISOString(),
          identityGrantId: grant.identityGrantId,
          identityAnchor: grant.identityAnchor,
          contractEvidence: {
            contractDigest: approvalEvidence.contractDigest,
            contractId: approvalEvidence.contractId,
          },
          displayName: approvalEvidence.displayName,
          description: approvalEvidence.description,
          capabilities: approvalEvidence.capabilities,
          participantKind: approvalEvidence.participantKind,
        });
      }

      approvals.sort((left, right) => {
        const byUser = left.user.localeCompare(right.user);
        if (byUser !== 0) return byUser;
        return left.displayName.localeCompare(right.displayName);
      });

      return Result.ok({
        ...storedApprovals,
        entries: approvals,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return Result.err(error);
      }
      throw error;
    }
  };
}

async function listApprovalsForRequest(args: {
  contractApprovalStorage: IdentityGrantStorage;
  targetUserId?: string;
  query: BoundedListQuery;
}): Promise<ListPage<IdentityGrantRecord>> {
  if (args.targetUserId) {
    return await args.contractApprovalStorage.listCountedPageByUser(
      args.targetUserId,
      args.query,
    );
  }
  return await args.contractApprovalStorage.listCountedPage(args.query);
}

/** Creates the Auth.IdentityGrants.Revoke RPC handler backed by SQL approval storage. */
export function createAuthIdentityGrantsRevokeHandler(opts: {
  connectionsKV: ApprovalKVLike;
  contractApprovalStorage: IdentityGrantStorage;
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
          userId?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    opts.logger.trace({
      rpc: "Auth.IdentityGrants.Revoke",
      user: req.user,
      identityGrantId: req.identityGrantId,
    }, "RPC request");

    if (
      typeof req.identityGrantId !== "string" ||
      req.identityGrantId.length === 0
    ) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    try {
      const target = await resolveTargetUser(req.user, user);
      const existing = await opts.contractApprovalStorage.get(
        req.identityGrantId,
      );
      if (existing === undefined) {
        return Result.ok({ success: false });
      }
      if (existing.userTrellisId !== target.userId) {
        return Result.err(
          new AuthError({ reason: "insufficient_permissions" }),
        );
      }

      await opts.contractApprovalStorage.delete(req.identityGrantId);
      await revokeGrantSessions({
        userTrellisId: target.userId,
        identityGrantId: req.identityGrantId,
        sessionStorage: opts.sessionStorage,
        connectionsKV: opts.connectionsKV,
        kick: opts.kick,
        publishSessionRevoked: opts.publishSessionRevoked,
        revokedBy: user.userId,
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
