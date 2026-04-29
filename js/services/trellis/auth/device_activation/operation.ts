import { AuthError } from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";

import { type AuthLogger, type AuthRuntimeDeps } from "../runtime_deps.ts";
import { randomToken } from "../crypto.ts";
import {
  deriveDeviceConfirmationCode,
  verifyDeviceWaitSignature,
} from "@qlever-llc/trellis/auth";
import type { Config } from "../../config.ts";
import { buildClientTransports } from "../transports.ts";
import { isDeviceProofIatFresh } from "./shared.ts";
import { resolveDeviceConnectInfo } from "../bootstrap/device.ts";

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
  deploymentId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date | string;
  expiresAt: Date | string;
};

type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  metadata?: Record<string, string>;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
};

type DeviceDeployment = {
  deploymentId: string;
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
  deploymentId: string;
  activatedBy?: DeviceActivationActor;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type DeviceActivationReviewRecord = {
  reviewId: string;
  operationId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  requestedBy: {
    origin: string;
    id: string;
  };
  state: "pending" | "approved" | "rejected";
  requestedAt: string | Date;
  decidedAt: string | Date | null;
  reason?: string;
};

type ReviewWaitTiming = {
  now(): number;
};

type DeviceActivationOperationDeps = {
  browserFlowsKV: Pick<AuthRuntimeDeps["browserFlowsKV"], "get">;
  deviceActivationReviewStorage: {
    getByFlowId(
      flowId: string,
    ): Promise<DeviceActivationReviewRecord | undefined>;
    put(record: DeviceActivationReviewRecord): Promise<void>;
  };
  deviceActivationStorage: {
    get(instanceId: string): Promise<DeviceActivationRecord | undefined>;
    put(record: DeviceActivationRecord): Promise<void>;
  };
  deviceDeploymentStorage: {
    get(deploymentId: string): Promise<DeviceDeployment | undefined>;
  };
  deviceInstanceStorage: {
    get(instanceId: string): Promise<DeviceInstance | undefined>;
    put(record: DeviceInstance): Promise<void>;
  };
  deviceProvisioningSecretStorage: {
    get(instanceId: string): Promise<DeviceProvisioningSecret | undefined>;
  };
  logger: Pick<AuthLogger, "trace" | "warn">;
  sentinelCreds: AuthRuntimeDeps["sentinelCreds"];
  trellis: AuthRuntimeDeps["trellis"];
  config: Config;
  reviewWaitTiming?: Partial<ReviewWaitTiming>;
};

function reviewWaitTiming(
  deps: DeviceActivationOperationDeps,
): ReviewWaitTiming {
  return {
    now: deps.reviewWaitTiming?.now ?? Date.now,
  };
}

function activationFailure(
  logger: Pick<AuthLogger, "warn">,
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
    deploymentId: string;
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
    deploymentId: value.deviceActivation.deploymentId,
    publicIdentityKey: value.deviceActivation.publicIdentityKey,
    nonce: value.deviceActivation.nonce,
    qrMac: value.deviceActivation.qrMac,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
}

async function loadDeviceActivationFlow(
  deps: DeviceActivationOperationDeps,
  flowId: string,
): Promise<DeviceActivationFlow | null> {
  const entry = await deps.browserFlowsKV.get(flowId).take();
  if (isErr(entry)) return null;
  return toDeviceActivationFlow(
    entry.value as {
      flowId?: string;
      kind?: string;
      deviceActivation?: {
        instanceId: string;
        deploymentId: string;
        publicIdentityKey: string;
        nonce: string;
        qrMac: string;
      };
      createdAt?: string | Date;
      expiresAt?: string | Date;
    },
  );
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

async function activateInstance(args: {
  deps: DeviceActivationOperationDeps;
  flow: DeviceActivationFlow;
  instance: DeviceInstance;
  deployment: DeviceDeployment;
  activatedBy: DeviceActivationActor;
}): Promise<{
  instanceId: string;
  deploymentId: string;
  activatedAt: string;
  confirmationCode?: string;
}> {
  const activatedAt = new Date().toISOString();
  await args.deps.deviceActivationStorage.put({
    instanceId: args.instance.instanceId,
    publicIdentityKey: args.instance.publicIdentityKey,
    deploymentId: args.deployment.deploymentId,
    activatedBy: args.activatedBy,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  await args.deps.deviceInstanceStorage.put({
    ...args.instance,
    state: "activated",
    activatedAt,
    revokedAt: null,
  });
  const confirmationCode = await confirmationCodeFor(
    args.flow,
    await args.deps.deviceProvisioningSecretStorage.get(
      args.instance.instanceId,
    ) ?? null,
  );
  return {
    instanceId: args.instance.instanceId,
    deploymentId: args.deployment.deploymentId,
    activatedAt,
    ...(confirmationCode ? { confirmationCode } : {}),
  };
}

async function activateApprovedReview(
  deps: DeviceActivationOperationDeps,
  flow: DeviceActivationFlow,
  review: DeviceActivationReviewRecord,
): Promise<{
  instanceId: string;
  deploymentId: string;
  activatedAt: string;
  confirmationCode?: string;
}> {
  const instance = await deps.deviceInstanceStorage.get(review.instanceId) ??
    null;
  if (!instance || instance.state === "disabled") {
    throw new AuthError({
      reason: "unknown_device",
      context: {
        instanceId: review.instanceId,
      },
    });
  }

  const deployment = await deps.deviceDeploymentStorage.get(
    review.deploymentId,
  ) ?? null;
  if (!deployment || deployment.disabled) {
    throw new AuthError({
      reason: "device_deployment_not_found",
      context: {
        deploymentId: review.deploymentId,
      },
    });
  }

  return await activateInstance({
    deps,
    flow,
    instance,
    deployment,
    activatedBy: review.requestedBy,
  });
}

async function currentActivationStatus(
  deps: DeviceActivationOperationDeps,
  flow: DeviceActivationFlow,
) {
  const activation = await deps.deviceActivationStorage.get(flow.instanceId) ??
    null;
  if (activation) {
    if (activation.state === "revoked") {
      return {
        status: "rejected" as const,
        reason: "device_activation_revoked",
      };
    }
    const confirmationCode = await confirmationCodeFor(
      flow,
      await deps.deviceProvisioningSecretStorage.get(flow.instanceId) ?? null,
    );
    return {
      status: "activated" as const,
      instanceId: activation.instanceId,
      deploymentId: activation.deploymentId,
      activatedAt: activation.activatedAt,
      ...(confirmationCode ? { confirmationCode } : {}),
    };
  }

  const review = await deps.deviceActivationReviewStorage.getByFlowId(
    flow.flowId,
  ) ?? null;
  if (!review) return null;
  if (review.state === "pending") {
    return {
      status: "pending_review" as const,
      reviewId: review.reviewId,
      instanceId: review.instanceId,
      deploymentId: review.deploymentId,
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
    deploymentId: review.deploymentId,
    requestedAt: isoString(review.requestedAt),
  };
}

function remainingFlowLifetimeMs(
  flow: DeviceActivationFlow,
  nowMs: number,
): number {
  return Math.max(0, new Date(isoString(flow.expiresAt)).getTime() - nowMs);
}

export function createActivateDeviceHandler(
  deps: DeviceActivationOperationDeps,
) {
  return async (
    { input, caller, op }: {
      input: { flowId: string };
      caller: Caller;
      op: {
        id: string;
        started(): PromiseLike<unknown>;
        progress(value: {
          status: "pending_review";
          reviewId: string;
          instanceId: string;
          deploymentId: string;
          requestedAt: string;
        }): PromiseLike<unknown>;
        defer(): { kind: "deferred" };
      };
    },
  ) => {
    const { deviceActivationReviewStorage, logger, trellis } = deps;
    logger.trace(
      { operation: "Auth.ActivateDevice", flowId: input.flowId },
      "Operation request",
    );
    if (caller.type !== "user" || !caller.origin || !caller.id) {
      return activationFailure(logger, "insufficient_permissions");
    }
    const flow = await loadDeviceActivationFlow(deps, input.flowId);
    if (!flow) {
      return activationFailure(logger, "device_activation_flow_not_found", {
        flowId: input.flowId,
      });
    }
    if (remainingFlowLifetimeMs(flow, reviewWaitTiming(deps).now()) <= 0) {
      return activationFailure(logger, "device_activation_flow_expired", {
        flowId: input.flowId,
      });
    }
    const instance = await deps.deviceInstanceStorage.get(flow.instanceId) ??
      null;
    if (!instance || instance.state === "disabled") {
      return activationFailure(logger, "unknown_device", {
        instanceId: flow.instanceId,
      });
    }
    const deployment = await deps.deviceDeploymentStorage.get(
      instance.deploymentId,
    ) ?? null;
    if (!deployment || deployment.disabled) {
      return activationFailure(logger, "device_deployment_not_found", {
        deploymentId: instance.deploymentId,
      });
    }

    await op.started();

    const existingStatus = await currentActivationStatus(deps, flow);
    if (
      existingStatus?.status === "activated" ||
      existingStatus?.status === "rejected"
    ) {
      return Result.ok(existingStatus);
    }

    const existingReview = await deps.deviceActivationReviewStorage.getByFlowId(
      flow.flowId,
    ) ?? null;
    if (existingReview?.state === "pending") {
      await op.progress(pendingReviewProgress(existingReview));
      return op.defer();
    }

    if (existingReview?.state === "approved") {
      try {
        return Result.ok({
          status: "activated" as const,
          ...(await activateApprovedReview(deps, flow, existingReview)),
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return Result.err(error);
        }
        throw error;
      }
    }

    if (deployment.reviewMode === "required") {
      const requestedAt = new Date().toISOString();
      const review: DeviceActivationReviewRecord = {
        reviewId: `dar_${randomToken(12)}`,
        operationId: op.id,
        flowId: flow.flowId,
        instanceId: instance.instanceId,
        publicIdentityKey: instance.publicIdentityKey,
        deploymentId: deployment.deploymentId,
        requestedBy: {
          origin: caller.origin,
          id: caller.id,
        },
        state: "pending",
        requestedAt,
        decidedAt: null,
      };
      await deviceActivationReviewStorage.put(review);
      await trellis.publish("Auth.DeviceActivationReviewRequested", {
        reviewId: review.reviewId,
        flowId: flow.flowId,
        instanceId: instance.instanceId,
        publicIdentityKey: instance.publicIdentityKey,
        deploymentId: deployment.deploymentId,
        requestedAt,
        requestedBy: review.requestedBy,
      });
      await op.progress(pendingReviewProgress(review));
      return op.defer();
    }

    return Result.ok({
      status: "activated" as const,
      ...(await activateInstance({
        deps,
        flow,
        instance,
        deployment,
        activatedBy: {
          origin: caller.origin,
          id: caller.id,
        },
      })),
    });
  };
}

export function createGetDeviceConnectInfoHandler(
  deps: DeviceActivationOperationDeps,
) {
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
    const { logger, sentinelCreds } = deps;
    logger.trace({
      rpc: "Auth.GetDeviceConnectInfo",
      publicIdentityKey: req.publicIdentityKey,
    }, "RPC request");

    if (!isDeviceProofIatFresh(req.iat)) {
      return activationFailure(logger, "iat_out_of_range");
    }

    const proofOk = await verifyDeviceWaitSignature({
      publicIdentityKey: req.publicIdentityKey,
      nonce: "connect-info",
      contractDigest: req.contractDigest,
      iat: req.iat,
      sig: req.sig,
    });
    if (!proofOk) {
      return activationFailure(logger, "invalid_signature");
    }

    const result = await resolveDeviceConnectInfo({
      transports: buildClientTransports(deps.config),
      sentinel: sentinelCreds,
      loadDeviceInstance: async (instanceId) =>
        await deps.deviceInstanceStorage.get(instanceId) ?? null,
      loadDeviceActivation: async (instanceId) =>
        await deps.deviceActivationStorage.get(instanceId) ?? null,
      loadDeviceDeployment: async (deploymentId) =>
        await deps.deviceDeploymentStorage.get(deploymentId) ?? null,
    }, req);

    if (result.status === "activation_required") {
      return activationFailure(logger, "unknown_device", {
        publicIdentityKey: req.publicIdentityKey,
      });
    }

    if (result.status === "not_ready") {
      if (result.reason === "device_activation_revoked") {
        return activationFailure(logger, "device_activation_revoked", {
          publicIdentityKey: req.publicIdentityKey,
        });
      }
      if (result.reason === "device_deployment_not_found") {
        return activationFailure(logger, "device_deployment_not_found", {
          publicIdentityKey: req.publicIdentityKey,
        });
      }
      return activationFailure(logger, "invalid_request", {
        reason: result.reason,
        contractDigest: req.contractDigest,
      });
    }

    return Result.ok({
      status: "ready" as const,
      connectInfo: result.connectInfo,
    });
  };
}
