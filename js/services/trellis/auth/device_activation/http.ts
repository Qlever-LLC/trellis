import type { Context, Hono } from "@hono/hono";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Value } from "typebox/value";

import {
  deriveDeviceConfirmationCode,
  deriveDeviceQrMac,
  verifyDeviceWaitSignature,
} from "@qlever-llc/trellis/auth";
import {
  DeviceBootstrapRequestSchema,
  resolveDeviceBootstrap,
  verifyDeviceBootstrapIdentityProof,
} from "../bootstrap/device.ts";
import { buildClientTransports } from "../transports.ts";
import { getConfig } from "../../config.ts";
import {
  browserFlowsKV,
  deviceActivationReviewsKV,
  deviceActivationsKV,
  deviceInstancesKV,
  devicePortalSelectionsKV,
  deviceProfilesKV,
  deviceProvisioningSecretsKV,
  portalDefaultsKV,
  portalsKV,
  sentinelCreds,
} from "../../bootstrap/globals.ts";
import { randomToken } from "../crypto.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import { resolveDevicePortal } from "../http/support.ts";
import { isDeviceProofIatFresh } from "./shared.ts";

const config = getConfig();

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

type DeviceActivationReview = {
  reviewId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "pending" | "approved" | "rejected";
  requestedAt: string | Date;
  decidedAt: string | Date | null;
  reason?: string;
};

type Portal = {
  portalId: string;
  entryUrl: string;
  disabled?: boolean;
};

type DeviceActivationRequest = {
  payload: {
    publicIdentityKey: string;
    nonce: string;
    qrMac: string;
  };
};

type DeviceActivationRequestResponse = {
  flowId: string;
  instanceId: string;
  profileId: string;
  activationUrl: string;
};

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
  return entry.value as unknown as DeviceProfile;
}

async function loadDeviceActivation(instanceId: string) {
  const entry = await deviceActivationsKV.get(instanceId).take();
  if (isErr(entry)) return null;
  return entry.value as {
    instanceId: string;
    publicIdentityKey: string;
    profileId: string;
    state: "activated" | "revoked";
    activatedAt: string;
    revokedAt: string | null;
  };
}

async function loadDeviceProvisioningSecret(
  instanceId: string,
): Promise<DeviceProvisioningSecret | null> {
  const entry = await deviceProvisioningSecretsKV.get(instanceId).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProvisioningSecret;
}

async function findDeviceActivationReviewByFlowId(
  flowId: string,
): Promise<DeviceActivationReview | null> {
  const iter = await deviceActivationReviewsKV.keys(">").take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = await deviceActivationReviewsKV.get(key).take();
    if (isErr(entry)) continue;
    const review = entry.value as unknown as DeviceActivationReview;
    if (review.flowId === flowId) return review;
  }
  return null;
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

async function findDeviceActivationFlow(input: {
  publicIdentityKey: string;
  nonce: string;
}): Promise<DeviceActivationFlow | null> {
  const iter = await browserFlowsKV.keys(">").take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = await browserFlowsKV.get(key).take();
    if (isErr(entry)) continue;
    const flow = toDeviceActivationFlow(
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
    if (!flow) continue;
    if (
      flow.publicIdentityKey === input.publicIdentityKey &&
      flow.nonce === input.nonce
    ) {
      return flow;
    }
  }
  return null;
}

async function listPortals(): Promise<Portal[]> {
  const iter = await portalsKV.keys(">").take();
  if (isErr(iter)) return [];
  const portals: Portal[] = [];
  for await (const key of iter) {
    const entry = await portalsKV.get(key).take();
    if (isErr(entry)) continue;
    portals.push(entry.value as Portal);
  }
  return portals;
}

async function listDevicePortalSelections(): Promise<
  Array<{ profileId: string; portalId: string | null }>
> {
  const iter = await devicePortalSelectionsKV.keys(">").take();
  if (isErr(iter)) return [];
  const selections: Array<{ profileId: string; portalId: string | null }> = [];
  for await (const key of iter) {
    const entry = await devicePortalSelectionsKV.get(key).take();
    if (isErr(entry)) continue;
    selections.push(
      entry.value as { profileId: string; portalId: string | null },
    );
  }
  return selections;
}

async function loadDevicePortalDefaultId(): Promise<string | null | undefined> {
  const entry = await portalDefaultsKV.get("device.default").take();
  if (isErr(entry)) return undefined;
  return (entry.value as { portalId: string | null }).portalId;
}

function deviceBootstrapDeps() {
  return {
    transports: buildClientTransports(config),
    sentinel: sentinelCreds,
    loadDeviceInstance,
    loadDeviceActivation,
    loadDeviceProfile,
    saveDeviceInstance: async (instance: DeviceInstance) => {
      await deviceInstancesKV.put(instance.instanceId, instance);
    },
    refreshActiveContracts: async () => {},
    verifyIdentityProof: verifyDeviceBootstrapIdentityProof,
  };
}

async function confirmationCodeForActivation(
  args: { instanceId: string; publicIdentityKey: string; nonce: string },
): Promise<string | undefined> {
  const provisioningSecret = await loadDeviceProvisioningSecret(
    args.instanceId,
  );
  if (!provisioningSecret) return undefined;
  return await deriveDeviceConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: args.publicIdentityKey,
    nonce: args.nonce,
  });
}

function builtinPortalEntryUrl(): string {
  const base = config.web.publicOrigin ?? config.oauth.redirectBase;
  return new URL("/_trellis/portal/devices/activate", base).toString();
}

async function createDeviceActivationRequest(
  payload: { publicIdentityKey: string; nonce: string; qrMac: string },
): Promise<DeviceActivationRequestResponse> {
  const instanceId = deviceInstanceId(payload.publicIdentityKey);
  const instance = await loadDeviceInstance(instanceId);
  if (!instance) throw new Error("Unknown device");
  if (instance.state === "disabled" || instance.state === "revoked") {
    throw new Error("Unknown device");
  }
  const provisioningSecret = await loadDeviceProvisioningSecret(instanceId);
  if (!provisioningSecret) throw new Error("Unknown device");
  const expectedQrMac = await deriveDeviceQrMac({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: payload.publicIdentityKey,
    nonce: payload.nonce,
  });
  if (expectedQrMac !== payload.qrMac) {
    throw new Error("Invalid device activation payload");
  }
  const profile = await loadDeviceProfile(instance.profileId);
  if (!profile || profile.disabled) throw new Error("Device profile not found");

  const now = new Date();
  const flowId = randomToken(16);
  await browserFlowsKV.put(flowId, {
    flowId,
    kind: "device_activation",
    deviceActivation: {
      instanceId,
      profileId: profile.profileId,
      publicIdentityKey: payload.publicIdentityKey,
      nonce: payload.nonce,
      qrMac: payload.qrMac,
    },
    createdAt: now,
    expiresAt: new Date(now.getTime() + config.ttlMs.deviceFlow),
  });

  const portalResolution = resolveDevicePortal({
    profileId: profile.profileId,
    portals: await listPortals(),
    defaultPortalId: await loadDevicePortalDefaultId(),
    selections: await listDevicePortalSelections(),
  });
  const portalEntryUrl = portalResolution.kind === "custom"
    ? portalResolution.portal.entryUrl
    : builtinPortalEntryUrl();
  const portalUrl = new URL(portalEntryUrl);
  portalUrl.searchParams.set("flowId", flowId);
  return {
    flowId,
    instanceId,
    profileId: profile.profileId,
    activationUrl: portalUrl.toString(),
  };
}

export function registerDeviceActivationHttpRoutes(
  app: Pick<Hono, "post">,
): void {
  app.post("/auth/devices/activate/requests", async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) return c.json({ error: "Invalid JSON body" }, 400);
    const body = bodyResult.take();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const payload = (body as Partial<DeviceActivationRequest>).payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return c.json({ error: "Invalid device activation payload" }, 400);
    }
    try {
      return c.json(
        await createDeviceActivationRequest({
          publicIdentityKey: String(payload.publicIdentityKey ?? ""),
          nonce: String(payload.nonce ?? ""),
          qrMac: String(payload.qrMac ?? ""),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status =
        message === "Unknown device" || message === "Device profile not found"
          ? 404
          : 400;
      return c.json({ error: message }, status);
    }
  });

  app.post("/auth/devices/activate/wait", async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) return c.json({ error: "Invalid JSON body" }, 400);
    const body = bodyResult.take() as Partial<Record<string, unknown>>;
    const publicIdentityKey = typeof body.publicIdentityKey === "string"
      ? body.publicIdentityKey
      : null;
    const nonce = typeof body.nonce === "string" ? body.nonce : null;
    const contractDigest = typeof body.contractDigest === "string"
      ? body.contractDigest
      : null;
    const iat = typeof body.iat === "number" ? body.iat : null;
    const sig = typeof body.sig === "string" ? body.sig : null;
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      !publicIdentityKey || !nonce || !contractDigest || iat === null || !sig
    ) {
      return c.json({ reason: "invalid_request" }, 400);
    }
    if (!isDeviceProofIatFresh(iat)) {
      return c.json({ reason: "iat_out_of_range", serverNow: nowSeconds }, 400);
    }
    const proofOk = await verifyDeviceWaitSignature({
      publicIdentityKey,
      nonce,
      contractDigest,
      iat,
      sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }
    const flow = await findDeviceActivationFlow({ publicIdentityKey, nonce });
    if (!flow) return c.json({ status: "pending" });
    if (new Date(flow.expiresAt).getTime() <= Date.now()) {
      return c.json({ status: "rejected", reason: "device_flow_expired" });
    }
    const instance = await loadDeviceInstance(flow.instanceId);
    if (!instance || instance.state === "disabled") {
      return c.json({ reason: "unknown_device" }, 404);
    }
    const activation = await loadDeviceActivation(flow.instanceId);
    const review = await findDeviceActivationReviewByFlowId(flow.flowId);
    if (!activation) {
      if (review?.state === "rejected") {
        return c.json({
          status: "rejected",
          reason: review.reason ?? "device_activation_rejected",
        });
      }
      return c.json({ status: "pending" });
    }
    if (activation.state === "revoked") {
      return c.json({
        status: "rejected",
        reason: "device_activation_revoked",
      });
    }
    const profile = await loadDeviceProfile(activation.profileId);
    if (!profile || profile.disabled) {
      return c.json({ status: "rejected", reason: "device_profile_not_found" });
    }
    const bootstrap = await resolveDeviceBootstrap(deviceBootstrapDeps(), {
      publicIdentityKey,
      contractDigest,
    });
    if (bootstrap.status !== "ready") {
      return c.json({ reason: "contract_digest_not_allowed" }, 403);
    }
    return c.json({
      status: "activated",
      activatedAt: activation.activatedAt,
      confirmationCode: await confirmationCodeForActivation({
        instanceId: activation.instanceId,
        publicIdentityKey: activation.publicIdentityKey,
        nonce: flow.nonce,
      }),
      connectInfo: bootstrap.connectInfo,
    });
  });

  app.post("/auth/devices/connect-info", async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) return c.json({ error: "Invalid JSON body" }, 400);
    const body = bodyResult.take();
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (!Value.Check(DeviceBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }
    const request = body;
    if (!isDeviceProofIatFresh(request.iat)) {
      return c.json({ reason: "iat_out_of_range", serverNow: nowSeconds }, 400);
    }
    const proofOk = await verifyDeviceBootstrapIdentityProof(request);
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }
    const result = await resolveDeviceBootstrap(deviceBootstrapDeps(), request);
    if (result.status === "activation_required") {
      return c.json({ reason: "unknown_device" }, 404);
    }
    if (result.status === "not_ready") {
      if (result.reason === "contract_digest_not_allowed") {
        return c.json({ reason: result.reason }, 403);
      }
      if (result.reason === "device_profile_not_found") {
        return c.json({ reason: result.reason }, 404);
      }
      return c.json({ reason: "unknown_device" }, 404);
    }
    return c.json(result);
  });
}
