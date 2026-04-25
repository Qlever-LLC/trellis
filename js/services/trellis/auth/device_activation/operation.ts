import { AuthError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import {
  browserFlowsKV,
  deviceActivationReviewsKV,
  deviceActivationsKV,
  deviceInstancesKV,
  deviceProfilesKV,
  deviceProvisioningSecretsKV,
  logger,
  sentinelCreds,
  trellis,
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

type DeviceActivationFlow = {
  flowId: string;
  instanceId: string;
  profileId: string;
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
  flowId: string;
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
const REVIEW_POLL_INTERVAL_MS = 1_000;

function activationFailure(
  reason: AuthError["reason"],
  context?: Record<string, unknown>,
) {
  logger.warn(
    { reason, ...(context ? { context } : {}) },
    "Device activation failed",
  );
  return Result.err(
    new AuthError({ reason, context }),
  );
}

function isoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDeviceActivationFlow(value: {
  flowId?: string;
  kind?: string;
  deviceActivation?: {
    instanceId: string;
    profileId: string;
    publicIdentityKey: string;
    nonce: string;
    qrMac: string;
  };
  createdAt?: string | Date;
  expiresAt?: string | Date;
}): DeviceActivationFlow | null {
  if (
    value.kind !== "device_activation" || !value.flowId ||
    !value.deviceActivation ||
    !value.createdAt || !value.expiresAt
  ) {
    return null;
  }
  return {
    flowId: value.flowId,
    instanceId: value.deviceActivation.instanceId,
    profileId: value.deviceActivation.profileId,
    publicIdentityKey: value.deviceActivation.publicIdentityKey,
    nonce: value.deviceActivation.nonce,
    qrMac: value.deviceActivation.qrMac,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
}

async function loadDeviceActivationFlow(
  flowId: string,
): Promise<DeviceActivationFlow | null> {
  const entry = await browserFlowsKV.get(flowId).take();
  if (isErr(entry)) return null;
  return toDeviceActivationFlow(
    entry.value as {
      flowId?: string;
      kind?: string;
      deviceActivation?: {
        instanceId: string;
        profileId: string;
        publicIdentityKey: string;
        nonce: string;
        qrMac: string;
      };
      createdAt?: string | Date;
      expiresAt?: string | Date;
    },
  );
}

async function loadDeviceInstance(
  instanceId: string,
): Promise<DeviceInstance | null> {
  const entry = await deviceInstancesKV.get(instanceId).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceInstance;
}

async function loadDeviceProfile(
  profileId: string,
): Promise<DeviceProfile | null> {
  const entry = await deviceProfilesKV.get(profileId).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProfile;
}

async function loadDeviceProvisioningSecret(
  instanceId: string,
): Promise<DeviceProvisioningSecret | null> {
  const entry = await deviceProvisioningSecretsKV.get(instanceId).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProvisioningSecret;
}

async function loadDeviceActivation(
  instanceId: string,
): Promise<DeviceActivationRecord | null> {
  const entry = await deviceActivationsKV.get(instanceId).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceActivationRecord;
}

async function findReviewByFlowId(
  flowId: string,
): Promise<DeviceActivationReviewRecord | null> {
  const iter = await deviceActivationReviewsKV.keys(">").take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = await deviceActivationReviewsKV.get(key).take();
    if (isErr(entry)) continue;
    const review = entry.value as unknown as DeviceActivationReviewRecord;
    if (review.flowId === flowId) return review;
  }
  return null;
}

async function confirmationCodeFor(
  flow: DeviceActivationFlow,
  provisioningSecret: DeviceProvisioningSecret | null,
): Promise<string | undefined> {
  if (!provisioningSecret) return undefined;
  return await deriveDeviceConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: flow.publicIdentityKey,
    nonce: flow.nonce,
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
      context: {
        reason: "contract_digest_not_allowed",
        contractDigest: args.contractDigest,
      },
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
  flow: DeviceActivationFlow;
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
    args.flow,
    await loadDeviceProvisioningSecret(args.instance.instanceId),
  );
  return {
    instanceId: args.instance.instanceId,
    profileId: args.profile.profileId,
    activatedAt,
    ...(confirmationCode ? { confirmationCode } : {}),
  };
}

async function activateApprovedReview(
  flow: DeviceActivationFlow,
  review: DeviceActivationReviewRecord,
): Promise<{
  instanceId: string;
  profileId: string;
  activatedAt: string;
  confirmationCode?: string;
}> {
  const instance = await loadDeviceInstance(review.instanceId);
  if (!instance || instance.state === "disabled") {
    throw new AuthError({
      reason: "unknown_device",
      context: {
        instanceId: review.instanceId,
      },
    });
  }

  const profile = await loadDeviceProfile(review.profileId);
  if (!profile || profile.disabled) {
    throw new AuthError({
      reason: "device_profile_not_found",
      context: {
        profileId: review.profileId,
      },
    });
  }

  return await activateInstance({
    flow,
    instance,
    profile,
    activatedBy: review.requestedBy,
  });
}

async function currentActivationStatus(flow: DeviceActivationFlow) {
  const activation = await loadDeviceActivation(flow.instanceId);
  if (activation) {
    if (activation.state === "revoked") {
      return {
        status: "rejected" as const,
        reason: "device_activation_revoked",
      };
    }
    const confirmationCode = await confirmationCodeFor(
      flow,
      await loadDeviceProvisioningSecret(flow.instanceId),
    );
    return {
      status: "activated" as const,
      instanceId: activation.instanceId,
      profileId: activation.profileId,
      activatedAt: activation.activatedAt,
      ...(confirmationCode ? { confirmationCode } : {}),
    };
  }

  const review = await findReviewByFlowId(flow.flowId);
  if (!review) return null;
  if (review.state === "pending") {
    return {
      status: "pending_review" as const,
      reviewId: review.reviewId,
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

function pendingReviewProgress(review: DeviceActivationReviewRecord) {
  return {
    status: "pending_review" as const,
    reviewId: review.reviewId,
    instanceId: review.instanceId,
    profileId: review.profileId,
    requestedAt: isoString(review.requestedAt),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTerminalActivationStatus(
  flow: DeviceActivationFlow,
): Promise<
  | {
    status: "activated";
    instanceId: string;
    profileId: string;
    activatedAt: string;
    confirmationCode?: string;
  }
  | { status: "rejected"; reason?: string }
> {
  while (true) {
    const status = await currentActivationStatus(flow);
    if (status && status.status !== "pending_review") {
      return status;
    }

    if (new Date(isoString(flow.expiresAt)).getTime() <= Date.now()) {
      return {
        status: "rejected",
        reason: "device_flow_expired",
      };
    }

    await sleep(REVIEW_POLL_INTERVAL_MS);
  }
}

export function createActivateDeviceHandler() {
  return async (
    { input, caller, op }: {
      input: { flowId: string };
      caller: Caller;
      op: {
        started(): PromiseLike<unknown>;
        progress(value: {
          status: "pending_review";
          reviewId: string;
          instanceId: string;
          profileId: string;
          requestedAt: string;
        }): PromiseLike<unknown>;
      };
    },
  ) => {
    logger.trace(
      { operation: "Auth.ActivateDevice", flowId: input.flowId },
      "Operation request",
    );
    if (caller.type !== "user" || !caller.origin || !caller.id) {
      return activationFailure("insufficient_permissions");
    }
    const flow = await loadDeviceActivationFlow(input.flowId);
    if (!flow) {
      return activationFailure("device_activation_flow_not_found", {
        flowId: input.flowId,
      });
    }
    if (new Date(isoString(flow.expiresAt)).getTime() <= Date.now()) {
      return activationFailure("device_activation_flow_expired", {
        flowId: input.flowId,
      });
    }
    const instance = await loadDeviceInstance(flow.instanceId);
    if (!instance || instance.state === "disabled") {
      return activationFailure("unknown_device", {
        instanceId: flow.instanceId,
      });
    }
    const profile = await loadDeviceProfile(instance.profileId);
    if (!profile || profile.disabled) {
      return activationFailure("device_profile_not_found", {
        profileId: instance.profileId,
      });
    }

    await op.started();

    const existingStatus = await currentActivationStatus(flow);
    if (
      existingStatus?.status === "activated" ||
      existingStatus?.status === "rejected"
    ) {
      return Result.ok(existingStatus);
    }

    const existingReview = await findReviewByFlowId(flow.flowId);
    if (existingReview?.state === "pending") {
      await op.progress(pendingReviewProgress(existingReview));
      return Result.ok(await waitForTerminalActivationStatus(flow));
    }

    if (existingReview?.state === "approved") {
      try {
        return Result.ok({
          status: "activated" as const,
          ...(await activateApprovedReview(flow, existingReview)),
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return Result.err(error);
        }
        throw error;
      }
    }

    if (profile.reviewMode === "required") {
      const requestedAt = new Date().toISOString();
      const review: DeviceActivationReviewRecord = {
        reviewId: `dar_${randomToken(12)}`,
        flowId: flow.flowId,
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
        flowId: flow.flowId,
        instanceId: instance.instanceId,
        publicIdentityKey: instance.publicIdentityKey,
        profileId: profile.profileId,
        requestedAt,
        requestedBy: review.requestedBy,
      });
      await op.progress(pendingReviewProgress(review));
      return Result.ok(await waitForTerminalActivationStatus(flow));
    }

    return Result.ok({
      status: "activated" as const,
      ...(await activateInstance({
        flow,
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

export function createGetDeviceConnectInfoHandler() {
  return async ({
    input: req,
  }: {
    input: {
      publicIdentityKey: string;
      contractDigest: string;
      iat: number;
      sig: string;
    };
  }) => {
    logger.trace({
      rpc: "Auth.GetDeviceConnectInfo",
      publicIdentityKey: req.publicIdentityKey,
    }, "RPC request");

    if (!isDeviceProofIatFresh(req.iat)) {
      return activationFailure("iat_out_of_range");
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
      return activationFailure("unknown_device", {
        publicIdentityKey: req.publicIdentityKey,
      });
    }
    const profile = await loadDeviceProfile(activation.profileId);
    if (!profile || profile.disabled) {
      return activationFailure("device_profile_not_found", {
        profileId: activation.profileId,
      });
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
