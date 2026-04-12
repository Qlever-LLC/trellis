import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { verifyWorkloadWaitSignature } from "../../../../packages/auth/workload_activation.ts";
import { workloadInstanceId } from "../admin/shared.ts";
import { SignatureSchema } from "../../state/schemas/auth_state.ts";
import { isWorkloadProofIatFresh } from "../workload_activation/shared.ts";

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const WorkloadBootstrapRequestSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: SignatureSchema,
}, { additionalProperties: false });

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

type WorkloadActivation = {
  instanceId: string;
  publicIdentityKey: string;
  profileId: string;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type WorkloadConnectInfo = {
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
    mode: "workload_identity";
    iatSkewSeconds: number;
  };
};

export type WorkloadBootstrapResult =
  | { status: "ready"; connectInfo: WorkloadConnectInfo }
  | { status: "activation_required" }
  | { status: "not_ready"; reason: string };

export type WorkloadBootstrapDeps = {
  natsServers: string[];
  sentinel: {
    jwt: string;
    seed: string;
  };
  loadWorkloadInstance(instanceId: string): Promise<WorkloadInstance | null>;
  loadWorkloadActivation(
    instanceId: string,
  ): Promise<WorkloadActivation | null>;
  loadWorkloadProfile(profileId: string): Promise<WorkloadProfile | null>;
  verifyIdentityProof(input: {
    publicIdentityKey: string;
    contractDigest: string;
    iat: number;
    sig: string;
  }): Promise<boolean>;
  nowSeconds?(): number;
};

function buildWorkloadConnectInfo(args: {
  instance: WorkloadInstance;
  profile: WorkloadProfile;
  contractDigest: string;
  natsServers: string[];
  sentinel: {
    jwt: string;
    seed: string;
  };
}): WorkloadConnectInfo | null {
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
      mode: "workload_identity",
      iatSkewSeconds: 30,
    },
  };
}

export async function resolveWorkloadBootstrap(
  deps: WorkloadBootstrapDeps,
  input: { publicIdentityKey: string; contractDigest: string },
): Promise<WorkloadBootstrapResult> {
  const instanceId = workloadInstanceId(input.publicIdentityKey);
  const instance = await deps.loadWorkloadInstance(instanceId);
  if (!instance) {
    return { status: "activation_required" };
  }
  if (instance.state === "disabled") {
    return { status: "not_ready", reason: "workload_disabled" };
  }

  const activation = await deps.loadWorkloadActivation(instanceId);
  if (!activation) {
    return { status: "activation_required" };
  }
  if (activation.state === "revoked") {
    return { status: "not_ready", reason: "workload_activation_revoked" };
  }

  const profile = await deps.loadWorkloadProfile(activation.profileId);
  if (!profile || profile.disabled) {
    return { status: "not_ready", reason: "workload_profile_not_found" };
  }

  const connectInfo = buildWorkloadConnectInfo({
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

export function createWorkloadBootstrapHandler(deps: WorkloadBootstrapDeps) {
  return async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = bodyResult.take();
    if (!Value.Check(WorkloadBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }

    const request = body;
    const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    if (!isWorkloadProofIatFresh(request.iat, nowSeconds)) {
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

    return c.json(await resolveWorkloadBootstrap(deps, request));
  };
}

export async function verifyWorkloadBootstrapIdentityProof(input: {
  publicIdentityKey: string;
  contractDigest: string;
  iat: number;
  sig: string;
}): Promise<boolean> {
  return await verifyWorkloadWaitSignature({
    publicIdentityKey: input.publicIdentityKey,
    nonce: "connect-info",
    contractDigest: input.contractDigest,
    iat: input.iat,
    sig: input.sig,
  });
}
