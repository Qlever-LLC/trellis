import { type AsyncResult, type BaseError, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import { revokeGrantSessions } from "../approval/user_grants.ts";
import type { IdentityGrantRecord, Session } from "../schemas.ts";
import type {
  SqlDeviceActivationRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
} from "../storage.ts";
import { revokeRuntimeAccessForSession } from "./revoke_runtime_access.ts";

type SessionStore = {
  getOneBySessionKey: SqlSessionRepository["getOneBySessionKey"];
  listEntriesByUser: SqlSessionRepository["listEntriesByUser"];
  deleteBySessionKey: SqlSessionRepository["deleteBySessionKey"];
};

type ConnectionsStore = {
  keys: (
    filter: string,
  ) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  get: (key: string) => AsyncResult<unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type ContractApprovalStorage = Pick<
  {
    get(
      identityGrantId: string,
    ): Promise<IdentityGrantRecord | undefined>;
    delete(identityGrantId: string): Promise<void>;
  },
  "get" | "delete"
>;

type DeviceActivationStorage = Pick<
  SqlDeviceActivationRepository,
  "get" | "put"
>;

type ServiceInstanceStorage = Pick<SqlServiceInstanceRepository, "get" | "put">;

type RevokeSessionDeps = {
  sessionStorage: SessionStore;
  connectionsKV: ConnectionsStore;
  contractApprovalStorage: ContractApprovalStorage;
  deviceActivationStorage?: DeviceActivationStorage;
  serviceInstanceStorage?: ServiceInstanceStorage;
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (
    event: {
      origin: string;
      id: string;
      sessionKey: string;
      revokedBy: string;
    },
  ) => Promise<void>;
};

type SessionCaller = {
  type: string;
  userId?: string;
};

function requireUserCaller(caller: SessionCaller): {
  userId: string;
} {
  if (caller.type !== "user" || !caller.userId) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  return {
    userId: caller.userId,
  };
}

function isApprovedAgentGrant(grant: IdentityGrantRecord): boolean {
  const approvalEvidence = grant.approvalEvidence as
    & IdentityGrantRecord["approvalEvidence"]
    & {
      participantKind: "app" | "agent";
    };
  return grant.answer === "approved" && (
    approvalEvidence.participantKind === "app" ||
    approvalEvidence.participantKind === "agent"
  );
}

export function createAuthSessionsRevokeHandler(deps: RevokeSessionDeps) {
  return async (
    req: { sessionKey: string },
    { caller }: { caller: SessionCaller },
  ) => {
    const user = requireUserCaller(caller);
    if (typeof req.sessionKey !== "string" || req.sessionKey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    return Result.ok({
      success: await revokeSessionByKey(deps, {
        sessionKey: req.sessionKey,
        revokedBy: user.userId,
      }),
    });
  };
}

/** Revokes one authenticated session and its associated runtime access. */
export async function revokeSessionByKey(
  deps: RevokeSessionDeps,
  req: { sessionKey: string; revokedBy: string },
): Promise<boolean> {
  let sessionToDelete: Session | undefined;
  try {
    sessionToDelete = await deps.sessionStorage.getOneBySessionKey(
      req.sessionKey,
    );
  } catch {
    return false;
  }
  if (!sessionToDelete) return false;

  if (sessionToDelete.type === "user") {
    if (sessionToDelete.identityGrantId) {
      const grant = await deps.contractApprovalStorage.get(
        sessionToDelete.identityGrantId,
      );
      if (grant && isApprovedAgentGrant(grant)) {
        await deps.contractApprovalStorage.delete(
          sessionToDelete.identityGrantId,
        );
      }
    }

    await revokeGrantSessions({
      userTrellisId: sessionToDelete.userId,
      identityGrantId: sessionToDelete.identityGrantId ?? "",
      participantKind: sessionToDelete.participantKind,
      sessionStorage: deps.sessionStorage,
      connectionsKV: deps.connectionsKV,
      kick: deps.kick,
      publishSessionRevoked: deps.publishSessionRevoked,
      revokedBy: req.revokedBy,
    });
    return true;
  }

  if (sessionToDelete.type === "device" && deps.deviceActivationStorage) {
    const activation = await deps.deviceActivationStorage.get(
      sessionToDelete.instanceId,
    );
    if (activation) {
      await deps.deviceActivationStorage.put({
        ...activation,
        state: "revoked",
        revokedAt: new Date().toISOString(),
      });
    }
  }

  if (sessionToDelete.type === "service" && deps.serviceInstanceStorage) {
    const serviceInstance = await deps.serviceInstanceStorage.get(
      sessionToDelete.instanceId,
    );
    if (serviceInstance) {
      await deps.serviceInstanceStorage.put({
        ...serviceInstance,
        disabled: true,
      });
    }
  }

  await revokeRuntimeAccessForSession({
    sessionKey: req.sessionKey,
    connectionsKV: deps.connectionsKV,
    kick: deps.kick,
    deleteSession: async () => {
      if (sessionToDelete.type !== "device") {
        await deps.publishSessionRevoked({
          origin: sessionToDelete.origin,
          id: sessionToDelete.id,
          sessionKey: req.sessionKey,
          revokedBy: req.revokedBy,
        });
      }
      await deps.sessionStorage.deleteBySessionKey(req.sessionKey);
    },
  });
  return true;
}
