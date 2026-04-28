import {
  base64urlDecode,
  trellisIdFromOriginId,
  verifyProof,
} from "@qlever-llc/trellis/auth";
import { AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";
import { AuthError } from "../../../../packages/trellis/errors/AuthError.ts";
import type {
  AuthListConnectionsInput,
  AuthListConnectionsOutput,
  AuthListSessionsInput,
  AuthListSessionsOutput,
} from "@qlever-llc/trellis/sdk/auth";
import type { Session } from "../schemas.ts";
import { resolveSessionPrincipal } from "./principal.ts";
import {
  connectionFilterForSession,
  parseConnectionKey,
} from "./connections.ts";
export { createAuthRevokeSessionHandler } from "./revoke.ts";
import { createAuthRevokeSessionHandler } from "./revoke.ts";
import type {
  SqlContractApprovalRepository,
  SqlDeviceActivationRepository,
  SqlDeviceDeploymentRepository,
  SqlSessionRepository,
  SqlUserProjectionRepository,
} from "../storage.ts";
import { authRuntimeDeps, maybeAuthRuntimeDeps } from "../runtime_deps.ts";
import { parseContractApprovalKey } from "../http/support.ts";
import { runtimeServiceLookup } from "../admin/service_lookup.ts";
import { loadEffectiveGrantPolicies } from "../grants/store.ts";
import { kick as kickConnection } from "../callout/kick.ts";

const logger = {
  trace: (fields: Record<string, unknown>, message: string) =>
    maybeAuthRuntimeDeps()?.logger.trace(fields, message),
  warn: (fields: Record<string, unknown>, message: string) =>
    maybeAuthRuntimeDeps()?.logger.warn(fields, message),
};

type AuthenticatedUser = {
  id: string;
  origin: string;
  active: boolean;
  name: string;
  email: string;
  image?: string;
  capabilities: string[];
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

type AuthMeResponse = {
  participantKind: "app" | "agent" | "device" | "service";
  user: AuthenticatedUser | null;
  device: AuthenticatedDevice | null;
  service: AuthenticatedService | null;
};

type UserProjectionStorage = Pick<SqlUserProjectionRepository, "get">;
type DeviceActivationStorage = Pick<SqlDeviceActivationRepository, "get">;
type DeviceDeploymentStorage = Pick<SqlDeviceDeploymentRepository, "get">;
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
  trellisId: string;
  id: string;
  origin: string;
  email: string;
  name: string;
  active: boolean;
  capabilities: string[];
  image?: string;
  lastLogin?: string;
};

type SessionContext = {
  caller: {
    type: string;
    participantKind?: "app" | "agent";
    trellisId?: string;
    id?: string;
    origin?: string;
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

type UserRefFilter = AuthListSessionsInput;
type SessionFilter = AuthListConnectionsInput;
type SessionKeyRequest = { sessionKey: string };
type UserNkeyRequest = { userNkey: string };
type SessionListRow = AuthListSessionsOutput["sessions"][number];
type ConnectionRow = AuthListConnectionsOutput["connections"][number];

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseOriginId(value: string): { origin: string; id: string } | null {
  const idx = value.indexOf(".");
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { origin: value.slice(0, idx), id: value.slice(idx + 1) };
}

function sessionActorKey(
  session: Session,
  sessionKey: string,
  userNkey?: string,
): string {
  const actor = session.type === "device"
    ? `${session.instanceId}.${session.publicIdentityKey}`
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
        trellisId: session.trellisId,
        origin: session.origin,
        id: session.id,
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
        trellisId: session.trellisId,
        origin: session.origin,
        id: session.id,
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
    !caller.trellisId ||
    !caller.id ||
    !caller.origin ||
    !caller.email ||
    !caller.name ||
    caller.active === undefined
  ) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
    trellisId: caller.trellisId,
    id: caller.id,
    origin: caller.origin,
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
    trellisId: session.trellisId,
    id: session.id,
    origin: session.origin,
    active: principal.active,
    name: session.name,
    email: session.email,
    image: session.image,
    capabilities: principal.capabilities,
  };
}

function deviceCallerFields(caller: SessionContext["caller"]): {
  deviceId: string;
  deploymentId: string;
  runtimePublicKey: string;
  active: boolean;
  capabilities: string[];
} | null {
  if (
    caller.type !== "device" || !caller.deviceId || !caller.runtimePublicKey ||
    !caller.deploymentId || caller.active === undefined
  ) {
    return null;
  }

  return {
    deviceId: caller.deviceId,
    deploymentId: caller.deploymentId,
    runtimePublicKey: caller.runtimePublicKey,
    active: caller.active,
    capabilities: caller.capabilities ?? [],
  };
}

function deviceResponseFromCaller(
  caller: SessionContext["caller"],
): AuthMeResponse | null {
  const deviceCaller = deviceCallerFields(caller);
  if (deviceCaller) {
    return {
      participantKind: "device",
      user: null,
      device: {
        type: "device",
        deviceId: deviceCaller.deviceId,
        deviceType: deviceTypeFromDeploymentId(deviceCaller.deploymentId),
        runtimePublicKey: deviceCaller.runtimePublicKey,
        deploymentId: deviceCaller.deploymentId,
        active: deviceCaller.active,
        capabilities: deviceCaller.capabilities,
      },
      service: null,
    };
  }

  return null;
}

async function responseFromDeviceCaller(args: {
  caller: SessionContext["caller"];
  userStorage: UserProjectionStorage;
  deviceActivationStorage: DeviceActivationStorage;
  deviceDeploymentStorage: DeviceDeploymentStorage;
}): Promise<AuthMeResponse | null> {
  const deviceCaller = deviceCallerFields(args.caller);
  if (!deviceCaller) {
    return null;
  }

  const activation = await args.deviceActivationStorage.get(
    deviceCaller.deviceId,
  );
  if (!activation) return null;
  if (
    activation.state !== "activated" ||
    activation.deploymentId !== deviceCaller.deploymentId ||
    activation.revokedAt !== null
  ) {
    return null;
  }

  const deployment = await args.deviceDeploymentStorage.get(
    activation.deploymentId,
  );
  if (!deployment || deployment.disabled) return null;

  const user = activation.activatedBy
    ? await loadAuthenticatedUser({
      userStorage: args.userStorage,
      origin: activation.activatedBy.origin,
      id: activation.activatedBy.id,
      fallback: {
        name: activation.activatedBy.id,
        email: `${activation.activatedBy.origin}:${activation.activatedBy.id}`,
        capabilities: [],
        active: true,
      },
    })
    : null;

  return {
    participantKind: "device",
    user,
    device: {
      type: "device",
      deviceId: deviceCaller.deviceId,
      deviceType: deviceTypeFromDeploymentId(deviceCaller.deploymentId),
      runtimePublicKey: deviceCaller.runtimePublicKey,
      deploymentId: deviceCaller.deploymentId,
      active: deviceCaller.active,
      capabilities: deviceCaller.capabilities,
    },
    service: null,
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
  origin: string;
  id: string;
  fallback:
    & Pick<AuthenticatedUser, "name" | "email" | "capabilities">
    & Partial<Pick<AuthenticatedUser, "image" | "lastLogin" | "active">>;
}): Promise<AuthenticatedUser | null> {
  const trellisId = await trellisIdFromOriginId(args.origin, args.id);
  const projection = await args.userStorage.get(trellisId);
  if (projection) {
    return {
      id: projection.id,
      origin: projection.origin,
      active: projection.active,
      name: projection.name ?? args.fallback.name,
      email: projection.email ?? args.fallback.email,
      ...(args.fallback.image ? { image: args.fallback.image } : {}),
      capabilities: projection.capabilities ?? args.fallback.capabilities,
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
  deviceActivationStorage: DeviceActivationStorage;
  deviceDeploymentStorage: DeviceDeploymentStorage;
  session: Session & { type: "device" };
}): Promise<{ user: AuthenticatedUser | null; device: AuthenticatedDevice }> {
  const activation = await args.deviceActivationStorage.get(
    args.session.instanceId,
  );
  if (!activation) {
    throw new AuthError({
      reason: "unknown_device",
      context: { instanceId: args.session.instanceId },
    });
  }

  const revokedAt = activation.revokedAt
    ? new Date(activation.revokedAt)
    : null;
  if (
    activation.state !== "activated" ||
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
      origin: activation.activatedBy.origin,
      id: activation.activatedBy.id,
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

export function createAuthMeHandler(deps: {
  sessionStorage: Pick<SessionStorage, "getOneBySessionKey">;
  userStorage: UserProjectionStorage;
  deviceActivationStorage: DeviceActivationStorage;
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
    { context: { sessionKey, caller } }: { context: SessionContext },
  ) => {
    logger.trace({ rpc: "Auth.Me", sessionKey }, "RPC request");

    try {
      const session = await loadSessionBySessionKey(
        sessionKey,
        deps.sessionStorage,
      );
      if (!session) {
        const deviceCallerResponse = await responseFromDeviceCaller({
          caller,
          userStorage: deps.userStorage,
          deviceActivationStorage: deps.deviceActivationStorage,
          deviceDeploymentStorage: deps.deviceDeploymentStorage,
        });
        if (deviceCallerResponse) {
          return Result.ok<AuthMeResponse>(deviceCallerResponse);
        }
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
          origin: session.origin,
          id: session.id,
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
              context: { origin: session.origin, id: session.id },
            }),
          );
        }
        return Result.ok<AuthMeResponse>({
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
        return Result.ok<AuthMeResponse>({
          participantKind: "service",
          user: null,
          device: null,
          service,
        });
      }

      const { user, device } = await loadAuthenticatedDevice({
        userStorage: deps.userStorage,
        deviceActivationStorage: deps.deviceActivationStorage,
        deviceDeploymentStorage: deps.deviceDeploymentStorage,
        session,
      });
      return Result.ok<AuthMeResponse>({
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

export const authMeHandler = async (
  args: Parameters<
    ReturnType<typeof createAuthMeHandler>
  >[0],
) => {
  const globals = authRuntimeDeps();
  const { loadServiceDeployment, loadServiceInstanceByKey } =
    runtimeServiceLookup();
  return await createAuthMeHandler({
    sessionStorage: globals.sessionStorage,
    userStorage: globals.userStorage,
    deviceActivationStorage: globals.deviceActivationStorage,
    deviceDeploymentStorage: globals.deviceDeploymentStorage,
    loadServiceInstance: loadServiceInstanceByKey,
    loadServiceDeployment,
  })(args);
};

/** Creates the Auth.ValidateRequest RPC handler backed by SQL auth projections. */
export function createAuthValidateRequestHandler(deps: {
  sessionStorage: Pick<SessionStorage, "getOneBySessionKey">;
  userStorage: UserProjectionStorage;
  contractApprovalStorage: Pick<SqlContractApprovalRepository, "get">;
  deviceActivationStorage: DeviceActivationStorage;
  deviceDeploymentStorage: DeviceDeploymentStorage;
  loadServiceInstance: Parameters<typeof resolveSessionPrincipal>[2][
    "loadServiceInstance"
  ];
  loadServiceDeployment: Parameters<typeof resolveSessionPrincipal>[2][
    "loadServiceDeployment"
  ];
  loadInstanceGrantPolicies: Parameters<typeof resolveSessionPrincipal>[2][
    "loadInstanceGrantPolicies"
  ];
}) {
  return async ({ input: req }: { input: ValidateRequestInput }) => {
    logger.trace({
      rpc: "Auth.ValidateRequest",
      sessionKey: req.sessionKey,
      subject: req.subject,
    }, "RPC request");

    const payloadHashBytes = base64urlDecode(req.payloadHash);
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
      deviceActivationStorage: deps.deviceActivationStorage,
      deviceDeploymentStorage: deps.deviceDeploymentStorage,
      loadStoredApproval: async (key) => {
        const approvalKey = parseContractApprovalKey(key);
        if (!approvalKey) return null;
        return await deps.contractApprovalStorage.get(
          approvalKey.userTrellisId,
          approvalKey.contractDigest,
        ) ?? null;
      },
      loadInstanceGrantPolicies: deps.loadInstanceGrantPolicies,
    });
    if (!principal.ok) {
      return Result.err(new AuthError(principal.error));
    }

    const required = req.capabilities ?? [];
    const allowed = required.length === 0 ||
      required.every((capability) =>
        principal.value.capabilities.includes(capability)
      );

    return Result.ok({
      allowed,
      inboxPrefix,
      caller: formatCaller(session, principal.value),
    });
  };
}

export const authValidateRequestHandler = async (
  args: Parameters<
    ReturnType<typeof createAuthValidateRequestHandler>
  >[0],
) => {
  const globals = authRuntimeDeps();
  const serviceLookup = runtimeServiceLookup();
  return await createAuthValidateRequestHandler({
    sessionStorage: globals.sessionStorage,
    userStorage: globals.userStorage,
    contractApprovalStorage: globals.contractApprovalStorage,
    deviceActivationStorage: globals.deviceActivationStorage,
    deviceDeploymentStorage: globals.deviceDeploymentStorage,
    loadServiceInstance: serviceLookup.loadServiceInstanceByKey,
    loadServiceDeployment: serviceLookup.loadServiceDeployment,
    loadInstanceGrantPolicies: loadEffectiveGrantPolicies,
  })(args);
};

export const authLogoutHandler = async (
  { context: { caller, sessionKey } }: { context: SessionContext },
) => {
  const { connectionsKV, natsAuth, sessionStorage } = authRuntimeDeps();
  const user = requireUserCaller(caller);
  logger.trace(
    { rpc: "Auth.Logout", sessionKey, userId: user.id },
    "RPC request",
  );
  await sessionStorage.deleteBySessionKey(sessionKey);

  const connKeys = await connectionsKV.keys(
    connectionFilterForSession(sessionKey),
  )
    .take();
  if (!isErr(connKeys)) {
    for await (const key of connKeys) {
      const parsedKey = parseConnectionKey(key);
      if (!parsedKey || parsedKey.scopeId !== user.trellisId) continue;
      const entry = await connectionsKV.get(key).take();
      if (!isErr(entry)) {
        const connection = unwrapConnectionEntry(entry);
        if (!connection) continue;
        await AsyncResult.try(() =>
          natsAuth.request(
            `$SYS.REQ.SERVER.${connection.serverId}.KICK`,
            JSON.stringify({ cid: connection.clientId }),
          )
        );
      }
      await connectionsKV.delete(key);
    }
  }

  return Result.ok({ success: true });
};

export function createAuthListSessionsHandler(deps: {
  sessionStorage: Pick<
    SessionStorage,
    "listEntries" | "listEntriesByUser"
  >;
}) {
  return async ({ input: req = {} }: { input?: UserRefFilter }) => {
    logger.trace({ rpc: "Auth.ListSessions", user: req.user }, "RPC request");
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    let sessions: SessionListRow[];
    if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) {
        return Result.err(new AuthError({ reason: "invalid_request" }));
      }
      const trellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
      sessions = (await deps.sessionStorage.listEntriesByUser(trellisId)).map(
        (entry) => buildSessionRow(entry.session, entry.sessionKey),
      );
    } else {
      sessions = (await deps.sessionStorage.listEntries()).map((entry) =>
        buildSessionRow(entry.session, entry.sessionKey)
      );
    }

    sessions.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ sessions });
  };
}

export const authListSessionsHandler = async (
  args: Parameters<
    ReturnType<typeof createAuthListSessionsHandler>
  >[0],
) => {
  const { sessionStorage } = authRuntimeDeps();
  return await createAuthListSessionsHandler({ sessionStorage })(args);
};

export const authRevokeSessionHandler = async (
  ...args: Parameters<ReturnType<typeof createAuthRevokeSessionHandler>>
) => {
  const globals = authRuntimeDeps();
  return await createAuthRevokeSessionHandler({
    sessionStorage: globals.sessionStorage,
    connectionsKV: globals.connectionsKV,
    contractApprovalStorage: globals.contractApprovalStorage,
    deviceActivationStorage: globals.deviceActivationStorage,
    serviceInstanceStorage: globals.serviceInstanceStorage,
    kick: kickConnection,
    publishSessionRevoked: async (event) => {
      (await globals.trellis.publish("Auth.SessionRevoked", event)).inspectErr(
        (error: unknown) =>
          logger.warn({ error }, "Failed to publish Auth.SessionRevoked"),
      );
    },
  })(...args);
};

export function createAuthListConnectionsHandler(deps: {
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
    logger.trace({
      rpc: "Auth.ListConnections",
      user: req.user,
      sessionKey: req.sessionKey,
    }, "RPC request");
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    const sessionKeyFilter = typeof req.sessionKey === "string"
      ? req.sessionKey
      : undefined;

    let filter = ">";
    let userTrellisId: string | undefined;
    if (sessionKeyFilter) {
      filter = connectionFilterForSession(sessionKeyFilter);
    } else if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) {
        return Result.err(new AuthError({ reason: "invalid_request" }));
      }
      userTrellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
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

      const parsedKey = parseConnectionKey(key);
      if (!parsedKey) continue;
      if (sessionKeyFilter && parsedKey.sessionKey !== sessionKeyFilter) {
        continue;
      }
      if (userTrellisId && parsedKey.scopeId !== userTrellisId) continue;

      const session = await deps.sessionStorage.getOneBySessionKey(
        parsedKey.sessionKey,
      );
      if (!session) continue;

      connections.push(buildConnectionRow(
        session,
        parsedKey.sessionKey,
        parsedKey.userNkey,
        {
          serverId: (entry as {
            value: {
              serverId: string;
              clientId: number;
              connectedAt: string | Date;
            };
          }).value.serverId,
          clientId: (entry as {
            value: {
              serverId: string;
              clientId: number;
              connectedAt: string | Date;
            };
          }).value.clientId,
          connectedAt: (entry as {
            value: {
              serverId: string;
              clientId: number;
              connectedAt: string | Date;
            };
          }).value.connectedAt,
        },
      ));
    }

    connections.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ connections });
  };
}

export const authListConnectionsHandler = async (
  args: Parameters<
    ReturnType<typeof createAuthListConnectionsHandler>
  >[0],
) => {
  const { sessionStorage, connectionsKV } = authRuntimeDeps();
  return await createAuthListConnectionsHandler({
    sessionStorage,
    connectionsKV,
  })(
    args,
  );
};

export function createAuthKickConnectionHandler(opts: {
  kick: (serverId: string, clientId: number) => Promise<void>;
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
    logger.trace({
      rpc: "Auth.KickConnection",
      userNkey: req.userNkey,
      userId: user.id,
    }, "RPC request");
    if (typeof req.userNkey !== "string" || req.userNkey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const { connectionsKV, sessionStorage, trellis } = authRuntimeDeps();
    const iter = await connectionsKV.keys(">").take();
    if (isErr(iter)) {
      return Result.ok({ success: false });
    }

    const kickedBy = `${user.origin}.${user.id}`;
    let kicked = false;

    for await (const key of iter) {
      const parsedKey = parseConnectionKey(key);
      if (!parsedKey || parsedKey.userNkey !== req.userNkey) continue;
      const entry = await connectionsKV.get(key).take();
      if (!isErr(entry)) {
        const connection = unwrapConnectionEntry(entry);
        if (connection) {
          await opts.kick(connection.serverId, connection.clientId);
        }
      }

      if (parsedKey.sessionKey && parsedKey.scopeId) {
        const session = await sessionStorage.getOneBySessionKey(
          parsedKey.sessionKey,
        );
        if (session) {
          if (session.type === "device") {
            continue;
          }
          (await trellis.publish("Auth.ConnectionKicked", {
            origin: session.origin,
            id: session.id,
            userNkey: req.userNkey,
            kickedBy,
          })).inspectErr((error: unknown) =>
            logger.warn({ error }, "Failed to publish Auth.ConnectionKicked")
          );
        }
      }

      await connectionsKV.delete(key);
      kicked = true;
    }

    return Result.ok({ success: kicked });
  };
}
