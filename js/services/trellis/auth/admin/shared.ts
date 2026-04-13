import { AuthError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { sha256Base64urlSync } from "../../../../packages/contracts/canonical.ts";

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

export type DeviceProfile = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
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
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
  contract?: object;
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

export function deviceInstanceId(publicIdentityKey: string): string {
  return `dev_${sha256Base64urlSync(publicIdentityKey).slice(0, 22)}`;
}

export function normalizeDigestList(values: string[]): string[] {
  return normalizeStringList(values);
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
  const impliedCapabilities = normalizeStringList(req.impliedCapabilities ?? []);
  const allowedOrigins = req.allowedOrigins === undefined
    ? undefined
    : (() => {
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

export function validateLoginPortalSelectionRequest(req: LoginPortalSelectionRequest) {
  if (!req.contractId || (req.portalId !== null && (!req.portalId || req.portalId.length === 0))) {
    return invalidRequest({ contractId: req.contractId, portalId: req.portalId });
  }
  return Result.ok({
    selection: {
      contractId: req.contractId,
      portalId: req.portalId,
    } as LoginPortalSelection,
  });
}

export function validateDevicePortalSelectionRequest(req: DevicePortalSelectionRequest) {
  if (!req.profileId || (req.portalId !== null && (!req.portalId || req.portalId.length === 0))) {
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
  const allowedDigests = normalizeDigestList(req.allowedDigests);
  if (allowedDigests.length === 0) {
    return invalidRequest({ profileId: req.profileId, reason: "no_allowed_digests" });
  }
  return Result.ok({
    profile: {
      profileId: req.profileId,
      contractId: req.contractId,
      allowedDigests,
      reviewMode: req.reviewMode,
      disabled: false,
    } as DeviceProfile,
  });
}

export function validateDeviceProvisionRequest(req: ProvisionDeviceInstanceRequest) {
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
        return invalidRequest({ metadata: req.metadata, reason: "invalid_device_metadata" });
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
