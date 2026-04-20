import { type AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import { revokeGrantSessions } from "../approval/user_grants.ts";
import type { ContractApprovalRecord, Session } from "../../state/schemas.ts";

type SessionStore = {
  keys: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  get: (key: string) => AsyncResult<unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type ConnectionsStore = {
  keys: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  get: (key: string) => AsyncResult<unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type ContractApprovalsStore = {
  get: (key: string) => AsyncResult<unknown, BaseError>;
  delete: (key: string) => AsyncResult<unknown, BaseError>;
};

type DeviceActivationsStore<T = unknown> = {
  get: (key: string) => AsyncResult<unknown, BaseError>;
  put: (key: string, value: T) => AsyncResult<unknown, BaseError>;
};

type ServiceInstancesStore<T = unknown> = {
  get: (key: string) => AsyncResult<unknown, BaseError>;
  put: (key: string, value: T) => AsyncResult<unknown, BaseError>;
};

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
  if (caller.type !== "user" || !caller.trellisId || !caller.origin || !caller.id) {
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
  const contractApproval = approval.approval as ContractApprovalRecord["approval"] & {
    participantKind: "app" | "agent";
  };
  return approval.answer === "approved" && (
    contractApproval.participantKind === "app" ||
    contractApproval.participantKind === "agent"
  );
}

export function createAuthRevokeSessionHandler<
  TDeviceActivation = unknown,
  TServiceInstance = unknown,
>(deps: {
  sessionKV: SessionStore;
  connectionsKV: ConnectionsStore;
  contractApprovalsKV: ContractApprovalsStore;
  deviceActivationsKV?: DeviceActivationsStore<TDeviceActivation>;
  serviceInstancesKV?: ServiceInstancesStore<TServiceInstance>;
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (event: { origin: string; id: string; sessionKey: string; revokedBy: string }) => Promise<void>;
}) {
  return async (
    req: { sessionKey: string },
    { caller }: { caller: SessionCaller },
  ) => {
    const user = requireUserCaller(caller);
    if (typeof req.sessionKey !== "string" || req.sessionKey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const sessionIter = await takeValue(deps.sessionKV.keys(`${req.sessionKey}.>`));
    if (isErr(sessionIter)) {
      return Result.ok({ success: false });
    }

    const sessionsToDelete: string[] = [];
    for await (const key of sessionIter as AsyncIterable<string>) {
      sessionsToDelete.push(key);
    }
    if (sessionsToDelete.length === 0) return Result.ok({ success: false });

    const kickedBy = `${user.origin}.${user.id}`;
    const firstSessionEntry = await takeValue(deps.sessionKV.get(sessionsToDelete[0]));
    if (!isErr(firstSessionEntry)) {
      const firstSession = unwrapValue(firstSessionEntry) as Session;
      if (firstSession.type === "user") {
        const approvalKey = `${firstSession.trellisId}.${firstSession.contractDigest}`;
        const approvalEntry = await takeValue(deps.contractApprovalsKV.get(approvalKey));
        if (!isErr(approvalEntry)) {
          const approval = unwrapValue(approvalEntry) as ContractApprovalRecord;
          if (isApprovedAgentGrant(approval)) {
            await takeValue(deps.contractApprovalsKV.delete(approvalKey));
          }
        }

        await revokeGrantSessions({
          userTrellisId: firstSession.trellisId,
          contractDigest: firstSession.contractDigest,
          participantKind: firstSession.participantKind,
          sessionKV: deps.sessionKV,
          connectionsKV: deps.connectionsKV,
          kick: deps.kick,
          publishSessionRevoked: deps.publishSessionRevoked,
          revokedBy: kickedBy,
        });
        return Result.ok({ success: true });
      }

      if (firstSession.type === "device" && deps.deviceActivationsKV) {
        const activationEntry = await takeValue(
          deps.deviceActivationsKV.get(firstSession.instanceId),
        );
        if (!isErr(activationEntry)) {
          const activation = unwrapValue(activationEntry) as {
            state: string;
            revokedAt: string | Date | null;
          } & Record<string, unknown>;
          await takeValue(
            deps.deviceActivationsKV.put(firstSession.instanceId, {
              ...activation,
              state: "revoked",
              revokedAt: new Date().toISOString(),
            } as TDeviceActivation),
          );
        }
      }

      if (firstSession.type === "service" && deps.serviceInstancesKV) {
        const serviceEntry = await takeValue(
          deps.serviceInstancesKV.get(firstSession.instanceId),
        );
        if (!isErr(serviceEntry)) {
          const serviceInstance = unwrapValue(serviceEntry) as {
            disabled: boolean;
          } & Record<string, unknown>;
          await takeValue(
            deps.serviceInstancesKV.put(firstSession.instanceId, {
              ...serviceInstance,
              disabled: true,
            } as TServiceInstance),
          );
        }
      }
    }

    const connIter = await takeValue(deps.connectionsKV.keys(`${req.sessionKey}.>.>`));
    if (!isErr(connIter)) {
      for await (const key of connIter as AsyncIterable<string>) {
        const entry = await takeValue(deps.connectionsKV.get(key));
        if (!isErr(entry)) {
          const connection = unwrapValue(entry) as { serverId: string; clientId: number };
          await deps.kick(connection.serverId, connection.clientId);
        }
        await deps.connectionsKV.delete(key);
      }
    }

    for (const sessionKeyId of sessionsToDelete) {
      const entry = await takeValue(deps.sessionKV.get(sessionKeyId));
      if (!isErr(entry)) {
        const session = unwrapValue(entry) as Session;
        if (session.type !== "device") {
          await deps.publishSessionRevoked({
            origin: session.origin,
            id: session.id,
            sessionKey: req.sessionKey,
            revokedBy: kickedBy,
          });
        }
      }
      await deps.sessionKV.delete(sessionKeyId);
    }

    return Result.ok({ success: true });
  };
}
