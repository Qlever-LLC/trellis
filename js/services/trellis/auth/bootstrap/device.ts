import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { verifyDeviceWaitSignature } from "@qlever-llc/trellis/auth";
import type { ContractsModule } from "../../catalog/runtime.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import {
  computeEnvelopeDelta,
  evaluateEnvelopeFit,
} from "../envelope_decision.ts";
import { SignatureSchema } from "../schemas.ts";
import type { DeploymentEnvelope, EnvelopeBoundary } from "../schemas.ts";
import { isDeviceProofIatFresh } from "../device_activation/shared.ts";

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });
const ClientTransportEndpointsSchema = Type.Object({
  natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
}, { additionalProperties: false });
const ClientTransportsSchema = Type.Object({
  native: Type.Optional(ClientTransportEndpointsSchema),
  websocket: Type.Optional(ClientTransportEndpointsSchema),
}, { additionalProperties: false });

export const DeviceConnectInfoRequestSchema = Type.Object({
  publicIdentityKey: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: SignatureSchema,
});

type DeviceInstance = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  metadata?: Record<string, string>;
  state: "registered" | "activated" | "revoked" | "disabled";
  createdAt: string | Date;
  activatedAt: string | Date | null;
  revokedAt: string | Date | null;
};

type DeviceDeployment = {
  deploymentId: string;
  reviewMode?: "none" | "required";
  disabled: boolean;
};

type DeviceActivation = {
  instanceId: string;
  publicIdentityKey: string;
  deploymentId: string;
  state: "activated" | "revoked";
  activatedAt: string;
  revokedAt: string | null;
};

type DeploymentEnvelopeStorage = {
  get(deploymentId: string): Promise<DeploymentEnvelope | undefined>;
};

type DeviceConnectInfo = {
  instanceId: string;
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  transport: {
    sentinel: {
      jwt: string;
      seed: string;
    };
  };
  auth: {
    mode: "device_identity";
    authority: "admin_reviewed" | "user_delegated";
    iatSkewSeconds: number;
  };
};

export type DeviceConnectInfoResult =
  | { status: "ready"; connectInfo: DeviceConnectInfo }
  | { status: "activation_required" }
  | { status: "not_ready"; reason: string };

export type DeviceConnectInfoResolverDeps = {
  contracts: Pick<
    ContractsModule,
    | "getActiveContractsById"
    | "getActiveEntries"
    | "getContract"
    | "validateContract"
  >;
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  sentinel: {
    jwt: string;
    seed: string;
  };
  loadDeviceInstance(instanceId: string): Promise<DeviceInstance | null>;
  loadDeviceActivation(
    instanceId: string,
  ): Promise<DeviceActivation | null>;
  loadDeviceDeployment(deploymentId: string): Promise<DeviceDeployment | null>;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
};

export type DeviceConnectInfoDeps = DeviceConnectInfoResolverDeps & {
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
  deploymentId: string;
  contract: TrellisContractV1;
  contractDigest: string;
  authority: "admin_reviewed" | "user_delegated";
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  sentinel: {
    jwt: string;
    seed: string;
  };
}): DeviceConnectInfo {
  return {
    instanceId: args.instance.instanceId,
    deploymentId: args.deploymentId,
    contractId: args.contract.id,
    contractDigest: args.contractDigest,
    transports: args.transports,
    transport: {
      sentinel: args.sentinel,
    },
    auth: {
      mode: "device_identity",
      authority: args.authority,
      iatSkewSeconds: 30,
    },
  };
}

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function mergeBoundaries(...boundaries: EnvelopeBoundary[]): EnvelopeBoundary {
  return computeEnvelopeDelta(EMPTY_BOUNDARY, {
    contracts: boundaries.flatMap((boundary) => boundary.contracts),
    surfaces: boundaries.flatMap((boundary) => boundary.surfaces),
    capabilities: boundaries.flatMap((boundary) => boundary.capabilities),
    resources: boundaries.flatMap((boundary) => boundary.resources),
  });
}

async function resolveDeviceEnvelopeContract(input: {
  deps: DeviceConnectInfoResolverDeps;
  deploymentId: string;
  contractDigest: string;
}): Promise<
  | { status: "ready"; contract: TrellisContractV1 }
  | { status: "not_ready"; reason: string }
> {
  const deploymentEnvelope = await input.deps.deploymentEnvelopeStorage.get(
    input.deploymentId,
  );
  if (!deploymentEnvelope || deploymentEnvelope.disabled) {
    return { status: "not_ready", reason: "device_deployment_not_found" };
  }

  const contract = await input.deps.contracts.getContract(
    input.contractDigest,
    {
      includeInactive: true,
    },
  );
  if (!contract) {
    return { status: "not_ready", reason: "contract_digest_not_allowed" };
  }

  const analysis = await analyzeContractEnvelopeBoundary(
    input.deps.contracts,
    contract,
  );
  const requestedBoundary = mergeBoundaries(
    analysis.required,
    analysis.contributedAvailability,
  );
  const fit = evaluateEnvelopeFit(
    deploymentEnvelope.boundary,
    requestedBoundary,
  );
  if (!fit.fits) {
    return { status: "not_ready", reason: "device_envelope_miss" };
  }
  return { status: "ready", contract };
}

export async function resolveDeviceConnectInfo(
  deps: DeviceConnectInfoResolverDeps,
  input: { publicIdentityKey: string; contractDigest: string },
): Promise<DeviceConnectInfoResult> {
  const instanceId = deviceInstanceId(input.publicIdentityKey);
  const instance = await deps.loadDeviceInstance(instanceId);
  if (!instance) {
    return { status: "activation_required" };
  }
  if (instance.state === "disabled" || instance.state === "revoked") {
    return { status: "not_ready", reason: "device_disabled" };
  }

  const activation = await deps.loadDeviceActivation(instanceId);
  if (!activation) {
    if (instance.state !== "registered") {
      return { status: "activation_required" };
    }
    const deployment = await deps.loadDeviceDeployment(instance.deploymentId);
    if (!deployment || deployment.disabled) {
      return { status: "not_ready", reason: "device_deployment_not_found" };
    }
    const contractResult = await resolveDeviceEnvelopeContract({
      deps,
      deploymentId: deployment.deploymentId,
      contractDigest: input.contractDigest,
    });
    if (contractResult.status === "not_ready") return contractResult;
    const connectInfo = buildDeviceConnectInfo({
      instance,
      deploymentId: deployment.deploymentId,
      contract: contractResult.contract,
      contractDigest: input.contractDigest,
      authority: "admin_reviewed",
      transports: deps.transports,
      sentinel: deps.sentinel,
    });
    return { status: "ready", connectInfo };
  }
  if (activation.state === "revoked") {
    return { status: "not_ready", reason: "device_activation_revoked" };
  }
  if (
    activation.publicIdentityKey !== instance.publicIdentityKey ||
    activation.deploymentId !== instance.deploymentId
  ) {
    return { status: "not_ready", reason: "device_activation_revoked" };
  }

  const deployment = await deps.loadDeviceDeployment(activation.deploymentId);
  if (!deployment || deployment.disabled) {
    return { status: "not_ready", reason: "device_deployment_not_found" };
  }

  const contractResult = await resolveDeviceEnvelopeContract({
    deps,
    deploymentId: deployment.deploymentId,
    contractDigest: input.contractDigest,
  });
  if (contractResult.status === "not_ready") return contractResult;

  const connectInfo = buildDeviceConnectInfo({
    instance,
    deploymentId: deployment.deploymentId,
    contract: contractResult.contract,
    contractDigest: input.contractDigest,
    authority: "user_delegated",
    transports: deps.transports,
    sentinel: deps.sentinel,
  });

  return {
    status: "ready",
    connectInfo,
  };
}

export function createDeviceConnectInfoHandler(deps: DeviceConnectInfoDeps) {
  return async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = bodyResult.take();
    if (!Value.Check(DeviceConnectInfoRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }

    const request = body;
    const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    if (!isDeviceProofIatFresh(request.iat, nowSeconds)) {
      return c.json({ reason: "iat_out_of_range", serverNow: nowSeconds }, 400);
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

    const result = await resolveDeviceConnectInfo(deps, request);
    if (result.status === "activation_required") {
      return c.json({ reason: "unknown_device" }, 404);
    }
    if (result.status === "not_ready") {
      if (
        result.reason === "contract_digest_not_allowed" ||
        result.reason === "device_envelope_miss"
      ) {
        return c.json({ reason: result.reason }, 403);
      }
      if (result.reason === "device_deployment_not_found") {
        return c.json({ reason: result.reason }, 404);
      }
      return c.json({ reason: "unknown_device" }, 404);
    }
    return c.json(result);
  };
}

export async function verifyDeviceConnectInfoIdentityProof(input: {
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
