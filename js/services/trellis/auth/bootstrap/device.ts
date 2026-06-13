import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { verifyDeviceWaitSignature } from "@qlever-llc/trellis/auth";
import type { ContractsModule } from "../../catalog/runtime.ts";
import { deviceInstanceId } from "../admin/shared.ts";
import { analyzeContractProposal } from "../contract_proposal_analysis.ts";
import {
  computeAuthorityNeedsDelta,
  evaluateProposalNeedsFit,
} from "../authority_needs_decision.ts";
import { normalizeAuthorityNeeds } from "../authority_needs.ts";
import { SignatureSchema } from "../schemas.ts";
import type {
  AuthorityNeedSet,
  AuthoritySurfaceAction,
  AuthoritySurfaceKind,
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
  DeploymentAuthorityResourceKind,
} from "../schemas.ts";
import type { BoundedListQuery } from "../storage.ts";
import { isDeviceProofIatFresh } from "../device_activation/shared.ts";

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });
const ClientTransportEndpointsSchema = Type.Object({
  natsServers: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
});
const ClientTransportsSchema = Type.Object({
  native: Type.Optional(ClientTransportEndpointsSchema),
  websocket: Type.Optional(ClientTransportEndpointsSchema),
});

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

type DeploymentAuthorityStorage = {
  get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
};

type DeploymentAuthorityPlanStorage = {
  listFiltered(
    filters: { deploymentId?: string; state?: string },
    query: BoundedListQuery,
  ): Promise<DeploymentAuthorityPlan[]>;
};

type MaterializedAuthorityStorage = {
  get(
    deploymentId: string,
  ): Promise<DeploymentAuthorityMaterialization | undefined>;
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
  deploymentAuthorityStorage: DeploymentAuthorityStorage;
  deploymentAuthorityPlanStorage: DeploymentAuthorityPlanStorage;
  materializedAuthorityStorage: MaterializedAuthorityStorage;
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

const EMPTY_AUTHORITY_NEEDS: AuthorityNeedSet = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function mergeAuthorityNeeds(...needs: AuthorityNeedSet[]): AuthorityNeedSet {
  return computeAuthorityNeedsDelta(EMPTY_AUTHORITY_NEEDS, {
    contracts: needs.flatMap((needSet) => needSet.contracts),
    surfaces: needs.flatMap((needSet) => needSet.surfaces),
    capabilities: needs.flatMap((needSet) => needSet.capabilities),
    resources: needs.flatMap((needSet) => needSet.resources),
  });
}

function desiredStateAuthorityNeeds(
  authority: DeploymentAuthority,
): AuthorityNeedSet {
  return mergeAuthorityNeeds({
    contracts: authority.desiredState.needs.contracts,
    surfaces: authority.desiredState.needs.surfaces,
    capabilities: authority.desiredState.needs.capabilities,
    resources: authority.desiredState.needs.resources,
  }, {
    contracts: [],
    surfaces: authority.desiredState.surfaces.map((surface) => ({
      ...surface,
      required: true,
    })),
    capabilities: authority.desiredState.capabilities.map((capability) => ({
      capability,
      required: true,
    })),
    resources: authority.desiredState.resources,
  });
}

function authoritySurfaceKind(
  value: unknown,
): AuthoritySurfaceKind | undefined {
  switch (value) {
    case "rpc":
    case "operation":
    case "event":
    case "feed":
      return value;
    default:
      return undefined;
  }
}

function authoritySurfaceAction(
  value: unknown,
): AuthoritySurfaceAction | undefined {
  switch (value) {
    case "call":
    case "publish":
    case "subscribe":
    case "observe":
    case "cancel":
      return value;
    default:
      return undefined;
  }
}

function authorityResourceKind(
  value: unknown,
): DeploymentAuthorityResourceKind | undefined {
  switch (value) {
    case "kv":
    case "store":
    case "jobs":
    case "event-consumer":
    case "transfer":
      return value;
    default:
      return undefined;
  }
}

function materializedAuthorityNeeds(
  materialized: DeploymentAuthorityMaterialization,
): AuthorityNeedSet {
  return normalizeAuthorityNeeds({
    contracts: [],
    surfaces: materialized.grants.surfaces.flatMap((grant) => {
      const kind = authoritySurfaceKind(grant.surfaceKind);
      const action = authoritySurfaceAction(grant.action);
      return kind !== undefined &&
          (grant.action === undefined || action !== undefined)
        ? [{
          contractId: grant.contractId,
          kind,
          name: grant.name,
          ...(action === undefined ? {} : { action }),
          required: true,
        }]
        : [];
    }),
    capabilities: materialized.grants.capabilities.map((grant) => ({
      capability: grant.capability,
      required: true,
    })),
    resources: materialized.resourceBindings.flatMap((binding) => {
      const kind = authorityResourceKind(binding.kind);
      return kind === undefined
        ? []
        : [{ kind, alias: binding.alias, required: true }];
    }),
  });
}

function runtimeAuthorityNeeds(needs: AuthorityNeedSet): AuthorityNeedSet {
  return {
    contracts: [],
    surfaces: needs.surfaces,
    capabilities: needs.capabilities,
    resources: needs.resources,
  };
}

async function resolveDeviceAuthorityContract(input: {
  deps: DeviceConnectInfoResolverDeps;
  deploymentId: string;
  contractDigest: string;
}): Promise<
  | { status: "ready"; contract: TrellisContractV1 }
  | { status: "not_ready"; reason: string }
> {
  const deploymentAuthority = await input.deps.deploymentAuthorityStorage.get(
    input.deploymentId,
  );
  if (!deploymentAuthority || deploymentAuthority.disabled) {
    return { status: "not_ready", reason: "device_deployment_not_found" };
  }

  const contract = await input.deps.contracts.getContract(
    input.contractDigest,
    {
      includeInactive: true,
    },
  ) ?? await acceptedAuthorityPlanContract(input);
  if (!contract) {
    return { status: "not_ready", reason: "contract_digest_not_allowed" };
  }

  const analysis = await analyzeContractProposal(
    input.deps.contracts,
    contract,
  );
  const requestedAuthority = mergeAuthorityNeeds(
    analysis.required,
    analysis.contributedAvailability,
  );
  const fit = evaluateProposalNeedsFit(
    desiredStateAuthorityNeeds(deploymentAuthority),
    requestedAuthority,
  );
  if (!fit.fits) {
    return { status: "not_ready", reason: "authority_needs_not_authorized" };
  }

  const materializedAuthority = await input.deps.materializedAuthorityStorage
    .get(
      input.deploymentId,
    );
  if (
    materializedAuthority === undefined ||
    materializedAuthority.desiredVersion !== deploymentAuthority.version ||
    materializedAuthority.status === "pending"
  ) {
    return { status: "not_ready", reason: "authority_reconciliation_pending" };
  }
  if (materializedAuthority.status === "failed") {
    return { status: "not_ready", reason: "authority_reconciliation_failed" };
  }
  const materializedFit = evaluateProposalNeedsFit(
    materializedAuthorityNeeds(materializedAuthority),
    runtimeAuthorityNeeds(requestedAuthority),
  );
  if (!materializedFit.fits) {
    return { status: "not_ready", reason: "authority_needs_not_materialized" };
  }
  return { status: "ready", contract };
}

async function acceptedAuthorityPlanContract(input: {
  deps: DeviceConnectInfoResolverDeps;
  deploymentId: string;
  contractDigest: string;
}): Promise<TrellisContractV1 | undefined> {
  const plans = await input.deps.deploymentAuthorityPlanStorage.listFiltered(
    { deploymentId: input.deploymentId, state: "accepted" },
    { limit: 500 },
  );
  for (const plan of plans) {
    if (plan.proposal.contractDigest !== input.contractDigest) continue;
    if (plan.proposal.contract === undefined) continue;
    const validated = await input.deps.contracts.validateContract(
      plan.proposal.contract,
    );
    if (validated.digest === input.contractDigest) {
      return validated.contract;
    }
  }
  return undefined;
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
    if (deployment.reviewMode === "required") {
      return { status: "activation_required" };
    }
    const contractResult = await resolveDeviceAuthorityContract({
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

  const contractResult = await resolveDeviceAuthorityContract({
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
        result.reason === "authority_needs_not_authorized" ||
        result.reason === "authority_needs_not_materialized"
      ) {
        return c.json({ reason: result.reason }, 403);
      }
      if (
        result.reason === "authority_reconciliation_pending" ||
        result.reason === "authority_reconciliation_failed"
      ) {
        return c.json({ reason: result.reason }, 202);
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
    flowId: "connect-info",
    publicIdentityKey: input.publicIdentityKey,
    nonce: "connect-info",
    contractDigest: input.contractDigest,
    iat: input.iat,
    sig: input.sig,
  });
}
