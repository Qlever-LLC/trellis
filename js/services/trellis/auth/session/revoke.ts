import { type AsyncResult, type BaseError, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import { revokeGrantSessions } from "../approval/user_grants.ts";
import type { ContractApprovalRecord, Session } from "../schemas.ts";
import type {
  SqlContractApprovalRepository,
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
  SqlContractApprovalRepository,
  "get" | "delete"
>;

type DeviceActivationStorage = Pick<
  SqlDeviceActivationRepository,
  "get" | "put"
>;

type ServiceInstanceStorage = Pick<SqlServiceInstanceRepository, "get" | "put">;

type SessionCaller = {
  type: string;
  trellisId?: string;
  origin?: string;
  id?: string;
};

function requireUserCaller(caller: SessionCaller): {
  trellisId: string;
  origin: string;
  id: string;
} {
  if (
    caller.type !== "user" || !caller.trellisId || !caller.origin || !caller.id
  ) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  return {
    trellisId: caller.trellisId,
    origin: caller.origin,
    id: caller.id,
  };
}

function isApprovedAgentGrant(approval: ContractApprovalRecord): boolean {
  const contractApproval = approval.approval as
    & ContractApprovalRecord["approval"]
    & {
      participantKind: "app" | "agent";
    };
  return approval.answer === "approved" && (
    contractApproval.participantKind === "app" ||
    contractApproval.participantKind === "agent"
  );
}

export function createAuthRevokeSessionHandler(deps: {
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
}) {
  return async (
    req: { sessionKey: string },
    { caller }: { caller: SessionCaller },
  ) => {
    const user = requireUserCaller(caller);
    if (typeof req.sessionKey !== "string" || req.sessionKey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    let sessionToDelete: Session | undefined;
    try {
      sessionToDelete = await deps.sessionStorage.getOneBySessionKey(
        req.sessionKey,
      );
    } catch {
      return Result.ok({ success: false });
    }
    if (!sessionToDelete) return Result.ok({ success: false });

    const kickedBy = `${user.origin}.${user.id}`;
    if (sessionToDelete.type === "user") {
      const approval = await deps.contractApprovalStorage.get(
        sessionToDelete.trellisId,
        sessionToDelete.contractDigest,
      );
      if (approval) {
        if (isApprovedAgentGrant(approval)) {
          await deps.contractApprovalStorage.delete(
            sessionToDelete.trellisId,
            sessionToDelete.contractDigest,
          );
        }
      }

      await revokeGrantSessions({
        userTrellisId: sessionToDelete.trellisId,
        contractDigest: sessionToDelete.contractDigest,
        participantKind: sessionToDelete.participantKind,
        sessionStorage: deps.sessionStorage,
        connectionsKV: deps.connectionsKV,
        kick: deps.kick,
        publishSessionRevoked: deps.publishSessionRevoked,
        revokedBy: kickedBy,
      });
      return Result.ok({ success: true });
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
            revokedBy: kickedBy,
          });
        }
        await deps.sessionStorage.deleteBySessionKey(req.sessionKey);
      },
    });

    return Result.ok({ success: true });
  };
}
