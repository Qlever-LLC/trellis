import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import { revokeGrantSessions } from "../approval/user_grants.ts";
import type { ContractApprovalRecord, Session } from "../../state/schemas.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlServiceInstanceRepository,
  SqlSessionRepository,
} from "../storage.ts";
import { connectionFilterForSession } from "./connections.ts";

type SessionStore = {
  listEntriesBySessionKey: SqlSessionRepository["listEntriesBySessionKey"];
  listEntriesByUser: SqlSessionRepository["listEntriesByUser"];
  delete: SqlSessionRepository["delete"];
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

async function takeValue<T>(
  value: AsyncResult<T, BaseError>,
): Promise<T | Result<never, BaseError>> {
  return await value.take();
}

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

function unwrapValue<V>(entry: { value: V } | V): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return entry.value;
  }
  return entry;
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

    let sessionsToDelete;
    try {
      sessionsToDelete = await deps.sessionStorage.listEntriesBySessionKey(
        req.sessionKey,
      );
    } catch {
      return Result.ok({ success: false });
    }
    if (sessionsToDelete.length === 0) return Result.ok({ success: false });

    const kickedBy = `${user.origin}.${user.id}`;
    const firstSession = sessionsToDelete[0]?.session;
    if (firstSession) {
      if (firstSession.type === "user") {
        const approval = await deps.contractApprovalStorage.get(
          firstSession.trellisId,
          firstSession.contractDigest,
        );
        if (approval) {
          if (isApprovedAgentGrant(approval)) {
            await deps.contractApprovalStorage.delete(
              firstSession.trellisId,
              firstSession.contractDigest,
            );
          }
        }

        await revokeGrantSessions({
          userTrellisId: firstSession.trellisId,
          contractDigest: firstSession.contractDigest,
          participantKind: firstSession.participantKind,
          sessionStorage: deps.sessionStorage,
          connectionsKV: deps.connectionsKV,
          kick: deps.kick,
          publishSessionRevoked: deps.publishSessionRevoked,
          revokedBy: kickedBy,
        });
        return Result.ok({ success: true });
      }

      if (firstSession.type === "device" && deps.deviceActivationStorage) {
        const activation = await deps.deviceActivationStorage.get(
          firstSession.instanceId,
        );
        if (activation) {
          await deps.deviceActivationStorage.put({
            ...activation,
            state: "revoked",
            revokedAt: new Date().toISOString(),
          });
        }
      }

      if (firstSession.type === "service" && deps.serviceInstanceStorage) {
        const serviceInstance = await deps.serviceInstanceStorage.get(
          firstSession.instanceId,
        );
        if (serviceInstance) {
          await deps.serviceInstanceStorage.put({
            ...serviceInstance,
            disabled: true,
          });
        }
      }
    }

    const connIter = await takeValue(
      deps.connectionsKV.keys(connectionFilterForSession(req.sessionKey)),
    );
    if (!isErr(connIter)) {
      for await (const key of connIter as AsyncIterable<string>) {
        const entry = await takeValue(deps.connectionsKV.get(key));
        if (!isErr(entry)) {
          const connection = unwrapValue(entry) as {
            serverId: string;
            clientId: number;
          };
          await deps.kick(connection.serverId, connection.clientId);
        }
        await deps.connectionsKV.delete(key);
      }
    }

    for (const entry of sessionsToDelete) {
      const session = entry.session;
      if (session.type !== "device") {
        await deps.publishSessionRevoked({
          origin: session.origin,
          id: session.id,
          sessionKey: req.sessionKey,
          revokedBy: kickedBy,
        });
      }
      await deps.sessionStorage.delete(entry.sessionKey, entry.trellisId);
    }

    return Result.ok({ success: true });
  };
}
