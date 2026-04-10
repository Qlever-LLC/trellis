import { Result, isErr } from "@qlever-llc/result";
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

type AuthenticatedWorkload = {
  type: "workload";
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  active: boolean;
  capabilities: string[];
};

type AuthMeResponse = {
  user: AuthenticatedUser | null;
  workload: AuthenticatedWorkload | null;
  service: AuthenticatedService | null;
};

type SessionCaller = {
  type: string;
  id?: string;
  origin?: string;
  email?: string;
  name?: string;
  active?: boolean;
  capabilities?: string[];
  image?: string;
  lastLogin?: string;
  instanceId?: string;
  publicIdentityKey?: string;
  profileId?: string;
};

type WorkloadActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: { origin: string; id: string };
  state: "activated" | "revoked";
  activatedAt: string | Date;
  revokedAt: string | Date | null;
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

async function loadSessionBySessionKey(sessionKey: string, sessionStore: KVLike<Session>): Promise<Session | null> {
  if (!sessionStore.keys) return null;

  const keysIterResult = await sessionStore.keys(`${sessionKey}.>`);
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

async function loadAuthenticatedWorkload(args: {
  usersKV: KVLike<UserProjectionEntry>;
  workloadActivationsKV: KVLike<WorkloadActivationRecord>;
  workloadProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
  session: Session & { type: "workload" };
}): Promise<{ user: AuthenticatedUser | null; workload: AuthenticatedWorkload }> {
  const activationEntry = unwrapValue<WorkloadActivationRecord>((await args.workloadActivationsKV.get(args.session.instanceId)).take());
  if (isErr(activationEntry)) {
    throw new AuthError({ reason: "unknown_workload", context: { instanceId: args.session.instanceId } });
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
      reason: "workload_activation_revoked",
      context: { instanceId: args.session.instanceId, profileId: activation.profileId },
    });
  }

  const profileEntry = unwrapValue<{ profileId: string; disabled: boolean }>((await args.workloadProfilesKV.get(activation.profileId)).take());
  if (isErr(profileEntry)) {
    throw new AuthError({
      reason: "workload_profile_not_found",
      context: { profileId: activation.profileId },
    });
  }

  const profile = profileEntry;
  if (profile.disabled) {
    throw new AuthError({
      reason: "workload_profile_disabled",
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
    workload: {
      type: "workload",
      instanceId: args.session.instanceId,
      publicIdentityKey: args.session.publicIdentityKey,
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
      workload: null,
      service: null,
    };
  }

  if (
    caller?.type === "service" && caller.id && caller.name &&
    caller.active !== undefined
  ) {
    return {
      user: null,
      workload: null,
      service: {
        type: "service",
        id: caller.id,
        name: caller.name,
        active: caller.active,
        capabilities: caller.capabilities ?? [],
      },
    };
  }

  if (
    caller?.type === "workload" && caller.instanceId &&
    caller.publicIdentityKey && caller.profileId && caller.active !== undefined
  ) {
    return {
      user: null,
      workload: {
        type: "workload",
        instanceId: caller.instanceId,
        publicIdentityKey: caller.publicIdentityKey,
        profileId: caller.profileId,
        active: caller.active,
        capabilities: caller.capabilities ?? [],
      },
      service: null,
    };
  }

  return null;
}

async function responseFromWorkloadCaller(args: {
  caller?: SessionCaller;
  usersKV: KVLike<UserProjectionEntry>;
  workloadActivationsKV: KVLike<WorkloadActivationRecord>;
  workloadProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
}): Promise<AuthMeResponse | null> {
  if (
    args.caller?.type !== "workload" || !args.caller.instanceId ||
    !args.caller.publicIdentityKey || !args.caller.profileId ||
    args.caller.active === undefined
  ) {
    return null;
  }

  const activationEntry = unwrapValue<WorkloadActivationRecord>(
    (await args.workloadActivationsKV.get(args.caller.instanceId)).take(),
  );
  if (isErr(activationEntry)) return null;
  const activation = activationEntry;
  if (
    activation.state !== "activated" ||
    activation.profileId !== args.caller.profileId ||
    activation.revokedAt !== null
  ) {
    return null;
  }

  const profileEntry = unwrapValue<{ profileId: string; disabled: boolean }>(
    (await args.workloadProfilesKV.get(activation.profileId)).take(),
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
    workload: {
      type: "workload",
      instanceId: args.caller.instanceId,
      publicIdentityKey: args.caller.publicIdentityKey,
      profileId: args.caller.profileId,
      active: args.caller.active,
      capabilities: args.caller.capabilities ?? [],
    },
    service: null,
  };
}

export function createAuthMeHandler(deps: {
  sessionKV: KVLike<Session>;
  usersKV: KVLike<UserProjectionEntry>;
  servicesKV: KVLike<ServiceRegistryEntry>;
  workloadActivationsKV: KVLike<WorkloadActivationRecord>;
  workloadProfilesKV: KVLike<{ profileId: string; disabled: boolean }>;
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
        const workloadCallerResponse = await responseFromWorkloadCaller({
          caller,
          usersKV: deps.usersKV,
          workloadActivationsKV: deps.workloadActivationsKV,
          workloadProfilesKV: deps.workloadProfilesKV,
        });
        if (workloadCallerResponse) {
          return Result.ok<AuthMeResponse>(workloadCallerResponse);
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
        return Result.ok<AuthMeResponse>({ user, workload: null, service: null });
      }

      if (session.type === "service") {
        const service = await loadAuthenticatedService({
          servicesKV: deps.servicesKV,
          sessionKey,
          session: session as Session & { type: "service" },
        });
        return Result.ok<AuthMeResponse>({ user: null, workload: null, service });
      }

      const { user, workload } = await loadAuthenticatedWorkload({
        usersKV: deps.usersKV,
        workloadActivationsKV: deps.workloadActivationsKV,
        workloadProfilesKV: deps.workloadProfilesKV,
        session: session as Session & { type: "workload" },
      });
      return Result.ok<AuthMeResponse>({ user, workload, service: null });
    } catch (error) {
      if (error instanceof AuthError) return Result.err(error);
      throw error;
    }
  };
}
