import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ContractsModule } from "../../catalog/runtime.ts";
import {
  getEventConsumerGroupRequests,
  getJobsQueueRequests,
  getKvResourceRequests,
  getStoreResourceRequests,
} from "../../catalog/resources.ts";
import {
  type ContractEntry,
  ContractUseDependencyError,
  validateActiveContractCompatibility,
} from "../../catalog/uses.ts";
import {
  analyzeContractEnvelopeBoundary,
  type ContractEnvelopeBoundary,
} from "../boundary_analysis.ts";
import {
  computeEnvelopeDelta,
  evaluateEnvelopeFit,
} from "../envelope_decision.ts";
import { SessionKeySchema, SignatureSchema } from "../schemas.ts";
import type {
  DeploymentEnvelope,
  DeploymentResourceBinding,
  EnvelopeBoundary,
  EnvelopeExpansionRequest,
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

type DeploymentEnvelopeStorage = {
  get(deploymentId: string): Promise<DeploymentEnvelope | undefined>;
  putExpansion?(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
  }): Promise<void>;
};

type DeploymentResourceBindingStorage = {
  get(
    deploymentId: string,
    kind: string,
    alias: string,
  ): Promise<DeploymentResourceBinding | undefined>;
  put(record: DeploymentResourceBinding): Promise<void>;
  listByDeployment(deploymentId: string): Promise<DeploymentResourceBinding[]>;
};

type EnvelopeExpansionRequestStorage = {
  putPending(
    record: EnvelopeExpansionRequest,
  ): Promise<EnvelopeExpansionRequest>;
  latestApprovedByContractId?(
    contractId: string,
  ): Promise<EnvelopeExpansionRequest | undefined>;
};

type ImplementationOfferStorage = {
  get(offerId: string): Promise<ImplementationOffer | undefined>;
  put(record: ImplementationOffer): Promise<void>;
  latestAcceptedByLineage(
    lineageKey: string,
  ): Promise<ImplementationOffer | undefined>;
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
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  deploymentResourceBindingStorage: DeploymentResourceBindingStorage;
  implementationOfferStorage: ImplementationOfferStorage;
  envelopeExpansionRequestStorage: EnvelopeExpansionRequestStorage;
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
  createExpansionRequestId?(): string;
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
  analysis: ContractEnvelopeBoundary,
  contract: TrellisContractV1,
): string[] {
  const capabilities = new Set<string>([
    "service",
    ...analysis.required.capabilities,
    ...analysis.optional.capabilities,
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

function emptyBoundary(): EnvelopeBoundary {
  return { contracts: [], surfaces: [], capabilities: [], resources: [] };
}

function mergeBoundaries(...boundaries: EnvelopeBoundary[]): EnvelopeBoundary {
  return computeEnvelopeDelta(emptyBoundary(), {
    contracts: boundaries.flatMap((boundary) => boundary.contracts),
    surfaces: boundaries.flatMap((boundary) => boundary.surfaces),
    capabilities: boundaries.flatMap((boundary) => boundary.capabilities),
    resources: boundaries.flatMap((boundary) => boundary.resources),
  });
}

function isEmptyBoundary(boundary: EnvelopeBoundary): boolean {
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
}): Promise<string | null> {
  if (input.deployment.contractCompatibilityMode === "mutable-dev") {
    return null;
  }
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
    return `previous service contract digest '${currentDigest}' is unknown`;
  }
  try {
    validateActiveContractCompatibility([
      { digest: currentDigest, contract: currentContract },
      { digest: input.presentedDigest, contract: input.presentedContract },
    ]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
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

function missingResourceBindingKeys(
  requested: EnvelopeBoundary,
  bindings: DeploymentResourceBinding[],
): string[] {
  const produced = new Set(
    bindings.map((binding) => resourceKey(binding.kind, binding.alias)),
  );
  const missing: string[] = [];
  for (const resource of requested.resources) {
    if (resource.kind === "transfer") continue;
    const key = resourceKey(resource.kind, resource.alias);
    if (!produced.has(key)) missing.push(key);
  }
  return missing.sort((left, right) => left.localeCompare(right));
}

async function knownDependencyEntriesForProvisioning(
  deps: Pick<
    ServiceBootstrapDeps["contracts"],
    "getActiveEntries" | "validateContract"
  >,
  expansionRequests: Pick<
    EnvelopeExpansionRequestStorage,
    "latestApprovedByContractId"
  >,
  contract: TrellisContractV1,
): Promise<ContractEntry[]> {
  const entriesByDigest = new Map<string, ContractEntry>();
  const activeEntriesByContractId = new Map<string, ContractEntry[]>();
  for (const entry of await deps.getActiveEntries()) {
    const entries = activeEntriesByContractId.get(entry.contract.id) ?? [];
    entries.push(entry);
    activeEntriesByContractId.set(entry.contract.id, entries);
  }
  const contractIds = new Set<string>();
  for (const group of [contract.uses?.required, contract.uses?.optional]) {
    for (const use of Object.values(group ?? {})) {
      contractIds.add(use.contract);
    }
  }
  for (const contractId of contractIds) {
    const activeEntries = activeEntriesByContractId.get(contractId);
    const approvedFallback = activeEntries === undefined
      ? await approvedFallbackEntry(deps, expansionRequests, contractId)
      : undefined;
    const dependencyEntries = activeEntries ??
      (approvedFallback ? [approvedFallback] : []);
    for (const entry of dependencyEntries) {
      entriesByDigest.set(entry.digest, entry);
    }
  }
  return [...entriesByDigest.values()].sort((left, right) =>
    left.digest.localeCompare(right.digest)
  );
}

async function approvedFallbackEntry(
  contracts: Pick<ServiceBootstrapDeps["contracts"], "validateContract">,
  storage: Pick<EnvelopeExpansionRequestStorage, "latestApprovedByContractId">,
  contractId: string,
): Promise<ContractEntry | undefined> {
  const request = await storage.latestApprovedByContractId?.(contractId);
  if (!request) return undefined;
  const validated = await contracts.validateContract(request.contract);
  if (
    validated.contract.id !== contractId ||
    validated.digest !== request.contractDigest
  ) {
    return undefined;
  }
  return { digest: validated.digest, contract: validated.contract };
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function booleanField(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function storedResourceBindingMismatchKeys(input: {
  contract: TrellisContractV1;
  requested: EnvelopeBoundary;
  bindings: DeploymentResourceBinding[];
  knownContractEntries: ContractEntry[];
}): string[] {
  const requestedKeys = new Set(
    input.requested.resources
      .filter((resource) => resource.kind !== "transfer")
      .map((resource) => resourceKey(resource.kind, resource.alias)),
  );
  const mismatches: string[] = [];
  const bindingByKey = new Map(
    input.bindings.map((binding) => [
      resourceKey(binding.kind, binding.alias),
      binding,
    ]),
  );

  for (const request of getKvResourceRequests(input.contract)) {
    const key = resourceKey("kv", request.alias);
    if (!requestedKeys.has(key)) continue;
    const binding = bindingByKey.get(key)?.binding;
    if (!binding) continue;
    if (
      numberField(binding, "history") !== request.history ||
      numberField(binding, "ttlMs") !== request.ttlMs ||
      numberField(binding, "maxValueBytes") !== request.maxValueBytes
    ) {
      mismatches.push(key);
    }
  }

  for (const request of getStoreResourceRequests(input.contract)) {
    const key = resourceKey("store", request.alias);
    if (!requestedKeys.has(key)) continue;
    const binding = bindingByKey.get(key)?.binding;
    if (!binding) continue;
    if (
      numberField(binding, "ttlMs") !== request.ttlMs ||
      numberField(binding, "maxTotalBytes") !== request.maxTotalBytes ||
      numberField(binding, "maxObjectBytes") !== request.maxObjectBytes
    ) {
      mismatches.push(key);
    }
  }

  for (const request of getJobsQueueRequests(input.contract)) {
    const key = resourceKey("jobs", request.queueType);
    if (!requestedKeys.has(key)) continue;
    const binding = bindingByKey.get(key)?.binding;
    if (!binding) continue;
    if (
      stringField(binding, "queueType") !== request.queueType ||
      !sameJsonRecord(binding.payload, request.payload) ||
      !sameJsonRecord(binding.result, request.result) ||
      numberField(binding, "maxDeliver") !== request.maxDeliver ||
      !sameJsonRecord(binding.backoffMs, request.backoffMs) ||
      numberField(binding, "ackWaitMs") !== request.ackWaitMs ||
      numberField(binding, "defaultDeadlineMs") !==
        request.defaultDeadlineMs ||
      booleanField(binding, "progress") !== request.progress ||
      booleanField(binding, "logs") !== request.logs ||
      booleanField(binding, "dlq") !== request.dlq ||
      numberField(binding, "concurrency") !== request.concurrency
    ) {
      mismatches.push(key);
    }
  }

  for (
    const request of getEventConsumerGroupRequests(input.contract, {
      knownContractEntries: input.knownContractEntries,
      envelopeBoundary: input.requested,
    })
  ) {
    const key = resourceKey("event-consumer", request.alias);
    if (!requestedKeys.has(key)) continue;
    const binding = bindingByKey.get(key)?.binding;
    if (!binding) continue;
    if (
      stringField(binding, "stream") !== request.stream ||
      !sameJsonRecord(binding.filterSubjects, request.filterSubjects) ||
      stringField(binding, "replay") !== request.replay ||
      stringField(binding, "ordering") !== request.ordering ||
      numberField(binding, "concurrency") !== request.concurrency ||
      numberField(binding, "ackWaitMs") !== request.ackWaitMs ||
      numberField(binding, "maxDeliver") !== request.maxDeliver ||
      !sameJsonRecord(binding.backoffMs, request.backoffMs)
    ) {
      mismatches.push(key);
    }
  }

  return mismatches.sort((left, right) => left.localeCompare(right));
}

function boundaryContractDeps(deps: ServiceBootstrapDeps) {
  return {
    ...deps.contracts,
    getApprovedFallbackEntryByContractId: (contractId: string) =>
      approvedFallbackEntry(
        deps.contracts,
        deps.envelopeExpansionRequestStorage,
        contractId,
      ),
  };
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
  const existing = await input.storage.get(offerId);
  return {
    offerId,
    deploymentKind: "service",
    deploymentId: input.deploymentId,
    instanceId: input.instanceId,
    contractId: input.contract.id,
    contractDigest: input.digest,
    lineageKey: serviceOfferLineageKey(input.deploymentId, input.contract.id),
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

    const deploymentEnvelope = await deps.deploymentEnvelopeStorage.get(
      service.deploymentId,
    );
    if (!deploymentEnvelope || deploymentEnvelope.disabled) {
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
          `Service deployment '${deployment.deploymentId}' needs the full manifest for contract '${request.contractId}' digest '${request.contractDigest}' to evaluate the deployment envelope.`,
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
      ReturnType<typeof analyzeContractEnvelopeBoundary>
    >;
    try {
      analysis = await analyzeContractEnvelopeBoundary(
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
          `Service contract '${request.contractId}' digest '${request.contractDigest}' is waiting for catalog repair: ${catalogError.message}`,
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

    const requestedBoundary = mergeBoundaries(
      analysis.required,
      analysis.optional,
      analysis.contributedAvailability,
    );
    const fit = evaluateEnvelopeFit(
      deploymentEnvelope.boundary,
      requestedBoundary,
    );
    const now = (deps.now?.() ?? new Date()).toISOString();

    if (!fit.fits) {
      const delta = computeEnvelopeDelta(
        deploymentEnvelope.boundary,
        requestedBoundary,
      );
      const requestId = deps.createExpansionRequestId?.() ??
        crypto.randomUUID();
      const expansionRequest = await deps.envelopeExpansionRequestStorage
        .putPending({
          requestId,
          deploymentId: service.deploymentId,
          requestedByKind: "service",
          requestedBy: { instanceId: service.instanceId },
          contractId: request.contractId,
          contractDigest: request.contractDigest,
          contract: { ...contract },
          state: "pending",
          createdAt: now,
          decidedAt: null,
          decidedBy: null,
          decisionReason: null,
          delta,
        });
      return c.json(
        bootstrapFailure(
          "envelope_expansion_required",
          `Service deployment '${service.deploymentId}' envelope does not cover contract '${request.contractId}' digest '${request.contractDigest}'. An expansion request was created.`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            requestId: expansionRequest.requestId,
            delta,
            missingAvailability: fit.missingAvailability,
            missingCapabilities: fit.missingCapabilities,
          },
        ),
        202,
      );
    }

    const compatibilityError = await assertPresentedContractCompatible({
      contracts: deps.contracts,
      deployment,
      implementationOfferStorage: deps.implementationOfferStorage,
      presentedDigest: request.contractDigest,
      presentedContract: contract,
    });
    if (compatibilityError) {
      return c.json(
        bootstrapFailure(
          "contract_compatibility_violation",
          `Service contract '${request.contractId}' digest '${request.contractDigest}' is incompatible with the current deployment surface. Use a new contract version or enable mutable-dev compatibility for this deployment. ${compatibilityError}`,
          {
            instanceId: service.instanceId,
            deploymentId: service.deploymentId,
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            latestAcceptedContractDigest: (await deps.implementationOfferStorage
              .latestAcceptedByLineage(
                serviceOfferLineageKey(
                  service.deploymentId,
                  request.contractId,
                ),
              ))?.contractDigest,
            compatibilityMode: deployment.contractCompatibilityMode ?? "strict",
          },
        ),
        409,
      );
    }

    const capabilities = getRequiredServiceCapabilities(analysis, contract);

    let activeAnalysis: Awaited<
      ReturnType<typeof analyzeContractEnvelopeBoundary>
    >;
    try {
      activeAnalysis = await analyzeContractEnvelopeBoundary(
        boundaryContractDeps(deps),
        contract,
        { dependencyResolution: "activeOrApproved" },
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
          `Service contract '${request.contractId}' digest '${request.contractDigest}' is waiting for catalog repair: ${catalogError.message}`,
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

    const existingBindings = await deps.deploymentResourceBindingStorage
      .listByDeployment(service.deploymentId);
    const requestedResourceKeys = new Set(
      requestedBoundary.resources
        .filter((resource) => resource.kind !== "transfer")
        .map((resource) => resourceKey(resource.kind, resource.alias)),
    );
    const resourceBindingRecords = existingBindings.filter((binding) =>
      requestedResourceKeys.has(resourceKey(binding.kind, binding.alias))
    );

    const missingResourceBindings = missingResourceBindingKeys(
      requestedBoundary,
      resourceBindingRecords,
    );
    if (missingResourceBindings.length > 0) {
      return c.json(
        bootstrapFailure(
          "resource_binding_missing",
          "Stored resource bindings are missing for requested resources.",
          { missingResourceBindings },
        ),
        409,
      );
    }

    const mismatchedResourceBindings = storedResourceBindingMismatchKeys({
      contract,
      requested: requestedBoundary,
      bindings: resourceBindingRecords,
      knownContractEntries: await knownDependencyEntriesForProvisioning(
        deps.contracts,
        deps.envelopeExpansionRequestStorage,
        contract,
      ),
    });
    if (mismatchedResourceBindings.length > 0) {
      return c.json(
        bootstrapFailure(
          "resource_binding_mismatch",
          "Stored resource bindings are stale for requested resources.",
          { mismatchedResourceBindings },
        ),
        409,
      );
    }

    const resourceBindings = resourceBindingsForResponse(
      resourceBindingRecords,
    );

    let nextService = service;
    if (
      !service.resourceBindings ||
      !sameJsonRecord(service.resourceBindings, resourceBindings) ||
      !sameJsonRecord(service.capabilities, capabilities)
    ) {
      nextService = {
        ...service,
        capabilities,
        resourceBindings: resourceBindings ?? {},
      };
      await deps.saveServiceInstance(nextService);
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
        resources: nextService.resourceBindings,
      },
    });
  };
}
