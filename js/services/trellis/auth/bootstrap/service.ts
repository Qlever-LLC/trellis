import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ulid } from "ulid";

import type { ContractsModule } from "../../catalog/runtime.ts";
import {
  type ContractEntry,
  ContractUseDependencyError,
  validateActiveContractCompatibility,
} from "../../catalog/uses.ts";
import {
  analyzeContractProposal,
  type ContractProposalAnalysis,
} from "../contract_proposal_analysis.ts";
import { evaluateProposalNeedsFit } from "../authority_needs_decision.ts";
import {
  emptyAuthorityNeeds,
  mergeAuthorityNeeds,
  normalizeAuthorityNeeds,
} from "../authority_needs.ts";
import { classifyDeploymentAuthorityPlan } from "../deployment_authority_plan.ts";
import { SessionKeySchema, SignatureSchema } from "../schemas.ts";
import type {
  AuthorityNeedSet,
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
  DeploymentResourceBinding,
  ImplementationOffer,
  SentinelCreds,
} from "../schemas.ts";

export const DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS = 30;

export function isServiceBootstrapProofIatFresh(
  iat: number,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  skewSeconds: number = DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS,
): boolean {
  return Math.abs(nowSeconds - iat) <= skewSeconds;
}

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

type ServiceBootstrapInstance = {
  instanceId: string;
  deploymentId: string;
  instanceKey: string;
  disabled: boolean;
  capabilities: string[];
  resourceBindings?: Record<string, unknown>;
  createdAt: string | Date;
};

type ServiceBootstrapDeployment = {
  deploymentId: string;
  namespaces: string[];
  contractCompatibilityMode?: "strict" | "mutable-dev";
  disabled: boolean;
};

type DeploymentAuthorityStorage = {
  get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
  listEnabled(): Promise<DeploymentAuthority[]>;
  put(record: DeploymentAuthority): Promise<void>;
  acceptAuthorityPlan?(
    authority: DeploymentAuthority,
    plan: DeploymentAuthorityPlan,
    expectedCurrentAuthorityVersion: string,
  ): Promise<boolean>;
};

type DeploymentAuthorityPlanStorage = {
  put(record: DeploymentAuthorityPlan): Promise<void>;
  listFiltered(
    filters: { deploymentId?: string; state?: string },
    query: { limit: number; offset?: number },
  ): Promise<DeploymentAuthorityPlan[]>;
};

type DeploymentAuthorityCapabilityDefinitionStorage = {
  replaceForDeployment(
    deploymentId: string,
    definitions: Awaited<ReturnType<typeof analyzeContractProposal>>[
      "capabilityDefinitions"
    ],
  ): Promise<void>;
};

type MaterializedAuthorityStorage = {
  get(
    deploymentId: string,
  ): Promise<DeploymentAuthorityMaterialization | undefined>;
};

type ImplementationOfferStorage = {
  get(offerId: string): Promise<ImplementationOffer | undefined>;
  put(record: ImplementationOffer): Promise<void>;
  latestAcceptedByLineage(
    lineageKey: string,
  ): Promise<ImplementationOffer | undefined>;
};

type ContractCompatibilityFailure = {
  message: string;
  latestAcceptedContractDigest: string;
};

type DeploymentAuthorityMigrationPlan = Extract<
  DeploymentAuthorityPlan,
  { classification: "migration" }
>;

type AuthorityReconciler = {
  reconcileDeployment(
    deploymentId: string,
    opts?: { desiredVersion?: string },
  ): Promise<unknown>;
};

export const ServiceBootstrapRequestSchema = Type.Object({
  sessionKey: SessionKeySchema,
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  contract: Type.Optional(Type.Unknown()),
  iat: Type.Number(),
  sig: SignatureSchema,
});

export type ServiceBootstrapDeps = {
  contracts: Pick<
    ContractsModule,
    | "getActiveEntries"
    | "getContract"
    | "getKnownEntriesByContractId"
    | "validateContract"
  >;
  transports: {
    native?: { natsServers: string[] };
    websocket?: { natsServers: string[] };
  };
  sentinel: SentinelCreds;
  loadServiceInstance(
    instanceKey: string,
  ): Promise<ServiceBootstrapInstance | null>;
  saveServiceInstance(instance: ServiceBootstrapInstance): Promise<void>;
  loadServiceDeployment(deploymentId: string): Promise<
    ServiceBootstrapDeployment | null
  >;
  deploymentAuthorityStorage: DeploymentAuthorityStorage;
  deploymentAuthorityPlanStorage: DeploymentAuthorityPlanStorage;
  capabilityDefinitionStorage?: DeploymentAuthorityCapabilityDefinitionStorage;
  materializedAuthorityStorage: MaterializedAuthorityStorage;
  implementationOfferStorage: ImplementationOfferStorage;
  storePresentedContract?(input: {
    contract: TrellisContractV1;
    digest: string;
    canonical: string;
  }): Promise<void>;
  verifyIdentityProof(input: {
    sessionKey: string;
    iat: number;
    contractDigest: string;
    sig: string;
  }): Promise<boolean>;
  nowSeconds?(): number;
  now?(): Date;
  createAuthorityPlanId?(): string;
  createAuthorityVersion?(): string;
  authorityReconciler?: AuthorityReconciler;
};

function buildContractView(contract: TrellisContractV1, digest: string) {
  return {
    id: contract.id,
    digest,
    displayName: contract.displayName,
    description: contract.description,
    ...(contract.jobs ? { jobs: contract.jobs } : {}),
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

function bootstrapFailure(
  reason: string,
  message?: string,
  extra?: Record<string, unknown>,
) {
  return {
    reason,
    ...(message ? { message } : {}),
    ...(extra ?? {}),
  };
}

function dependencyReasonForResponse(
  error: ContractUseDependencyError,
): string {
  return error.reason === "inactive" ? "dependency_not_active" : error.reason;
}

function dependencySurfaceLabel(
  surface: ContractUseDependencyError["surface"],
): string {
  return surface === "rpc" ? "RPC" : surface;
}

function dependencyWaitMessage(args: {
  contractId: string;
  contractDigest: string;
  error: ContractUseDependencyError;
}): string {
  const dependency =
    `dependency '${args.error.alias}' (${args.error.contractId})`;
  const prefix =
    `Service contract '${args.contractId}' digest '${args.contractDigest}' is waiting for ${dependency}`;
  if (args.error.reason === "inactive") {
    return `${prefix} to have an active running implementation.`;
  }
  if (args.error.reason === "unknown") {
    return `${prefix} to be installed or approved.`;
  }
  if (args.error.key !== undefined) {
    return `${prefix} to provide required ${
      dependencySurfaceLabel(args.error.surface)
    } '${args.error.key}'.`;
  }
  return `${prefix} to provide required ${
    dependencySurfaceLabel(args.error.surface)
  } access.`;
}

function dependencyFailureContext(args: {
  service: { instanceId: string };
  deployment: { deploymentId: string };
  request: { contractId: string; contractDigest: string };
  error: ContractUseDependencyError;
}): Record<string, unknown> {
  return {
    instanceId: args.service.instanceId,
    deploymentId: args.deployment.deploymentId,
    contractId: args.request.contractId,
    contractDigest: args.request.contractDigest,
    dependencyAlias: args.error.alias,
    dependencyContractId: args.error.contractId,
    dependencySurface: args.error.surface,
    dependencyReason: dependencyReasonForResponse(args.error),
    dependencyMessage: dependencyWaitMessage({
      contractId: args.request.contractId,
      contractDigest: args.request.contractDigest,
      error: args.error,
    }),
    ...(args.error.key !== undefined ? { dependencyKey: args.error.key } : {}),
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getRequiredServiceCapabilities(
  analysis: ContractProposalAnalysis,
  contract: TrellisContractV1,
): string[] {
  const capabilities = new Set<string>([
    "service",
    ...analysis.required.capabilities.map((need) => need.capability),
    ...analysis.optional.capabilities.map((need) => need.capability),
  ]);
  const events = contract.events as
    | Record<string, {
      capabilities?: { publish?: string[] };
    }>
    | undefined;
  for (const event of Object.values(events ?? {})) {
    for (const capability of event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }
  return [...capabilities].sort((left, right) => left.localeCompare(right));
}

function sameJsonRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuthorityNeedSet(value: unknown): value is AuthorityNeedSet {
  if (!isRecord(value)) return false;
  const { contracts, surfaces, capabilities, resources } = value;
  return Array.isArray(contracts) &&
    contracts.every((contract) =>
      isRecord(contract) && typeof contract.contractId === "string" &&
      typeof contract.required === "boolean"
    ) && Array.isArray(surfaces) &&
    surfaces.every((surface) =>
      isRecord(surface) && typeof surface.contractId === "string" &&
      typeof surface.kind === "string" && typeof surface.name === "string" &&
      typeof surface.required === "boolean"
    ) && Array.isArray(capabilities) &&
    capabilities.every((capability) =>
      isRecord(capability) && typeof capability.capability === "string" &&
      typeof capability.required === "boolean"
    ) && Array.isArray(resources) &&
    resources.every((resource) =>
      isRecord(resource) && typeof resource.kind === "string" &&
      typeof resource.alias === "string" &&
      typeof resource.required === "boolean"
    );
}

function mergeBoundaries(...boundaries: AuthorityNeedSet[]): AuthorityNeedSet {
  return mergeAuthorityNeeds(...boundaries);
}

function isEmptyBoundary(boundary: AuthorityNeedSet): boolean {
  return boundary.contracts.length === 0 && boundary.surfaces.length === 0 &&
    boundary.capabilities.length === 0 && boundary.resources.length === 0;
}

function resourceKey(kind: string, alias: string): string {
  return `${kind}\u001f${alias}`;
}

function serviceOfferLineageKey(
  deploymentId: string,
  contractId: string,
): string {
  return JSON.stringify(["service", deploymentId, contractId]);
}

function serviceOfferId(input: {
  deploymentId: string;
  instanceId: string;
  contractId: string;
  contractDigest: string;
}): string {
  return JSON.stringify([
    "service",
    input.deploymentId,
    input.instanceId,
    input.contractId,
    input.contractDigest,
  ]);
}

async function assertPresentedContractCompatible(input: {
  contracts: Pick<ServiceBootstrapDeps["contracts"], "getContract">;
  deployment: ServiceBootstrapDeployment;
  implementationOfferStorage: ImplementationOfferStorage;
  presentedDigest: string;
  presentedContract: TrellisContractV1;
}): Promise<ContractCompatibilityFailure | null> {
  const latestAccepted = await input.implementationOfferStorage
    .latestAcceptedByLineage(
      serviceOfferLineageKey(
        input.deployment.deploymentId,
        input.presentedContract.id,
      ),
    );
  const currentDigest = latestAccepted?.contractDigest;
  if (!currentDigest || currentDigest === input.presentedDigest) {
    return null;
  }

  const currentContract = await input.contracts.getContract(currentDigest, {
    includeInactive: true,
  });
  if (!currentContract) {
    return {
      message: `previous service contract digest '${currentDigest}' is unknown`,
      latestAcceptedContractDigest: currentDigest,
    };
  }
  try {
    validateActiveContractCompatibility([
      { digest: currentDigest, contract: currentContract },
      { digest: input.presentedDigest, contract: input.presentedContract },
    ]);
    return null;
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      latestAcceptedContractDigest: currentDigest,
    };
  }
}

function resourceBindingsForResponse(
  records: DeploymentResourceBinding[],
): Record<string, unknown> {
  const resources: Record<string, unknown> = {};
  const resourcesByKind: Record<string, Record<string, unknown>> = {};
  let jobsBinding:
    | {
      namespace: unknown;
      workStream?: unknown;
      queues: Record<string, Record<string, unknown>>;
    }
    | undefined;
  for (const record of records) {
    if (record.kind === "jobs") {
      const { namespace, workStream, ...queueBinding } = record.binding;
      jobsBinding ??= {
        namespace,
        ...(workStream !== undefined ? { workStream } : {}),
        queues: {},
      };
      jobsBinding.queues[record.alias] = queueBinding;
      continue;
    }

    const responseKind = record.kind === "event-consumer"
      ? "eventConsumers"
      : record.kind;
    resourcesByKind[responseKind] ??= {};
    resourcesByKind[responseKind][record.alias] = record.binding;
  }
  for (const [kind, bindings] of Object.entries(resourcesByKind)) {
    resources[kind] = bindings;
  }
  if (jobsBinding) resources.jobs = jobsBinding;
  return resources;
}

function authorityProvidesContract(
  authority: DeploymentAuthority,
  contractId: string,
): boolean {
  if (authority.disabled) return false;
  return authority.desiredState.needs.contracts.some((need) =>
    need.required && need.contractId === contractId
  ) || authority.desiredState.surfaces.some((surface) =>
    surface.contractId === contractId
  );
}

function newestAcceptedPlanFirst(
  left: DeploymentAuthorityPlan,
  right: DeploymentAuthorityPlan,
): number {
  return (right.decisionAt ?? "").localeCompare(left.decisionAt ?? "") ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.planId.localeCompare(left.planId);
}

async function acceptedAuthorityContractEntry(
  deps: ServiceBootstrapDeps,
  contractId: string,
): Promise<ContractEntry | undefined> {
  const authorities = (await deps.deploymentAuthorityStorage.listEnabled())
    .filter((authority) => authorityProvidesContract(authority, contractId));

  for (const authority of authorities) {
    const plans = (await deps.deploymentAuthorityPlanStorage.listFiltered(
      { deploymentId: authority.deploymentId, state: "accepted" },
      { limit: 500 },
    ))
      .filter((plan) => plan.proposal.contractId === contractId)
      .sort(newestAcceptedPlanFirst);

    for (const plan of plans) {
      const rawContract = plan.proposal.contract;
      if (rawContract === undefined) continue;
      const validated = await deps.contracts.validateContract(rawContract);
      if (
        validated.contract.id === contractId &&
        validated.digest === plan.proposal.contractDigest
      ) {
        return { digest: validated.digest, contract: validated.contract };
      }
    }
  }

  return undefined;
}

function boundaryContractDeps(deps: ServiceBootstrapDeps) {
  return {
    ...deps.contracts,
    getAcceptedFallbackEntryByContractId: (contractId: string) =>
      acceptedAuthorityContractEntry(deps, contractId),
  };
}

function desiredStateToAuthorityNeeds(
  desiredState: DeploymentAuthority["desiredState"],
): AuthorityNeedSet {
  return mergeBoundaries({
    contracts: desiredState.needs.contracts,
    surfaces: [
      ...desiredState.needs.surfaces,
      ...desiredState.surfaces.map((surface) => ({
        ...surface,
        required: true,
      })),
    ],
    capabilities: [
      ...desiredState.needs.capabilities,
      ...desiredState.capabilities.map((capability) => ({
        capability,
        required: true,
      })),
    ],
    resources: [...desiredState.needs.resources, ...desiredState.resources],
  });
}

function authorityNeedsToProposalNeeds(
  needs: AuthorityNeedSet,
): DeploymentAuthorityPlan["proposal"]["requestedNeeds"] {
  return normalizeAuthorityNeeds(needs);
}

function desiredStateFromProposal(
  proposal: DeploymentAuthorityPlan["proposal"],
): DeploymentAuthority["desiredState"] {
  const capabilities = new Set<string>();
  const resources = new Map<
    string,
    DeploymentAuthority["desiredState"]["resources"][number]
  >();
  const surfaces = new Map<
    string,
    DeploymentAuthority["desiredState"]["surfaces"][number]
  >();

  for (const need of proposal.requestedNeeds.capabilities) {
    capabilities.add(need.capability);
  }
  for (const resource of proposal.requestedNeeds.resources) {
    resources.set(resourceKey(resource.kind, resource.alias), resource);
  }
  for (const surface of proposal.providedSurfaces) {
    surfaces.set(
      [surface.contractId, surface.kind, surface.name, surface.action].join(
        "\u001f",
      ),
      surface,
    );
  }

  return {
    needs: normalizeAuthorityNeeds(proposal.requestedNeeds),
    capabilities: [...capabilities].sort(),
    resources: [...resources.values()].sort((left, right) =>
      resourceKey(left.kind, left.alias).localeCompare(
        resourceKey(right.kind, right.alias),
      )
    ),
    surfaces: [...surfaces.values()].sort((left, right) =>
      left.contractId.localeCompare(right.contractId) ||
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name) ||
      (left.action ?? "").localeCompare(right.action ?? "")
    ),
  };
}

async function acceptMutableDevCompatibilityMigration(input: {
  deps: ServiceBootstrapDeps;
  authority: DeploymentAuthority;
  plan: DeploymentAuthorityMigrationPlan;
  service: ServiceBootstrapInstance;
  now: string;
}): Promise<DeploymentAuthority> {
  const newVersion = input.deps.createAuthorityVersion?.() ?? ulid();
  const updatedAuthority: DeploymentAuthority = {
    ...input.authority,
    desiredState: desiredStateFromProposal(input.plan.proposal),
    version: newVersion,
    updatedAt: input.now,
  };
  const acceptedPlan: DeploymentAuthorityMigrationPlan = {
    ...input.plan,
    acknowledgementRequired: false,
    state: "accepted",
    decisionAt: input.now,
    decisionBy: {
      kind: "system",
      mode: "mutable-dev",
      serviceInstanceId: input.service.instanceId,
    },
    decisionReason:
      "mutable-dev auto-accepted incompatible same-contract replacement",
  };

  if (input.deps.deploymentAuthorityStorage.acceptAuthorityPlan) {
    await input.deps.deploymentAuthorityPlanStorage.put(input.plan);
    const accepted = await input.deps.deploymentAuthorityStorage
      .acceptAuthorityPlan(
        updatedAuthority,
        acceptedPlan,
        input.authority.version,
      );
    if (!accepted) return input.authority;
  } else {
    await input.deps.deploymentAuthorityStorage.put(updatedAuthority);
    await input.deps.deploymentAuthorityPlanStorage.put(acceptedPlan);
  }

  try {
    await input.deps.authorityReconciler?.reconcileDeployment(
      updatedAuthority.deploymentId,
      { desiredVersion: newVersion },
    );
  } catch {
    // Bootstrap reports reconciliation state below; failed scheduling must not
    // turn auto-approval history into implicit runtime authority.
  }
  return updatedAuthority;
}

async function pendingAuthorityPlanForContract(input: {
  storage: DeploymentAuthorityPlanStorage;
  deploymentId: string;
  contractId: string;
  contractDigest: string;
  desiredVersion: string;
  classification: DeploymentAuthorityPlan["classification"];
  desiredChange: AuthorityNeedSet;
  requestedNeeds: AuthorityNeedSet;
}): Promise<DeploymentAuthorityPlan | undefined> {
  const plans = await input.storage.listFiltered(
    { deploymentId: input.deploymentId, state: "pending" },
    { limit: 500 },
  );
  return plans.find((plan) =>
    plan.proposal.contractId === input.contractId &&
    plan.proposal.contractDigest === input.contractDigest &&
    plan.classification === input.classification &&
    isAuthorityNeedSet(plan.desiredChange) &&
    sameJsonRecord(
      normalizeAuthorityNeeds(plan.desiredChange),
      normalizeAuthorityNeeds(input.desiredChange),
    ) &&
    sameJsonRecord(
      normalizeAuthorityNeeds(plan.proposal.requestedNeeds),
      normalizeAuthorityNeeds(input.requestedNeeds),
    ) &&
    plan.proposal.summary !== undefined &&
    isRecord(plan.proposal.summary) &&
    plan.proposal.summary.desiredVersion === input.desiredVersion
  );
}

function compatibilityMigrationSummary(input: {
  requestedById: string;
  desiredVersion: string;
  previousContractDigest: string;
  authorityCapabilityDefinitions: Awaited<
    ReturnType<typeof analyzeContractProposal>
  >["capabilityDefinitions"];
}) {
  return {
    requestedByKind: "service",
    requestedById: input.requestedById,
    desiredVersion: input.desiredVersion,
    compatibilityMigration: true,
    previousContractDigest: input.previousContractDigest,
    authorityCapabilityDefinitions: input.authorityCapabilityDefinitions,
  };
}

function isCompatibilityMigrationPlan(input: {
  plan: DeploymentAuthorityPlan;
  deploymentId: string;
  contractId: string;
  previousContractDigest: string;
  presentedContractDigest: string;
  state?: string;
  desiredVersion?: string;
}): boolean {
  if (input.plan.deploymentId !== input.deploymentId) return false;
  if (input.plan.classification !== "migration") return false;
  if (
    input.state !== undefined && (input.plan.state ?? "pending") !== input.state
  ) {
    return false;
  }
  if (input.plan.proposal.contractId !== input.contractId) return false;
  if (input.plan.proposal.contractDigest !== input.presentedContractDigest) {
    return false;
  }
  const summary = input.plan.proposal.summary;
  if (summary === undefined || !isRecord(summary)) return false;
  return summary.compatibilityMigration === true &&
    summary.previousContractDigest === input.previousContractDigest &&
    (input.desiredVersion === undefined ||
      summary.desiredVersion === input.desiredVersion);
}

async function pendingCompatibilityMigrationPlan(input: {
  storage: DeploymentAuthorityPlanStorage;
  deploymentId: string;
  contractId: string;
  previousContractDigest: string;
  presentedContractDigest: string;
  desiredVersion: string;
}): Promise<DeploymentAuthorityMigrationPlan | undefined> {
  const plans = await input.storage.listFiltered(
    { deploymentId: input.deploymentId, state: "pending" },
    { limit: 500 },
  );
  for (const plan of plans) {
    if (plan.classification !== "migration") continue;
    if (
      isCompatibilityMigrationPlan({
        plan,
        deploymentId: input.deploymentId,
        contractId: input.contractId,
        previousContractDigest: input.previousContractDigest,
        presentedContractDigest: input.presentedContractDigest,
        desiredVersion: input.desiredVersion,
        state: "pending",
      })
    ) return plan;
  }
  return undefined;
}

async function acceptedCompatibilityMigrationExists(input: {
  contracts: Pick<ServiceBootstrapDeps["contracts"], "validateContract">;
  storage: DeploymentAuthorityPlanStorage;
  deploymentId: string;
  contractId: string;
  previousContractDigest: string;
  presentedContractDigest: string;
  requestedNeeds: AuthorityNeedSet;
}): Promise<boolean> {
  const plans = await input.storage.listFiltered(
    { deploymentId: input.deploymentId, state: "accepted" },
    { limit: 500 },
  );
  for (const plan of plans) {
    if (
      !isCompatibilityMigrationPlan({
        plan,
        deploymentId: input.deploymentId,
        contractId: input.contractId,
        previousContractDigest: input.previousContractDigest,
        presentedContractDigest: input.presentedContractDigest,
        state: "accepted",
      }) || !sameJsonRecord(
        normalizeAuthorityNeeds(plan.proposal.requestedNeeds),
        normalizeAuthorityNeeds(input.requestedNeeds),
      )
    ) {
      continue;
    }
    const rawContract = plan.proposal.contract;
    if (rawContract === undefined) continue;
    try {
      const validated = await input.contracts.validateContract(rawContract);
      if (
        validated.contract.id === input.contractId &&
        validated.digest === input.presentedContractDigest
      ) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function requestedResourceBindings(
  requested: AuthorityNeedSet,
  bindings: DeploymentResourceBinding[],
): DeploymentResourceBinding[] {
  const requestedKeys = new Set(
    requested.resources
      .filter((resource) => resource.kind !== "transfer")
      .map((resource) => resourceKey(resource.kind, resource.alias)),
  );
  return bindings.filter((binding) =>
    requestedKeys.has(resourceKey(binding.kind, binding.alias))
  );
}

async function acceptedServiceOfferRecord(input: {
  storage: ImplementationOfferStorage;
  deploymentId: string;
  instanceId: string;
  contract: TrellisContractV1;
  digest: string;
  now: string;
}): Promise<ImplementationOffer> {
  const offerId = serviceOfferId({
    deploymentId: input.deploymentId,
    instanceId: input.instanceId,
    contractId: input.contract.id,
    contractDigest: input.digest,
  });
  const lineageKey = serviceOfferLineageKey(
    input.deploymentId,
    input.contract.id,
  );
  const existing = await input.storage.get(offerId);
  const latestAccepted = await input.storage.latestAcceptedByLineage(
    lineageKey,
  );
  if (
    latestAccepted && latestAccepted.offerId !== offerId &&
    latestAccepted.contractDigest !== input.digest &&
    latestAccepted.staleAt === null
  ) {
    await input.storage.put({
      ...latestAccepted,
      liveness: "disconnected",
      lastRefreshedAt: input.now,
      staleAt: input.now,
    });
  }
  return {
    offerId,
    deploymentKind: "service",
    deploymentId: input.deploymentId,
    instanceId: input.instanceId,
    contractId: input.contract.id,
    contractDigest: input.digest,
    lineageKey,
    status: "accepted",
    liveness: "healthy",
    firstOfferedAt: existing?.firstOfferedAt ?? input.now,
    acceptedAt: existing?.acceptedAt ?? input.now,
    lastRefreshedAt: input.now,
    staleAt: null,
    expiresAt: null,
  };
}

export function createServiceBootstrapHandler(deps: ServiceBootstrapDeps) {
  return async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = bodyResult.take();
    if (!Value.Check(ServiceBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }

    const request = body;
    const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    if (!isServiceBootstrapProofIatFresh(request.iat, nowSeconds)) {
      return c.json({ reason: "iat_out_of_range", serverNow: nowSeconds }, 400);
    }

    const proofOk = await deps.verifyIdentityProof({
      sessionKey: request.sessionKey,
      iat: request.iat,
      contractDigest: request.contractDigest,
      sig: request.sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }

    const service = await deps.loadServiceInstance(request.sessionKey);
    if (!service) {
      return c.json(
        bootstrapFailure(
          "unknown_service",
          `Service instance for session key '${request.sessionKey}' is not provisioned in Trellis. Provision the instance before starting the service.`,
        ),
        404,
      );
    }
    if (service.disabled) {
      return c.json(
        bootstrapFailure(
          "service_disabled",
          `Service instance '${service.instanceId}' is disabled in Trellis. Enable the instance or provision a new one before reconnecting.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
          },
        ),
        403,
      );
    }

    const deployment = await deps.loadServiceDeployment(service.deploymentId);
    if (!deployment || deployment.disabled) {
      return c.json(
        bootstrapFailure(
          "service_deployment_disabled",
          `Service deployment '${service.deploymentId}' is disabled or missing in Trellis. Enable the deployment before reconnecting this instance.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
          },
        ),
        403,
      );
    }

    let deploymentAuthority = await deps.deploymentAuthorityStorage.get(
      service.deploymentId,
    );
    if (!deploymentAuthority || deploymentAuthority.disabled) {
      return c.json(
        bootstrapFailure(
          "service_deployment_disabled",
          `Service deployment '${service.deploymentId}' is disabled or missing in Trellis. Enable the deployment before reconnecting this instance.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
          },
        ),
        403,
      );
    }

    let rawContract: unknown = request.contract ??
      await deps.contracts.getContract(request.contractDigest, {
        includeInactive: true,
      });
    if (rawContract === undefined) {
      return c.json(
        bootstrapFailure(
          "manifest_required",
          `Service deployment '${deployment.deploymentId}' needs the full manifest for contract '${request.contractId}' digest '${request.contractDigest}' to evaluate deployment authority.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      );
    }

    let validated: Awaited<
      ReturnType<ServiceBootstrapDeps["contracts"]["validateContract"]>
    >;
    try {
      validated = await deps.contracts.validateContract(rawContract);
    } catch (error) {
      const contractError = toError(error);
      return c.json(
        bootstrapFailure(
          "presented_contract_invalid",
          `Presented contract manifest is invalid: ${contractError.message}`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            contractError: contractError.message,
          },
        ),
        409,
      );
    }

    let analysis: Awaited<
      ReturnType<typeof analyzeContractProposal>
    >;
    try {
      analysis = await analyzeContractProposal(
        boundaryContractDeps(deps),
        validated.contract,
        { dependencyResolution: "knownOrPending" },
      );
    } catch (error) {
      const catalogError = toError(error);
      if (error instanceof ContractUseDependencyError) {
        return c.json(
          bootstrapFailure(
            "contract_activation_pending",
            dependencyWaitMessage({
              contractId: request.contractId,
              contractDigest: request.contractDigest,
              error,
            }),
            dependencyFailureContext({ service, deployment, request, error }),
          ),
          202,
        );
      }
      return c.json(
        bootstrapFailure(
          "contract_catalog_issue",
          `Service contract '${request.contractId}' digest '${request.contractDigest}' is waiting for catalog authority resolution: ${catalogError.message}`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            catalogError: catalogError.message,
          },
        ),
        409,
      );
    }

    const contract = validated.contract;
    if (analysis.contract.digest !== request.contractDigest) {
      return c.json(
        bootstrapFailure(
          "presented_contract_digest_mismatch",
          `Presented contract digest '${analysis.contract.digest}' does not match requested digest '${request.contractDigest}'. Review and apply the intended contract before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            expectedContractDigest: request.contractDigest,
            presentedContractDigest: analysis.contract.digest,
          },
        ),
        409,
      );
    }
    if (contract.id !== request.contractId) {
      return c.json(
        bootstrapFailure(
          "presented_contract_id_mismatch",
          `Presented contract id '${contract.id}' does not match requested contract '${request.contractId}'. Review and apply the intended contract before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            expectedContractId: request.contractId,
            presentedContractId: contract.id,
            contractDigest: request.contractDigest,
          },
        ),
        409,
      );
    }

    if (request.contract !== undefined && deps.storePresentedContract) {
      await deps.storePresentedContract({
        contract,
        digest: request.contractDigest,
        canonical: validated.canonical,
      });
    }

    const requestedNeeds = mergeBoundaries(
      analysis.required,
      analysis.optional,
      {
        ...emptyAuthorityNeeds(),
        contracts: analysis.contributedAvailability.contracts,
      },
    );
    const providedSurfaces = analysis.contributedAvailability.surfaces.map(
      ({ required: _required, ...surface }) => surface,
    );
    const desiredNeeds = desiredStateToAuthorityNeeds(
      deploymentAuthority.desiredState,
    );
    const fit = evaluateProposalNeedsFit(
      desiredNeeds,
      requestedNeeds,
    );
    const now = (deps.now?.() ?? new Date()).toISOString();
    const planClassification = classifyDeploymentAuthorityPlan(
      desiredNeeds,
      requestedNeeds,
    );
    const requestedProposalNeeds = authorityNeedsToProposalNeeds(
      requestedNeeds,
    );
    const capabilityDefinitions = analysis.capabilityDefinitions.map(
      (definition) => ({
        ...definition,
        deploymentId: service.deploymentId,
      }),
    );

    const compatibilityError = await assertPresentedContractCompatible({
      contracts: deps.contracts,
      deployment,
      implementationOfferStorage: deps.implementationOfferStorage,
      presentedDigest: request.contractDigest,
      presentedContract: contract,
    });
    if (compatibilityError) {
      const acceptedCompatibilityMigration =
        await acceptedCompatibilityMigrationExists({
          contracts: deps.contracts,
          storage: deps.deploymentAuthorityPlanStorage,
          deploymentId: service.deploymentId,
          contractId: request.contractId,
          previousContractDigest:
            compatibilityError.latestAcceptedContractDigest,
          presentedContractDigest: request.contractDigest,
          requestedNeeds: requestedProposalNeeds,
        });
      if (!acceptedCompatibilityMigration) {
        const existingPlan = await pendingCompatibilityMigrationPlan({
          storage: deps.deploymentAuthorityPlanStorage,
          deploymentId: service.deploymentId,
          contractId: request.contractId,
          previousContractDigest:
            compatibilityError.latestAcceptedContractDigest,
          presentedContractDigest: request.contractDigest,
          desiredVersion: deploymentAuthority.version,
        });
        const plan: DeploymentAuthorityMigrationPlan = existingPlan ?? {
          planId: deps.createAuthorityPlanId?.() ?? ulid(),
          deploymentId: service.deploymentId,
          classification: "migration",
          proposal: {
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            contract: { ...contract },
            requestedNeeds: requestedProposalNeeds,
            providedSurfaces,
            summary: compatibilityMigrationSummary({
              requestedById: service.instanceId,
              desiredVersion: deploymentAuthority.version,
              previousContractDigest:
                compatibilityError.latestAcceptedContractDigest,
              authorityCapabilityDefinitions: capabilityDefinitions,
            }),
          },
          desiredChange: planClassification.desiredChange,
          materializationPreview: {},
          warnings: [compatibilityError.message],
          createdAt: now,
          state: "pending",
          acknowledgementRequired: true,
        };
        if (deployment.contractCompatibilityMode === "mutable-dev") {
          const acceptedAuthority =
            await acceptMutableDevCompatibilityMigration(
              {
                deps,
                authority: deploymentAuthority,
                plan,
                service,
                now,
              },
            );
          if (acceptedAuthority.version === deploymentAuthority.version) {
            return c.json(
              bootstrapFailure(
                "authority_migration_required",
                `Service contract '${request.contractId}' digest '${request.contractDigest}' has a deployment authority migration pending auto-accept retry. ${compatibilityError.message}`,
                {
                  instanceId: service.instanceId,
                  deploymentId: service.deploymentId,
                  contractId: request.contractId,
                  contractDigest: request.contractDigest,
                  latestAcceptedContractDigest:
                    compatibilityError.latestAcceptedContractDigest,
                  compatibilityMode: deployment.contractCompatibilityMode,
                  planId: plan.planId,
                  desiredVersion: deploymentAuthority.version,
                  classification: plan.classification,
                  desiredChange: plan.desiredChange,
                },
              ),
              202,
            );
          }
          deploymentAuthority = acceptedAuthority;
        } else {
          if (existingPlan === undefined) {
            await deps.deploymentAuthorityPlanStorage.put(plan);
            await deps.capabilityDefinitionStorage?.replaceForDeployment(
              service.deploymentId,
              capabilityDefinitions,
            );
          }
          return c.json(
            bootstrapFailure(
              "authority_migration_required",
              `Service contract '${request.contractId}' digest '${request.contractDigest}' is incompatible with the current deployment surface. A deployment authority migration plan is pending. ${compatibilityError.message}`,
              {
                instanceId: service.instanceId,
                deploymentId: service.deploymentId,
                contractId: request.contractId,
                contractDigest: request.contractDigest,
                latestAcceptedContractDigest:
                  compatibilityError.latestAcceptedContractDigest,
                compatibilityMode: deployment.contractCompatibilityMode ??
                  "strict",
                planId: plan.planId,
                desiredVersion: deploymentAuthority.version,
                classification: plan.classification,
                desiredChange: plan.desiredChange,
              },
            ),
            202,
          );
        }
      }
    }

    if (
      planClassification.classification === "migration" || !fit.fits ||
      !isEmptyBoundary(planClassification.desiredChange)
    ) {
      const existingPlan = await pendingAuthorityPlanForContract({
        storage: deps.deploymentAuthorityPlanStorage,
        deploymentId: service.deploymentId,
        contractId: request.contractId,
        contractDigest: request.contractDigest,
        desiredVersion: deploymentAuthority.version,
        classification: planClassification.classification,
        desiredChange: planClassification.desiredChange,
        requestedNeeds: requestedProposalNeeds,
      });
      const proposal = {
        deploymentId: service.deploymentId,
        contractId: request.contractId,
        contractDigest: request.contractDigest,
        contract: { ...contract },
        requestedNeeds: requestedProposalNeeds,
        providedSurfaces,
        summary: {
          requestedByKind: "service",
          requestedById: service.instanceId,
          desiredVersion: deploymentAuthority.version,
          authorityCapabilityDefinitions: capabilityDefinitions,
        },
      };
      const plan: DeploymentAuthorityPlan = existingPlan ??
        (planClassification.classification === "migration"
          ? {
            planId: deps.createAuthorityPlanId?.() ?? ulid(),
            deploymentId: service.deploymentId,
            classification: "migration",
            proposal,
            desiredChange: planClassification.desiredChange,
            materializationPreview: {},
            warnings: [],
            createdAt: now,
            state: "pending",
            acknowledgementRequired: true,
          }
          : {
            planId: deps.createAuthorityPlanId?.() ?? ulid(),
            deploymentId: service.deploymentId,
            classification: "update",
            proposal,
            desiredChange: planClassification.desiredChange,
            materializationPreview: {},
            warnings: [],
            createdAt: now,
            state: "pending",
          });
      if (existingPlan === undefined) {
        await deps.deploymentAuthorityPlanStorage.put(plan);
        await deps.capabilityDefinitionStorage?.replaceForDeployment(
          service.deploymentId,
          capabilityDefinitions,
        );
      }
      return c.json(
        bootstrapFailure(
          plan.classification === "migration"
            ? "authority_migration_required"
            : "authority_update_required",
          `Service deployment '${service.deploymentId}' authority does not cover contract '${request.contractId}' digest '${request.contractDigest}'. A deployment authority ${plan.classification} plan is pending.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            planId: plan.planId,
            desiredVersion: deploymentAuthority.version,
            classification: plan.classification,
            desiredChange: plan.desiredChange,
            missingAvailability: fit.missingAvailability,
            missingCapabilities: fit.missingCapabilities,
          },
        ),
        202,
      );
    }

    const capabilities = getRequiredServiceCapabilities(analysis, contract);

    let activeAnalysis: Awaited<
      ReturnType<typeof analyzeContractProposal>
    >;
    try {
      activeAnalysis = await analyzeContractProposal(
        boundaryContractDeps(deps),
        contract,
        { dependencyResolution: "activeOrAccepted" },
      );
    } catch (error) {
      const catalogError = toError(error);
      if (error instanceof ContractUseDependencyError) {
        return c.json(
          bootstrapFailure(
            "contract_activation_pending",
            dependencyWaitMessage({
              contractId: request.contractId,
              contractDigest: request.contractDigest,
              error,
            }),
            dependencyFailureContext({ service, deployment, request, error }),
          ),
          202,
        );
      }
      return c.json(
        bootstrapFailure(
          "contract_catalog_issue",
          `Service contract '${request.contractId}' digest '${request.contractDigest}' is waiting for catalog authority resolution: ${catalogError.message}`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            catalogError: catalogError.message,
          },
        ),
        409,
      );
    }
    if (activeAnalysis.contract.digest !== request.contractDigest) {
      return c.json(
        bootstrapFailure(
          "presented_contract_digest_mismatch",
          `Presented contract digest '${activeAnalysis.contract.digest}' does not match requested digest '${request.contractDigest}'. Review and apply the intended contract before starting this service.`,
          {
            instanceId: service.instanceId,
            deploymentId: deployment.deploymentId,
            contractId: request.contractId,
            expectedContractDigest: request.contractDigest,
            presentedContractDigest: activeAnalysis.contract.digest,
          },
        ),
        409,
      );
    }

    const currentMaterializedAuthority = await deps.materializedAuthorityStorage
      .get(
        service.deploymentId,
      );
    if (
      currentMaterializedAuthority === undefined ||
      currentMaterializedAuthority.desiredVersion !==
        deploymentAuthority.version ||
      currentMaterializedAuthority.status === "pending"
    ) {
      return c.json(
        bootstrapFailure(
          "authority_reconciliation_pending",
          `Service deployment '${service.deploymentId}' authority reconciliation is pending.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            desiredVersion: deploymentAuthority.version,
            materializedDesiredVersion: currentMaterializedAuthority
              ?.desiredVersion,
            materializedStatus: currentMaterializedAuthority?.status,
          },
        ),
        202,
      );
    }
    if (currentMaterializedAuthority.status === "failed") {
      return c.json(
        bootstrapFailure(
          "authority_reconciliation_failed",
          `Service deployment '${service.deploymentId}' authority reconciliation failed.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            desiredVersion: deploymentAuthority.version,
            materializedDesiredVersion: currentMaterializedAuthority
              .desiredVersion,
            materializedStatus: currentMaterializedAuthority.status,
            ...(currentMaterializedAuthority.error
              ? { reconciliationError: currentMaterializedAuthority.error }
              : {}),
          },
        ),
        202,
      );
    }

    await deps.implementationOfferStorage.put(
      await acceptedServiceOfferRecord({
        storage: deps.implementationOfferStorage,
        deploymentId: service.deploymentId,
        instanceId: service.instanceId,
        contract,
        digest: request.contractDigest,
        now,
      }),
    );
    try {
      await deps.authorityReconciler?.reconcileDeployment(
        service.deploymentId,
        { desiredVersion: deploymentAuthority.version },
      );
    } catch (error) {
      return c.json(
        bootstrapFailure(
          "authority_reconciliation_pending",
          `Service deployment '${service.deploymentId}' authority reconciliation could not be refreshed after accepting the implementation offer.`,
          {
            err: toError(error).message,
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            desiredVersion: deploymentAuthority.version,
          },
        ),
        202,
      );
    }

    const materializedAuthority = await deps.materializedAuthorityStorage.get(
      service.deploymentId,
    );
    if (
      materializedAuthority === undefined ||
      materializedAuthority.desiredVersion !== deploymentAuthority.version ||
      materializedAuthority.status === "pending"
    ) {
      return c.json(
        bootstrapFailure(
          "authority_reconciliation_pending",
          `Service deployment '${service.deploymentId}' authority reconciliation is pending.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            desiredVersion: deploymentAuthority.version,
            materializedDesiredVersion: materializedAuthority?.desiredVersion,
            materializedStatus: materializedAuthority?.status,
          },
        ),
        202,
      );
    }
    if (materializedAuthority.status === "failed") {
      return c.json(
        bootstrapFailure(
          "authority_reconciliation_failed",
          `Service deployment '${service.deploymentId}' authority reconciliation failed.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            desiredVersion: deploymentAuthority.version,
            materializedDesiredVersion: materializedAuthority.desiredVersion,
            materializedStatus: materializedAuthority.status,
            ...(materializedAuthority.error
              ? { reconciliationError: materializedAuthority.error }
              : {}),
          },
        ),
        202,
      );
    }

    await deps.capabilityDefinitionStorage?.replaceForDeployment(
      service.deploymentId,
      capabilityDefinitions,
    );

    const resourceBindings = resourceBindingsForResponse(
      requestedResourceBindings(
        requestedNeeds,
        materializedAuthority.resourceBindings,
      ),
    );

    if (!sameJsonRecord(service.capabilities, capabilities)) {
      await deps.saveServiceInstance({
        ...service,
        capabilities,
      });
    }

    return c.json({
      status: "ready",
      serverNow: nowSeconds,
      connectInfo: {
        sessionKey: request.sessionKey,
        contractId: request.contractId,
        contractDigest: request.contractDigest,
        transports: deps.transports,
        transport: {
          sentinel: deps.sentinel,
        },
        auth: {
          mode: "service_identity" as const,
          iatSkewSeconds: DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS,
        },
      },
      contract: buildContractView(contract, request.contractDigest),
      binding: {
        contractId: request.contractId,
        digest: request.contractDigest,
        resources: resourceBindings,
      },
    });
  };
}
