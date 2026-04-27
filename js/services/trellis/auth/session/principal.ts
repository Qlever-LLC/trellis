import type {
  ContractApprovalRecord,
  InstanceGrantPolicy,
  Session,
} from "../schemas.ts";
import type { UserProjectionEntry } from "../schemas.ts";
import {
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
    deploymentId: string;
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
    | "device_deployment_not_found"
    | "device_deployment_disabled"
    | "user_not_found"
    | "user_inactive"
    | "insufficient_permissions"
    | "service_role_on_user";
  context?: Record<string, unknown>;
};

type SessionPrincipalResult =
  | { ok: true; value: SessionPrincipal }
  | { ok: false; error: SessionPrincipalError };

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
        deploymentId: string;
        instanceKey: string;
        disabled: boolean;
        currentContractId?: string;
        currentContractDigest?: string;
        capabilities: string[];
        resourceBindings?: Record<string, unknown>;
      } | null
    >;
    loadServiceDeployment?: (
      deploymentId: string,
    ) => Promise<{ deploymentId: string; disabled: boolean } | null>;
    deviceActivationStorage?: {
      get(instanceId: string): Promise<
        {
          instanceId: string;
          publicIdentityKey: string;
          deploymentId: string;
          state: string;
          revokedAt: string | Date | null;
        } | undefined
      >;
    };
    deviceDeploymentStorage?: {
      get(deploymentId: string): Promise<
        {
          deploymentId: string;
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

    const deployment = await deps.loadServiceDeployment?.(service.deploymentId);
    if (!deployment || deployment.disabled) {
      return {
        ok: false,
        error: {
          reason: "service_disabled",
          context: { deploymentId: service.deploymentId, sessionKey },
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
      activation.deploymentId !== session.deploymentId ||
      revokedAt !== null ||
      session.revokedAt !== null
    ) {
      return {
        ok: false,
        error: {
          reason: "device_activation_revoked",
          context: {
            instanceId: session.instanceId,
            deploymentId: activation.deploymentId,
          },
        },
      };
    }

    const deployment = await deps.deviceDeploymentStorage?.get(
      activation.deploymentId,
    );
    if (!deployment) {
      return {
        ok: false,
        error: {
          reason: "device_deployment_not_found",
          context: { deploymentId: activation.deploymentId },
        },
      };
    }

    if (deployment.disabled) {
      return {
        ok: false,
        error: {
          reason: "device_deployment_disabled",
          context: { deploymentId: deployment.deploymentId },
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
    appOrigin: session.app?.origin,
  });
  const storedApproval = deps.loadStoredApproval
    ? await deps.loadStoredApproval(
      `${session.trellisId}.${session.contractDigest}`,
    )
    : null;
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
