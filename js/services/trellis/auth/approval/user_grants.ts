import { type AsyncResult, type BaseError, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type {
  ContractApprovalRecord,
  UserParticipantKind,
} from "../schemas.ts";
import type {
  SqlContractApprovalRepository,
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
  trellisId: string;
  origin: string;
  id: string;
  capabilities?: string[];
};

/** Formats a user origin/id pair for approval RPC inputs and audit fields. */
export function formatOriginId(origin: string, id: string): string {
  return `${origin}.${id}`;
}

/** Returns a normalized user caller or throws the approval RPC auth error. */
export function requireUserCaller(caller: {
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

function toUserGrant(approval: ContractApprovalRecord) {
  const contractApproval = approval.approval as
    & ContractApprovalRecord["approval"]
    & {
      participantKind: "app" | "agent";
    };
  return {
    contractDigest: contractApproval.contractDigest,
    contractId: contractApproval.contractId,
    displayName: contractApproval.displayName,
    description: contractApproval.description,
    participantKind: contractApproval.participantKind,
    capabilities: contractApproval.capabilities,
    grantedAt: approval.answeredAt.toISOString(),
    updatedAt: approval.updatedAt.toISOString(),
  };
}

/** Revokes active sessions and connections for a user contract grant. */
export async function revokeGrantSessions(args: {
  userTrellisId: string;
  contractDigest: string;
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
      session.type !== "user" || session.contractDigest !== args.contractDigest
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
          origin: session.origin,
          id: session.id,
          sessionKey,
          revokedBy: args.revokedBy,
        });
        await args.sessionStorage.deleteBySessionKey(entry.sessionKey);
      },
    });
  }
}

/** Creates the Auth.ListUserGrants RPC handler backed by SQL approval storage. */
export function createAuthListUserGrantsHandler(deps: {
  contractApprovalStorage: SqlContractApprovalRepository;
}) {
  return async (
    {
      context: { caller },
    }: {
      context: {
        caller: {
          type: string;
          trellisId?: string;
          origin?: string;
          id?: string;
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    const grants = (await deps.contractApprovalStorage.listByUser(
      user.trellisId,
    ))
      .filter((approval) => approval.answer === "approved")
      .map((approval) => toUserGrant(approval));

    grants.sort((left, right) =>
      left.displayName.localeCompare(right.displayName)
    );
    return Result.ok({ grants });
  };
}

/** Creates an Auth.RevokeUserGrant handler using SQL grants and KV sessions. */
export function createAuthRevokeUserGrantHandler(deps: {
  contractApprovalStorage: SqlContractApprovalRepository;
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
      input: { contractDigest: string };
      context: {
        caller: {
          type: string;
          trellisId?: string;
          origin?: string;
          id?: string;
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    if (
      typeof req.contractDigest !== "string" || req.contractDigest.length === 0
    ) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const existing = await deps.contractApprovalStorage.get(
      user.trellisId,
      req.contractDigest,
    );
    if (existing === undefined) return Result.ok({ success: false });

    await deps.contractApprovalStorage.delete(
      user.trellisId,
      req.contractDigest,
    );
    await revokeGrantSessions({
      userTrellisId: user.trellisId,
      contractDigest: req.contractDigest,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      kick: deps.kick,
      publishSessionRevoked: deps.publishSessionRevoked,
      revokedBy: formatOriginId(user.origin, user.id),
    });
    return Result.ok({ success: true });
  };
}
