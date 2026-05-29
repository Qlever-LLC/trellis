import { type AsyncResult, type BaseError, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { IdentityGrantRecord, UserParticipantKind } from "../schemas.ts";
import type {
  BoundedListQuery,
  ListPage,
  SqlSessionRepository,
} from "../storage.ts";
import { parseConnectionKey } from "../session/connections.ts";
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";

export type ApprovalKVLike = {
  get: (key: string) => AsyncResult<unknown, BaseError>;
  keys: (
    filter: string,
  ) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

export type ApprovalSessionStore = {
  listEntriesByUser: SqlSessionRepository["listEntriesByUser"];
  deleteBySessionKey: SqlSessionRepository["deleteBySessionKey"];
};

type RpcUser = {
  type: string;
  userId: string;
  identity?: { provider: string; subject: string };
  capabilities?: string[];
};

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
  listApprovedCountedPageByUser(
    userTrellisId: string,
    query: BoundedListQuery,
  ): Promise<ListPage<IdentityGrantRecord>>;
};

/** Formats a provider and subject pair for approval RPC inputs. */
export function formatOriginId(origin: string, id: string): string {
  return `${origin}.${id}`;
}

/** Returns a normalized user caller or throws the approval RPC auth error. */
export function requireUserCaller(caller: {
  type: string;
  userId?: string;
  identity?: { provider: string; subject: string };
  capabilities?: string[];
}): RpcUser {
  if (
    caller.type !== "user" || !caller.userId
  ) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
    type: "user",
    userId: caller.userId,
    identity: caller.identity,
    capabilities: caller.capabilities,
  };
}

function toUserGrant(grant: IdentityGrantRecord) {
  const approvalEvidence = grant.approvalEvidence as
    & IdentityGrantRecord["approvalEvidence"]
    & {
      participantKind: "app" | "agent";
    };
  return {
    identityGrantId: grant.identityGrantId,
    identityAnchor: grant.identityAnchor,
    contractEvidence: {
      contractDigest: approvalEvidence.contractDigest,
      contractId: approvalEvidence.contractId,
    },
    displayName: approvalEvidence.displayName,
    description: approvalEvidence.description,
    participantKind: approvalEvidence.participantKind,
    capabilities: Object.keys(approvalEvidence.capabilities),
    grantedAt: grant.answeredAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

/** Revokes active sessions and connections for a user contract grant. */
export async function revokeGrantSessions(args: {
  userTrellisId: string;
  identityGrantId: string;
  participantKind?: UserParticipantKind;
  sessionStorage: ApprovalSessionStore;
  connectionsKV: ApprovalKVLike;
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
  revokedBy: string;
}): Promise<void> {
  const entries = await args.sessionStorage.listEntriesByUser(
    args.userTrellisId,
  );
  for (const entry of entries) {
    const session = entry.session;
    if (
      session.type !== "user" ||
      session.identityGrantId !== args.identityGrantId
    ) continue;
    if (
      args.participantKind && session.participantKind !== args.participantKind
    ) continue;

    const sessionKey = entry.sessionKey;

    await revokeRuntimeAccessForSession({
      sessionKey,
      connectionFilter: ">",
      shouldRevokeConnectionKey: (connKey) => {
        const parsedKey = parseConnectionKey(connKey);
        return parsedKey !== null && parsedKey.sessionKey === sessionKey &&
          parsedKey.scopeId === args.userTrellisId;
      },
      connectionsKV: args.connectionsKV,
      kick: args.kick,
      deleteSession: async () => {
        await args.publishSessionRevoked({
          origin: session.identity.provider,
          id: session.identity.subject,
          sessionKey,
          revokedBy: args.revokedBy,
        });
        await args.sessionStorage.deleteBySessionKey(entry.sessionKey);
      },
    });
  }
}

/** Creates the Auth.IdentityGrants.List RPC handler backed by SQL approval storage. */
export function createAuthIdentitiesGrantsListHandler(deps: {
  contractApprovalStorage: IdentityGrantStorage;
}) {
  return async (
    {
      input,
      context: { caller },
    }: {
      input: BoundedListQuery;
      context: {
        caller: {
          type: string;
          userId?: string;
          identity?: { provider: string; subject: string };
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    const page = await deps.contractApprovalStorage
      .listApprovedCountedPageByUser(
        user.userId,
        input,
      );
    const grants = page.entries.map((grant) => toUserGrant(grant));

    grants.sort((left, right) =>
      left.displayName.localeCompare(right.displayName)
    );
    return Result.ok({ ...page, entries: grants });
  };
}

/** Creates an Auth.IdentityGrants.Revoke handler using SQL grants and KV sessions. */
export function createUserGrantRevokeHandler(deps: {
  contractApprovalStorage: IdentityGrantStorage;
  sessionStorage: ApprovalSessionStore;
  connectionsKV: ApprovalKVLike;
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { identityGrantId: string };
      context: {
        caller: {
          type: string;
          userId?: string;
          identity?: { provider: string; subject: string };
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    if (
      typeof req.identityGrantId !== "string" ||
      req.identityGrantId.length === 0
    ) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const existing = await deps.contractApprovalStorage.get(
      req.identityGrantId,
    );
    if (existing === undefined) return Result.ok({ success: false });
    if (existing.userTrellisId !== user.userId) {
      return Result.err(new AuthError({ reason: "insufficient_permissions" }));
    }

    await deps.contractApprovalStorage.delete(req.identityGrantId);
    await revokeGrantSessions({
      userTrellisId: user.userId,
      identityGrantId: req.identityGrantId,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      kick: deps.kick,
      publishSessionRevoked: deps.publishSessionRevoked,
      revokedBy: user.userId,
    });
    return Result.ok({ success: true });
  };
}
