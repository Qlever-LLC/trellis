import { type AsyncResult, type BaseError, Result, isErr } from "@qlever-llc/result";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { AuthError } from "../../../../packages/trellis/errors/AuthError.ts";

import type {
  ServiceRegistryEntry,
  Session,
  UserProjectionEntry,
} from "../../state/schemas.ts";

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

type SessionCaller = {
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

type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: { origin: string; id: string };
  state: "activated" | "revoked";
  activatedAt: string | Date;
  revokedAt: string | Date | null;
};

function deviceTypeFromProfileId(profileId: string): string {
  const [deviceType] = profileId.split(".", 1);
  return deviceType && deviceType.length > 0 ? deviceType : profileId;
}

function deviceCallerFields(caller?: SessionCaller): {
  deviceId: string;
  profileId: string;
  runtimePublicKey: string;
  active: boolean;
  capabilities: string[];
} | null {
  if (
    caller?.type !== "device" || !caller.deviceId || !caller.runtimePublicKey ||
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

type KVLike<V> = {
  get: (key: string) => AsyncResult<{ value: V } | V | unknown, BaseError>;
  keys?: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
};

async function takeValue<T>(
  value: AsyncResult<T, BaseError>,
): Promise<T | Result<never, BaseError>> {
  return await value.take();
}

function unwrapValue<V>(entry: unknown): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return (entry as { value: V }).value;
  }
  return entry as V;
}

async function loadSessionBySessionKey(sessionKey: string, sessionStore: KVLike<Session>): Promise<Session | null> {
  if (!sessionStore.keys) return null;

  const keysIter = unwrapValue<AsyncIterable<string>>(await takeValue(sessionStore.keys(`${sessionKey}.>`)));
  if (isErr(keysIter)) return null;

  let sessionKeyId: string | undefined;
  for await (const key of keysIter as AsyncIterable<string>) {
    if (!sessionKeyId) sessionKeyId = key;
    else {
      throw new AuthError({ reason: "session_corrupted", context: { sessionKey } });
    }
  }

  if (!sessionKeyId) return null;
  const sessionValue = unwrapValue<Session>(await takeValue(sessionStore.get(sessionKeyId)));
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
  const projectionEntry = unwrapValue<UserProjectionEntry>(await takeValue(args.usersKV.get(trellisId)));
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
  const serviceEntry = unwrapValue<ServiceRegistryEntry>(await takeValue(args.servicesKV.get(args.sessionKey)));
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
  const activationEntry = unwrapValue<DeviceActivationRecord>(await takeValue(args.deviceActivationsKV.get(args.session.instanceId)));
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

  const profileEntry = unwrapValue<{ profileId: string; disabled: boolean }>(await takeValue(args.deviceProfilesKV.get(activation.profileId)));
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

function responseFromCaller(caller?: SessionCaller): AuthMeResponse | null {
  if (
    caller?.type === "user" && caller.id && caller.origin && caller.email &&
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
    caller?.type === "service" && caller.id && caller.name &&
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
  caller?: SessionCaller;
  usersKV: KVLike<UserProjectionEntry>;
  deviceActivationsKV: KVLike<DeviceActivationRecord>;
  deviceProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
}): Promise<AuthMeResponse | null> {
  const deviceCaller = deviceCallerFields(args.caller);
  if (!deviceCaller) {
    return null;
  }

  const activationEntry = unwrapValue<DeviceActivationRecord>(
    await takeValue(args.deviceActivationsKV.get(deviceCaller.deviceId)),
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
    await takeValue(args.deviceProfilesKV.get(activation.profileId)),
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

export function createAuthMeHandler(deps: {
  sessionKV: KVLike<Session>;
  usersKV: KVLike<UserProjectionEntry>;
  servicesKV: KVLike<ServiceRegistryEntry>;
  deviceActivationsKV: KVLike<DeviceActivationRecord>;
  deviceProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
}) {
  return async (
    _req: unknown,
    { sessionKey, caller }: { sessionKey: string; caller?: SessionCaller },
  ) => {
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
        return Result.ok<AuthMeResponse>({
          participantKind: session.participantKind,
          user,
          device: null,
          service: null,
        });
      }

      if (session.type === "service") {
        const service = await loadAuthenticatedService({
          servicesKV: deps.servicesKV,
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
