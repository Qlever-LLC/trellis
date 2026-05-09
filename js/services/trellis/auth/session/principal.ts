import type { Session } from "../schemas.ts";
import type { UserProjectionEntry } from "../schemas.ts";

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
    | "insufficient_permissions";
  context?: Record<string, unknown>;
};

type SessionPrincipalResult =
  | { ok: true; value: SessionPrincipal }
  | { ok: false; error: SessionPrincipalError };

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
    deviceInstanceStorage?: {
      get(instanceId: string): Promise<
        {
          instanceId: string;
          publicIdentityKey: string;
          deploymentId: string;
          state: string;
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
      const instance = await deps.deviceInstanceStorage?.get(
        session.instanceId,
      );
      if (
        !instance ||
        instance.publicIdentityKey !== session.publicIdentityKey ||
        instance.deploymentId !== session.deploymentId ||
        instance.state !== "registered" ||
        session.revokedAt !== null
      ) {
        return {
          ok: false,
          error: {
            reason: "unknown_device",
            context: { instanceId: session.instanceId },
          },
        };
      }

      const deployment = await deps.deviceDeploymentStorage?.get(
        instance.deploymentId,
      );
      if (!deployment) {
        return {
          ok: false,
          error: {
            reason: "device_deployment_not_found",
            context: { deploymentId: instance.deploymentId },
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

    const instance = await deps.deviceInstanceStorage?.get(session.instanceId);
    if (
      !instance ||
      instance.publicIdentityKey !== session.publicIdentityKey ||
      instance.deploymentId !== session.deploymentId ||
      instance.state === "disabled" ||
      instance.state === "revoked"
    ) {
      return {
        ok: false,
        error: {
          reason: "device_activation_revoked",
          context: {
            instanceId: session.instanceId,
            deploymentId: instance?.deploymentId ?? session.deploymentId,
          },
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
  if (
    !session.delegatedCapabilities.every((capability) =>
      currentCapabilities.includes(capability)
    )
  ) {
    return {
      ok: false,
      error: { reason: "insufficient_permissions" },
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
