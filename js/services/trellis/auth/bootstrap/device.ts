import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { verifyDeviceWaitSignature } from "../../../../packages/auth/device_activation.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import { SignatureSchema } from "../../state/schemas/auth_state.ts";
import { isDeviceProofIatFresh } from "../device_activation/shared.ts";

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const DeviceBootstrapRequestSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: SignatureSchema,
}, { additionalProperties: false });

type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
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

type DeviceActivation = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type DeviceConnectInfo = {
  instanceId: string;
  profileId: string;
  contractId: string;
  contractDigest: string;
  transport: {
    natsServers: string[];
    sentinel: {
      jwt: string;
      seed: string;
    };
  };
  auth: {
    mode: "device_identity";
    iatSkewSeconds: number;
  };
};

export type DeviceBootstrapResult =
  | { status: "ready"; connectInfo: DeviceConnectInfo }
  | { status: "activation_required" }
  | { status: "not_ready"; reason: string };

export type DeviceBootstrapDeps = {
  natsServers: string[];
  sentinel: {
    jwt: string;
    seed: string;
  };
  loadDeviceInstance(instanceId: string): Promise<DeviceInstance | null>;
  loadDeviceActivation(
    instanceId: string,
  ): Promise<DeviceActivation | null>;
  loadDeviceProfile(profileId: string): Promise<DeviceProfile | null>;
  verifyIdentityProof(input: {
    publicIdentityKey: string;
    contractDigest: string;
    iat: number;
    sig: string;
  }): Promise<boolean>;
  nowSeconds?(): number;
};

function buildDeviceConnectInfo(args: {
  instance: DeviceInstance;
  profile: DeviceProfile;
  contractDigest: string;
  natsServers: string[];
  sentinel: {
    jwt: string;
    seed: string;
  };
}): DeviceConnectInfo | null {
  if (!args.profile.allowedDigests.includes(args.contractDigest)) {
    return null;
  }

  return {
    instanceId: args.instance.instanceId,
    profileId: args.profile.profileId,
    contractId: args.profile.contractId,
    contractDigest: args.contractDigest,
    transport: {
      natsServers: args.natsServers,
      sentinel: args.sentinel,
    },
    auth: {
      mode: "device_identity",
      iatSkewSeconds: 30,
    },
  };
}

export async function resolveDeviceBootstrap(
  deps: DeviceBootstrapDeps,
  input: { publicIdentityKey: string; contractDigest: string },
): Promise<DeviceBootstrapResult> {
  const instanceId = deviceInstanceId(input.publicIdentityKey);
  const instance = await deps.loadDeviceInstance(instanceId);
  if (!instance) {
    return { status: "activation_required" };
  }
  if (instance.state === "disabled") {
    return { status: "not_ready", reason: "device_disabled" };
  }

  const activation = await deps.loadDeviceActivation(instanceId);
  if (!activation) {
    return { status: "activation_required" };
  }
  if (activation.state === "revoked") {
    return { status: "not_ready", reason: "device_activation_revoked" };
  }

  const profile = await deps.loadDeviceProfile(activation.profileId);
  if (!profile || profile.disabled) {
    return { status: "not_ready", reason: "device_profile_not_found" };
  }

  const connectInfo = buildDeviceConnectInfo({
    instance,
    profile,
    contractDigest: input.contractDigest,
    natsServers: deps.natsServers,
    sentinel: deps.sentinel,
  });
  if (!connectInfo) {
    return { status: "not_ready", reason: "contract_digest_not_allowed" };
  }

  return {
    status: "ready",
    connectInfo,
  };
}

export function createDeviceBootstrapHandler(deps: DeviceBootstrapDeps) {
  return async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = bodyResult.take();
    if (!Value.Check(DeviceBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }

    const request = body;
    const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    if (!isDeviceProofIatFresh(request.iat, nowSeconds)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
    }

    const proofOk = await deps.verifyIdentityProof({
      publicIdentityKey: request.publicIdentityKey,
      contractDigest: request.contractDigest,
      iat: request.iat,
      sig: request.sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }

    return c.json(await resolveDeviceBootstrap(deps, request));
  };
}

export async function verifyDeviceBootstrapIdentityProof(input: {
  publicIdentityKey: string;
  contractDigest: string;
  iat: number;
  sig: string;
}): Promise<boolean> {
  return await verifyDeviceWaitSignature({
    publicIdentityKey: input.publicIdentityKey,
    nonce: "connect-info",
    contractDigest: input.contractDigest,
    iat: input.iat,
    sig: input.sig,
  });
}
