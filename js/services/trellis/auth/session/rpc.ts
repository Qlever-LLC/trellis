import {
  base64urlDecode,
  trellisIdFromOriginId,
  verifyProof,
} from "@qlever-llc/trellis/auth";
import { AsyncResult, isErr, Result } from "@qlever-llc/result";
import { AuthError } from "../../../../packages/trellis/errors/AuthError.ts";
import {
  bindingTokenKV,
  connectionsKV,
  logger,
  natsAuth,
  sentinelCreds,
  servicesKV,
  sessionKV,
  trellis,
  usersKV,
  deviceActivationsKV,
  deviceProfilesKV,
} from "../../bootstrap/globals.ts";
import { getConfig } from "../../config.ts";
import type { ServiceRegistryEntry, Session, UserProjectionEntry } from "../../state/schemas.ts";
import { resolveSessionPrincipal } from "./principal.ts";

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
  user: AuthenticatedUser | null;
  device: AuthenticatedDevice | null;
  service: AuthenticatedService | null;
};

type KVResult<T> = { take(): T };

type KVLike<V> = {
  get: (key: string) => Promise<KVResult<{ value: V } | V | unknown>>;
  keys?: (filter: string) => Promise<KVResult<AsyncIterable<string> | unknown>>;
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

const config = getConfig();

function deviceTypeFromProfileId(profileId: string): string {
  const [deviceType] = profileId.split(".", 1);
  return deviceType && deviceType.length > 0 ? deviceType : profileId;
}

type SessionUser = {
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

const CLI_CONTRACT_ID = "trellis.cli@v1";

type UserRefFilter = { user?: string };
type SessionFilter = { sessionKey?: string; user?: string };
type SessionKeyRequest = { sessionKey: string };
type UserNkeyRequest = { userNkey: string };
type SessionListRow = {
  key: string;
  type: "user" | "service" | "device";
  createdAt: string;
  lastAuth: string;
};
type ConnectionRow = {
  key: string;
  serverId: string;
  clientId: number;
  connectedAt: string;
};

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseOriginId(value: string): { origin: string; id: string } | null {
  const idx = value.indexOf(".");
  if (idx <= 0 || idx >= value.length - 1) return null;
  return { origin: value.slice(0, idx), id: value.slice(idx + 1) };
}

function sessionActorKey(session: Session, sessionKey: string, userNkey?: string): string {
  const actor = session.type === "device"
    ? `${session.instanceId}.${session.publicIdentityKey}`
    : `${session.origin}.${session.id}`;
  return userNkey ? `${actor}.${sessionKey}.${userNkey}` : `${actor}.${sessionKey}`;
}

function requireUserCaller(caller: SessionContext["caller"]): SessionUser {
  if (
    caller.type !== "user" ||
    !caller.id ||
    !caller.origin ||
    !caller.email ||
    !caller.name ||
    caller.active === undefined
  ) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
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

function formatCaller(session: Session, principal: { active: boolean; capabilities: string[]; email: string; name: string }) {
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

function responseFromCaller(caller: SessionContext["caller"]): AuthMeResponse | null {
  if (
    caller.type === "user" && caller.id && caller.origin && caller.email &&
    caller.name && caller.active !== undefined
  ) {
    return {
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
    (await args.deviceActivationsKV.get(deviceCaller.deviceId)).take(),
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
    (await args.deviceProfilesKV.get(activation.profileId)).take(),
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

async function loadSessionBySessionKey(sessionKey: string, sessionStore: KVLike<Session>): Promise<Session | null> {
  const keysFn = sessionStore.keys;
  if (!keysFn) return null;
  const keysIterResult = await keysFn(`${sessionKey}.>`);
  const keysIter = unwrapValue<AsyncIterable<string>>(keysIterResult.take());
  if (isErr(keysIter)) return null;

  let sessionKeyId: string | undefined;
  for await (const key of keysIter as AsyncIterable<string>) {
    if (!sessionKeyId) sessionKeyId = key;
    else {
      throw new AuthError({ reason: "session_corrupted", context: { sessionKey } });
    }
  }

  if (!sessionKeyId) return null;
  const sessionValue = unwrapValue<Session>((await sessionStore.get(sessionKeyId)).take());
  if (isErr(sessionValue)) return null;
  return sessionValue;
}

async function loadAuthenticatedUser(args: {
  usersKV: KVLike<UserProjectionEntry>;
  origin: string;
  id: string;
  fallback: Pick<AuthenticatedUser, "name" | "email" | "capabilities"> & Partial<Pick<AuthenticatedUser, "image" | "lastLogin" | "active">>;
}): Promise<AuthenticatedUser> {
  const trellisId = await trellisIdFromOriginId(args.origin, args.id);
  const projectionEntry = unwrapValue<UserProjectionEntry>((await args.usersKV.get(trellisId)).take());
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
      ...(args.fallback.lastLogin ? { lastLogin: args.fallback.lastLogin } : {}),
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
  servicesKV: KVLike<ServiceRegistryEntry>;
  sessionKey: string;
  session: Session & { type: "service" };
}): Promise<AuthenticatedService> {
  const serviceEntry = unwrapValue<ServiceRegistryEntry>((await args.servicesKV.get(args.sessionKey)).take());
  if (!isErr(serviceEntry)) {
    const service = serviceEntry;
    return {
      type: "service",
      id: args.session.id,
      name: args.session.name,
      active: service.active,
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
  const activationEntry = unwrapValue<DeviceActivationRecord>((await args.deviceActivationsKV.get(args.session.instanceId)).take());
  if (isErr(activationEntry)) {
    throw new AuthError({ reason: "unknown_device", context: { instanceId: args.session.instanceId } });
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
      context: { instanceId: args.session.instanceId, profileId: activation.profileId },
    });
  }

  const profileEntry = unwrapValue<{ profileId: string; disabled: boolean }>((await args.deviceProfilesKV.get(activation.profileId)).take());
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
  servicesKV: KVLike<ServiceRegistryEntry>;
  deviceActivationsKV: KVLike<DeviceActivationRecord>;
  deviceProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
}) {
  return async (_req: unknown, { sessionKey, caller }: SessionContext) => {
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
        return Result.err(new AuthError({ reason: "session_not_found", context: { sessionKey } }));
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
        return Result.ok<AuthMeResponse>({ user, device: null, service: null });
      }

      if (session.type === "service") {
        const service = await loadAuthenticatedService({
          servicesKV: deps.servicesKV,
          sessionKey,
          session: session as Session & { type: "service" },
        });
        return Result.ok<AuthMeResponse>({ user: null, device: null, service });
      }

      const { user, device } = await loadAuthenticatedDevice({
        usersKV: deps.usersKV,
        deviceActivationsKV: deps.deviceActivationsKV,
        deviceProfilesKV: deps.deviceProfilesKV,
        session: session as Session & { type: "device" },
      });
      return Result.ok<AuthMeResponse>({ user, device, service: null });
    } catch (error) {
      if (error instanceof AuthError) return Result.err(error);
      throw error;
    }
  };
}

export const authMeHandler = createAuthMeHandler({
  sessionKV,
  usersKV,
  servicesKV,
  deviceActivationsKV: deviceActivationsKV,
  deviceProfilesKV: deviceProfilesKV,
});

export const authValidateRequestHandler = async (req: ValidateRequestInput) => {
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

  const keysIter = (await sessionKV.keys(`${req.sessionKey}.>`)).take();
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
  const sessionEntry = (await sessionKV.get(sessionKeyId)).take();
  if (isErr(sessionEntry)) {
    return Result.err(new AuthError({ reason: "session_not_found" }));
  }

  const session = sessionEntry.value;
  const inboxPrefix = `_INBOX.${req.sessionKey.slice(0, 16)}`;
  const principal = await resolveSessionPrincipal(session, req.sessionKey, {
    servicesKV,
    usersKV,
    deviceActivationsKV: deviceActivationsKV,
    deviceProfilesKV: deviceProfilesKV,
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
  _req: unknown,
  { caller, sessionKey }: SessionContext,
) => {
  const user = requireUserCaller(caller);
  logger.trace(
    { rpc: "Auth.Logout", sessionKey, userId: user.id },
    "RPC request",
  );
  const trellisId = await trellisIdFromOriginId(user.origin, user.id);
  const sessionKeyId = `${sessionKey}.${trellisId}`;

  await sessionKV.delete(sessionKeyId);

  const connKeys = (await connectionsKV.keys(`${sessionKey}.${trellisId}.>`))
    .take();
  if (!isErr(connKeys)) {
    for await (const key of connKeys) {
      const entry = (await connectionsKV.get(key)).take();
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

export function createAuthRenewBindingTokenHandler(opts: {
  randomToken: (bytes: number) => string;
  hashKey: (value: string) => Promise<string>;
}) {
  return async (_req: unknown, { caller, sessionKey }: SessionContext) => {
    const user = requireUserCaller(caller);
    logger.trace(
      { rpc: "Auth.RenewBindingToken", sessionKey, userId: user.id },
      "RPC request",
    );
    const trellisId = await trellisIdFromOriginId(user.origin, user.id);
    const sessionKeyId = `${sessionKey}.${trellisId}`;

    const session = (await sessionKV.get(sessionKeyId)).take();
    if (isErr(session)) {
      return Result.err(
        new AuthError({ reason: "session_not_found", context: { sessionKey } }),
      );
    }

    const sessionValue = unwrapValue<Session>(session);
    const bindingTtlMs = sessionValue.type === "user" &&
        sessionValue.contractId === CLI_CONTRACT_ID
      ? config.ttlMs.bindingTokens.cliRenew
      : config.ttlMs.bindingTokens.renew;

    const bindingToken = opts.randomToken(32);
    const bindingTokenHash = await opts.hashKey(bindingToken);
    const now = new Date();
    const expires = new Date(now.getTime() + bindingTtlMs);
    await bindingTokenKV.put(bindingTokenHash, {
      sessionKey,
      kind: "renew",
      createdAt: now,
      expiresAt: expires,
    });

    const response = {
      status: "bound" as const,
      bindingToken,
      inboxPrefix: `_INBOX.${sessionKey.slice(0, 16)}`,
      expires: expires.toISOString(),
      sentinel: sentinelCreds,
      natsServers: config.client.natsServers,
    };
    return Result.ok(response);
  };
}

export const authListSessionsHandler = async (req: UserRefFilter) => {
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

  const iter = (await sessionKV.keys(filter)).take();
  if (isErr(iter)) {
    return Result.ok({ sessions: [] });
  }

  const sessions: SessionListRow[] = [];
  for await (const key of iter) {
    const entry = (await sessionKV.get(key)).take();
    if (isErr(entry)) continue;

    const sessionKey = key.split(".")[0] ?? "";
    sessions.push({
      key: sessionActorKey(entry.value as Session, sessionKey),
      type: entry.value.type,
      createdAt: iso(entry.value.createdAt),
      lastAuth: iso(entry.value.lastAuth),
    });
  }

  return Result.ok({ sessions });
};

export function createAuthRevokeSessionHandler(opts: {
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async (req: SessionKeyRequest, { caller }: { caller: SessionContext["caller"] }) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.RevokeSession",
      targetSessionKey: req.sessionKey,
      userId: user.id,
    }, "RPC request");
    if (typeof req.sessionKey !== "string" || req.sessionKey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const sessionIter = (await sessionKV.keys(`${req.sessionKey}.>`)).take();
    if (isErr(sessionIter)) {
      return Result.ok({ success: false });
    }

    const sessionsToDelete: string[] = [];
    for await (const key of sessionIter) sessionsToDelete.push(key);
    if (sessionsToDelete.length === 0) return Result.ok({ success: false });

    const kickedBy = `${user.origin}.${user.id}`;
    const connIter = (await connectionsKV.keys(`${req.sessionKey}.>.>`)).take();
    if (!isErr(connIter)) {
      for await (const key of connIter) {
        const entry = (await connectionsKV.get(key)).take();
        if (!isErr(entry)) {
          await opts.kick(entry.value.serverId, entry.value.clientId);
        }
        await connectionsKV.delete(key);
      }
    }

    for (const sessionKeyId of sessionsToDelete) {
      const entry = (await sessionKV.get(sessionKeyId)).take();
      if (!isErr(entry)) {
        if (entry.value.type === "device") {
          continue;
        }
        (
          await trellis.publish("Auth.SessionRevoked", {
            origin: entry.value.origin,
            id: entry.value.id,
            sessionKey: req.sessionKey,
            revokedBy: kickedBy,
          })
        ).inspectErr((error) =>
          logger.warn({ error }, "Failed to publish Auth.SessionRevoked")
        );
      }
      await sessionKV.delete(sessionKeyId);
    }

    return Result.ok({ success: true });
  };
}

export const authListConnectionsHandler = async (req: SessionFilter) => {
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

  const iter = (await connectionsKV.keys(filter)).take();
  if (isErr(iter)) {
    return Result.ok({ connections: [] });
  }

  const connections: ConnectionRow[] = [];
  for await (const key of iter) {
    const entry = (await connectionsKV.get(key)).take();
    if (isErr(entry)) continue;

    const parts = key.split(".");
    const sessionKey = parts[0];
    const trellisId = parts[1];
    const userNkey = parts[2];
    if (!sessionKey || !trellisId || !userNkey) continue;

    const session = (await sessionKV.get(`${sessionKey}.${trellisId}`)).take();
    if (isErr(session)) continue;

    const sessionValue = session.value as Session;
    connections.push({
      key: sessionActorKey(sessionValue, sessionKey, userNkey),
      serverId: entry.value.serverId,
      clientId: entry.value.clientId,
      connectedAt: iso(entry.value.connectedAt),
    });
  }

  return Result.ok({ connections });
};

export function createAuthKickConnectionHandler(opts: {
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async (req: UserNkeyRequest, { caller }: { caller: SessionContext["caller"] }) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.KickConnection",
      userNkey: req.userNkey,
      userId: user.id,
    }, "RPC request");
    if (typeof req.userNkey !== "string" || req.userNkey.length === 0) {
      return Result.err(new AuthError({ reason: "invalid_request" }));
    }

    const iter = (await connectionsKV.keys(`>.>.${req.userNkey}`)).take();
    if (isErr(iter)) {
      return Result.ok({ success: false });
    }

    const kickedBy = `${user.origin}.${user.id}`;
    let kicked = false;

    for await (const key of iter) {
      const entry = (await connectionsKV.get(key)).take();
      if (!isErr(entry)) {
        await opts.kick(entry.value.serverId, entry.value.clientId);
      }

      const parts = key.split(".");
      const sessionKey = parts[0];
      const trellisId = parts[1];
      if (sessionKey && trellisId) {
        const session = (await sessionKV.get(`${sessionKey}.${trellisId}`))
          .take();
        if (!isErr(session)) {
          if (session.value.type === "device") {
            continue;
          }
          (
            await trellis.publish("Auth.ConnectionKicked", {
              origin: session.value.origin,
              id: session.value.id,
              userNkey: req.userNkey,
              kickedBy,
            })
          ).inspectErr((error) =>
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
