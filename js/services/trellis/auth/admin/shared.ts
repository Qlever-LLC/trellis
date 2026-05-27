import { AuthError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { sha256Base64urlSync } from "../../../../packages/trellis/contract_support/canonical.ts";

export type ServiceDeployment = {
  deploymentId: string;
  namespaces: string[];
  contractCompatibilityMode?: "strict" | "mutable-dev";
  disabled: boolean;
};

export type ServiceInstance = {
  instanceId: string;
  deploymentId: string;
  instanceKey: string;
  disabled: boolean;
  currentContractId?: string;
  currentContractDigest?: string;
  capabilities: string[];
  resourceBindings?: Record<string, unknown>;
  createdAt: string;
};

export type DeviceDeployment = {
  deploymentId: string;
  reviewMode?: "none" | "required";
  disabled: boolean;
};

export type DeviceProvisioningSecret = {
  instanceId: string;
  activationKey: string;
  createdAt: string | Date;
};

export type DeviceMetadata = Record<string, string>;

export type DeviceActivationReview = {
  reviewId: string;
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
  reason?: string;
};

export type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  metadata?: DeviceMetadata;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

export type CreateDeviceDeploymentRequest = {
  deploymentId: string;
  reviewMode?: "none" | "required";
};

export type CreateServiceDeploymentRequest = {
  deploymentId: string;
  namespaces: string[];
  contractCompatibilityMode?: "strict" | "mutable-dev";
};

export type DeviceActivationActor = {
  participantKind: "app" | "agent";
  userId: string;
  identity: {
    identityId: string;
    provider: string;
    subject: string;
  };
};

export type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  activatedBy?: DeviceActivationActor;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

export type AdminCaller = {
  type?: string;
  capabilities?: string[];
};

/** Requires an admin user caller. */
export function requireAdmin(caller: AdminCaller) {
  if (caller.type !== "user" || !caller.capabilities?.includes("admin")) {
    return Result.err(new AuthError({ reason: "insufficient_permissions" }));
  }

  return Result.ok(undefined);
}

export type ProvisionDeviceInstanceRequest = {
  deploymentId: string;
  publicIdentityKey: string;
  activationKey: string;
  metadata?: DeviceMetadata;
};

export type ProvisionServiceInstanceRequest = {
  deploymentId: string;
  instanceKey: string;
};

function invalidRequest(context?: Record<string, unknown>) {
  return Result.err(new AuthError({ reason: "invalid_request", context }));
}

export function deviceInstanceId(instanceKey: string): string {
  return `dev_${sha256Base64urlSync(instanceKey).slice(0, 22)}`;
}

export function serviceInstanceId(instanceKey: string): string {
  return `svc_${sha256Base64urlSync(instanceKey).slice(0, 22)}`;
}

export function normalizeStringList(values: string[]): string[] {
  const digests: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    digests.push(value);
  }
  return digests;
}

export function validateDeviceDeploymentRequest(
  req: CreateDeviceDeploymentRequest,
) {
  if (!req.deploymentId) {
    return invalidRequest({ deploymentId: req.deploymentId });
  }
  return Result.ok({
    deployment: {
      deploymentId: req.deploymentId,
      reviewMode: req.reviewMode,
      disabled: false,
    } as DeviceDeployment,
  });
}

export function validateServiceDeploymentRequest(
  req: CreateServiceDeploymentRequest,
) {
  if (!req.deploymentId) {
    return invalidRequest({ deploymentId: req.deploymentId });
  }
  return Result.ok({
    deployment: {
      deploymentId: req.deploymentId,
      namespaces: normalizeStringList(req.namespaces ?? []),
      contractCompatibilityMode: req.contractCompatibilityMode ?? "strict",
      disabled: false,
    } as ServiceDeployment,
  });
}

export function validateDeviceProvisionRequest(
  req: ProvisionDeviceInstanceRequest,
) {
  if (!req.deploymentId || !req.publicIdentityKey || !req.activationKey) {
    return invalidRequest({
      deploymentId: req.deploymentId,
      publicIdentityKey: req.publicIdentityKey,
      activationKey: req.activationKey,
    });
  }
  if (req.metadata) {
    for (const [key, value] of Object.entries(req.metadata)) {
      if (key.length === 0 || value.length === 0) {
        return invalidRequest({
          metadata: req.metadata,
          reason: "invalid_device_metadata",
        });
      }
    }
  }
  const now = new Date().toISOString();
  return Result.ok({
    instance: {
      instanceId: deviceInstanceId(req.publicIdentityKey),
      publicIdentityKey: req.publicIdentityKey,
      deploymentId: req.deploymentId,
      ...(req.metadata ? { metadata: { ...req.metadata } } : {}),
      state: "registered",
      createdAt: now,
      activatedAt: null,
      revokedAt: null,
    } as DeviceInstance,
    provisioningSecret: {
      instanceId: deviceInstanceId(req.publicIdentityKey),
      activationKey: req.activationKey,
      createdAt: now,
    } as DeviceProvisioningSecret,
  });
}

export function validateServiceProvisionRequest(
  req: ProvisionServiceInstanceRequest,
) {
  if (!req.deploymentId || !req.instanceKey) {
    return invalidRequest({
      deploymentId: req.deploymentId,
      instanceKey: req.instanceKey,
    });
  }
  const now = new Date().toISOString();
  return Result.ok({
    instance: {
      instanceId: serviceInstanceId(req.instanceKey),
      deploymentId: req.deploymentId,
      instanceKey: req.instanceKey,
      disabled: false,
      capabilities: ["service"],
      createdAt: now,
    } as ServiceInstance,
  });
}
