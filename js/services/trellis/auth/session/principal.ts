import { isErr } from "@qlever-llc/result";
import type {
  ServiceRegistryEntry,
  Session,
  UserProjectionEntry,
} from "../../state/schemas.ts";

type KVResult<T> = { take(): T };

type KVLike<V> = {
  get: (key: string) => Promise<KVResult<{ value: V } | V | unknown>>;
  keys?: (filter: string) => Promise<KVResult<AsyncIterable<string> | unknown>>;
};

export type SessionPrincipal = {
  active: boolean;
  capabilities: string[];
  email: string;
  name: string;
  serviceState?: ServiceRegistryEntry;
};

export type SessionPrincipalError = {
  reason:
    | "unknown_service"
    | "service_disabled"
    | "unknown_device"
    | "device_activation_revoked"
    | "device_profile_not_found"
    | "device_profile_disabled"
    | "user_not_found"
    | "user_inactive"
    | "insufficient_permissions"
    | "service_role_on_user";
  context?: Record<string, unknown>;
};

type SessionPrincipalResult =
  | { ok: true; value: SessionPrincipal }
  | { ok: false; error: SessionPrincipalError };

function unwrapValue<V>(entry: { value: V } | V): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return (entry as { value: V }).value;
  }
  return entry as V;
}

function hasAllCapabilities(granted: string[], required: string[]): boolean {
  return required.every((capability) => granted.includes(capability));
}

function hasServiceOnlyCapability(capabilities: string[]): boolean {
  return capabilities.some((capability) => capability === "service" || capability.startsWith("service:"));
}

export async function resolveSessionPrincipal(
  session: Session,
  sessionKey: string,
  deps: {
    servicesKV: KVLike<ServiceRegistryEntry>;
    deviceActivationsKV?: KVLike<{ instanceId: string; publicIdentityKey: string; profileId: string; state: string; revokedAt: string | Date | null }>;
    deviceProfilesKV?: KVLike<{ profileId: string; disabled: boolean }>;
    usersKV: KVLike<UserProjectionEntry>;
  },
): Promise<SessionPrincipalResult> {
  if (session.type === "service") {
    const serviceEntry = (await deps.servicesKV.get(sessionKey)).take();
    if (isErr(serviceEntry)) {
      return {
        ok: false,
        error: { reason: "unknown_service", context: { sessionKey } },
      };
    }

    const service = unwrapValue(serviceEntry as { value: ServiceRegistryEntry } | ServiceRegistryEntry);
    if (!service.active) {
      return {
        ok: false,
        error: {
          reason: "service_disabled",
          context: { service: service.displayName, sessionKey },
        },
      };
    }

    return {
      ok: true,
      value: {
        active: true,
        capabilities: service.capabilities ?? [],
        email: session.email,
        name: session.name,
        serviceState: service,
      },
    };
  }

  if (session.type === "device") {
    const activationEntry = deps.deviceActivationsKV
      ? (await deps.deviceActivationsKV.get(session.instanceId)).take()
      : null;
    if (!activationEntry || isErr(activationEntry)) {
      return {
        ok: false,
          error: { reason: "unknown_device", context: { instanceId: session.instanceId } },
      };
    }

    const activation = unwrapValue(activationEntry as {
      value: { instanceId: string; publicIdentityKey: string; profileId: string; state: string; revokedAt: string | Date | null };
    } | { instanceId: string; publicIdentityKey: string; profileId: string; state: string; revokedAt: string | Date | null });
    const revokedAt = activation.revokedAt instanceof Date
      ? activation.revokedAt
      : activation.revokedAt
      ? new Date(activation.revokedAt)
      : null;
    if (
      activation.state !== "activated" ||
      activation.profileId !== session.profileId ||
      revokedAt !== null ||
      session.revokedAt !== null
    ) {
      return {
        ok: false,
        error: {
          reason: "device_activation_revoked",
          context: { instanceId: session.instanceId, profileId: activation.profileId },
        },
      };
    }

    const profileEntry = deps.deviceProfilesKV
      ? (await deps.deviceProfilesKV.get(activation.profileId)).take()
      : null;
    if (!profileEntry || isErr(profileEntry)) {
      return {
        ok: false,
          error: { reason: "device_profile_not_found", context: { profileId: activation.profileId } },
      };
    }

    const profile = unwrapValue(profileEntry as { value: { profileId: string; disabled: boolean } } | { profileId: string; disabled: boolean });
    if (profile.disabled) {
      return {
        ok: false,
          error: { reason: "device_profile_disabled", context: { profileId: profile.profileId } },
      };
    }

    return {
      ok: true,
      value: {
        active: true,
        capabilities: session.delegatedCapabilities,
        email: `device:${session.instanceId}`,
        name: session.instanceId,
      },
    };
  }

  const projectionEntry = (await deps.usersKV.get(session.trellisId)).take();
  if (isErr(projectionEntry)) {
    return {
      ok: false,
      error: {
        reason: "user_not_found",
        context: { origin: session.origin, id: session.id },
      },
    };
  }

  const projection = unwrapValue(
    projectionEntry as { value: UserProjectionEntry } | UserProjectionEntry,
  );
  if (!projection.active) {
    return {
      ok: false,
      error: {
        reason: "user_inactive",
        context: { origin: session.origin, id: session.id },
      },
    };
  }

  const currentCapabilities = projection.capabilities ?? [];
  if (!hasAllCapabilities(currentCapabilities, session.delegatedCapabilities)) {
    return {
      ok: false,
      error: { reason: "insufficient_permissions" },
    };
  }

  if (hasServiceOnlyCapability(session.delegatedCapabilities)) {
    return {
      ok: false,
      error: { reason: "service_role_on_user" },
    };
  }

  return {
    ok: true,
    value: {
      active: true,
      capabilities: session.delegatedCapabilities,
      email: session.email,
      name: session.name,
    },
  };
}
