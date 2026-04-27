import { AuthError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { sha256Base64urlSync } from "../../../../packages/trellis/contract_support/canonical.ts";

export type Portal = {
  portalId: string;
  entryUrl: string;
  disabled: boolean;
};

export type PortalProfile = {
  portalId: string;
  entryUrl: string;
  contractId: string;
  allowedOrigins?: string[];
  impliedCapabilities: string[];
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InstanceGrantPolicyActor = {
  origin: string;
  id: string;
};

export type InstanceGrantPolicy = {
  contractId: string;
  allowedOrigins?: string[];
  impliedCapabilities: string[];
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  source:
    | {
      kind: "admin_policy";
      createdBy?: InstanceGrantPolicyActor;
      updatedBy?: InstanceGrantPolicyActor;
    }
    | {
      kind: "portal_profile";
      portalId: string;
      entryUrl: string;
    };
};

export type PortalDefault = {
  portalId: string | null;
};

export type LoginPortalSelection = {
  contractId: string;
  portalId: string | null;
};

export type DevicePortalSelection = {
  deploymentId: string;
  portalId: string | null;
};

export type AppliedDeploymentContract = {
  contractId: string;
  allowedDigests: string[];
};

export type ServiceDeployment = {
  deploymentId: string;
  namespaces: string[];
  disabled: boolean;
  appliedContracts: AppliedDeploymentContract[];
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

export type InstalledServiceDeploymentContract = {
  id: string;
  digest: string;
  usedNamespaces: string[];
};

export type DeviceDeployment = {
  deploymentId: string;
  reviewMode?: "none" | "required";
  disabled: boolean;
  appliedContracts: AppliedDeploymentContract[];
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
  currentContractId?: string;
  currentContractDigest?: string;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

export type CreatePortalRequest = {
  portalId: string;
  entryUrl: string;
};

export type SetPortalProfileRequest = {
  portalId: string;
  entryUrl: string;
  contractId: string;
  allowedOrigins?: string[];
};

export type PortalDefaultRequest = {
  portalId: string | null;
};

export type LoginPortalSelectionRequest = {
  contractId: string;
  portalId: string | null;
};

export type UpsertInstanceGrantPolicyRequest = {
  contractId: string;
  allowedOrigins?: string[];
  impliedCapabilities: string[];
};

export type DevicePortalSelectionRequest = {
  deploymentId: string;
  portalId: string | null;
};

export type CreateDeviceDeploymentRequest = {
  deploymentId: string;
  reviewMode?: "none" | "required";
};

export type CreateServiceDeploymentRequest = {
  deploymentId: string;
  namespaces: string[];
};

export type DeviceActivationActor = {
  origin: string;
  id: string;
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

function isAllowedWebProtocol(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}

function parseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return isAllowedWebProtocol(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function deviceInstanceId(instanceKey: string): string {
  return `dev_${sha256Base64urlSync(instanceKey).slice(0, 22)}`;
}

export function serviceInstanceId(instanceKey: string): string {
  return `svc_${sha256Base64urlSync(instanceKey).slice(0, 22)}`;
}

export function normalizeDigestList(values: string[]): string[] {
  return normalizeStringList(values);
}

export function normalizeAppliedContracts(
  values: AppliedDeploymentContract[],
): AppliedDeploymentContract[] {
  const byId = new Map<string, Set<string>>();
  for (const value of values) {
    if (!value.contractId) continue;
    const digests = byId.get(value.contractId) ?? new Set<string>();
    for (const digest of normalizeDigestList(value.allowedDigests ?? [])) {
      digests.add(digest);
    }
    byId.set(value.contractId, digests);
  }
  return [...byId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contractId, digests]) => ({
      contractId,
      allowedDigests: [...digests].sort((left, right) =>
        left.localeCompare(right)
      ),
    }));
}

/** Builds the persisted service deployment state after applying a contract. */
export function applyInstalledServiceDeploymentContract(
  deployment: ServiceDeployment,
  installed: InstalledServiceDeploymentContract,
): ServiceDeployment {
  return {
    ...deployment,
    namespaces: [
      ...new Set([...deployment.namespaces, ...installed.usedNamespaces]),
    ]
      .sort((left, right) => left.localeCompare(right)),
    appliedContracts: normalizeAppliedContracts([
      ...deployment.appliedContracts,
      { contractId: installed.id, allowedDigests: [installed.digest] },
    ]),
  };
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

function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return isAllowedWebProtocol(url) ? url.origin : null;
  } catch {
    return null;
  }
}

export function validateInstanceGrantPolicyRequest(
  req: UpsertInstanceGrantPolicyRequest,
) {
  if (!req.contractId) {
    return invalidRequest({ contractId: req.contractId });
  }
  const impliedCapabilities = normalizeStringList(
    req.impliedCapabilities ?? [],
  );
  const allowedOrigins = req.allowedOrigins === undefined ? undefined : (() => {
    const normalized = [] as string[];
    for (const value of req.allowedOrigins) {
      const origin = parseOrigin(value);
      if (!origin) return null;
      normalized.push(origin);
    }
    const uniqueOrigins = normalizeStringList(normalized);
    return uniqueOrigins.length > 0 ? uniqueOrigins : undefined;
  })();
  if (allowedOrigins === null) {
    return invalidRequest({ allowedOrigins: req.allowedOrigins });
  }

  return Result.ok({
    policy: {
      contractId: req.contractId,
      ...(allowedOrigins ? { allowedOrigins } : {}),
      impliedCapabilities,
    },
  });
}

export function validatePortalRequest(req: CreatePortalRequest) {
  const entryUrl = parseUrl(req.entryUrl);
  if (!req.portalId || !entryUrl) {
    return invalidRequest({ portalId: req.portalId, entryUrl: req.entryUrl });
  }
  const portal: Portal = {
    portalId: req.portalId,
    entryUrl,
    disabled: false,
  };
  return Result.ok({
    portal,
  });
}

export function validatePortalProfileRequest(req: SetPortalProfileRequest) {
  const entryUrl = parseUrl(req.entryUrl);
  if (!req.portalId || !entryUrl || !req.contractId) {
    return invalidRequest({
      portalId: req.portalId,
      entryUrl: req.entryUrl,
      contractId: req.contractId,
    });
  }
  const allowedOrigins = req.allowedOrigins === undefined ? undefined : (() => {
    const normalized = [] as string[];
    for (const value of req.allowedOrigins) {
      const origin = parseOrigin(value);
      if (!origin) return null;
      normalized.push(origin);
    }
    const uniqueOrigins = normalizeStringList(normalized);
    return uniqueOrigins.length > 0 ? uniqueOrigins : undefined;
  })();
  if (allowedOrigins === null) {
    return invalidRequest({ allowedOrigins: req.allowedOrigins });
  }

  const profile: Pick<
    PortalProfile,
    "portalId" | "entryUrl" | "contractId" | "allowedOrigins"
  > = {
    portalId: req.portalId,
    entryUrl,
    contractId: req.contractId,
    allowedOrigins,
  };

  return Result.ok({ profile });
}

export function validatePortalDefaultRequest(req: PortalDefaultRequest) {
  if (req.portalId !== null && (!req.portalId || req.portalId.length === 0)) {
    return invalidRequest({ portalId: req.portalId });
  }
  return Result.ok({
    defaultPortal: {
      portalId: req.portalId,
    } as PortalDefault,
  });
}

export function validateLoginPortalSelectionRequest(
  req: LoginPortalSelectionRequest,
) {
  if (
    !req.contractId ||
    (req.portalId !== null && (!req.portalId || req.portalId.length === 0))
  ) {
    return invalidRequest({
      contractId: req.contractId,
      portalId: req.portalId,
    });
  }
  return Result.ok({
    selection: {
      contractId: req.contractId,
      portalId: req.portalId,
    } as LoginPortalSelection,
  });
}

export function validateDevicePortalSelectionRequest(
  req: DevicePortalSelectionRequest,
) {
  if (
    !req.deploymentId ||
    (req.portalId !== null && (!req.portalId || req.portalId.length === 0))
  ) {
    return invalidRequest({
      deploymentId: req.deploymentId,
      portalId: req.portalId,
    });
  }
  return Result.ok({
    selection: {
      deploymentId: req.deploymentId,
      portalId: req.portalId,
    } as DevicePortalSelection,
  });
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
      appliedContracts: [],
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
      disabled: false,
      appliedContracts: [],
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
      currentContractId: undefined,
      currentContractDigest: undefined,
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
