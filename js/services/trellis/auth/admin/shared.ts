import { AuthError } from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { sha256Base64urlSync } from "../../../../packages/contracts/canonical.ts";

export type Portal = {
  portalId: string;
  appContractId?: string;
  entryUrl: string;
  disabled: boolean;
};

export type PortalDefault = {
  portalId: string | null;
};

export type LoginPortalSelection = {
  contractId: string;
  portalId: string | null;
};

export type WorkloadPortalSelection = {
  profileId: string;
  portalId: string | null;
};

export type WorkloadProfile = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
  disabled: boolean;
};

export type WorkloadProvisioningSecret = {
  instanceId: string;
  activationKey: string;
  createdAt: string | Date;
};

export type WorkloadActivationReview = {
  reviewId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt: string | null;
  reason?: string;
};

export type WorkloadInstance = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
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

export type WorkloadPortalSelectionRequest = {
  profileId: string;
  portalId: string | null;
};

export type CreateWorkloadProfileRequest = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
  contract?: object;
};

export type WorkloadActivationActor = {
  origin: string;
  id: string;
};

export type WorkloadActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: WorkloadActivationActor;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

export type ProvisionWorkloadInstanceRequest = {
  profileId: string;
  publicIdentityKey: string;
  activationKey: string;
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

export function workloadInstanceId(publicIdentityKey: string): string {
  return `wrk_${sha256Base64urlSync(publicIdentityKey).slice(0, 22)}`;
}

export function normalizeDigestList(values: string[]): string[] {
  const digests: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    digests.push(value);
  }
  return digests;
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

export function validateWorkloadPortalSelectionRequest(req: WorkloadPortalSelectionRequest) {
  if (!req.profileId || (req.portalId !== null && (!req.portalId || req.portalId.length === 0))) {
    return invalidRequest({ profileId: req.profileId, portalId: req.portalId });
  }
  return Result.ok({
    selection: {
      profileId: req.profileId,
      portalId: req.portalId,
    } as WorkloadPortalSelection,
  });
}

export function validateWorkloadProfileRequest(req: CreateWorkloadProfileRequest) {
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
    } as WorkloadProfile,
  });
}

export function validateWorkloadProvisionRequest(req: ProvisionWorkloadInstanceRequest) {
  if (!req.profileId || !req.publicIdentityKey || !req.activationKey) {
    return invalidRequest({
      profileId: req.profileId,
      publicIdentityKey: req.publicIdentityKey,
      activationKey: req.activationKey,
    });
  }
  const now = new Date().toISOString();
  return Result.ok({
    instance: {
      instanceId: workloadInstanceId(req.publicIdentityKey),
      publicIdentityKey: req.publicIdentityKey,
      profileId: req.profileId,
      state: "registered",
      createdAt: now,
      activatedAt: null,
      revokedAt: null,
    } as WorkloadInstance,
    provisioningSecret: {
      instanceId: workloadInstanceId(req.publicIdentityKey),
      activationKey: req.activationKey,
      createdAt: now,
    } as WorkloadProvisioningSecret,
  });
}
