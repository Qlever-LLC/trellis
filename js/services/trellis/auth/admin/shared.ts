import { AuthError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { sha256Base64urlSync } from "../../../../packages/trellis/contract_support/canonical.ts";

export type Portal = {
  portalId: string;
  appContractId?: string;
  entryUrl: string;
  disabled: boolean;
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
  source: {
    kind: "admin_policy";
    createdBy?: InstanceGrantPolicyActor;
    updatedBy?: InstanceGrantPolicyActor;
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
  profileId: string;
  portalId: string | null;
};

export type AppliedProfileContract = {
  contractId: string;
  allowedDigests: string[];
};

export type ServiceProfile = {
  profileId: string;
  namespaces: string[];
  disabled: boolean;
  appliedContracts: AppliedProfileContract[];
};

export type ServiceInstance = {
  instanceId: string;
  profileId: string;
  instanceKey: string;
  disabled: boolean;
  currentContractId?: string;
  currentContractDigest?: string;
  capabilities: string[];
  resourceBindings?: Record<string, unknown>;
  createdAt: string;
};

export type DeviceProfile = {
  profileId: string;
  reviewMode?: "none" | "required";
  disabled: boolean;
  appliedContracts: AppliedProfileContract[];
};

export type DeviceProvisioningSecret = {
  instanceId: string;
  activationKey: string;
  createdAt: string | Date;
};

export type DeviceMetadata = Record<string, string>;

export type DeviceActivationReview = {
  reviewId: string;
  linkRequestId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
  reason?: string;
};

export type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
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
  appContractId?: string;
  entryUrl: string;
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
  profileId: string;
  portalId: string | null;
};

export type CreateDeviceProfileRequest = {
  profileId: string;
  reviewMode?: "none" | "required";
};

export type CreateServiceProfileRequest = {
  profileId: string;
  namespaces: string[];
};

export type DeviceActivationActor = {
  origin: string;
  id: string;
};

export type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: DeviceActivationActor;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

export type ProvisionDeviceInstanceRequest = {
  profileId: string;
  publicIdentityKey: string;
  activationKey: string;
  metadata?: DeviceMetadata;
};

export type ProvisionServiceInstanceRequest = {
  profileId: string;
  instanceKey: string;
};

function invalidRequest(context?: Record<string, unknown>) {
  return Result.err(new AuthError({ reason: "invalid_request", context }));
}

function parseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
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
  values: AppliedProfileContract[],
): AppliedProfileContract[] {
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
    return new URL(value).origin;
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
  if (req.appContractId !== undefined && req.appContractId.length === 0) {
    return invalidRequest({ appContractId: req.appContractId });
  }
  return Result.ok({
    portal: {
      portalId: req.portalId,
      appContractId: req.appContractId,
      entryUrl,
      disabled: false,
    } as Portal,
  });
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
    !req.profileId ||
    (req.portalId !== null && (!req.portalId || req.portalId.length === 0))
  ) {
    return invalidRequest({ profileId: req.profileId, portalId: req.portalId });
  }
  return Result.ok({
    selection: {
      profileId: req.profileId,
      portalId: req.portalId,
    } as DevicePortalSelection,
  });
}

export function validateDeviceProfileRequest(req: CreateDeviceProfileRequest) {
  if (!req.profileId) {
    return invalidRequest({ profileId: req.profileId });
  }
  return Result.ok({
    profile: {
      profileId: req.profileId,
      reviewMode: req.reviewMode,
      disabled: false,
      appliedContracts: [],
    } as DeviceProfile,
  });
}

export function validateServiceProfileRequest(
  req: CreateServiceProfileRequest,
) {
  if (!req.profileId) {
    return invalidRequest({ profileId: req.profileId });
  }
  return Result.ok({
    profile: {
      profileId: req.profileId,
      namespaces: normalizeStringList(req.namespaces ?? []),
      disabled: false,
      appliedContracts: [],
    } as ServiceProfile,
  });
}

export function validateDeviceProvisionRequest(
  req: ProvisionDeviceInstanceRequest,
) {
  if (!req.profileId || !req.publicIdentityKey || !req.activationKey) {
    return invalidRequest({
      profileId: req.profileId,
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
      profileId: req.profileId,
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
  if (!req.profileId || !req.instanceKey) {
    return invalidRequest({
      profileId: req.profileId,
      instanceKey: req.instanceKey,
    });
  }
  const now = new Date().toISOString();
  return Result.ok({
    instance: {
      instanceId: serviceInstanceId(req.instanceKey),
      profileId: req.profileId,
      instanceKey: req.instanceKey,
      disabled: false,
      capabilities: ["service"],
      createdAt: now,
    } as ServiceInstance,
  });
}
