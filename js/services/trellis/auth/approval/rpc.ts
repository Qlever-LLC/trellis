import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { AuthLogger } from "../runtime_deps.ts";
import type { IdentityEnvelopeRecord } from "../schemas.ts";
import type {
  BoundedListQuery,
  SqlIdentityEnvelopeRepository,
} from "../storage.ts";
import {
  type ApprovalKVLike,
  type ApprovalSessionStore,
  createAuthIdentitiesGrantsListHandler,
  formatOriginId,
  requireUserCaller,
  revokeGrantSessions,
} from "./user_grants.ts";

export { createAuthIdentitiesGrantsListHandler } from "./user_grants.ts";

type RpcUser = {
  type: string;
  trellisId: string;
  origin: string;
  id: string;
  capabilities?: string[];
};

type ListApprovalsRequest = BoundedListQuery & { user?: string };
type RevokeApprovalRequest = { identityEnvelopeId: string; user?: string };

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

/** Creates the Auth.Identities.List RPC handler backed by SQL approval storage. */
export function createAuthIdentitiesListHandler(deps: {
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
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
        rpc: "Auth.Identities.List",
        user: req.user,
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
        identityEnvelopeId: string;
        identityAnchor: IdentityEnvelopeRecord["identityAnchor"];
        contractEvidence: {
          contractDigest: string;
          contractId: string;
        };
        displayName: string;
        description: string;
        capabilities:
          IdentityEnvelopeRecord["approvalEvidence"]["capabilities"];
      }>;

      const target = req.user ? await resolveTargetUser(req.user, user) : null;
      const storedApprovals = await listApprovalsForRequest({
        contractApprovalStorage: deps.contractApprovalStorage,
        targetTrellisId: target?.trellisId,
        query: req,
      });

      for (const envelope of storedApprovals) {
        if (
          !target && callerTrellisId &&
          envelope.userTrellisId !== callerTrellisId
        ) {
          continue;
        }

        const approvalEvidence = envelope.approvalEvidence as
          & IdentityEnvelopeRecord["approvalEvidence"]
          & {
            participantKind: "app" | "agent";
          };
        approvals.push({
          user: formatOriginId(envelope.origin, envelope.id),
          answer: envelope.answer,
          answeredAt: envelope.answeredAt.toISOString(),
          updatedAt: envelope.updatedAt.toISOString(),
          identityEnvelopeId: envelope.identityEnvelopeId,
          identityAnchor: envelope.identityAnchor,
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
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
  targetTrellisId?: string;
  query: BoundedListQuery;
}): Promise<IdentityEnvelopeRecord[]> {
  if (args.targetTrellisId) {
    return await args.contractApprovalStorage.listPageByUser(
      args.targetTrellisId,
      args.query,
    );
  }
  return await args.contractApprovalStorage.listPage(args.query);
}

/** Creates the Auth.IdentityEnvelopes.Revoke RPC handler backed by SQL approval storage. */
export function createAuthIdentityEnvelopesRevokeHandler(opts: {
  connectionsKV: ApprovalKVLike;
  contractApprovalStorage: SqlIdentityEnvelopeRepository;
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
      rpc: "Auth.IdentityEnvelopes.Revoke",
      user: req.user,
      identityEnvelopeId: req.identityEnvelopeId,
    }, "RPC request");

    if (
      typeof req.identityEnvelopeId !== "string" ||
      req.identityEnvelopeId.length === 0
    ) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    try {
      const target = await resolveTargetUser(req.user, user);
      const existing = await opts.contractApprovalStorage.get(
        req.identityEnvelopeId,
      );
      if (existing === undefined) {
        return Result.ok({ success: false });
      }
      if (existing.userTrellisId !== target.trellisId) {
        return Result.err(
          new AuthError({ reason: "insufficient_permissions" }),
        );
      }

      await opts.contractApprovalStorage.delete(req.identityEnvelopeId);
      await revokeGrantSessions({
        userTrellisId: target.trellisId,
        identityEnvelopeId: req.identityEnvelopeId,
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
