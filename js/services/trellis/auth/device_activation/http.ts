import type { Context, Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Value } from "typebox/value";

import {
  deriveDeviceConfirmationCode,
  deriveDeviceQrMac,
  parseDeviceActivationPayload,
  verifyDeviceWaitSignature,
} from "../../../../packages/auth/device_activation.ts";
import {
  resolveDeviceBootstrap,
  verifyDeviceBootstrapIdentityProof,
  DeviceBootstrapRequestSchema,
} from "../bootstrap/device.ts";
import { getConfig } from "../../config.ts";
import {
  deviceActivationHandoffsKV,
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

type DeviceHandoff = {
  handoffId: string;
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date;
  expiresAt: Date;
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
  contractId: string;
  allowedDigests: string[];
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
  handoffId: string;
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

async function loadDeviceInstance(
  instanceId: string,
): Promise<DeviceInstance | null> {
  const entry = (await deviceInstancesKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceInstance;
}

async function loadDeviceProfile(
  profileId: string,
): Promise<DeviceProfile | null> {
  const entry = (await deviceProfilesKV.get(profileId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProfile;
}

async function loadDeviceActivation(instanceId: string) {
  const entry = (await deviceActivationsKV.get(instanceId)).take();
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
  const entry = (await deviceProvisioningSecretsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as DeviceProvisioningSecret;
}

async function findDeviceActivationReviewByHandoffId(
  handoffId: string,
): Promise<DeviceActivationReview | null> {
  const iter = (await deviceActivationReviewsKV.keys(">")).take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = (await deviceActivationReviewsKV.get(key)).take();
    if (isErr(entry)) continue;
    const review = entry.value as DeviceActivationReview;
    if (review.handoffId === handoffId) return review;
  }
  return null;
}

async function findDeviceHandoff(input: {
  publicIdentityKey: string;
  nonce: string;
}): Promise<DeviceHandoff | null> {
  const iter = (await deviceActivationHandoffsKV.keys(">")).take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = (await deviceActivationHandoffsKV.get(key)).take();
    if (isErr(entry)) continue;
    const handoff = entry.value as DeviceHandoff;
    if (
      handoff.publicIdentityKey === input.publicIdentityKey &&
      handoff.nonce === input.nonce
    ) {
      return handoff;
    }
  }
  return null;
}

async function listPortals(): Promise<Portal[]> {
  const iter = (await portalsKV.keys(">")).take();
  if (isErr(iter)) return [];
  const portals: Portal[] = [];
  for await (const key of iter) {
    const entry = (await portalsKV.get(key)).take();
    if (isErr(entry)) continue;
    portals.push(entry.value as Portal);
  }
  return portals;
}

async function listDevicePortalSelections(): Promise<
  Array<{ profileId: string; portalId: string | null }>
> {
  const iter = (await devicePortalSelectionsKV.keys(">")).take();
  if (isErr(iter)) return [];
  const selections: Array<{ profileId: string; portalId: string | null }> = [];
  for await (const key of iter) {
    const entry = (await devicePortalSelectionsKV.get(key)).take();
    if (isErr(entry)) continue;
    selections.push(
      entry.value as { profileId: string; portalId: string | null },
    );
  }
  return selections;
}

async function loadDevicePortalDefaultId(): Promise<
  string | null | undefined
> {
  const entry = (await portalDefaultsKV.get("device.default")).take();
  if (isErr(entry)) return undefined;
  return (entry.value as { portalId: string | null }).portalId;
}

function deviceBootstrapDeps() {
  return {
    natsServers: config.client.natsServers,
    sentinel: sentinelCreds,
    loadDeviceInstance,
    loadDeviceActivation,
    loadDeviceProfile,
    verifyIdentityProof: verifyDeviceBootstrapIdentityProof,
  };
}

async function confirmationCodeForActivation(args: {
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string | undefined> {
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
  return new URL("/_trellis/portal/activate", base).toString();
}

export function registerDeviceActivationHttpRoutes(
  app: Pick<Hono, "get" | "post">,
): void {
  app.get("/auth/devices/activate", async (c: Context) => {
    const rawPayload = c.req.query("payload");
    if (!rawPayload) {
      throw new HTTPException(400, { message: "Missing payload" });
    }
    let payload;
    try {
      payload = parseDeviceActivationPayload(rawPayload);
    } catch {
      throw new HTTPException(400, {
        message: "Invalid device activation payload",
      });
    }

    const instanceId = deviceInstanceId(payload.publicIdentityKey);
    const instance = await loadDeviceInstance(instanceId);
    if (!instance) {
      throw new HTTPException(404, { message: "Unknown device" });
    }
    const provisioningSecret = await loadDeviceProvisioningSecret(instanceId);
    if (!provisioningSecret) {
      throw new HTTPException(404, { message: "Unknown device" });
    }
    const expectedQrMac = await deriveDeviceQrMac({
      activationKey: provisioningSecret.activationKey,
      publicIdentityKey: payload.publicIdentityKey,
      nonce: payload.nonce,
    });
    if (expectedQrMac !== payload.qrMac) {
      throw new HTTPException(400, {
        message: "Invalid device activation payload",
      });
    }
    const profile = await loadDeviceProfile(instance.profileId);
    if (!profile || profile.disabled) {
      throw new HTTPException(404, { message: "Device profile not found" });
    }

    const now = new Date();
    const handoffId = `dah_${randomToken(12)}`;
    await deviceActivationHandoffsKV.put(handoffId, {
      handoffId,
      instanceId,
      publicIdentityKey: payload.publicIdentityKey,
      nonce: payload.nonce,
      qrMac: payload.qrMac,
      createdAt: now,
      expiresAt: new Date(now.getTime() + config.ttlMs.deviceHandoff),
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
    portalUrl.searchParams.set("handoffId", handoffId);
    portalUrl.searchParams.set("instanceId", instanceId);
    portalUrl.searchParams.set("profileId", profile.profileId);
    return c.redirect(portalUrl.toString());
  });

  app.post("/auth/devices/activate/wait", async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
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
    if (
      !publicIdentityKey || !nonce || !contractDigest || iat === null || !sig
    ) {
      return c.json({ reason: "invalid_request" }, 400);
    }
    if (!isDeviceProofIatFresh(iat)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
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
    const handoff = await findDeviceHandoff({ publicIdentityKey, nonce });
    if (!handoff) {
      return c.json({ status: "pending" });
    }
    if (new Date(handoff.expiresAt).getTime() <= Date.now()) {
      return c.json({ status: "rejected", reason: "device_handoff_expired" });
    }
    const instance = await loadDeviceInstance(handoff.instanceId);
    if (!instance || instance.state === "disabled") {
      return c.json({ reason: "unknown_device" }, 404);
    }
    const activation = await loadDeviceActivation(handoff.instanceId);
    const review = await findDeviceActivationReviewByHandoffId(
      handoff.handoffId,
    );
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
      return c.json({
        status: "rejected",
        reason: "device_profile_not_found",
      });
    }
    const bootstrap = await resolveDeviceBootstrap(deviceBootstrapDeps(), {
      publicIdentityKey,
      contractDigest,
    });
    if (bootstrap.status !== "ready") {
      throw new HTTPException(403, { message: "contract_digest_not_allowed" });
    }
    return c.json({
      status: "activated",
      activatedAt: activation.activatedAt,
      confirmationCode: await confirmationCodeForActivation({
        instanceId: activation.instanceId,
        publicIdentityKey: activation.publicIdentityKey,
        nonce: handoff.nonce,
      }),
      connectInfo: bootstrap.connectInfo,
    });
  });

  app.post("/auth/devices/connect-info", async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take();
    if (!Value.Check(DeviceBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }
    const request = body;
    if (!isDeviceProofIatFresh(request.iat)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
    }
    const proofOk = await verifyDeviceBootstrapIdentityProof(request);
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }

    const result = await resolveDeviceBootstrap(
      deviceBootstrapDeps(),
      request,
    );

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
