import { base64urlDecode, verifyProof } from "@qlever-llc/trellis/auth";
import { AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";
import { AuthError } from "../../../../packages/trellis/errors/AuthError.ts";
import type { AuthConnectionRow } from "../../../../packages/trellis/models/auth/rpc/ListConnections.ts";
import type { AuthSessionRow } from "../../../../packages/trellis/models/auth/rpc/ListSessions.ts";
import type { Session } from "../schemas.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolveCapabilities } from "../capability_groups.ts";
import { resolveSessionPrincipal } from "./principal.ts";
import {
  connectionFilterForSession,
  parseConnectionKey,
} from "./connections.ts";
export { createAuthSessionsRevokeHandler } from "./revoke.ts";
import { createAuthSessionsRevokeHandler } from "./revoke.ts";
import type {
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import type { AuthLogger, AuthRuntimeDeps } from "../runtime_deps.ts";

type SessionRpcLogger = Pick<AuthLogger, "trace" | "warn">;

type AuthenticatedUser = {
  userId: string;
  active: boolean;
  name: string;
  email: string;
  image?: string;
  capabilities: string[];
  identity: {
    identityId: string;
    provider: string;
    subject: string;
  };
  lastLogin?: string;
};

type AuthenticatedService = {
  type: "service";
  id: string;
  name: string;
  active: boolean;
  capabilities: string[];
};

type AuthenticatedDevice = {
  type: "device";
  deviceId: string;
  deviceType: string;
  runtimePublicKey: string;
  deploymentId: string;
  active: boolean;
  capabilities: string[];
};

type AuthSessionsMeResponse = {
  participantKind: "app" | "agent" | "device" | "service";
  user: AuthenticatedUser | null;
  device: AuthenticatedDevice | null;
  service: AuthenticatedService | null;
};

type UserProjectionStorage = Pick<SqlUserProjectionRepository, "get">;
type CapabilityGroupStorage = CapabilityGroupLoader;
type DeviceActivationStorage = Pick<SqlDeviceActivationRepository, "get">;
type DeviceDeploymentStorage = {
  get(deploymentId: string): Promise<
    {
      deploymentId: string;
      disabled: boolean;
    } | undefined
  >;
};
type DeviceInstanceStorage = {
  get(instanceId: string): Promise<
    {
      instanceId: string;
      publicIdentityKey: string;
      deploymentId: string;
      state: "registered" | "activated" | "revoked" | "disabled" | string;
    } | undefined
  >;
};
type ServiceDeploymentLoader = (
  deploymentId: string,
) => Promise<{ disabled: boolean } | null | undefined>;
type SessionStorage = Pick<
  SqlSessionRepository,
  | "getOneBySessionKey"
  | "listEntries"
  | "listEntriesByUser"
  | "deleteBySessionKey"
>;

type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  activatedBy?: {
    origin: string;
    id: string;
  };
  state: "activated" | "revoked";
  activatedAt: string | Date;
  revokedAt: string | Date | null;
};

function deviceTypeFromDeploymentId(deploymentId: string): string {
  const [deviceType] = deploymentId.split(".", 1);
  return deviceType && deviceType.length > 0 ? deviceType : deploymentId;
}

type SessionUser = {
  userId: string;
  email: string;
  name: string;
  active: boolean;
  capabilities: string[];
  identity: AuthenticatedUser["identity"];
  image?: string;
  lastLogin?: string;
};

type SessionContext = {
  caller: {
    type: string;
    participantKind?: "app" | "agent";
    userId?: string;
    identity?: AuthenticatedUser["identity"];
    email?: string;
    name?: string;
    active?: boolean;
    capabilities?: string[];
    image?: string;
    lastLogin?: string;
    deviceId?: string;
    runtimePublicKey?: string;
    deploymentId?: string;
  };
  sessionKey: string;
};

type ValidateRequestInput = {
  sessionKey: string;
  subject: string;
  payloadHash: string;
  proof: string;
  capabilities?: string[];
};

type UserRefFilter = { user?: string; offset?: number; limit?: number };
type SessionFilter = {
  user?: string;
  sessionKey?: string;
  offset?: number;
  limit?: number;
};
type SessionKeyRequest = { sessionKey: string };
type UserNkeyRequest = { userNkey: string };
type SessionListRow = AuthSessionRow;
type ConnectionRow = AuthConnectionRow;

function subjectMatches(pattern: string, subject: string): boolean {
  const patternParts = pattern.split(".");
  const subjectParts = subject.split(".");
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    if (patternPart === ">") return true;
    if (patternPart === "*") continue;
    if (patternPart !== subjectParts[i]) return false;
  }
  return patternParts.length === subjectParts.length;
}

function sessionCanPublishSubject(session: Session, subject: string): boolean {
  if (session.type !== "user" && session.type !== "device") return true;
  return session.delegatedPublishSubjects.some((pattern) =>
    subjectMatches(pattern, subject)
  );
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function sessionActorKey(
  session: Session,
  sessionKey: string,
  userNkey?: string,
): string {
  const actor = session.type === "device"
    ? `${session.instanceId}.${session.publicIdentityKey}`
    : session.type === "user"
    ? session.userId
    : `${session.origin}.${session.id}`;
  return userNkey
    ? `${actor}.${sessionKey}.${userNkey}`
    : `${actor}.${sessionKey}`;
}

function buildSessionRow(session: Session, sessionKey: string): SessionListRow {
  if (session.type === "user") {
    return {
      key: sessionActorKey(session, sessionKey),
      sessionKey,
      participantKind: session.participantKind,
      principal: {
        type: "user",
        userId: session.userId,
        identity: session.identity,
        name: session.name,
      },
      contractId: session.contractId,
      contractDisplayName: session.contractDisplayName,
      createdAt: iso(session.createdAt),
      lastAuth: iso(session.lastAuth),
    };
  }

  if (session.type === "device") {
    return {
      key: sessionActorKey(session, sessionKey),
      sessionKey,
      participantKind: "device",
      principal: {
        type: "device",
        deviceId: session.instanceId,
        deviceType: deviceTypeFromDeploymentId(session.deploymentId),
        runtimePublicKey: session.publicIdentityKey,
        deploymentId: session.deploymentId,
      },
      contractId: session.contractId,
      createdAt: iso(session.createdAt),
      lastAuth: iso(session.lastAuth),
    };
  }

  return {
    key: sessionActorKey(session, sessionKey),
    sessionKey,
    participantKind: "service",
    principal: {
      type: "service",
      id: session.id,
      name: session.name,
      instanceId: session.instanceId,
      deploymentId: session.deploymentId,
    },
    createdAt: iso(session.createdAt),
    lastAuth: iso(session.lastAuth),
  };
}

function buildConnectionRow(
  session: Session,
  sessionKey: string,
  userNkey: string,
  connection: {
    serverId: string;
    clientId: number;
    connectedAt: string | Date;
  },
): ConnectionRow {
  const base = {
    key: sessionActorKey(session, sessionKey, userNkey),
    userNkey,
    sessionKey,
    serverId: connection.serverId,
    clientId: connection.clientId,
    connectedAt: iso(connection.connectedAt),
  };

  if (session.type === "user") {
    return {
      ...base,
      participantKind: session.participantKind,
      principal: {
        type: "user",
        userId: session.userId,
        identity: session.identity,
        name: session.name,
      },
      contractId: session.contractId,
      contractDisplayName: session.contractDisplayName,
    };
  }

  if (session.type === "device") {
    return {
      ...base,
      participantKind: "device",
      principal: {
        type: "device",
        deviceId: session.instanceId,
        deviceType: deviceTypeFromDeploymentId(session.deploymentId),
        runtimePublicKey: session.publicIdentityKey,
        deploymentId: session.deploymentId,
      },
      contractId: session.contractId,
    };
  }

  return {
    ...base,
    participantKind: "service",
    principal: {
      type: "service",
      id: session.id,
      name: session.name,
      instanceId: session.instanceId,
      deploymentId: session.deploymentId,
    },
  };
}

function unwrapConnectionEntry(entry: unknown): {
  serverId: string;
  clientId: number;
  connectedAt?: string | Date;
} | null {
  if (!entry || typeof entry !== "object" || !("value" in entry)) return null;
  const value = entry.value;
  if (!value || typeof value !== "object") return null;
  const serverId = "serverId" in value ? value.serverId : undefined;
  const clientId = "clientId" in value ? value.clientId : undefined;
  const connectedAt = "connectedAt" in value ? value.connectedAt : undefined;
  if (typeof serverId !== "string" || typeof clientId !== "number") {
    return null;
  }
  return {
    serverId,
    clientId,
    ...(typeof connectedAt === "string" || connectedAt instanceof Date
      ? { connectedAt }
      : {}),
  };
}

function requireUserCaller(caller: SessionContext["caller"]): SessionUser {
  if (
    caller.type !== "user" ||
    !caller.userId ||
    !caller.identity ||
    !caller.email ||
    !caller.name ||
    caller.active === undefined
  ) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
    userId: caller.userId,
    identity: caller.identity,
    email: caller.email,
    name: caller.name,
    active: caller.active,
    capabilities: caller.capabilities ?? [],
    ...(caller.image ? { image: caller.image } : {}),
    ...(caller.lastLogin ? { lastLogin: caller.lastLogin } : {}),
  };
}

function formatCaller(
  session: Session,
  principal: {
    active: boolean;
    capabilities: string[];
    email: string;
    name: string;
  },
) {
  if (session.type === "device") {
    return {
      type: "device" as const,
      deviceId: session.instanceId,
      deviceType: deviceTypeFromDeploymentId(session.deploymentId),
      runtimePublicKey: session.publicIdentityKey,
      deploymentId: session.deploymentId,
      active: principal.active,
      capabilities: principal.capabilities,
    };
  }

  if (session.type === "service") {
    return {
      type: "service" as const,
      id: session.id,
      name: session.name,
      active: principal.active,
      capabilities: principal.capabilities,
    };
  }

  return {
    type: "user" as const,
    participantKind: session.participantKind,
    userId: session.userId,
    identity: session.identity,
    active: principal.active,
    name: session.name,
    email: session.email,
    image: session.image,
    capabilities: principal.capabilities,
  };
}

async function loadSessionBySessionKey(
  sessionKey: string,
  sessionStore: Pick<SessionStorage, "getOneBySessionKey">,
): Promise<Session | null> {
  try {
    return await sessionStore.getOneBySessionKey(sessionKey) ?? null;
  } catch {
    throw new AuthError({
      reason: "session_corrupted",
      context: { sessionKey },
    });
  }
}

async function loadAuthenticatedUser(args: {
  userStorage: UserProjectionStorage;
  capabilityGroupStorage?: CapabilityGroupStorage;
  userId: string;
  identity: AuthenticatedUser["identity"];
  fallback:
    & Pick<AuthenticatedUser, "name" | "email" | "capabilities">
    & Partial<Pick<AuthenticatedUser, "image" | "lastLogin" | "active">>;
}): Promise<AuthenticatedUser | null> {
  const projection = await args.userStorage.get(args.userId);
  if (projection) {
    return {
      userId: args.userId,
      active: projection.active,
      name: projection.name ?? args.fallback.name,
      email: projection.email ?? args.fallback.email,
      identity: args.identity,
      ...(args.fallback.image ? { image: args.fallback.image } : {}),
      capabilities: await resolveCapabilities(
        projection,
        args.capabilityGroupStorage,
      ),
      ...(args.fallback.lastLogin
        ? { lastLogin: args.fallback.lastLogin }
        : {}),
    };
  }

  return null;
}

async function loadAuthenticatedService(args: {
  loadServiceInstance?: (sessionKey: string) => Promise<
    | {
      deploymentId: string;
      disabled: boolean;
      capabilities?: string[];
    }
    | null
    | undefined
  >;
  loadServiceDeployment?: (
    deploymentId: string,
  ) => Promise<{ disabled: boolean } | null | undefined>;
  sessionKey: string;
  session: Session & { type: "service" };
}): Promise<AuthenticatedService> {
  const service = args.loadServiceInstance
    ? await args.loadServiceInstance(args.sessionKey)
    : null;
  if (!service) {
    throw new AuthError({
      reason: "unknown_service",
      context: { sessionKey: args.sessionKey },
    });
  }
  if (service.disabled) {
    throw new AuthError({
      reason: "service_disabled",
      context: { sessionKey: args.sessionKey },
    });
  }

  const deployment = await args.loadServiceDeployment?.(
    service.deploymentId,
  );
  if (!deployment || deployment.disabled) {
    throw new AuthError({
      reason: "service_disabled",
      context: { deploymentId: service.deploymentId },
    });
  }

  return {
    type: "service",
    id: args.session.id,
    name: args.session.name,
    active: true,
    capabilities: service.capabilities ?? [],
  };
}

async function loadAuthenticatedDevice(args: {
  userStorage: UserProjectionStorage;
  capabilityGroupStorage?: CapabilityGroupStorage;
  deviceActivationStorage: DeviceActivationStorage;
  deviceInstanceStorage?: DeviceInstanceStorage;
  deviceDeploymentStorage: DeviceDeploymentStorage;
  session: Session & { type: "device" };
}): Promise<{ user: AuthenticatedUser | null; device: AuthenticatedDevice }> {
  const activation = await args.deviceActivationStorage.get(
    args.session.instanceId,
  );
  const instance = await args.deviceInstanceStorage?.get(
    args.session.instanceId,
  );
  if (!activation) {
    if (
      !instance ||
      instance.publicIdentityKey !== args.session.publicIdentityKey ||
      instance.deploymentId !== args.session.deploymentId ||
      instance.state !== "registered" ||
      args.session.revokedAt !== null
    ) {
      throw new AuthError({
        reason: "unknown_device",
        context: { instanceId: args.session.instanceId },
      });
    }

    const deployment = await args.deviceDeploymentStorage.get(
      instance.deploymentId,
    );
    if (!deployment) {
      throw new AuthError({
        reason: "device_deployment_not_found",
        context: { deploymentId: instance.deploymentId },
      });
    }
    if (deployment.disabled) {
      throw new AuthError({
        reason: "device_deployment_disabled",
        context: { deploymentId: deployment.deploymentId },
      });
    }
    return {
      user: null,
      device: {
        type: "device",
        deviceId: args.session.instanceId,
        deviceType: deviceTypeFromDeploymentId(args.session.deploymentId),
        runtimePublicKey: args.session.publicIdentityKey,
        deploymentId: args.session.deploymentId,
        active: true,
        capabilities: args.session.delegatedCapabilities,
      },
    };
  }

  if (
    !instance ||
    instance.publicIdentityKey !== args.session.publicIdentityKey ||
    instance.deploymentId !== args.session.deploymentId ||
    instance.state === "disabled" ||
    instance.state === "revoked"
  ) {
    throw new AuthError({
      reason: "device_activation_revoked",
      context: {
        instanceId: args.session.instanceId,
        deploymentId: instance?.deploymentId ?? args.session.deploymentId,
      },
    });
  }

  const revokedAt = activation.revokedAt
    ? new Date(activation.revokedAt)
    : null;
  if (
    activation.state !== "activated" ||
    activation.publicIdentityKey !== args.session.publicIdentityKey ||
    activation.deploymentId !== args.session.deploymentId ||
    revokedAt !== null ||
    args.session.revokedAt !== null
  ) {
    throw new AuthError({
      reason: "device_activation_revoked",
      context: {
        instanceId: args.session.instanceId,
        deploymentId: activation.deploymentId,
      },
    });
  }

  const deployment = await args.deviceDeploymentStorage.get(
    activation.deploymentId,
  );
  if (!deployment) {
    throw new AuthError({
      reason: "device_deployment_not_found",
      context: { deploymentId: activation.deploymentId },
    });
  }

  if (deployment.disabled) {
    throw new AuthError({
      reason: "device_deployment_disabled",
      context: { deploymentId: deployment.deploymentId },
    });
  }

  const user = activation.activatedBy
    ? await loadAuthenticatedUser({
      userStorage: args.userStorage,
      capabilityGroupStorage: args.capabilityGroupStorage,
      userId: activation.activatedBy.id,
      identity: {
        identityId: activation.activatedBy.id,
        provider: activation.activatedBy.origin,
        subject: activation.activatedBy.id,
      },
      fallback: {
        name: activation.activatedBy.id,
        email: `${activation.activatedBy.origin}:${activation.activatedBy.id}`,
        capabilities: [],
        active: true,
      },
    })
    : null;

  return {
    user,
    device: {
      type: "device",
      deviceId: args.session.instanceId,
      deviceType: deviceTypeFromDeploymentId(args.session.deploymentId),
      runtimePublicKey: args.session.publicIdentityKey,
      deploymentId: args.session.deploymentId,
      active: true,
      capabilities: args.session.delegatedCapabilities,
    },
  };
}

export function createAuthSessionsMeHandler(deps: {
  logger: Pick<SessionRpcLogger, "trace">;
  sessionStorage: Pick<SessionStorage, "getOneBySessionKey">;
  userStorage: UserProjectionStorage;
  capabilityGroupStorage?: CapabilityGroupStorage;
  deviceActivationStorage: DeviceActivationStorage;
  deviceInstanceStorage?: DeviceInstanceStorage;
  deviceDeploymentStorage: DeviceDeploymentStorage;
  loadServiceInstance?: (sessionKey: string) => Promise<
    | {
      deploymentId: string;
      disabled: boolean;
      capabilities?: string[];
    }
    | null
    | undefined
  >;
  loadServiceDeployment?: ServiceDeploymentLoader;
}) {
  return async (
    { context: { sessionKey } }: { context: SessionContext },
  ) => {
    deps.logger.trace({ rpc: "Auth.Sessions.Me", sessionKey }, "RPC request");

    try {
      const session = await loadSessionBySessionKey(
        sessionKey,
        deps.sessionStorage,
      );
      if (!session) {
        return Result.err(
          new AuthError({
            reason: "session_not_found",
            context: { sessionKey },
          }),
        );
      }

      if (session.type === "user") {
        const user = await loadAuthenticatedUser({
          userStorage: deps.userStorage,
          capabilityGroupStorage: deps.capabilityGroupStorage,
          userId: session.userId,
          identity: session.identity,
          fallback: {
            name: session.name,
            email: session.email,
            capabilities: session.delegatedCapabilities,
            image: session.image,
            lastLogin: session.lastAuth.toISOString(),
            active: true,
          },
        });
        if (!user) {
          return Result.err(
            new AuthError({
              reason: "user_not_found",
              context: { userId: session.userId },
            }),
          );
        }
        return Result.ok<AuthSessionsMeResponse>({
          participantKind: session.participantKind,
          user,
          device: null,
          service: null,
        });
      }

      if (session.type === "service") {
        const service = await loadAuthenticatedService({
          loadServiceInstance: deps.loadServiceInstance,
          loadServiceDeployment: deps.loadServiceDeployment,
          sessionKey,
          session,
        });
        return Result.ok<AuthSessionsMeResponse>({
          participantKind: "service",
          user: null,
          device: null,
          service,
        });
      }

      const { user, device } = await loadAuthenticatedDevice({
        userStorage: deps.userStorage,
        capabilityGroupStorage: deps.capabilityGroupStorage,
        deviceActivationStorage: deps.deviceActivationStorage,
        deviceInstanceStorage: deps.deviceInstanceStorage,
        deviceDeploymentStorage: deps.deviceDeploymentStorage,
        session,
      });
      return Result.ok<AuthSessionsMeResponse>({
        participantKind: "device",
        user,
        device,
        service: null,
      });
    } catch (error) {
      if (error instanceof AuthError) return Result.err(error);
      throw error;
    }
  };
}

/** Creates the Auth.Requests.Validate RPC handler backed by SQL auth projections. */
export function createAuthRequestsValidateHandler(deps: {
  logger: Pick<SessionRpcLogger, "trace">;
  sessionStorage: Pick<SessionStorage, "getOneBySessionKey">;
  userStorage: UserProjectionStorage;
  capabilityGroupStorage?: CapabilityGroupStorage;
  deviceActivationStorage: DeviceActivationStorage;
  deviceDeploymentStorage: DeviceDeploymentStorage;
  deviceInstanceStorage: DeviceInstanceStorage;
  loadServiceInstance: Parameters<typeof resolveSessionPrincipal>[2][
    "loadServiceInstance"
  ];
  loadServiceDeployment: Parameters<typeof resolveSessionPrincipal>[2][
    "loadServiceDeployment"
  ];
}) {
  return async ({ input: req }: { input: ValidateRequestInput }) => {
    deps.logger.trace({
      rpc: "Auth.Requests.Validate",
      sessionKey: req.sessionKey,
      subject: req.subject,
    }, "RPC request");

    let payloadHashBytes: Uint8Array;
    try {
      payloadHashBytes = base64urlDecode(req.payloadHash);
    } catch {
      return Result.err(new AuthError({ reason: "invalid_signature" }));
    }

    const proofOk = await verifyProof(
      req.sessionKey,
      {
        sessionKey: req.sessionKey,
        subject: req.subject,
        payloadHash: payloadHashBytes,
      },
      req.proof,
    );
    if (!proofOk) {
      return Result.err(new AuthError({ reason: "invalid_signature" }));
    }

    let session: Session | undefined;
    try {
      session = await deps.sessionStorage.getOneBySessionKey(req.sessionKey);
    } catch {
      return Result.err(
        new AuthError({
          reason: "session_corrupted",
          context: { sessionKey: req.sessionKey },
        }),
      );
    }
    if (!session) {
      return Result.err(new AuthError({ reason: "session_not_found" }));
    }
    const inboxPrefix = `_INBOX.${req.sessionKey.slice(0, 16)}`;
    const principal = await resolveSessionPrincipal(session, req.sessionKey, {
      loadServiceInstance: deps.loadServiceInstance,
      loadServiceDeployment: deps.loadServiceDeployment,
      loadUserProjection: async (trellisId) => {
        return await deps.userStorage.get(trellisId) ?? null;
      },
      capabilityGroupStorage: deps.capabilityGroupStorage,
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceInstanceStorage: deps.deviceInstanceStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
    });
    if (!principal.ok) {
      return Result.err(new AuthError(principal.error));
    }

    const required = req.capabilities ?? [];
    const subjectAllowed = sessionCanPublishSubject(session, req.subject);
    const allowed = subjectAllowed && (required.length === 0 ||
      required.every((capability) =>
        principal.value.capabilities.includes(capability)
      ));

    return Result.ok({
      allowed,
      inboxPrefix,
      caller: formatCaller(session, principal.value),
    });
  };
}

export function createAuthSessionsLogoutHandler(deps: {
  logger: Pick<SessionRpcLogger, "trace">;
  sessionStorage: Pick<SessionStorage, "deleteBySessionKey">;
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  natsSystem: Pick<AuthRuntimeDeps["natsSystem"], "request">;
}) {
  return async (
    { context: { caller, sessionKey } }: { context: SessionContext },
  ) => {
    const user = requireUserCaller(caller);
    deps.logger.trace(
      { rpc: "Auth.Sessions.Logout", sessionKey, userId: user.userId },
      "RPC request",
    );
    await deps.sessionStorage.deleteBySessionKey(sessionKey);

    const connKeys = await deps.connectionsKV.keys(
      connectionFilterForSession(sessionKey),
    )
      .take();
    if (!isErr(connKeys)) {
      for await (const key of connKeys) {
        const parsedKey = parseConnectionKey(key);
        if (!parsedKey || parsedKey.scopeId !== user.userId) continue;
        const entry = await deps.connectionsKV.get(key).take();
        if (!isErr(entry)) {
          const connection = unwrapConnectionEntry(entry);
          if (!connection) continue;
          await AsyncResult.try(() =>
            deps.natsSystem.request(
              `$SYS.REQ.SERVER.${connection.serverId}.KICK`,
              JSON.stringify({ cid: connection.clientId }),
            )
          );
        }
        await deps.connectionsKV.delete(key);
      }
    }

    return Result.ok({ success: true });
  };
}

export function createAuthSessionsListHandler(deps: {
  logger: Pick<SessionRpcLogger, "trace">;
  sessionStorage: Pick<
    SessionStorage,
    "listEntries" | "listEntriesByUser"
  >;
}) {
  return async ({ input: req = {} }: { input?: UserRefFilter }) => {
    deps.logger.trace(
      { rpc: "Auth.Sessions.List", user: req.user },
      "RPC request",
    );
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    let sessions: SessionListRow[];
    if (userFilter) {
      sessions = (await deps.sessionStorage.listEntriesByUser(userFilter)).map(
        (entry) => buildSessionRow(entry.session, entry.sessionKey),
      );
    } else {
      sessions = (await deps.sessionStorage.listEntries({
        offset: req.offset,
        limit: req.limit ?? 500,
      })).map((entry) => buildSessionRow(entry.session, entry.sessionKey));
    }

    sessions.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ sessions });
  };
}

export function createAuthConnectionsListHandler(deps: {
  logger: Pick<SessionRpcLogger, "trace">;
  sessionStorage: Pick<SessionStorage, "getOneBySessionKey">;
  connectionsKV: {
    keys: (
      filter: string,
    ) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
    get: (key: string) => AsyncResult<
      {
        value: {
          serverId: string;
          clientId: number;
          connectedAt: string | Date;
        };
      } | unknown,
      BaseError
    >;
  };
}) {
  return async ({ input: req = {} }: { input?: SessionFilter }) => {
    deps.logger.trace({
      rpc: "Auth.Connections.List",
      user: req.user,
      sessionKey: req.sessionKey,
    }, "RPC request");
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    const sessionKeyFilter = typeof req.sessionKey === "string"
      ? req.sessionKey
      : undefined;

    let filter = ">";
    let userId: string | undefined;
    if (sessionKeyFilter) {
      filter = connectionFilterForSession(sessionKeyFilter);
    } else if (userFilter) {
      userId = userFilter;
      filter = ">";
    }

    const iter = await deps.connectionsKV.keys(filter).take();
    if (isErr(iter)) {
      return Result.ok({ connections: [] });
    }

    const connections: ConnectionRow[] = [];
    for await (const key of iter as AsyncIterable<string>) {
      const entry = await deps.connectionsKV.get(key).take();
      if (isErr(entry)) continue;
      const connection = unwrapConnectionEntry(entry);
      if (!connection?.connectedAt) continue;

      const parsedKey = parseConnectionKey(key);
      if (!parsedKey) continue;
      if (sessionKeyFilter && parsedKey.sessionKey !== sessionKeyFilter) {
        continue;
      }
      if (userId && parsedKey.scopeId !== userId) continue;

      const session = await deps.sessionStorage.getOneBySessionKey(
        parsedKey.sessionKey,
      );
      if (!session) continue;

      connections.push(buildConnectionRow(
        session,
        parsedKey.sessionKey,
        parsedKey.userNkey,
        {
          serverId: connection.serverId,
          clientId: connection.clientId,
          connectedAt: connection.connectedAt,
        },
      ));
    }

    connections.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ connections });
  };
}

export function createAuthConnectionsKickHandler(opts: {
  logger: SessionRpcLogger;
  kick: (serverId: string, clientId: number) => Promise<void>;
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  sessionStorage: Pick<SessionStorage, "getOneBySessionKey">;
  trellis: AuthRuntimeDeps["trellis"];
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: UserNkeyRequest;
      context: { caller: SessionContext["caller"] };
    },
  ) => {
    const user = requireUserCaller(caller);
    opts.logger.trace({
      rpc: "Auth.Connections.Kick",
      userNkey: req.userNkey,
      userId: user.userId,
    }, "RPC request");
    if (typeof req.userNkey !== "string" || req.userNkey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const iter = await opts.connectionsKV.keys(">").take();
    if (isErr(iter)) {
      return Result.ok({ success: false });
    }

    const kickedBy = user.userId;
    let kicked = false;

    for await (const key of iter) {
      const parsedKey = parseConnectionKey(key);
      if (!parsedKey || parsedKey.userNkey !== req.userNkey) continue;
      const entry = await opts.connectionsKV.get(key).take();
      if (!isErr(entry)) {
        const connection = unwrapConnectionEntry(entry);
        if (connection) {
          await opts.kick(connection.serverId, connection.clientId);
        }
      }

      if (parsedKey.sessionKey && parsedKey.scopeId) {
        const session = await opts.sessionStorage.getOneBySessionKey(
          parsedKey.sessionKey,
        );
        if (session) {
          if (session.type === "device") {
            continue;
          }
          (await opts.trellis.publish("Auth.Connections.Kicked", {
            origin: session.type === "user"
              ? session.identity.provider
              : session.origin,
            id: session.type === "user" ? session.identity.subject : session.id,
            userNkey: req.userNkey,
            kickedBy,
          })).inspectErr((error: unknown) =>
            opts.logger.warn(
              { error },
              "Failed to publish Auth.Connections.Kicked",
            )
          );
        }
      }

      await opts.connectionsKV.delete(key);
      kicked = true;
    }

    return Result.ok({ success: kicked });
  };
}
