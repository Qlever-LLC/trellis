import { AuthError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import {
  logger,
  sentinelCreds,
  trellis,
  deviceActivationHandoffsKV,
  deviceActivationReviewsKV,
  deviceActivationsKV,
  deviceInstancesKV,
  deviceProfilesKV,
  deviceProvisioningSecretsKV,
} from "../../bootstrap/globals.ts";
import { randomToken } from "../crypto.ts";
import {
  deriveDeviceConfirmationCode,
  verifyDeviceWaitSignature,
} from "@qlever-llc/trellis/auth";
import { getConfig } from "../../config.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import { buildClientTransports } from "../transports.ts";
import { isDeviceProofIatFresh } from "./shared.ts";

type Caller = {
  type: string;
  origin?: string;
  id?: string;
};

type DeviceActivationActor = {
  origin: string;
  id: string;
};

type DeviceActivationHandoff = {
  handoffId: string;
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date | string;
  expiresAt: Date | string;
};

type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  metadata?: Record<string, string>;
  state: "registered" | "activated" | "revoked" | "disabled";
  currentContractId?: string;
  currentContractDigest?: string;
  createdAt: string | Date;
  activatedAt: string | Date | null;
  revokedAt: string | Date | null;
};

type DeviceProfile = {
  profileId: string;
  appliedContracts: Array<{ contractId: string; allowedDigests: string[] }>;
  reviewMode?: "none" | "required";
  disabled: boolean;
};

type DeviceProvisioningSecret = {
  instanceId: string;
  activationKey: string;
  createdAt: string | Date;
};

type DeviceActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: DeviceActivationActor;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type DeviceActivationReviewRecord = {
  reviewId: string;
  linkRequestId: string;
  handoffId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  requestedBy: {
    origin: string;
    id: string;
  };
  state: "pending" | "approved" | "rejected";
  requestedAt: string | Date;
  decidedAt: string | Date | null;
  reason?: string;
};

const config = getConfig();

function activationFailure(reason: string, context?: Record<string, unknown>) {
  return Result.err(new AuthError({ reason: reason as AuthError["reason"], context }));
}

function isoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function loadDeviceHandoff(handoffId: string): Promise<DeviceActivationHandoff | null> {
  const entry = (await deviceActivationHandoffsKV.get(handoffId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceActivationHandoff;
}

async function loadDeviceInstance(instanceId: string): Promise<DeviceInstance | null> {
  const entry = (await deviceInstancesKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceInstance;
}

async function loadDeviceProfile(profileId: string): Promise<DeviceProfile | null> {
  const entry = (await deviceProfilesKV.get(profileId)).take();
  if (isErr(entry)) return null;
  return entry.value as unknown as DeviceProfile;
}

async function loadDeviceProvisioningSecret(instanceId: string): Promise<DeviceProvisioningSecret | null> {
  const entry = (await deviceProvisioningSecretsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProvisioningSecret;
}

async function loadDeviceActivation(instanceId: string): Promise<DeviceActivationRecord | null> {
  const entry = (await deviceActivationsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceActivationRecord;
}

async function findReviewByHandoffId(handoffId: string): Promise<DeviceActivationReviewRecord | null> {
  const iter = (await deviceActivationReviewsKV.keys(">")).take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = (await deviceActivationReviewsKV.get(key)).take();
    if (isErr(entry)) continue;
    const review = entry.value as DeviceActivationReviewRecord;
    if (review.handoffId === handoffId) return review;
  }
  return null;
}

async function confirmationCodeFor(
  handoff: DeviceActivationHandoff,
  provisioningSecret: DeviceProvisioningSecret | null,
): Promise<string | undefined> {
  if (!provisioningSecret) return undefined;
  return await deriveDeviceConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: handoff.publicIdentityKey,
    nonce: handoff.nonce,
  });
}

async function buildDeviceConnectInfo(args: {
  instance: DeviceInstance;
  profile: DeviceProfile;
  contractDigest: string;
}) {
  const applied = args.profile.appliedContracts.find((entry) =>
    entry.allowedDigests.includes(args.contractDigest)
  );
  if (!applied) {
    throw new AuthError({
      reason: "invalid_request",
      context: { reason: "contract_digest_not_allowed", contractDigest: args.contractDigest },
    });
  }
  return {
    instanceId: args.instance.instanceId,
    profileId: args.profile.profileId,
    contractId: applied.contractId,
    contractDigest: args.contractDigest,
    transports: buildClientTransports(config),
    transport: {
      sentinel: sentinelCreds,
    },
    auth: {
      mode: "device_identity" as const,
      iatSkewSeconds: 30,
    },
  };
}

async function activateInstance(args: {
  handoff: DeviceActivationHandoff;
  instance: DeviceInstance;
  profile: DeviceProfile;
  activatedBy: DeviceActivationActor;
}): Promise<{
  instanceId: string;
  profileId: string;
  activatedAt: string;
  confirmationCode?: string;
}> {
  const activatedAt = new Date().toISOString();
  await deviceActivationsKV.put(args.instance.instanceId, {
    instanceId: args.instance.instanceId,
    publicIdentityKey: args.instance.publicIdentityKey,
    profileId: args.profile.profileId,
    activatedBy: args.activatedBy,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  await deviceInstancesKV.put(args.instance.instanceId, {
    ...args.instance,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  const confirmationCode = await confirmationCodeFor(
    args.handoff,
    await loadDeviceProvisioningSecret(args.instance.instanceId),
  );
  return {
    instanceId: args.instance.instanceId,
    profileId: args.profile.profileId,
    activatedAt,
    ...(confirmationCode ? { confirmationCode } : {}),
  };
}

async function currentActivationStatus(handoff: DeviceActivationHandoff) {
  const activation = await loadDeviceActivation(handoff.instanceId);
  if (activation) {
    if (activation.state === "revoked") {
      return { status: "rejected" as const, reason: "device_activation_revoked" };
    }
    const confirmationCode = await confirmationCodeFor(
      handoff,
      await loadDeviceProvisioningSecret(handoff.instanceId),
    );
    return {
      status: "activated" as const,
      instanceId: activation.instanceId,
      profileId: activation.profileId,
      activatedAt: activation.activatedAt,
      ...(confirmationCode ? { confirmationCode } : {}),
    };
  }

  const review = await findReviewByHandoffId(handoff.handoffId);
  if (!review) return null;
  if (review.state === "pending") {
      return {
        status: "pending_review" as const,
        reviewId: review.reviewId,
        linkRequestId: review.linkRequestId,
        instanceId: review.instanceId,
      profileId: review.profileId,
      requestedAt: isoString(review.requestedAt),
    };
  }
  if (review.state === "rejected") {
    return {
      status: "rejected" as const,
      ...(review.reason ? { reason: review.reason } : {}),
    };
  }
  return null;
}

export function createActivateDeviceHandler() {
  return async (
    req: { handoffId: string; linkRequestId: string },
    { caller }: { caller: Caller },
  ) => {
    logger.trace({ rpc: "Auth.ActivateDevice", handoffId: req.handoffId }, "RPC request");
    if (caller.type !== "user" || !caller.origin || !caller.id) {
      return activationFailure("insufficient_permissions");
    }
    const handoff = await loadDeviceHandoff(req.handoffId);
    if (!handoff) {
      return activationFailure("invalid_request", { reason: "device_handoff_not_found" });
    }
    if (new Date(isoString(handoff.expiresAt)).getTime() <= Date.now()) {
      return activationFailure("invalid_request", { reason: "device_handoff_expired" });
    }
    const instance = await loadDeviceInstance(handoff.instanceId);
    if (!instance || instance.state === "disabled") {
      return activationFailure("invalid_request", { reason: "unknown_device" });
    }
    const profile = await loadDeviceProfile(instance.profileId);
    if (!profile || profile.disabled) {
      return activationFailure("invalid_request", { reason: "device_profile_not_found" });
    }

    const existingStatus = await currentActivationStatus(handoff);
    if (existingStatus) return Result.ok(existingStatus);

    if (profile.reviewMode === "required") {
      const requestedAt = new Date().toISOString();
      const review: DeviceActivationReviewRecord = {
        reviewId: `dar_${randomToken(12)}`,
        linkRequestId: req.linkRequestId,
        handoffId: handoff.handoffId,
        instanceId: instance.instanceId,
        publicIdentityKey: instance.publicIdentityKey,
        profileId: profile.profileId,
        requestedBy: {
          origin: caller.origin,
          id: caller.id,
        },
        state: "pending",
        requestedAt,
        decidedAt: null,
      };
      await deviceActivationReviewsKV.put(review.reviewId, review);
      await trellis.publish("Auth.DeviceActivationReviewRequested", {
        reviewId: review.reviewId,
        linkRequestId: review.linkRequestId,
        handoffId: handoff.handoffId,
        instanceId: instance.instanceId,
        publicIdentityKey: instance.publicIdentityKey,
        profileId: profile.profileId,
        requestedAt,
        requestedBy: review.requestedBy,
      });
      return Result.ok({
        status: "pending_review" as const,
        reviewId: review.reviewId,
        linkRequestId: review.linkRequestId,
        instanceId: instance.instanceId,
        profileId: profile.profileId,
        requestedAt,
      });
    }

    return Result.ok({
      status: "activated" as const,
      ...(await activateInstance({
        handoff,
        instance,
        profile,
        activatedBy: {
          origin: caller.origin,
          id: caller.id,
        },
      })),
    });
  };
}

export function createGetDeviceActivationStatusHandler() {
  return async (req: { handoffId: string }) => {
    logger.trace({ rpc: "Auth.GetDeviceActivationStatus", handoffId: req.handoffId }, "RPC request");
    const handoff = await loadDeviceHandoff(req.handoffId);
    if (!handoff) {
      return activationFailure("invalid_request", { reason: "device_handoff_not_found" });
    }
    if (new Date(isoString(handoff.expiresAt)).getTime() <= Date.now()) {
      return Result.ok({ status: "rejected" as const, reason: "device_handoff_expired" });
    }
    const status = await currentActivationStatus(handoff);
    if (status) return Result.ok(status);
    return Result.ok({ status: "rejected" as const, reason: "activation_not_started" });
  };
}

export function createGetDeviceConnectInfoHandler() {
  return async (req: {
    publicIdentityKey: string;
    contractDigest: string;
    iat: number;
    sig: string;
  }) => {
    logger.trace({
      rpc: "Auth.GetDeviceConnectInfo",
      publicIdentityKey: req.publicIdentityKey,
    }, "RPC request");

    if (!isDeviceProofIatFresh(req.iat)) {
      return activationFailure("invalid_request", { reason: "iat_out_of_range" });
    }

    const proofOk = await verifyDeviceWaitSignature({
      publicIdentityKey: req.publicIdentityKey,
      nonce: "connect-info",
      contractDigest: req.contractDigest,
      iat: req.iat,
      sig: req.sig,
    });
    if (!proofOk) {
      return activationFailure("invalid_signature");
    }

    const instanceId = deviceInstanceId(req.publicIdentityKey);
    const instance = await loadDeviceInstance(instanceId);
    const activation = await loadDeviceActivation(instanceId);
    if (!instance || !activation || activation.state !== "activated") {
      return activationFailure("invalid_request", { reason: "unknown_device" });
    }
    const profile = await loadDeviceProfile(activation.profileId);
    if (!profile || profile.disabled) {
      return activationFailure("invalid_request", { reason: "device_profile_not_found" });
    }

    const connectInfo = await buildDeviceConnectInfo({
      instance,
      profile,
      contractDigest: req.contractDigest,
    });
    await deviceInstancesKV.put(instance.instanceId, {
      ...instance,
      currentContractId: connectInfo.contractId,
      currentContractDigest: connectInfo.contractDigest,
    });
    return Result.ok({
      status: "ready" as const,
      connectInfo,
    });
  };
}
