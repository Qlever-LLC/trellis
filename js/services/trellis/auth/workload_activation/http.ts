import type { Context, Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";

import {
  deriveWorkloadConfirmationCode,
  deriveWorkloadQrMac,
  parseWorkloadActivationPayload,
  verifyWorkloadWaitSignature,
} from "../../../../packages/auth/workload_activation.ts";
import { getConfig } from "../../config.ts";
import {
  portalDefaultsKV,
  portalsKV,
  workloadPortalSelectionsKV,
  sentinelCreds,
  workloadActivationHandoffsKV,
  workloadActivationReviewsKV,
  workloadActivationsKV,
  workloadInstancesKV,
  workloadProfilesKV,
  workloadProvisioningSecretsKV,
} from "../../bootstrap/globals.ts";
import { randomToken } from "../crypto.ts";
import { workloadInstanceId } from "../admin/shared.ts";
import { resolveWorkloadPortal } from "../http/support.ts";
import { isWorkloadProofIatFresh } from "./shared.ts";

const config = getConfig();

type WorkloadHandoff = {
  handoffId: string;
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
  qrMac: string;
  createdAt: Date;
  expiresAt: Date;
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

type WorkloadActivationReview = {
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

async function loadWorkloadActivation(instanceId: string) {
  const entry = (await workloadActivationsKV.get(instanceId)).take();
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

async function loadWorkloadProvisioningSecret(instanceId: string): Promise<WorkloadProvisioningSecret | null> {
  const entry = (await workloadProvisioningSecretsKV.get(instanceId)).take();
  if (isErr(entry)) return null;
  return entry.value as WorkloadProvisioningSecret;
}

async function findWorkloadActivationReviewByHandoffId(handoffId: string): Promise<WorkloadActivationReview | null> {
  const iter = (await workloadActivationReviewsKV.keys(">")).take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = (await workloadActivationReviewsKV.get(key)).take();
    if (isErr(entry)) continue;
    const review = entry.value as WorkloadActivationReview;
    if (review.handoffId === handoffId) return review;
  }
  return null;
}

async function findWorkloadHandoff(input: {
  publicIdentityKey: string;
  nonce: string;
}): Promise<WorkloadHandoff | null> {
  const iter = (await workloadActivationHandoffsKV.keys(">")).take();
  if (isErr(iter)) return null;
  for await (const key of iter) {
    const entry = (await workloadActivationHandoffsKV.get(key)).take();
    if (isErr(entry)) continue;
    const handoff = entry.value as WorkloadHandoff;
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

async function listWorkloadPortalSelections(): Promise<Array<{ profileId: string; portalId: string | null }>> {
  const iter = (await workloadPortalSelectionsKV.keys(">")).take();
  if (isErr(iter)) return [];
  const selections: Array<{ profileId: string; portalId: string | null }> = [];
  for await (const key of iter) {
    const entry = (await workloadPortalSelectionsKV.get(key)).take();
    if (isErr(entry)) continue;
    selections.push(entry.value as { profileId: string; portalId: string | null });
  }
  return selections;
}

async function loadWorkloadPortalDefaultId(): Promise<string | null | undefined> {
  const entry = (await portalDefaultsKV.get("workload.default")).take();
  if (isErr(entry)) return undefined;
  return (entry.value as { portalId: string | null }).portalId;
}

async function buildWorkloadConnectInfo(args: {
  instance: WorkloadInstance;
  profile: WorkloadProfile;
  contractDigest: string;
}) {
  if (!args.profile.allowedDigests.includes(args.contractDigest)) {
    throw new HTTPException(403, { message: "contract_digest_not_allowed" });
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
      mode: "workload_identity",
      iatSkewSeconds: 30,
    },
  };
}

async function confirmationCodeForActivation(args: {
  instanceId: string;
  publicIdentityKey: string;
  nonce: string;
}): Promise<string | undefined> {
  const provisioningSecret = await loadWorkloadProvisioningSecret(args.instanceId);
  if (!provisioningSecret) return undefined;
  return await deriveWorkloadConfirmationCode({
    activationKey: provisioningSecret.activationKey,
    publicIdentityKey: args.publicIdentityKey,
    nonce: args.nonce,
  });
}

function builtinPortalEntryUrl(): string {
  const base = config.web.publicOrigin ?? config.oauth.redirectBase;
  return new URL("/_trellis/portal/activate", base).toString();
}

export function registerWorkloadActivationHttpRoutes(app: Pick<Hono, "get" | "post">): void {
  app.get("/auth/workloads/activate", async (c: Context) => {
    const rawPayload = c.req.query("payload");
    if (!rawPayload) {
      throw new HTTPException(400, { message: "Missing payload" });
    }
    let payload;
    try {
      payload = parseWorkloadActivationPayload(rawPayload);
    } catch {
      throw new HTTPException(400, { message: "Invalid workload activation payload" });
    }

    const instanceId = workloadInstanceId(payload.publicIdentityKey);
    const instance = await loadWorkloadInstance(instanceId);
    if (!instance) {
      throw new HTTPException(404, { message: "Unknown workload" });
    }
    const provisioningSecret = await loadWorkloadProvisioningSecret(instanceId);
    if (!provisioningSecret) {
      throw new HTTPException(404, { message: "Unknown workload" });
    }
    const expectedQrMac = await deriveWorkloadQrMac({
      activationKey: provisioningSecret.activationKey,
      publicIdentityKey: payload.publicIdentityKey,
      nonce: payload.nonce,
    });
    if (expectedQrMac !== payload.qrMac) {
      throw new HTTPException(400, { message: "Invalid workload activation payload" });
    }
    const profile = await loadWorkloadProfile(instance.profileId);
    if (!profile || profile.disabled) {
      throw new HTTPException(404, { message: "Workload profile not found" });
    }

    const now = new Date();
    const handoffId = `wah_${randomToken(12)}`;
    await workloadActivationHandoffsKV.put(handoffId, {
      handoffId,
      instanceId,
      publicIdentityKey: payload.publicIdentityKey,
      nonce: payload.nonce,
      qrMac: payload.qrMac,
      createdAt: now,
      expiresAt: new Date(now.getTime() + config.ttlMs.workloadHandoff),
    });

    const portalResolution = resolveWorkloadPortal({
      profileId: profile.profileId,
      portals: await listPortals(),
      defaultPortalId: await loadWorkloadPortalDefaultId(),
      selections: await listWorkloadPortalSelections(),
    });
    const portalEntryUrl = portalResolution.kind === "custom"
      ? portalResolution.portal.entryUrl
      : builtinPortalEntryUrl();

    const portalUrl = new URL(portalEntryUrl);
    portalUrl.searchParams.set("handoffId", handoffId);
    portalUrl.searchParams.set("profileId", profile.profileId);
    return c.redirect(portalUrl.toString());
  });

  app.post("/auth/workloads/activate/wait", async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take() as Partial<Record<string, unknown>>;
    const publicIdentityKey = typeof body.publicIdentityKey === "string" ? body.publicIdentityKey : null;
    const nonce = typeof body.nonce === "string" ? body.nonce : null;
    const contractDigest = typeof body.contractDigest === "string" ? body.contractDigest : null;
    const iat = typeof body.iat === "number" ? body.iat : null;
    const sig = typeof body.sig === "string" ? body.sig : null;
    if (!publicIdentityKey || !nonce || !contractDigest || iat === null || !sig) {
      return c.json({ reason: "invalid_request" }, 400);
    }
    if (!isWorkloadProofIatFresh(iat)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
    }
    const proofOk = await verifyWorkloadWaitSignature({
      publicIdentityKey,
      nonce,
      contractDigest,
      iat,
      sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }
    const handoff = await findWorkloadHandoff({ publicIdentityKey, nonce });
    if (!handoff) {
      return c.json({ status: "pending" });
    }
    if (new Date(handoff.expiresAt).getTime() <= Date.now()) {
      return c.json({ status: "rejected", reason: "workload_handoff_expired" });
    }
    const instance = await loadWorkloadInstance(handoff.instanceId);
    if (!instance || instance.state === "disabled") {
      return c.json({ reason: "unknown_workload" }, 404);
    }
    const activation = await loadWorkloadActivation(handoff.instanceId);
    const review = await findWorkloadActivationReviewByHandoffId(handoff.handoffId);
    if (!activation) {
      if (review?.state === "rejected") {
        return c.json({ status: "rejected", reason: review.reason ?? "workload_activation_rejected" });
      }
      return c.json({ status: "pending" });
    }
    if (activation.state === "revoked") {
      return c.json({ status: "rejected", reason: "workload_activation_revoked" });
    }
    const profile = await loadWorkloadProfile(activation.profileId);
    if (!profile || profile.disabled) {
      return c.json({ status: "rejected", reason: "workload_profile_not_found" });
    }
    return c.json({
      status: "activated",
      activatedAt: activation.activatedAt,
      confirmationCode: await confirmationCodeForActivation({
        instanceId: activation.instanceId,
        publicIdentityKey: activation.publicIdentityKey,
        nonce: handoff.nonce,
      }),
      connectInfo: await buildWorkloadConnectInfo({ instance, profile, contractDigest }),
    });
  });

  app.post("/auth/workloads/connect-info", async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take() as Partial<Record<string, unknown>>;
    const publicIdentityKey = typeof body.publicIdentityKey === "string" ? body.publicIdentityKey : null;
    const contractDigest = typeof body.contractDigest === "string" ? body.contractDigest : null;
    const iat = typeof body.iat === "number" ? body.iat : null;
    const sig = typeof body.sig === "string" ? body.sig : null;
    if (!publicIdentityKey || !contractDigest || iat === null || !sig) {
      return c.json({ reason: "invalid_request" }, 400);
    }
    if (!isWorkloadProofIatFresh(iat)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
    }
    const proofOk = await verifyWorkloadWaitSignature({
      publicIdentityKey,
      nonce: "connect-info",
      contractDigest,
      iat,
      sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }

    const instanceId = workloadInstanceId(publicIdentityKey);
    const instance = await loadWorkloadInstance(instanceId);
    const activation = await loadWorkloadActivation(instanceId);
    if (!instance || !activation || activation.state !== "activated") {
      return c.json({ reason: "unknown_workload" }, 404);
    }
    const profile = await loadWorkloadProfile(activation.profileId);
    if (!profile || profile.disabled) {
      return c.json({ reason: "workload_profile_not_found" }, 404);
    }
    return c.json({
      status: "ready",
      connectInfo: await buildWorkloadConnectInfo({ instance, profile, contractDigest }),
    });
  });
}
