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
} from "../../../../../generated/js/sdks/auth/types.ts";
import {
  connectionsKV,
  contractApprovalsKV,
  deviceActivationsKV,
  deviceProfilesKV,
  logger,
  natsAuth,
  serviceInstancesKV,
  serviceProfilesKV,
  sessionKV,
  trellis,
  usersKV,
} from "../../bootstrap/globals.ts";
import type {
  Session,
  UserProjectionEntry,
} from "../../state/schemas.ts";
import { resolveSessionPrincipal } from "./principal.ts";
import { loadServiceInstanceByKey, loadServiceProfile } from "../admin/service_rpc.ts";
import { loadEffectiveGrantPolicies } from "../grants/store.ts";
export { createAuthRevokeSessionHandler } from "./revoke.ts";
import { createAuthRevokeSessionHandler } from "./revoke.ts";

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
  profileId: string;
  active: boolean;
  capabilities: string[];
};

type AuthMeResponse = {
  participantKind: "app" | "agent" | "device" | "service";
  user: AuthenticatedUser | null;
  device: AuthenticatedDevice | null;
  service: AuthenticatedService | null;
};

type KVLike<V> = {
  get: (key: string) => AsyncResult<{ value: V } | V | unknown, BaseError>;
  keys?: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
};

function unwrapValue<V>(entry: unknown): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return (entry as { value: V }).value;
  }
  return entry as V;
}

type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: {
    origin: string;
    id: string;
  };
  state: "activated" | "revoked";
  activatedAt: string | Date;
  revokedAt: string | Date | null;
};

function deviceTypeFromProfileId(profileId: string): string {
  const [deviceType] = profileId.split(".", 1);
  return deviceType && deviceType.length > 0 ? deviceType : profileId;
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
    profileId?: string;
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
      ...(session.app?.origin ? { appOrigin: session.app.origin } : {}),
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
        deviceType: deviceTypeFromProfileId(session.profileId),
        runtimePublicKey: session.publicIdentityKey,
        profileId: session.profileId,
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
      profileId: session.profileId,
    },
    createdAt: iso(session.createdAt),
    lastAuth: iso(session.lastAuth),
  };
}

function buildConnectionRow(
  session: Session,
  sessionKey: string,
  userNkey: string,
  connection: { serverId: string; clientId: number; connectedAt: string | Date },
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
      ...(session.app?.origin ? { appOrigin: session.app.origin } : {}),
    };
  }

  if (session.type === "device") {
    return {
      ...base,
      participantKind: "device",
      principal: {
        type: "device",
        deviceId: session.instanceId,
        deviceType: deviceTypeFromProfileId(session.profileId),
        runtimePublicKey: session.publicIdentityKey,
        profileId: session.profileId,
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
      profileId: session.profileId,
    },
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
      deviceType: deviceTypeFromProfileId(session.profileId),
      runtimePublicKey: session.publicIdentityKey,
      profileId: session.profileId,
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
  profileId: string;
  runtimePublicKey: string;
  active: boolean;
  capabilities: string[];
} | null {
  if (
    caller.type !== "device" || !caller.deviceId || !caller.runtimePublicKey ||
    !caller.profileId || caller.active === undefined
  ) {
    return null;
  }

  return {
    deviceId: caller.deviceId,
    profileId: caller.profileId,
    runtimePublicKey: caller.runtimePublicKey,
    active: caller.active,
    capabilities: caller.capabilities ?? [],
  };
}

function responseFromCaller(
  caller: SessionContext["caller"],
): AuthMeResponse | null {
  if (
    caller.type === "user" && caller.id && caller.origin && caller.email &&
    caller.name && caller.active !== undefined
  ) {
    return {
      participantKind: caller.participantKind ?? "app",
      user: {
        id: caller.id,
        origin: caller.origin,
        active: caller.active,
        name: caller.name,
        email: caller.email,
        ...(caller.image ? { image: caller.image } : {}),
        capabilities: caller.capabilities ?? [],
        ...(caller.lastLogin ? { lastLogin: caller.lastLogin } : {}),
      },
      device: null,
      service: null,
    };
  }

  if (
    caller.type === "service" && caller.id && caller.name &&
    caller.active !== undefined
  ) {
    return {
      participantKind: "service",
      user: null,
      device: null,
      service: {
        type: "service",
        id: caller.id,
        name: caller.name,
        active: caller.active,
        capabilities: caller.capabilities ?? [],
      },
    };
  }

  const deviceCaller = deviceCallerFields(caller);
  if (deviceCaller) {
    return {
      participantKind: "device",
      user: null,
      device: {
        type: "device",
        deviceId: deviceCaller.deviceId,
        deviceType: deviceTypeFromProfileId(deviceCaller.profileId),
        runtimePublicKey: deviceCaller.runtimePublicKey,
        profileId: deviceCaller.profileId,
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
  usersKV: KVLike<UserProjectionEntry>;
  deviceActivationsKV: KVLike<DeviceActivationRecord>;
  deviceProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
}): Promise<AuthMeResponse | null> {
  const deviceCaller = deviceCallerFields(args.caller);
  if (!deviceCaller) {
    return null;
  }

  const activationEntry = unwrapValue<DeviceActivationRecord>(
    await args.deviceActivationsKV.get(deviceCaller.deviceId).take(),
  );
  if (isErr(activationEntry)) return null;
  const activation = activationEntry;
  if (
    activation.state !== "activated" ||
    activation.profileId !== deviceCaller.profileId ||
    activation.revokedAt !== null
  ) {
    return null;
  }

  const profileEntry = unwrapValue<{ profileId: string; disabled: boolean }>(
    await args.deviceProfilesKV.get(activation.profileId).take(),
  );
  if (isErr(profileEntry) || profileEntry.disabled) return null;

  const user = activation.activatedBy
    ? await loadAuthenticatedUser({
      usersKV: args.usersKV,
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
      deviceType: deviceTypeFromProfileId(deviceCaller.profileId),
      runtimePublicKey: deviceCaller.runtimePublicKey,
      profileId: deviceCaller.profileId,
      active: deviceCaller.active,
      capabilities: deviceCaller.capabilities,
    },
    service: null,
  };
}

async function loadSessionBySessionKey(
  sessionKey: string,
  sessionStore: KVLike<Session>,
): Promise<Session | null> {
  const keysFn = sessionStore.keys;
  if (!keysFn) return null;
  const keysIterResult = await keysFn(`${sessionKey}.>`);
  const keysIter = unwrapValue<AsyncIterable<string>>(keysIterResult.take());
  if (isErr(keysIter)) return null;

  let sessionKeyId: string | undefined;
  for await (const key of keysIter as AsyncIterable<string>) {
    if (!sessionKeyId) sessionKeyId = key;
    else {
      throw new AuthError({
        reason: "session_corrupted",
        context: { sessionKey },
      });
    }
  }

  if (!sessionKeyId) return null;
  const sessionValue = unwrapValue<Session>(
    await sessionStore.get(sessionKeyId).take(),
  );
  if (isErr(sessionValue)) return null;
  return sessionValue;
}

async function loadAuthenticatedUser(args: {
  usersKV: KVLike<UserProjectionEntry>;
  origin: string;
  id: string;
  fallback:
    & Pick<AuthenticatedUser, "name" | "email" | "capabilities">
    & Partial<Pick<AuthenticatedUser, "image" | "lastLogin" | "active">>;
}): Promise<AuthenticatedUser> {
  const trellisId = await trellisIdFromOriginId(args.origin, args.id);
  const projectionEntry = unwrapValue<UserProjectionEntry>(
    await args.usersKV.get(trellisId).take(),
  );
  if (!isErr(projectionEntry)) {
    const projection = projectionEntry;
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

  return {
    id: args.id,
    origin: args.origin,
    active: args.fallback.active ?? true,
    name: args.fallback.name,
    email: args.fallback.email,
    ...(args.fallback.image ? { image: args.fallback.image } : {}),
    capabilities: args.fallback.capabilities,
    ...(args.fallback.lastLogin ? { lastLogin: args.fallback.lastLogin } : {}),
  };
}

async function loadAuthenticatedService(args: {
  sessionKey: string;
  session: Session & { type: "service" };
}): Promise<AuthenticatedService> {
  const service = await loadServiceInstanceByKey(args.sessionKey);
  if (service) {
    return {
      type: "service",
      id: args.session.id,
      name: args.session.name,
      active: !service.disabled,
      capabilities: service.capabilities ?? [],
    };
  }

  return {
    type: "service",
    id: args.session.id,
    name: args.session.name,
    active: false,
    capabilities: [],
  };
}

async function loadAuthenticatedDevice(args: {
  usersKV: KVLike<UserProjectionEntry>;
  deviceActivationsKV: KVLike<DeviceActivationRecord>;
  deviceProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
  session: Session & { type: "device" };
}): Promise<{ user: AuthenticatedUser | null; device: AuthenticatedDevice }> {
  const activationEntry = unwrapValue<DeviceActivationRecord>(
    await args.deviceActivationsKV.get(args.session.instanceId).take(),
  );
  if (isErr(activationEntry)) {
    throw new AuthError({
      reason: "unknown_device",
      context: { instanceId: args.session.instanceId },
    });
  }

  const activation = activationEntry;
  const revokedAt = activation.revokedAt instanceof Date
    ? activation.revokedAt
    : activation.revokedAt
    ? new Date(activation.revokedAt)
    : null;
  if (
    activation.state !== "activated" ||
    activation.profileId !== args.session.profileId ||
    revokedAt !== null ||
    args.session.revokedAt !== null
  ) {
    throw new AuthError({
      reason: "device_activation_revoked",
      context: {
        instanceId: args.session.instanceId,
        profileId: activation.profileId,
      },
    });
  }

  const profileEntry = unwrapValue<{ profileId: string; disabled: boolean }>(
    await args.deviceProfilesKV.get(activation.profileId).take(),
  );
  if (isErr(profileEntry)) {
    throw new AuthError({
      reason: "device_profile_not_found",
      context: { profileId: activation.profileId },
    });
  }

  const profile = profileEntry;
  if (profile.disabled) {
    throw new AuthError({
      reason: "device_profile_disabled",
      context: { profileId: profile.profileId },
    });
  }

  const user = activation.activatedBy
    ? await loadAuthenticatedUser({
      usersKV: args.usersKV,
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
        deviceType: deviceTypeFromProfileId(args.session.profileId),
        runtimePublicKey: args.session.publicIdentityKey,
        profileId: args.session.profileId,
      active: true,
      capabilities: args.session.delegatedCapabilities,
    },
  };
}

export function createAuthMeHandler(deps: {
  sessionKV: KVLike<Session>;
  usersKV: KVLike<UserProjectionEntry>;
  deviceActivationsKV: KVLike<DeviceActivationRecord>;
  deviceProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
}) {
  return async ({ context: { sessionKey, caller } }: { context: SessionContext }) => {
    logger.trace({ rpc: "Auth.Me", sessionKey }, "RPC request");

    try {
      const callerResponse = responseFromCaller(caller);
      if (callerResponse && (callerResponse.user || callerResponse.service)) {
        return Result.ok<AuthMeResponse>(callerResponse);
      }

      const session = await loadSessionBySessionKey(sessionKey, deps.sessionKV);
      if (!session) {
        if (callerResponse && (callerResponse.user || callerResponse.service)) {
          return Result.ok<AuthMeResponse>(callerResponse);
        }
        const deviceCallerResponse = await responseFromDeviceCaller({
          caller,
          usersKV: deps.usersKV,
          deviceActivationsKV: deps.deviceActivationsKV,
          deviceProfilesKV: deps.deviceProfilesKV,
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
          usersKV: deps.usersKV,
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
        return Result.ok<AuthMeResponse>({
          participantKind: session.participantKind,
          user,
          device: null,
          service: null,
        });
      }

      if (session.type === "service") {
        const service = await loadAuthenticatedService({
          sessionKey,
          session: session as Session & { type: "service" },
        });
        return Result.ok<AuthMeResponse>({
          participantKind: "service",
          user: null,
          device: null,
          service,
        });
      }

      const { user, device } = await loadAuthenticatedDevice({
        usersKV: deps.usersKV,
        deviceActivationsKV: deps.deviceActivationsKV,
        deviceProfilesKV: deps.deviceProfilesKV,
        session: session as Session & { type: "device" },
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

export const authMeHandler = createAuthMeHandler({
  sessionKV,
  usersKV,
  deviceActivationsKV: deviceActivationsKV,
  deviceProfilesKV: deviceProfilesKV,
});

export const authValidateRequestHandler = async (
  { input: req }: { input: ValidateRequestInput },
) => {
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

  const keysIter = await sessionKV.keys(`${req.sessionKey}.>`).take();
  if (isErr(keysIter)) {
    return Result.err(new AuthError({ reason: "session_not_found" }));
  }

  let sessionKeyId: string | undefined;
  for await (const key of keysIter) {
    if (!sessionKeyId) sessionKeyId = key;
    else {
      return Result.err(
        new AuthError({
          reason: "session_corrupted",
          context: { sessionKey: req.sessionKey },
        }),
      );
    }
  }

  if (!sessionKeyId) {
    return Result.err(new AuthError({ reason: "session_not_found" }));
  }
  const sessionEntry = await sessionKV.get(sessionKeyId).take();
  if (isErr(sessionEntry)) {
    return Result.err(new AuthError({ reason: "session_not_found" }));
  }

  const session = sessionEntry.value;
  const inboxPrefix = `_INBOX.${req.sessionKey.slice(0, 16)}`;
  const principal = await resolveSessionPrincipal(session, req.sessionKey, {
    loadServiceInstance: loadServiceInstanceByKey,
    loadServiceProfile,
    usersKV,
    deviceActivationsKV: deviceActivationsKV,
    deviceProfilesKV: deviceProfilesKV,
    loadStoredApproval: async (key) => {
      const entry = await contractApprovalsKV.get(key).take();
      return isErr(entry) ? null : entry.value;
    },
    loadInstanceGrantPolicies: async (contractId: string) => {
      return await loadEffectiveGrantPolicies(contractId);
    },
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

export const authLogoutHandler = async (
  { context: { caller, sessionKey } }: { context: SessionContext },
) => {
  const user = requireUserCaller(caller);
  logger.trace(
    { rpc: "Auth.Logout", sessionKey, userId: user.id },
    "RPC request",
  );
  const sessionKeyId = `${sessionKey}.${user.trellisId}`;

  await sessionKV.delete(sessionKeyId);

  const connKeys = await connectionsKV.keys(`${sessionKey}.${user.trellisId}.>`).take();
  if (!isErr(connKeys)) {
    for await (const key of connKeys) {
      const entry = await connectionsKV.get(key).take();
      if (!isErr(entry)) {
        await AsyncResult.try(() =>
          natsAuth.request(
            `$SYS.REQ.SERVER.${entry.value.serverId}.KICK`,
            JSON.stringify({ cid: entry.value.clientId }),
          )
        );
      }
      await connectionsKV.delete(key);
    }
  }

  return Result.ok({ success: true });
};

export function createAuthListSessionsHandler(deps: {
  sessionKV: Required<Pick<KVLike<Session>, "keys" | "get">>;
}) {
  return async ({ input: req = {} }: { input?: UserRefFilter }) => {
    logger.trace({ rpc: "Auth.ListSessions", user: req.user }, "RPC request");
    const userFilter = typeof req.user === "string" ? req.user : undefined;
    let filter = ">";
    if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) {
        return Result.err(new AuthError({ reason: "invalid_request" }));
      }
      const trellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
      filter = `>.${trellisId}`;
    }

    const iter = await deps.sessionKV.keys(filter).take();
    if (isErr(iter)) {
      return Result.ok({ sessions: [] });
    }

    const sessions: SessionListRow[] = [];
    for await (const key of iter as AsyncIterable<string>) {
      const entry = await deps.sessionKV.get(key).take();
      if (isErr(entry)) continue;

      const sessionKey = key.split(".")[0] ?? "";
      sessions.push(buildSessionRow((entry as { value: Session }).value, sessionKey));
    }

    sessions.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ sessions });
  };
}

export const authListSessionsHandler = createAuthListSessionsHandler({ sessionKV });

export const authRevokeSessionHandler = createAuthRevokeSessionHandler({
  sessionKV,
  connectionsKV,
  contractApprovalsKV,
  deviceActivationsKV,
  serviceInstancesKV,
  kick: async (serverId, clientId) => {
    await import("../callout/kick.ts").then(({ kick }) => kick(serverId, clientId));
  },
  publishSessionRevoked: async (event) => {
    await trellis.publish("Auth.SessionRevoked", event).inspectErr((error) =>
      logger.warn({ error }, "Failed to publish Auth.SessionRevoked"));
  },
});

export function createAuthListConnectionsHandler(deps: {
  sessionKV: Pick<KVLike<Session>, "get">;
  connectionsKV: {
    keys: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
    get: (key: string) => AsyncResult<
      { value: { serverId: string; clientId: number; connectedAt: string | Date } } | unknown,
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
    if (sessionKeyFilter) {
      filter = `${sessionKeyFilter}.>.>`;
    } else if (userFilter) {
      const parsed = parseOriginId(userFilter);
      if (!parsed) {
        return Result.err(new AuthError({ reason: "invalid_request" }));
      }
      const trellisId = await trellisIdFromOriginId(parsed.origin, parsed.id);
      filter = `>.${trellisId}.>`;
    }

    const iter = await deps.connectionsKV.keys(filter).take();
    if (isErr(iter)) {
      return Result.ok({ connections: [] });
    }

    const connections: ConnectionRow[] = [];
    for await (const key of iter as AsyncIterable<string>) {
      const entry = await deps.connectionsKV.get(key).take();
      if (isErr(entry)) continue;

      const parts = key.split(".");
      const sessionKey = parts[0];
      const trellisId = parts[1];
      const userNkey = parts[2];
      if (!sessionKey || !trellisId || !userNkey) continue;

      const session = await deps.sessionKV.get(`${sessionKey}.${trellisId}`).take();
      if (isErr(session)) continue;

      const sessionValue = (session as { value: Session }).value;
      connections.push(buildConnectionRow(sessionValue, sessionKey, userNkey, {
        serverId: (entry as { value: { serverId: string; clientId: number; connectedAt: string | Date } }).value.serverId,
        clientId: (entry as { value: { serverId: string; clientId: number; connectedAt: string | Date } }).value.clientId,
        connectedAt: (entry as { value: { serverId: string; clientId: number; connectedAt: string | Date } }).value.connectedAt,
      }));
    }

    connections.sort((left, right) => left.key.localeCompare(right.key));
    return Result.ok({ connections });
  };
}

export const authListConnectionsHandler = createAuthListConnectionsHandler({
  sessionKV,
  connectionsKV,
});

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

    const iter = await connectionsKV.keys(`>.>.${req.userNkey}`).take();
    if (isErr(iter)) {
      return Result.ok({ success: false });
    }

    const kickedBy = `${user.origin}.${user.id}`;
    let kicked = false;

    for await (const key of iter) {
      const entry = await connectionsKV.get(key).take();
      if (!isErr(entry)) {
        await opts.kick(entry.value.serverId, entry.value.clientId);
      }

      const parts = key.split(".");
      const sessionKey = parts[0];
      const trellisId = parts[1];
      if (sessionKey && trellisId) {
        const session = await sessionKV.get(`${sessionKey}.${trellisId}`).take();
        if (!isErr(session)) {
          if (session.value.type === "device") {
            continue;
          }
          await trellis.publish("Auth.ConnectionKicked", {
              origin: session.value.origin,
              id: session.value.id,
              userNkey: req.userNkey,
              kickedBy,
            }).inspectErr((error) =>
            logger.warn({ error }, "Failed to publish Auth.ConnectionKicked"));
        }
      }

      await connectionsKV.delete(key);
      kicked = true;
    }

    return Result.ok({ success: kicked });
  };
}
