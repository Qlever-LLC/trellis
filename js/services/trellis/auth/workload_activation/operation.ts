import { AuthError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import {
  logger,
  sentinelCreds,
  trellis,
  workloadActivationHandoffsKV,
  workloadActivationReviewsKV,
  workloadActivationsKV,
  workloadInstancesKV,
  workloadProfilesKV,
  workloadProvisioningSecretsKV,
} from "../../bootstrap/globals.ts";
import { randomToken } from "../crypto.ts";
import { deriveWorkloadConfirmationCode } from "../../../../packages/auth/workload_activation.ts";
import { verifyWorkloadWaitSignature } from "../../../../packages/auth/workload_activation.ts";
import { getConfig } from "../../config.ts";
import { workloadInstanceId } from "../admin/shared.ts";
import { isWorkloadProofIatFresh } from "./shared.ts";

type Caller = {
  type: string;
  origin?: string;
  id?: string;
};

type WorkloadActivationActor = {
  origin: string;
  id: string;
};

type WorkloadActivationHandoff = {
  handoffId: string;
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date | string;
  expiresAt: Date | string;
};

type WorkloadInstance = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string | Date;
  activatedAt: string | Date | null;
  revokedAt: string | Date | null;
};

type WorkloadProfile = {
  profileId: string;
  contractId: string;
  allowedDigests: string[];
  reviewMode?: "none" | "required";
  disabled: boolean;
};

type WorkloadProvisioningSecret = {
  instanceId: string;
  activationKey: string;
  createdAt: string | Date;
};

type WorkloadActivationRecord = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  activatedBy?: WorkloadActivationActor;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type WorkloadActivationReviewRecord = {
  reviewId: string;
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

async function loadWorkloadHandoff(handoffId: string): Promise<WorkloadActivationHandoff | null> {
  const entry = (await workloadActivationHandoffsKV.get(handoffId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadActivationHandoff;
}

async function loadWorkloadInstance(instanceId: string): Promise<WorkloadInstance | null> {
  const entry = (await workloadInstancesKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadInstance;
}

async function loadWorkloadProfile(profileId: string): Promise<WorkloadProfile | null> {
  const entry = (await workloadProfilesKV.get(profileId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadProfile;
}

async function loadWorkloadProvisioningSecret(instanceId: string): Promise<WorkloadProvisioningSecret | null> {
  const entry = (await workloadProvisioningSecretsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadProvisioningSecret;
}

async function loadWorkloadActivation(instanceId: string): Promise<WorkloadActivationRecord | null> {
  const entry = (await workloadActivationsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadActivationRecord;
}

async function findReviewByHandoffId(handoffId: string): Promise<WorkloadActivationReviewRecord | null> {
  const iter = (await workloadActivationReviewsKV.keys(">")).take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = (await workloadActivationReviewsKV.get(key)).take();
    if (isErr(entry)) continue;
    const review = entry.value as WorkloadActivationReviewRecord;
    if (review.handoffId === handoffId) return review;
  }
  return null;
}

async function confirmationCodeFor(
  handoff: WorkloadActivationHandoff,
  provisioningSecret: WorkloadProvisioningSecret | null,
): Promise<string | undefined> {
  if (!provisioningSecret) return undefined;
  return await deriveWorkloadConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: handoff.publicIdentityKey,
    nonce: handoff.nonce,
  });
}

async function buildWorkloadConnectInfo(args: {
  instance: WorkloadInstance;
  profile: WorkloadProfile;
  contractDigest: string;
}) {
  if (!args.profile.allowedDigests.includes(args.contractDigest)) {
    throw new AuthError({
      reason: "invalid_request",
      context: { reason: "contract_digest_not_allowed", contractDigest: args.contractDigest },
    });
  }
  return {
    instanceId: args.instance.instanceId,
    profileId: args.profile.profileId,
    contractId: args.profile.contractId,
    contractDigest: args.contractDigest,
    transport: {
      natsServers: config.client.natsServers,
      sentinel: sentinelCreds,
    },
    auth: {
      mode: "workload_identity" as const,
      iatSkewSeconds: 30,
    },
  };
}

async function activateInstance(args: {
  handoff: WorkloadActivationHandoff;
  instance: WorkloadInstance;
  profile: WorkloadProfile;
  activatedBy: WorkloadActivationActor;
}): Promise<{
  instanceId: string;
  profileId: string;
  activatedAt: string;
  confirmationCode?: string;
}> {
  const activatedAt = new Date().toISOString();
  await workloadActivationsKV.put(args.instance.instanceId, {
    instanceId: args.instance.instanceId,
    publicIdentityKey: args.instance.publicIdentityKey,
    profileId: args.profile.profileId,
    activatedBy: args.activatedBy,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  await workloadInstancesKV.put(args.instance.instanceId, {
    ...args.instance,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  const confirmationCode = await confirmationCodeFor(
    args.handoff,
    await loadWorkloadProvisioningSecret(args.instance.instanceId),
  );
  return {
    instanceId: args.instance.instanceId,
    profileId: args.profile.profileId,
    activatedAt,
    ...(confirmationCode ? { confirmationCode } : {}),
  };
}

async function currentActivationStatus(handoff: WorkloadActivationHandoff) {
  const activation = await loadWorkloadActivation(handoff.instanceId);
  if (activation) {
    if (activation.state === "revoked") {
      return { status: "rejected" as const, reason: "workload_activation_revoked" };
    }
    const confirmationCode = await confirmationCodeFor(
      handoff,
      await loadWorkloadProvisioningSecret(handoff.instanceId),
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

export function createActivateWorkloadHandler() {
  return async (
    req: { handoffId: string },
    { caller }: { caller: Caller },
  ) => {
    logger.trace({ rpc: "Auth.ActivateWorkload", handoffId: req.handoffId }, "RPC request");
    if (caller.type !== "user" || !caller.origin || !caller.id) {
      return activationFailure("insufficient_permissions");
    }
    const handoff = await loadWorkloadHandoff(req.handoffId);
    if (!handoff) {
      return activationFailure("invalid_request", { reason: "workload_handoff_not_found" });
    }
    if (new Date(isoString(handoff.expiresAt)).getTime() <= Date.now()) {
      return activationFailure("invalid_request", { reason: "workload_handoff_expired" });
    }
    const instance = await loadWorkloadInstance(handoff.instanceId);
    if (!instance || instance.state === "disabled") {
      return activationFailure("invalid_request", { reason: "unknown_workload" });
    }
    const profile = await loadWorkloadProfile(instance.profileId);
    if (!profile || profile.disabled) {
      return activationFailure("invalid_request", { reason: "workload_profile_not_found" });
    }

    const existingStatus = await currentActivationStatus(handoff);
    if (existingStatus) return Result.ok(existingStatus);

    if (profile.reviewMode === "required") {
      const requestedAt = new Date().toISOString();
      const review: WorkloadActivationReviewRecord = {
        reviewId: `war_${randomToken(12)}`,
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
      await workloadActivationReviewsKV.put(review.reviewId, review);
      await trellis.publish("Auth.WorkloadActivationReviewRequested", {
        reviewId: review.reviewId,
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

export function createGetWorkloadActivationStatusHandler() {
  return async (req: { handoffId: string }) => {
    logger.trace({ rpc: "Auth.GetWorkloadActivationStatus", handoffId: req.handoffId }, "RPC request");
    const handoff = await loadWorkloadHandoff(req.handoffId);
    if (!handoff) {
      return activationFailure("invalid_request", { reason: "workload_handoff_not_found" });
    }
    if (new Date(isoString(handoff.expiresAt)).getTime() <= Date.now()) {
      return Result.ok({ status: "rejected" as const, reason: "workload_handoff_expired" });
    }
    const status = await currentActivationStatus(handoff);
    if (status) return Result.ok(status);
    return Result.ok({ status: "rejected" as const, reason: "activation_not_started" });
  };
}

export function createGetWorkloadConnectInfoHandler() {
  return async (req: {
    publicIdentityKey: string;
    contractDigest: string;
    iat: number;
    sig: string;
  }) => {
    logger.trace({
      rpc: "Auth.GetWorkloadConnectInfo",
      publicIdentityKey: req.publicIdentityKey,
    }, "RPC request");

    if (!isWorkloadProofIatFresh(req.iat)) {
      return activationFailure("invalid_request", { reason: "iat_out_of_range" });
    }

    const proofOk = await verifyWorkloadWaitSignature({
      publicIdentityKey: req.publicIdentityKey,
      nonce: "connect-info",
      contractDigest: req.contractDigest,
      iat: req.iat,
      sig: req.sig,
    });
    if (!proofOk) {
      return activationFailure("invalid_signature");
    }

    const instanceId = workloadInstanceId(req.publicIdentityKey);
    const instance = await loadWorkloadInstance(instanceId);
    const activation = await loadWorkloadActivation(instanceId);
    if (!instance || !activation || activation.state !== "activated") {
      return activationFailure("invalid_request", { reason: "unknown_workload" });
    }
    const profile = await loadWorkloadProfile(activation.profileId);
    if (!profile || profile.disabled) {
      return activationFailure("invalid_request", { reason: "workload_profile_not_found" });
    }

    return Result.ok({
      status: "ready" as const,
      connectInfo: await buildWorkloadConnectInfo({
        instance,
        profile,
        contractDigest: req.contractDigest,
      }),
    });
  };
}
