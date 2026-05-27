import {
  AuthError,
  UnexpectedError,
  ValidationError,
} from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { AuthRequestsValidateResponseSchema } from "@qlever-llc/trellis/auth";
import type { StaticDecode } from "typebox";
import { ulid } from "ulid";

import type { ContractsModule } from "../../catalog/runtime.ts";
import { analyzeContract } from "../../catalog/analysis.ts";
import {
  type ContractResourceBindings,
  createNatsResourcePurgeManager,
  existingResourceNamesFromBindings,
  getKvResourceRequests,
  getStoreResourceRequests,
  type KvResourceRequest,
  provisionContractResources,
  type ProvisionedContractResources,
  type ResourceProvisioningOptions,
  type ResourcePurgeManager,
  rollbackProvisionedContractResources,
  type StoreResourceRequest,
} from "../../catalog/resources.ts";
import type { ContractRecord } from "../../catalog/schemas.ts";
import {
  type ContractEntry,
  ContractUseDependencyError,
} from "../../catalog/uses.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import {
  computeEnvelopeDelta,
  previewEnvelopeShrinkImpact,
} from "../envelope_decision.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type {
  Connection,
  DeploymentEnvelope,
  DeploymentGrantOverride,
  DeploymentPortalRoute,
  DeploymentResourceBinding,
  EnvelopeBoundary,
  EnvelopeExpansionRequest,
  EnvelopeHistoryEntry,
  IdentityEnvelopeRecord,
  ImplementationOffer,
  Session,
} from "../schemas.ts";
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";
import type { BoundedListQuery, ListPage } from "../storage.ts";
import { MAX_STORAGE_LIST_LIMIT } from "../storage.ts";
import { type AdminCaller, requireAdmin } from "./shared.ts";

type RpcUser =
  & StaticDecode<
    typeof AuthRequestsValidateResponseSchema
  >["caller"]
  & AdminCaller;

function actorId(caller: RpcUser): string | null {
  if (caller.type === "user") return caller.userId;
  if (caller.type === "service") {
    const { id } = caller;
    return id;
  }
  return caller.deviceId;
}

function historyActor(caller: RpcUser): Record<string, unknown> {
  return { type: caller.type, id: actorId(caller) };
}

function envelopeHistoryRecord(input: {
  scopeId: string;
  action: EnvelopeHistoryEntry["action"];
  delta: EnvelopeBoundary;
  resultingUpdatedAt: string;
  actor: Record<string, unknown> | null;
  reason: string | null;
  source: EnvelopeHistoryEntry["source"];
  createdAt: string;
}): EnvelopeHistoryEntry {
  return {
    entryId: `envh_${ulid()}`,
    scopeKind: "deployment",
    scopeId: input.scopeId,
    action: input.action,
    delta: input.delta,
    resultingUpdatedAt: input.resultingUpdatedAt,
    actor: input.actor,
    reason: input.reason,
    source: input.source,
    createdAt: input.createdAt,
  };
}

function compactExpansionRequestForResponse(
  request: EnvelopeExpansionRequest,
): EnvelopeExpansionRequest {
  const compactContract: Record<string, unknown> = {
    id: request.contractId,
    digest: request.contractDigest,
    redacted: true,
  };
  for (const key of ["format", "displayName", "description", "kind"]) {
    const value = request.contract[key];
    if (typeof value === "string") compactContract[key] = value;
  }
  return { ...request, contract: compactContract };
}

function compactExpansionRequestPageForResponse(
  page: ListPage<EnvelopeExpansionRequest>,
): ListPage<EnvelopeExpansionRequest> {
  return {
    ...page,
    entries: page.entries.map(compactExpansionRequestForResponse),
  };
}

async function knownDependencyEntriesForProvisioning(
  deps: Pick<EnvelopeContractDeps, "getActiveEntries" | "validateContract">,
  expansionRequests:
    | Pick<
      EnvelopeExpansionRequestStorage,
      "latestApprovedByContractId"
    >
    | undefined,
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

type EnvelopeContractDeps = Pick<
  ContractsModule,
  | "getActiveEntries"
  | "getKnownContract"
  | "getKnownEntriesByContractId"
  | "validateContract"
>;

type ApprovedFallbackContractDeps = Pick<
  EnvelopeContractDeps,
  "validateContract"
>;

type ExpansionDependencyResolution = "known" | "knownOrPending";

type DeploymentEnvelopeStorage = {
  get(deploymentId: string): Promise<DeploymentEnvelope | undefined>;
  put(record: DeploymentEnvelope): Promise<void>;
  listPage?(query: BoundedListQuery): Promise<DeploymentEnvelope[]>;
  listEnabled(): Promise<DeploymentEnvelope[]>;
  listFiltered(filters: {
    kind?: string;
    disabled?: boolean;
  }, query: BoundedListQuery): Promise<DeploymentEnvelope[]>;
  listFilteredPage?(filters: {
    kind?: string;
    disabled?: boolean;
  }, query: BoundedListQuery): Promise<ListPage<DeploymentEnvelope>>;
  putExpansion?(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    history?: EnvelopeHistoryEntry;
  }): Promise<void>;
  approveExpansion?(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    history?: EnvelopeHistoryEntry;
    request: {
      requestId: string;
      state: "approved";
      decidedAt: string;
      decidedBy: Record<string, unknown>;
      decisionReason: string | null;
    };
  }): Promise<boolean>;
};

type EnvelopeHistoryStorage = {
  put(record: EnvelopeHistoryEntry): Promise<void>;
  listByScope?(
    scopeKind: EnvelopeHistoryEntry["scopeKind"],
    scopeId: string,
    query: BoundedListQuery,
  ): Promise<EnvelopeHistoryEntry[]>;
};

type DeploymentPortalRouteStorage = {
  get(deploymentId: string): Promise<DeploymentPortalRoute | undefined>;
};

type DeploymentGrantOverrideStorage = {
  listByDeployment(deploymentId: string): Promise<DeploymentGrantOverride[]>;
  listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentGrantOverride>>;
  replaceForDeployment(
    deploymentId: string,
    records: DeploymentGrantOverride[],
  ): Promise<void>;
};

type DeploymentResourceBindingStorage = {
  get(
    deploymentId: string,
    kind: string,
    alias: string,
  ): Promise<DeploymentResourceBinding | undefined>;
  put(record: DeploymentResourceBinding): Promise<void>;
  listByDeployment?(deploymentId: string): Promise<DeploymentResourceBinding[]>;
};

type ImplementationOfferStorage = {
  listByDeployment?(
    deploymentKind: ImplementationOffer["deploymentKind"],
    deploymentId: string,
  ): Promise<ImplementationOffer[]>;
};

type ContractStorage = {
  put(record: ContractRecord): Promise<void>;
};

type EnvelopeExpansionRequestStorage = {
  get?(requestId: string): Promise<EnvelopeExpansionRequest | undefined>;
  listPage?(query: BoundedListQuery): Promise<EnvelopeExpansionRequest[]>;
  listByDeployment(deploymentId: string): Promise<EnvelopeExpansionRequest[]>;
  listFiltered(filters: {
    deploymentId?: string;
    state?: string;
  }, query: BoundedListQuery): Promise<EnvelopeExpansionRequest[]>;
  listFilteredPage?(filters: {
    deploymentId?: string;
    state?: string;
  }, query: BoundedListQuery): Promise<ListPage<EnvelopeExpansionRequest>>;
  updateState?(record: {
    requestId: string;
    state: "pending" | "approved" | "rejected";
    decidedAt: string | null;
    decidedBy: Record<string, unknown> | null;
    decisionReason: string | null;
  }): Promise<boolean>;
  latestApprovedByContractId?(
    contractId: string,
  ): Promise<EnvelopeExpansionRequest | undefined>;
};

async function approvedFallbackEntry(
  contracts: ApprovedFallbackContractDeps,
  storage:
    | Pick<EnvelopeExpansionRequestStorage, "latestApprovedByContractId">
    | undefined,
  contractId: string,
): Promise<ContractEntry | undefined> {
  const request = await storage?.latestApprovedByContractId?.(contractId);
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

function boundaryContractDeps(deps: {
  contracts: EnvelopeContractDeps;
  envelopeExpansionRequestStorage?: EnvelopeExpansionRequestStorage;
}) {
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

type IdentityEnvelopeStorage = {
  listApproved(): Promise<IdentityEnvelopeRecord[]>;
};

type SessionStorage = {
  listEntriesForDeploymentEnvelopePreview(
    deploymentId: string,
  ): Promise<Array<{ sessionKey: string; session: Session }>>;
  deleteBySessionKey(sessionKey: string): Promise<void>;
};

type RuntimeConnectionKV = {
  keys: Parameters<
    typeof revokeRuntimeAccessForSession
  >[0]["connectionsKV"]["keys"];
  get: Parameters<
    typeof revokeRuntimeAccessForSession
  >[0]["connectionsKV"]["get"];
  delete: Parameters<
    typeof revokeRuntimeAccessForSession
  >[0]["connectionsKV"]["delete"];
};

type ShrinkImpactSession = {
  sessionKey: string;
  type: "app" | "agent" | "device" | "service";
  contractId: string | null;
  contractDigest: string | null;
  missing: EnvelopeBoundary;
};

type ShrinkImpact = {
  removed: EnvelopeBoundary;
  impactedSessions: ShrinkImpactSession[];
  impactedServiceInstances: Array<{ missing: EnvelopeBoundary }>;
  impactedDeviceSessions: ShrinkImpactSession[];
  impactedIdentityEnvelopes: Array<{
    identityEnvelopeId: string;
    identityAnchor: IdentityEnvelopeRecord["identityAnchor"];
    missing: EnvelopeBoundary;
  }>;
  impactedPendingRequests: Array<
    { requestId: string; missing: EnvelopeBoundary }
  >;
  orphanedResources: Array<
    { kind: DeploymentResourceBinding["kind"]; alias: string }
  >;
};

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

function invalid(
  path: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return Result.err(
    new ValidationError({
      errors: [{ path, message }],
      ...(context ? { context } : {}),
    }),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function invalidDependency(error: ContractUseDependencyError) {
  return invalid("/contract/uses", error.message, {
    dependencyAlias: error.alias,
    dependencyContractId: error.contractId,
    dependencySurface: error.surface,
    dependencyReason: error.reason,
    ...(error.key ? { dependencyKey: error.key } : {}),
  });
}

function invalidResourceDependency(error: Error) {
  return invalid("/contract/eventConsumers", error.message);
}

function normalizedBoundary(boundary: EnvelopeBoundary): EnvelopeBoundary {
  return computeEnvelopeDelta(EMPTY_BOUNDARY, boundary);
}

function isEmptyBoundary(boundary: EnvelopeBoundary): boolean {
  return boundary.contracts.length === 0 && boundary.surfaces.length === 0 &&
    boundary.capabilities.length === 0 && boundary.resources.length === 0;
}

function mergeBoundaries(...boundaries: EnvelopeBoundary[]): EnvelopeBoundary {
  return normalizedBoundary({
    contracts: boundaries.flatMap((boundary) => boundary.contracts),
    surfaces: boundaries.flatMap((boundary) => boundary.surfaces),
    capabilities: boundaries.flatMap((boundary) => boundary.capabilities),
    resources: boundaries.flatMap((boundary) => boundary.resources),
  });
}

function contractStorageRecord(input: {
  digest: string;
  contract: TrellisContractV1;
  canonical: string;
  installedAt: Date;
}): ContractRecord {
  const analyzed = analyzeContract(input.contract);
  return {
    digest: input.digest,
    id: input.contract.id,
    displayName: input.contract.displayName,
    description: input.contract.description,
    installedAt: input.installedAt,
    contract: input.canonical,
    resources: input.contract.resources,
    analysisSummary: analyzed.summary,
    analysis: analyzed.analysis,
  };
}

function resourceKey(kind: string, alias: string): string {
  return `${kind}\u001f${alias}`;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function kvBindingMatchesRequest(
  binding: Record<string, unknown>,
  request: Pick<KvResourceRequest, "history" | "ttlMs" | "maxValueBytes">,
): boolean {
  return numberField(binding, "history") === request.history &&
    numberField(binding, "ttlMs") === request.ttlMs &&
    numberField(binding, "maxValueBytes") === request.maxValueBytes;
}

function storeBindingMatchesRequest(
  binding: Record<string, unknown>,
  request: Pick<StoreResourceRequest, "ttlMs" | "maxTotalBytes">,
): boolean {
  return numberField(binding, "ttlMs") === request.ttlMs &&
    numberField(binding, "maxTotalBytes") === request.maxTotalBytes;
}

function grantOverrideKey(record: DeploymentGrantOverride): string {
  return JSON.stringify([
    record.deploymentId,
    record.identityKind,
    record.grantKind,
    record.contractId,
    record.origin,
    record.sessionPublicKey,
    record.capability,
    record.capabilityGroupKey,
  ]);
}

function grantOverrideDeploymentIdError(input: {
  deploymentId: string;
  overrides: DeploymentGrantOverride[];
}): ValidationError | null {
  const mismatch = input.overrides.find((override) =>
    override.deploymentId !== input.deploymentId
  );
  if (!mismatch) return null;
  return new ValidationError({
    errors: [{
      path: "/overrides",
      message: "grant override deployment id mismatch",
    }],
    context: {
      deploymentId: input.deploymentId,
      overrideDeploymentId: mismatch.deploymentId,
    },
  });
}

async function storedResourceKeysNeedingProvisioning(input: {
  deploymentId: string;
  contract: TrellisContractV1;
  requested: EnvelopeBoundary;
  storage: Pick<DeploymentResourceBindingStorage, "get">;
}): Promise<Set<string>> {
  const kvRequests = new Map(
    getKvResourceRequests(input.contract).map((
      request,
    ) => [request.alias, request]),
  );
  const storeRequests = new Map(
    getStoreResourceRequests(input.contract).map((request) => [
      request.alias,
      request,
    ]),
  );
  const needsProvisioning = new Set<string>();
  for (const resource of input.requested.resources) {
    if (resource.kind === "transfer") continue;
    const key = resourceKey(resource.kind, resource.alias);
    const stored = await input.storage.get(
      input.deploymentId,
      resource.kind,
      resource.alias,
    );
    if (!stored) {
      needsProvisioning.add(key);
      continue;
    }
    if (resource.kind === "kv") {
      const request = kvRequests.get(resource.alias);
      if (request && !kvBindingMatchesRequest(stored.binding, request)) {
        needsProvisioning.add(key);
      }
    }
    if (resource.kind === "store") {
      const request = storeRequests.get(resource.alias);
      if (request && !storeBindingMatchesRequest(stored.binding, request)) {
        needsProvisioning.add(key);
      }
    }
  }
  return needsProvisioning;
}

async function storedResourceBindingsForRequestedResources(input: {
  deploymentId: string;
  requested: EnvelopeBoundary;
  storage: Pick<DeploymentResourceBindingStorage, "get">;
}): Promise<DeploymentResourceBinding[]> {
  const records: DeploymentResourceBinding[] = [];
  for (const resource of input.requested.resources) {
    if (resource.kind === "transfer") continue;
    const stored = await input.storage.get(
      input.deploymentId,
      resource.kind,
      resource.alias,
    );
    if (stored) records.push(stored);
  }
  return records;
}

async function missingResourceBindingKeys(input: {
  deploymentId: string;
  requested: EnvelopeBoundary;
  records: DeploymentResourceBinding[];
  storage: Pick<DeploymentResourceBindingStorage, "get">;
}): Promise<string[]> {
  const produced = new Set(
    input.records.map((binding) => resourceKey(binding.kind, binding.alias)),
  );
  const missing: string[] = [];
  for (const resource of input.requested.resources) {
    if (resource.kind === "transfer") continue;
    const key = resourceKey(resource.kind, resource.alias);
    if (produced.has(key)) continue;
    const stored = await input.storage.get(
      input.deploymentId,
      resource.kind,
      resource.alias,
    );
    if (!stored) missing.push(key);
  }
  return missing.sort((left, right) => left.localeCompare(right));
}

async function buildResourceBindingRecords(input: {
  deploymentId: string;
  bindings: ContractResourceBindings;
  missingKeys: Set<string>;
  now: string;
  storage: DeploymentResourceBindingStorage;
}): Promise<DeploymentResourceBinding[]> {
  const stored: DeploymentResourceBinding[] = [];

  for (const [alias, binding] of Object.entries(input.bindings.kv ?? {})) {
    if (!input.missingKeys.has(resourceKey("kv", alias))) continue;
    const existing = await input.storage.get(input.deploymentId, "kv", alias);
    const record: DeploymentResourceBinding = {
      deploymentId: input.deploymentId,
      kind: "kv",
      alias,
      binding: {
        bucket: binding.bucket,
        history: binding.history,
        ttlMs: binding.ttlMs,
        ...(binding.maxValueBytes !== undefined
          ? { maxValueBytes: binding.maxValueBytes }
          : {}),
      },
      limits: null,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    };
    stored.push(record);
  }

  for (const [alias, binding] of Object.entries(input.bindings.store ?? {})) {
    if (!input.missingKeys.has(resourceKey("store", alias))) continue;
    const existing = await input.storage.get(
      input.deploymentId,
      "store",
      alias,
    );
    const record: DeploymentResourceBinding = {
      deploymentId: input.deploymentId,
      kind: "store",
      alias,
      binding: {
        name: binding.name,
        ttlMs: binding.ttlMs,
        ...(binding.maxTotalBytes !== undefined
          ? { maxTotalBytes: binding.maxTotalBytes }
          : {}),
      },
      limits: null,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    };
    stored.push(record);
  }

  if (input.bindings.jobs) {
    for (const [alias, queue] of Object.entries(input.bindings.jobs.queues)) {
      if (!input.missingKeys.has(resourceKey("jobs", alias))) continue;
      const existing = await input.storage.get(
        input.deploymentId,
        "jobs",
        alias,
      );
      const record: DeploymentResourceBinding = {
        deploymentId: input.deploymentId,
        kind: "jobs",
        alias,
        binding: {
          namespace: input.bindings.jobs.namespace,
          workStream: input.bindings.jobs.workStream,
          queueType: queue.queueType,
          publishPrefix: queue.publishPrefix,
          workSubject: queue.workSubject,
          consumerName: queue.consumerName,
          payload: queue.payload,
          ...(queue.result ? { result: queue.result } : {}),
          maxDeliver: queue.maxDeliver,
          backoffMs: queue.backoffMs,
          ackWaitMs: queue.ackWaitMs,
          ...(queue.defaultDeadlineMs
            ? { defaultDeadlineMs: queue.defaultDeadlineMs }
            : {}),
          progress: queue.progress,
          logs: queue.logs,
          dlq: queue.dlq,
          concurrency: queue.concurrency,
        },
        limits: null,
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: input.now,
      };
      stored.push(record);
    }
  }

  for (
    const [alias, consumer] of Object.entries(
      input.bindings.eventConsumers ?? {},
    )
  ) {
    if (!input.missingKeys.has(resourceKey("event-consumer", alias))) continue;
    const existing = await input.storage.get(
      input.deploymentId,
      "event-consumer",
      alias,
    );
    stored.push({
      deploymentId: input.deploymentId,
      kind: "event-consumer",
      alias,
      binding: {
        stream: consumer.stream,
        consumerName: consumer.consumerName,
        filterSubjects: consumer.filterSubjects,
        replay: consumer.replay,
        ordering: consumer.ordering,
        concurrency: consumer.concurrency,
        ackWaitMs: consumer.ackWaitMs,
        maxDeliver: consumer.maxDeliver,
        backoffMs: consumer.backoffMs,
      },
      limits: null,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
    });
  }

  return stored.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.alias.localeCompare(right.alias)
  );
}

export function createAuthEnvelopesListHandler(deps: {
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: BoundedListQuery & {
        kind?: DeploymentEnvelope["kind"];
        disabled?: boolean;
      };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<ListPage<DeploymentEnvelope>, AuthError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({ rpc: "Auth.Envelopes.List", caller }, "RPC request");
    try {
      const filters = { kind: req.kind, disabled: req.disabled };
      if (deps.deploymentEnvelopeStorage.listFilteredPage) {
        return Result.ok(
          await deps.deploymentEnvelopeStorage.listFilteredPage(filters, req),
        );
      }
      const entries = await deps.deploymentEnvelopeStorage.listFiltered(
        filters,
        req,
      );
      const envelopes = {
        entries,
        count: entries.length,
        offset: req.offset ?? 0,
        limit: req.limit,
      };
      return Result.ok(envelopes);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

export function createAuthEnvelopesGetHandler(deps: {
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  deploymentResourceBindingStorage: Pick<
    DeploymentResourceBindingStorage,
    "listByDeployment"
  >;
  envelopeHistoryStorage: EnvelopeHistoryStorage;
  implementationOfferStorage: ImplementationOfferStorage;
  envelopeExpansionRequestStorage: EnvelopeExpansionRequestStorage;
  deploymentPortalRouteStorage: DeploymentPortalRouteStorage;
  deploymentGrantOverrideStorage: DeploymentGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: { deploymentId: string };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<{
      envelope: DeploymentEnvelope;
      resourceBindings: DeploymentResourceBinding[];
      contractHistory: EnvelopeHistoryEntry[];
      implementationOffers: ImplementationOffer[];
      expansionRequests: EnvelopeExpansionRequest[];
      portalRoute: DeploymentPortalRoute | null;
      grantOverrides: DeploymentGrantOverride[];
    }, AuthError | ValidationError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace(
      { rpc: "Auth.Envelopes.Get", caller, deploymentId: req.deploymentId },
      "RPC request",
    );
    try {
      const envelope = await deps.deploymentEnvelopeStorage.get(
        req.deploymentId,
      );
      if (!envelope) {
        return invalid("/deploymentId", "deployment envelope not found", {
          deploymentId: req.deploymentId,
        });
      }
      const [
        resourceBindings,
        contractHistory,
        implementationOffers,
        expansionRequests,
        portalRoute,
        grantOverrides,
      ] = await Promise.all([
        deps.deploymentResourceBindingStorage.listByDeployment?.(
          req.deploymentId,
        ) ?? Promise.resolve([]),
        deps.envelopeHistoryStorage.listByScope?.(
          "deployment",
          req.deploymentId,
          { limit: MAX_STORAGE_LIST_LIMIT },
        ) ?? Promise.resolve([]),
        deps.implementationOfferStorage.listByDeployment?.(
          envelope.kind === "device" ? "device" : "service",
          req.deploymentId,
        ) ?? Promise.resolve([]),
        deps.envelopeExpansionRequestStorage.listByDeployment(req.deploymentId),
        deps.deploymentPortalRouteStorage.get(req.deploymentId),
        deps.deploymentGrantOverrideStorage.listByDeployment(req.deploymentId),
      ]);
      return Result.ok({
        envelope,
        resourceBindings,
        contractHistory,
        implementationOffers,
        expansionRequests: expansionRequests.map(
          compactExpansionRequestForResponse,
        ),
        portalRoute: portalRoute ?? null,
        grantOverrides,
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment grant override list RPC handler. */
export function createAuthEnvelopesGrantOverridesListHandler(deps: {
  deploymentGrantOverrideStorage: DeploymentGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: BoundedListQuery;
    context: { caller: RpcUser };
  }): Promise<
    Result<ListPage<DeploymentGrantOverride>, AuthError | UnexpectedError>
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.Envelopes.GrantOverrides.List",
      caller,
    }, "RPC request");

    try {
      return Result.ok(
        await deps.deploymentGrantOverrideStorage.listCountedPage(req),
      );
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment grant override replacement RPC handler. */
export function createAuthEnvelopesGrantOverridesPutHandler(deps: {
  deploymentEnvelopeStorage: Pick<DeploymentEnvelopeStorage, "get">;
  deploymentGrantOverrideStorage: DeploymentGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: { deploymentId: string; overrides: DeploymentGrantOverride[] };
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { grantOverrides: DeploymentGrantOverride[] },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.Envelopes.GrantOverrides.Put",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");

    const invalidOverrides = grantOverrideDeploymentIdError(req);
    if (invalidOverrides) return Result.err(invalidOverrides);

    try {
      const envelope = await deps.deploymentEnvelopeStorage.get(
        req.deploymentId,
      );
      if (!envelope) {
        return invalid("/deploymentId", "deployment envelope does not exist", {
          deploymentId: req.deploymentId,
        });
      }
      await deps.deploymentGrantOverrideStorage.replaceForDeployment(
        req.deploymentId,
        req.overrides,
      );
      const grantOverrides = await deps.deploymentGrantOverrideStorage
        .listByDeployment(req.deploymentId);
      return Result.ok({ grantOverrides });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment grant override exact-row removal RPC handler. */
export function createAuthEnvelopesGrantOverridesRemoveHandler(deps: {
  deploymentEnvelopeStorage: Pick<DeploymentEnvelopeStorage, "get">;
  deploymentGrantOverrideStorage: DeploymentGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: { deploymentId: string; overrides: DeploymentGrantOverride[] };
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { grantOverrides: DeploymentGrantOverride[] },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.Envelopes.GrantOverrides.Remove",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");

    const invalidOverrides = grantOverrideDeploymentIdError(req);
    if (invalidOverrides) return Result.err(invalidOverrides);

    try {
      const envelope = await deps.deploymentEnvelopeStorage.get(
        req.deploymentId,
      );
      if (!envelope) {
        return invalid("/deploymentId", "deployment envelope does not exist", {
          deploymentId: req.deploymentId,
        });
      }
      const removeKeys = new Set(
        req.overrides.map((override) => grantOverrideKey(override)),
      );
      const grantOverrides = (await deps.deploymentGrantOverrideStorage
        .listByDeployment(req.deploymentId))
        .filter((override) => !removeKeys.has(grantOverrideKey(override)));
      await deps.deploymentGrantOverrideStorage.replaceForDeployment(
        req.deploymentId,
        grantOverrides,
      );
      return Result.ok({ grantOverrides });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

async function boundaryForKnownDigest(input: {
  contracts: EnvelopeContractDeps;
  digest: string;
}): Promise<EnvelopeBoundary | null> {
  const contract = await input.contracts.getKnownContract(input.digest);
  if (!contract) return null;
  const analysis = await analyzeContractEnvelopeBoundary(
    input.contracts,
    contract,
    { dependencyResolution: "known" },
  );
  return mergeBoundaries(analysis.required, analysis.contributedAvailability);
}

function sessionContract(session: Session): {
  contractId: string | null;
  contractDigest: string | null;
} {
  if (session.type === "service") {
    return {
      contractId: session.contractId,
      contractDigest: session.contractDigest,
    };
  }
  return {
    contractId: session.contractId,
    contractDigest: session.contractDigest,
  };
}

function sessionDeploymentId(session: Session): string | null {
  return session.type === "user" ? null : session.deploymentId;
}

async function previewEnvelopeChange(input: {
  contracts: EnvelopeContractDeps;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  deploymentResourceBindingStorage: DeploymentResourceBindingStorage;
  identityEnvelopeStorage?: IdentityEnvelopeStorage;
  envelopeExpansionRequestStorage?: EnvelopeExpansionRequestStorage;
  sessionStorage?: Pick<
    SessionStorage,
    "listEntriesForDeploymentEnvelopePreview"
  >;
  current: DeploymentEnvelope;
  proposedBoundary: EnvelopeBoundary;
}): Promise<{ proposed: DeploymentEnvelope; impact: ShrinkImpact }> {
  const proposedBoundary = normalizedBoundary(input.proposedBoundary);
  const proposed: DeploymentEnvelope = {
    ...input.current,
    boundary: proposedBoundary,
  };
  const resourceBindings = await input.deploymentResourceBindingStorage
    .listByDeployment?.(input.current.deploymentId) ?? [];
  const pendingRequests = await input.envelopeExpansionRequestStorage
    ?.listFiltered({
      deploymentId: input.current.deploymentId,
      state: "pending",
    }, { limit: MAX_STORAGE_LIST_LIMIT }) ?? [];
  const enabledEnvelopes = await input.deploymentEnvelopeStorage.listEnabled();
  const effectiveAvailability = mergeBoundaries(
    ...enabledEnvelopes
      .map((envelope) =>
        envelope.deploymentId === input.current.deploymentId
          ? proposed
          : envelope
      )
      .map((envelope) => envelope.boundary),
  );

  const boundaryByDigest = new Map<string, EnvelopeBoundary>();
  const impactedSessions: ShrinkImpactSession[] = [];
  const unknownDeploymentSessionMissing = computeEnvelopeDelta(
    proposedBoundary,
    input.current.boundary,
  );
  const sessionEntries = input.sessionStorage
    ? await input.sessionStorage.listEntriesForDeploymentEnvelopePreview(
      input.current.deploymentId,
    )
    : [];
  for (const entry of sessionEntries) {
    const deploymentId = sessionDeploymentId(entry.session);
    if (deploymentId !== null && deploymentId !== input.current.deploymentId) {
      continue;
    }
    const sessionEnvelope = entry.session.type === "user"
      ? effectiveAvailability
      : proposedBoundary;
    const contract = sessionContract(entry.session);
    const sessionIdentityBoundary = entry.session.type === "user"
      ? entry.session.identityEnvelope ?? null
      : null;
    if (sessionIdentityBoundary) {
      const missing = computeEnvelopeDelta(
        sessionEnvelope,
        sessionIdentityBoundary,
      );
      if (!isEmptyBoundary(missing)) {
        impactedSessions.push({
          sessionKey: entry.sessionKey,
          type: entry.session.type === "user"
            ? entry.session.participantKind
            : entry.session.type,
          contractId: contract.contractId,
          contractDigest: contract.contractDigest,
          missing,
        });
      }
      continue;
    }
    if (contract.contractDigest === null) {
      continue;
    }
    const boundary = boundaryByDigest.get(contract.contractDigest) ??
      await boundaryForKnownDigest({
        contracts: input.contracts,
        digest: contract.contractDigest,
      });
    if (!boundary) {
      throw new Error(
        `Unknown session contract digest '${contract.contractDigest}'`,
      );
    }
    const missing = computeEnvelopeDelta(sessionEnvelope, boundary);
    if (isEmptyBoundary(missing)) continue;
    impactedSessions.push({
      sessionKey: entry.sessionKey,
      type: entry.session.type === "user"
        ? entry.session.participantKind
        : entry.session.type,
      contractId: contract.contractId,
      contractDigest: contract.contractDigest,
      missing,
    });
  }

  const genericImpact = previewEnvelopeShrinkImpact({
    current: input.current.boundary,
    proposed: proposedBoundary,
    resourceBindings: resourceBindings.map((binding) => ({
      kind: binding.kind,
      alias: binding.alias,
    })),
    pendingRequests,
  });

  const impactedIdentityEnvelopes: ShrinkImpact["impactedIdentityEnvelopes"] =
    [];
  const identityEnvelopes = input.identityEnvelopeStorage
    ? await input.identityEnvelopeStorage.listApproved()
    : [];
  for (const envelope of identityEnvelopes) {
    const boundary = await boundaryForKnownDigest({
      contracts: input.contracts,
      digest: envelope.approvalEvidence.contractDigest,
    });
    if (!boundary) {
      throw new Error(
        `Unknown identity envelope contract digest '${envelope.approvalEvidence.contractDigest}'`,
      );
    }
    const missing = computeEnvelopeDelta(effectiveAvailability, boundary);
    if (isEmptyBoundary(missing)) continue;
    impactedIdentityEnvelopes.push({
      identityEnvelopeId: envelope.identityEnvelopeId,
      identityAnchor: envelope.identityAnchor,
      missing,
    });
  }

  return {
    proposed,
    impact: {
      removed: genericImpact.removed,
      impactedSessions,
      impactedServiceInstances: impactedSessions
        .filter((session) => session.type === "service")
        .map((session) => ({ missing: session.missing })),
      impactedDeviceSessions: impactedSessions.filter((session) =>
        session.type === "device"
      ),
      impactedIdentityEnvelopes,
      impactedPendingRequests: genericImpact.impactedPendingRequests,
      orphanedResources: genericImpact.orphanedResources,
    },
  };
}

async function revokeSession(input: {
  sessionKey: string;
  sessionStorage: Pick<SessionStorage, "deleteBySessionKey">;
  connectionsKV?: RuntimeConnectionKV;
  kick?: (serverId: string, clientId: number) => Promise<void>;
  revokeSessionRuntimeAccess?: (sessionKey: string) => Promise<void>;
}): Promise<void> {
  if (input.revokeSessionRuntimeAccess) {
    await input.revokeSessionRuntimeAccess(input.sessionKey);
    return;
  }
  if (input.connectionsKV && input.kick) {
    await revokeRuntimeAccessForSession({
      sessionKey: input.sessionKey,
      connectionsKV: input.connectionsKV,
      kick: input.kick,
      deleteSession: () =>
        input.sessionStorage.deleteBySessionKey(input.sessionKey),
    });
    return;
  }
  await input.sessionStorage.deleteBySessionKey(input.sessionKey);
}

/** Creates the manual deployment envelope expansion RPC handler. */
export function createAuthEnvelopesExpandHandler(deps: {
  contracts: EnvelopeContractDeps;
  contractStorage: ContractStorage;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  envelopeHistoryStorage?: EnvelopeHistoryStorage;
  deploymentResourceBindingStorage: DeploymentResourceBindingStorage;
  envelopeExpansionRequestStorage?: EnvelopeExpansionRequestStorage;
  nats?: NatsConnection;
  provisionResources?: (
    nats: NatsConnection | undefined,
    contract: TrellisContractV1,
    deploymentId: string,
    options?: ResourceProvisioningOptions,
  ) => Promise<ProvisionedContractResources>;
  resourcePurgeManager?: ResourcePurgeManager;
  resourceProvisioningOptions?: ResourceProvisioningOptions;
  now?: () => Date;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}, options: {
  persist?: boolean;
  dependencyResolution?: ExpansionDependencyResolution;
  onProvisioned?: (resources: ProvisionedContractResources) => void;
} = {}) {
  return async (args: {
    input: {
      deploymentId: string;
      contract: unknown;
      expectedDigest: string;
    };
    context: { caller: RpcUser };
  }): Promise<
    Result<{
      envelope: DeploymentEnvelope;
      delta: EnvelopeBoundary;
      contractHistory: EnvelopeHistoryEntry[];
      resourceBindings: DeploymentResourceBinding[];
    }, AuthError | ValidationError | UnexpectedError>
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.Envelopes.Expand",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");

    let analysis;
    let validated;
    try {
      analysis = await analyzeContractEnvelopeBoundary(
        boundaryContractDeps(deps),
        req.contract,
        { dependencyResolution: options.dependencyResolution ?? "known" },
      );
      validated = await deps.contracts.validateContract(req.contract);
    } catch (error) {
      return invalid("/contract", toError(error).message);
    }

    if (analysis.contract.digest !== req.expectedDigest) {
      return invalid("/expectedDigest", "contract digest did not match", {
        expectedDigest: req.expectedDigest,
        actualDigest: analysis.contract.digest,
      });
    }

    try {
      const current = await deps.deploymentEnvelopeStorage.get(
        req.deploymentId,
      );
      if (!current) {
        return invalid("/deploymentId", "deployment envelope does not exist", {
          deploymentId: req.deploymentId,
        });
      }

      const requested = mergeBoundaries(
        analysis.required,
        analysis.optional,
        analysis.contributedAvailability,
      );
      const delta = computeEnvelopeDelta(current.boundary, requested);
      const now = (deps.now?.() ?? new Date()).toISOString();
      let resourceBindings: DeploymentResourceBinding[] = [];
      let provisionedResources: ProvisionedContractResources | undefined;
      const rollbackCreatedResources = async () => {
        if (
          !provisionedResources || provisionedResources.created.length === 0
        ) {
          return;
        }
        const manager = deps.resourcePurgeManager ??
          (deps.nats ? createNatsResourcePurgeManager(deps.nats) : undefined);
        if (!manager) return;
        await rollbackProvisionedContractResources(
          provisionedResources,
          manager,
        );
      };
      const resourcesNeedingProvisioning =
        await storedResourceKeysNeedingProvisioning({
          deploymentId: req.deploymentId,
          contract: validated.contract,
          requested,
          storage: deps.deploymentResourceBindingStorage,
        });
      const existingResourceBindings =
        await storedResourceBindingsForRequestedResources({
          deploymentId: req.deploymentId,
          requested,
          storage: deps.deploymentResourceBindingStorage,
        });

      if (resourcesNeedingProvisioning.size > 0) {
        try {
          provisionedResources = await (deps.provisionResources ??
            provisionContractResources)(
              deps.nats,
              validated.contract,
              req.deploymentId,
              {
                ...deps.resourceProvisioningOptions,
                existingResourceNames: existingResourceNamesFromBindings(
                  existingResourceBindings,
                ),
                knownContractEntries:
                  await knownDependencyEntriesForProvisioning(
                    deps.contracts,
                    deps.envelopeExpansionRequestStorage,
                    validated.contract,
                  ),
                envelopeBoundary: requested,
              },
            );
        } catch (error) {
          if (error instanceof ContractUseDependencyError) {
            return invalidDependency(error);
          }
          const cause = toError(error);
          if (
            cause.message.startsWith("Active compatible digests define") ||
            cause.message.startsWith("event consumer group '")
          ) {
            return invalidResourceDependency(cause);
          }
          throw error;
        }
        options.onProvisioned?.(provisionedResources);
        resourceBindings = await buildResourceBindingRecords({
          deploymentId: req.deploymentId,
          bindings: provisionedResources.bindings,
          missingKeys: resourcesNeedingProvisioning,
          now,
          storage: deps.deploymentResourceBindingStorage,
        });
      }

      const missing = await missingResourceBindingKeys({
        deploymentId: req.deploymentId,
        requested,
        records: resourceBindings,
        storage: deps.deploymentResourceBindingStorage,
      });
      if (missing.length > 0) {
        await rollbackCreatedResources();
        return invalid(
          "/contract/resources",
          "resource provisioning did not produce all requested bindings",
          { missing },
        );
      }

      const envelope: DeploymentEnvelope = delta.contracts.length === 0 &&
          delta.surfaces.length === 0 && delta.capabilities.length === 0 &&
          delta.resources.length === 0
        ? current
        : {
          ...current,
          updatedAt: now,
          boundary: mergeBoundaries(current.boundary, delta),
        };
      await deps.contractStorage.put(contractStorageRecord({
        digest: analysis.contract.digest,
        contract: validated.contract,
        canonical: validated.canonical,
        installedAt: new Date(now),
      }));

      const history = envelopeHistoryRecord({
        scopeId: req.deploymentId,
        action: "expand",
        delta,
        resultingUpdatedAt: envelope.updatedAt,
        actor: historyActor(caller),
        reason: null,
        source: {
          contractId: validated.contract.id,
          contractDigest: analysis.contract.digest,
        },
        createdAt: now,
      });
      if (options.persist ?? true) {
        if (deps.deploymentEnvelopeStorage.putExpansion) {
          try {
            await deps.deploymentEnvelopeStorage.putExpansion({
              envelope,
              delta,
              resourceBindings,
              history,
            });
          } catch (error) {
            await rollbackCreatedResources();
            throw error;
          }
        } else {
          try {
            if (envelope !== current) {
              await deps.deploymentEnvelopeStorage.put(envelope);
            }
            for (const binding of resourceBindings) {
              await deps.deploymentResourceBindingStorage.put(binding);
            }
            await deps.envelopeHistoryStorage?.put(history);
          } catch (error) {
            await rollbackCreatedResources();
            throw error;
          }
        }
      }

      return Result.ok({
        envelope,
        delta,
        contractHistory: [history],
        resourceBindings,
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the pending envelope expansion request approval RPC handler. */
export function createAuthEnvelopesApproveRequestHandler(deps: {
  contracts: EnvelopeContractDeps;
  contractStorage: ContractStorage;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  envelopeHistoryStorage?: EnvelopeHistoryStorage;
  deploymentResourceBindingStorage: DeploymentResourceBindingStorage;
  envelopeExpansionRequestStorage: EnvelopeExpansionRequestStorage;
  nats?: NatsConnection;
  provisionResources?: (
    nats: NatsConnection | undefined,
    contract: TrellisContractV1,
    deploymentId: string,
    options?: ResourceProvisioningOptions,
  ) => Promise<ProvisionedContractResources>;
  resourcePurgeManager?: ResourcePurgeManager;
  resourceProvisioningOptions?: ResourceProvisioningOptions;
  now?: () => Date;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  let provisionedForApproval: ProvisionedContractResources | undefined;
  const rollbackApprovalResources = async () => {
    if (
      !provisionedForApproval || provisionedForApproval.created.length === 0
    ) {
      return;
    }
    const manager = deps.resourcePurgeManager ??
      (deps.nats ? createNatsResourcePurgeManager(deps.nats) : undefined);
    if (!manager) return;
    await rollbackProvisionedContractResources(provisionedForApproval, manager);
  };
  const expand = createAuthEnvelopesExpandHandler(deps, {
    persist: !deps.deploymentEnvelopeStorage.approveExpansion,
    dependencyResolution: "knownOrPending",
    onProvisioned: (resources) => {
      provisionedForApproval = resources;
    },
  });
  return async (args: {
    input: { requestId: string; reason?: string };
    context: { caller: RpcUser };
  }): Promise<
    Result<{
      request: EnvelopeExpansionRequest;
      envelope: DeploymentEnvelope;
      delta: EnvelopeBoundary;
      contractHistory: EnvelopeHistoryEntry[];
      resourceBindings: DeploymentResourceBinding[];
    }, AuthError | ValidationError | UnexpectedError>
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.EnvelopeExpansions.Approve",
      caller,
      requestId: req.requestId,
    }, "RPC request");

    try {
      const request = await deps.envelopeExpansionRequestStorage.get?.(
        req.requestId,
      );
      if (!request) {
        return invalid("/requestId", "envelope expansion request not found", {
          requestId: req.requestId,
        });
      }
      if (request.state !== "pending") {
        return invalid(
          "/requestId",
          "envelope expansion request is not pending",
          {
            requestId: req.requestId,
            state: request.state,
          },
        );
      }

      const expanded = await expand({
        input: {
          deploymentId: request.deploymentId,
          contract: request.contract,
          expectedDigest: request.contractDigest,
        },
        context: { caller },
      });
      if (expanded.isErr()) return expanded;
      const value = expanded.take();
      if (Result.isErr(value)) return value;

      const decidedAt = (deps.now?.() ?? new Date()).toISOString();
      const decidedBy = { type: caller.type, id: actorId(caller) };
      const approvedRequest: EnvelopeExpansionRequest = {
        ...request,
        state: "approved",
        decidedAt,
        decidedBy,
        decisionReason: req.reason ?? null,
      };
      const stateUpdate = {
        requestId: request.requestId,
        state: "approved" as const,
        decidedAt,
        decidedBy,
        decisionReason: approvedRequest.decisionReason,
      };
      if (deps.deploymentEnvelopeStorage.approveExpansion) {
        const history = envelopeHistoryRecord({
          scopeId: request.deploymentId,
          action: "expand",
          delta: value.delta,
          resultingUpdatedAt: value.envelope.updatedAt,
          actor: decidedBy,
          reason: approvedRequest.decisionReason,
          source: {
            contractId: request.contractId,
            contractDigest: request.contractDigest,
            requestId: request.requestId,
          },
          createdAt: decidedAt,
        });
        let updated: boolean;
        try {
          updated = await deps.deploymentEnvelopeStorage.approveExpansion({
            envelope: value.envelope,
            delta: value.delta,
            resourceBindings: value.resourceBindings,
            history,
            request: stateUpdate,
          });
        } catch (error) {
          await rollbackApprovalResources();
          throw error;
        }
        if (!updated) {
          await rollbackApprovalResources();
          return invalid(
            "/requestId",
            "envelope expansion request is not pending",
            { requestId: request.requestId },
          );
        }
      } else if (deps.envelopeExpansionRequestStorage.updateState) {
        const updated = await deps.envelopeExpansionRequestStorage.updateState(
          stateUpdate,
        );
        if (!updated) {
          await rollbackApprovalResources();
          return invalid(
            "/requestId",
            "envelope expansion request is not pending",
            { requestId: request.requestId },
          );
        }
      } else {
        throw new Error("expansion request state storage unavailable");
      }

      return Result.ok({
        request: compactExpansionRequestForResponse(approvedRequest),
        ...value,
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the top-level envelope expansion request review queue RPC handler. */
export function createAuthEnvelopeExpansionsListHandler(deps: {
  envelopeExpansionRequestStorage: EnvelopeExpansionRequestStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: BoundedListQuery & {
      deploymentId?: string;
      state?: EnvelopeExpansionRequest["state"];
    };
    context: { caller: RpcUser };
  }): Promise<
    Result<
      ListPage<EnvelopeExpansionRequest>,
      AuthError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.EnvelopeExpansions.List",
      caller,
      deploymentId: req.deploymentId,
      state: req.state,
    }, "RPC request");

    try {
      const filters = { deploymentId: req.deploymentId, state: req.state };
      if (deps.envelopeExpansionRequestStorage.listFilteredPage) {
        return Result.ok(
          compactExpansionRequestPageForResponse(
            await deps.envelopeExpansionRequestStorage.listFilteredPage(
              filters,
              req,
            ),
          ),
        );
      }
      const entries = await deps.envelopeExpansionRequestStorage.listFiltered(
        filters,
        req,
      );
      const requests = {
        entries: entries.map(compactExpansionRequestForResponse),
        count: entries.length,
        offset: req.offset ?? 0,
        limit: req.limit,
      };
      return Result.ok(requests);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the pending envelope expansion request rejection RPC handler. */
export function createAuthEnvelopeExpansionsRejectHandler(deps: {
  envelopeExpansionRequestStorage: EnvelopeExpansionRequestStorage;
  now?: () => Date;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: { requestId: string; reason?: string };
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { request: EnvelopeExpansionRequest },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.EnvelopeExpansions.Reject",
      caller,
      requestId: req.requestId,
    }, "RPC request");

    try {
      const request = await deps.envelopeExpansionRequestStorage.get?.(
        req.requestId,
      );
      if (!request) {
        return invalid("/requestId", "envelope expansion request not found", {
          requestId: req.requestId,
        });
      }
      if (request.state !== "pending") {
        return invalid(
          "/requestId",
          "envelope expansion request is not pending",
          { requestId: req.requestId, state: request.state },
        );
      }
      if (!deps.envelopeExpansionRequestStorage.updateState) {
        throw new Error("expansion request state storage unavailable");
      }

      const decidedAt = (deps.now?.() ?? new Date()).toISOString();
      const decidedBy = { type: caller.type, id: actorId(caller) };
      const rejectedRequest: EnvelopeExpansionRequest = {
        ...request,
        state: "rejected",
        decidedAt,
        decidedBy,
        decisionReason: req.reason ?? null,
      };
      const updated = await deps.envelopeExpansionRequestStorage.updateState({
        requestId: request.requestId,
        state: "rejected",
        decidedAt,
        decidedBy,
        decisionReason: rejectedRequest.decisionReason,
      });
      if (!updated) {
        return invalid(
          "/requestId",
          "envelope expansion request is not pending",
          { requestId: request.requestId },
        );
      }
      return Result.ok({
        request: compactExpansionRequestForResponse(rejectedRequest),
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment envelope change preview RPC handler. */
export function createAuthEnvelopesChangesPreviewHandler(deps: {
  contracts: EnvelopeContractDeps;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  deploymentResourceBindingStorage: DeploymentResourceBindingStorage;
  identityEnvelopeStorage?: IdentityEnvelopeStorage;
  envelopeExpansionRequestStorage?: EnvelopeExpansionRequestStorage;
  sessionStorage?: Pick<
    SessionStorage,
    "listEntriesForDeploymentEnvelopePreview"
  >;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: { deploymentId: string; proposedBoundary: EnvelopeBoundary };
    context: { caller: RpcUser };
  }): Promise<
    Result<{
      current: DeploymentEnvelope;
      proposed: DeploymentEnvelope;
      impact: ShrinkImpact;
    }, AuthError | ValidationError | UnexpectedError>
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.Envelopes.Changes.Preview",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");

    try {
      const current = await deps.deploymentEnvelopeStorage.get(
        req.deploymentId,
      );
      if (!current) {
        return invalid("/deploymentId", "deployment envelope does not exist", {
          deploymentId: req.deploymentId,
        });
      }
      const proposedBoundary = normalizedBoundary(req.proposedBoundary);
      const added = computeEnvelopeDelta(current.boundary, proposedBoundary);
      if (!isEmptyBoundary(added)) {
        return invalid(
          "/proposedBoundary",
          "envelope shrink cannot add authority",
          { added },
        );
      }
      const preview = await previewEnvelopeChange({
        contracts: deps.contracts,
        deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
        deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
        identityEnvelopeStorage: deps.identityEnvelopeStorage,
        envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
        sessionStorage: deps.sessionStorage,
        current,
        proposedBoundary,
      });
      return Result.ok({ current, ...preview });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment envelope shrink RPC handler. */
export function createAuthEnvelopesShrinkHandler(deps: {
  contracts: EnvelopeContractDeps;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  envelopeHistoryStorage?: EnvelopeHistoryStorage;
  deploymentResourceBindingStorage: DeploymentResourceBindingStorage;
  identityEnvelopeStorage?: IdentityEnvelopeStorage;
  envelopeExpansionRequestStorage?: EnvelopeExpansionRequestStorage;
  sessionStorage: SessionStorage;
  connectionsKV?: RuntimeConnectionKV;
  kick?: (serverId: string, clientId: number) => Promise<void>;
  revokeSessionRuntimeAccess?: (sessionKey: string) => Promise<void>;
  now?: () => Date;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: {
      deploymentId: string;
      proposedBoundary: EnvelopeBoundary;
      confirm: boolean;
    };
    context: { caller: RpcUser };
  }): Promise<
    Result<{
      envelope: DeploymentEnvelope;
      impact: ShrinkImpact;
      retainedResources: Array<
        { kind: DeploymentResourceBinding["kind"]; alias: string }
      >;
    }, AuthError | ValidationError | UnexpectedError>
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.Envelopes.Shrink",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");
    if (!req.confirm) {
      return invalid(
        "/confirm",
        "envelope shrink requires explicit confirmation",
      );
    }

    try {
      const current = await deps.deploymentEnvelopeStorage.get(
        req.deploymentId,
      );
      if (!current) {
        return invalid("/deploymentId", "deployment envelope does not exist", {
          deploymentId: req.deploymentId,
        });
      }
      const proposedBoundary = normalizedBoundary(req.proposedBoundary);
      const added = computeEnvelopeDelta(current.boundary, proposedBoundary);
      if (!isEmptyBoundary(added)) {
        return invalid(
          "/proposedBoundary",
          "envelope shrink cannot add authority",
          { added },
        );
      }
      const preview = await previewEnvelopeChange({
        contracts: deps.contracts,
        deploymentEnvelopeStorage: deps.deploymentEnvelopeStorage,
        deploymentResourceBindingStorage: deps.deploymentResourceBindingStorage,
        identityEnvelopeStorage: deps.identityEnvelopeStorage,
        envelopeExpansionRequestStorage: deps.envelopeExpansionRequestStorage,
        sessionStorage: deps.sessionStorage,
        current,
        proposedBoundary,
      });
      const now = (deps.now?.() ?? new Date()).toISOString();
      const envelope: DeploymentEnvelope = {
        ...preview.proposed,
        updatedAt: now,
      };
      const removed = preview.impact.removed;

      await deps.deploymentEnvelopeStorage.put(envelope);
      await deps.envelopeHistoryStorage?.put(envelopeHistoryRecord({
        scopeId: req.deploymentId,
        action: "revoke",
        delta: removed,
        resultingUpdatedAt: envelope.updatedAt,
        actor: historyActor(caller),
        reason: null,
        source: {},
        createdAt: now,
      }));
      for (const session of preview.impact.impactedSessions) {
        await revokeSession({
          sessionKey: session.sessionKey,
          sessionStorage: deps.sessionStorage,
          connectionsKV: deps.connectionsKV,
          kick: deps.kick,
          revokeSessionRuntimeAccess: deps.revokeSessionRuntimeAccess,
        });
      }

      return Result.ok({
        envelope,
        impact: preview.impact,
        retainedResources: preview.impact.orphanedResources,
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}
