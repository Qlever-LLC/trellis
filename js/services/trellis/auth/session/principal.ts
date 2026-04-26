import type {
  ContractApprovalRecord,
  InstanceGrantPolicy,
  Session,
  UserProjectionEntry,
} from "../../state/schemas.ts";
import {
  effectiveApproval,
  effectiveCapabilities,
  matchingInstanceGrantPolicies,
  userDelegationAllowed,
} from "../grants/policy.ts";

export type SessionPrincipal = {
  active: boolean;
  capabilities: string[];
  email: string;
  name: string;
  serviceState?: {
    instanceId: string;
    profileId: string;
    instanceKey: string;
    disabled: boolean;
    currentContractId?: string;
    currentContractDigest?: string;
    capabilities: string[];
    resourceBindings?: Record<string, unknown>;
  };
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

function hasAllCapabilities(granted: string[], required: string[]): boolean {
  return required.every((capability) => granted.includes(capability));
}

function hasServiceOnlyCapability(capabilities: string[]): boolean {
  return capabilities.some((capability) =>
    capability === "service" || capability.startsWith("service:")
  );
}

export async function resolveSessionPrincipal(
  session: Session,
  sessionKey: string,
  deps: {
    loadServiceInstance?: (instanceKey: string) => Promise<
      {
        instanceId: string;
        profileId: string;
        instanceKey: string;
        disabled: boolean;
        currentContractId?: string;
        currentContractDigest?: string;
        capabilities: string[];
        resourceBindings?: Record<string, unknown>;
      } | null
    >;
    loadServiceProfile?: (
      profileId: string,
    ) => Promise<{ profileId: string; disabled: boolean } | null>;
    deviceActivationStorage?: {
      get(instanceId: string): Promise<
        {
          instanceId: string;
          publicIdentityKey: string;
          profileId: string;
          state: string;
          revokedAt: string | Date | null;
        } | undefined
      >;
    };
    deviceProfileStorage?: {
      get(profileId: string): Promise<
        {
          profileId: string;
          disabled: boolean;
        } | undefined
      >;
    };
    loadUserProjection: (
      trellisId: string,
    ) => Promise<UserProjectionEntry | null>;
    loadStoredApproval?: (
      key: string,
    ) => Promise<ContractApprovalRecord | null>;
    loadInstanceGrantPolicies?: (
      contractId: string,
    ) => Promise<InstanceGrantPolicy[]>;
  },
): Promise<SessionPrincipalResult> {
  if (session.type === "service") {
    const service = await deps.loadServiceInstance?.(sessionKey);
    if (!service) {
      return {
        ok: false,
        error: { reason: "unknown_service", context: { sessionKey } },
      };
    }
    if (service.disabled) {
      return {
        ok: false,
        error: {
          reason: "service_disabled",
          context: { instanceId: service.instanceId, sessionKey },
        },
      };
    }

    const profile = await deps.loadServiceProfile?.(service.profileId);
    if (!profile || profile.disabled) {
      return {
        ok: false,
        error: {
          reason: "service_disabled",
          context: { profileId: service.profileId, sessionKey },
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
    const activation = await deps.deviceActivationStorage?.get(
      session.instanceId,
    );
    if (!activation) {
      return {
        ok: false,
        error: {
          reason: "unknown_device",
          context: { instanceId: session.instanceId },
        },
      };
    }

    const revokedAt = activation.revokedAt instanceof Date
      ? activation.revokedAt
      : activation.revokedAt
      ? new Date(activation.revokedAt)
      : null;
    if (
      activation.state !== "activated" ||
      activation.publicIdentityKey !== session.publicIdentityKey ||
      activation.profileId !== session.profileId ||
      revokedAt !== null ||
      session.revokedAt !== null
    ) {
      return {
        ok: false,
        error: {
          reason: "device_activation_revoked",
          context: {
            instanceId: session.instanceId,
            profileId: activation.profileId,
          },
        },
      };
    }

    const profile = await deps.deviceProfileStorage?.get(activation.profileId);
    if (!profile) {
      return {
        ok: false,
        error: {
          reason: "device_profile_not_found",
          context: { profileId: activation.profileId },
        },
      };
    }

    if (profile.disabled) {
      return {
        ok: false,
        error: {
          reason: "device_profile_disabled",
          context: { profileId: profile.profileId },
        },
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

  const projection = await deps.loadUserProjection(session.trellisId);
  if (projection === null) {
    return {
      ok: false,
      error: {
        reason: "user_not_found",
        context: { origin: session.origin, id: session.id },
      },
    };
  }

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
  const matchedPolicies = matchingInstanceGrantPolicies({
    policies: await (deps.loadInstanceGrantPolicies?.(session.contractId) ??
      Promise.resolve([])),
    contractId: session.contractId,
    appOrigin: session.app?.origin ?? session.appOrigin,
  });
  const storedApproval = deps.loadStoredApproval
    ? await deps.loadStoredApproval(
      `${session.trellisId}.${session.contractDigest}`,
    )
    : null;
  const resolvedCapabilities = effectiveCapabilities({
    explicitCapabilities: currentCapabilities,
    matchedPolicies,
  });
  const resolvedApproval = effectiveApproval({
    storedApproval,
    matchedPolicies,
  });
  if (
    !userDelegationAllowed({
      active: projection.active,
      explicitCapabilities: currentCapabilities,
      delegatedCapabilities: session.delegatedCapabilities,
      storedApproval,
      matchedPolicies,
    })
  ) {
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
