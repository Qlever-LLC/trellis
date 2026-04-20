import { type AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";
import type {
  AuthListUserGrantsInput,
  AuthListUserGrantsOutput,
} from "../../../../../generated/js/sdks/auth/types.ts";

import type {
  Connection,
  ContractApprovalRecord,
  Session,
  UserParticipantKind,
} from "../../state/schemas.ts";

type KVLike = {
  get: (key: string) => AsyncResult<unknown, BaseError>;
  keys: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type RpcUser = {
  type: string;
  trellisId: string;
  origin: string;
  id: string;
};

function formatOriginId(origin: string, id: string): string {
  return `${origin}.${id}`;
}

function requireUserCaller(caller: {
  type: string;
  trellisId?: string;
  origin?: string;
  id?: string;
}): RpcUser {
  if (caller.type !== "user" || !caller.trellisId || !caller.origin || !caller.id) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
    type: "user",
    trellisId: caller.trellisId,
    origin: caller.origin,
    id: caller.id,
  };
}

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

function toUserGrant(approval: ContractApprovalRecord) {
  const contractApproval = approval.approval as ContractApprovalRecord["approval"] & {
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

export async function revokeGrantSessions(args: {
  userTrellisId: string;
  contractDigest: string;
  participantKind?: UserParticipantKind;
  sessionKV: KVLike;
  connectionsKV: KVLike;
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (event: { origin: string; id: string; sessionKey: string; revokedBy: string }) => Promise<void>;
  revokedBy: string;
}): Promise<void> {
  const iter = await takeValue(args.sessionKV.keys(`>.${args.userTrellisId}`));
  if (isErr(iter)) return;

  for await (const key of iter as AsyncIterable<string>) {
    const entry = await takeValue(args.sessionKV.get(key));
    if (isErr(entry)) continue;
    const session = unwrapValue(entry) as Session;
    if (session.type !== "user" || session.contractDigest !== args.contractDigest) continue;
    if (args.participantKind && session.participantKind !== args.participantKind) continue;

    const sessionKey = key.split(".")[0];
    if (!sessionKey) continue;

    const connIter = await takeValue(args.connectionsKV.keys(`${sessionKey}.${args.userTrellisId}.>`));
    if (!isErr(connIter)) {
      for await (const connKey of connIter as AsyncIterable<string>) {
        const connection = await takeValue(args.connectionsKV.get(connKey));
        if (!isErr(connection)) {
          const connectionValue = unwrapValue(connection) as Connection;
          await args.kick(connectionValue.serverId, connectionValue.clientId);
        }
        await takeValue(args.connectionsKV.delete(connKey));
      }
    }

    await args.publishSessionRevoked({
      origin: session.origin,
      id: session.id,
      sessionKey,
      revokedBy: args.revokedBy,
    });
    await takeValue(args.sessionKV.delete(key));
  }
}

export function createAuthListUserGrantsHandler(deps: {
  contractApprovalsKV: Pick<KVLike, "get" | "keys">;
}) {
  return async (
    _req: AuthListUserGrantsInput,
    { caller }: { caller: { type: string; trellisId?: string; origin?: string; id?: string } },
  ) => {
    const user = requireUserCaller(caller);
    const iter = await takeValue(deps.contractApprovalsKV.keys(`${user.trellisId}.>`));
    if (isErr(iter)) return Result.ok({ grants: [] });

    const grants = [] as Array<ReturnType<typeof toUserGrant>>;
    for await (const key of iter as AsyncIterable<string>) {
      const entry = await takeValue(deps.contractApprovalsKV.get(key));
      if (isErr(entry)) continue;
      const approval = unwrapValue(entry) as ContractApprovalRecord;
      if (approval.answer !== "approved") continue;
      grants.push(toUserGrant(approval));
    }

    grants.sort((left, right) => left.displayName.localeCompare(right.displayName));
    return Result.ok<AuthListUserGrantsOutput, never>({ grants });
  };
}

export function createAuthRevokeUserGrantHandler(deps: {
  contractApprovalsKV: KVLike;
  sessionKV: KVLike;
  connectionsKV: KVLike;
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (event: { origin: string; id: string; sessionKey: string; revokedBy: string }) => Promise<void>;
}) {
  return async (
    req: { contractDigest: string },
    { caller }: { caller: { type: string; trellisId?: string; origin?: string; id?: string } },
  ) => {
    const user = requireUserCaller(caller);
    if (typeof req.contractDigest !== "string" || req.contractDigest.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const approvalKey = `${user.trellisId}.${req.contractDigest}`;
    const existing = await takeValue(deps.contractApprovalsKV.get(approvalKey));
    if (isErr(existing)) return Result.ok({ success: false });

    await takeValue(deps.contractApprovalsKV.delete(approvalKey));
    await revokeGrantSessions({
      userTrellisId: user.trellisId,
      contractDigest: req.contractDigest,
      sessionKV: deps.sessionKV,
      connectionsKV: deps.connectionsKV,
      kick: deps.kick,
      publishSessionRevoked: deps.publishSessionRevoked,
      revokedBy: formatOriginId(user.origin, user.id),
    });
    return Result.ok({ success: true });
  };
}
