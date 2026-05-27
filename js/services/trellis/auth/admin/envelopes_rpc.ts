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
  getKvResourceRequests,
  getStoreResourceRequests,
  type KvResourceRequest,
  provisionContractResourceBindings,
  type ResourceProvisioningOptions,
  type StoreResourceRequest,
} from "../../catalog/resources.ts";
import type { ContractRecord } from "../../catalog/schemas.ts";
import type { ContractEntry } from "../../catalog/uses.ts";
import { analyzeContractEnvelopeBoundary } from "../boundary_analysis.ts";
import {
  computeEnvelopeDelta,
  previewEnvelopeShrinkImpact,
} from "../envelope_decision.ts";
import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import type {
  Connection,
  DeploymentContractEvidence,
  DeploymentEnvelope,
  DeploymentGrantOverride,
  DeploymentPortalRoute,
  DeploymentResourceBinding,
  EnvelopeBoundary,
  EnvelopeExpansionRequest,
  EnvelopeHistoryEntry,
  IdentityEnvelopeRecord,
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

async function knownDependencyEntriesForProvisioning(
  deps: Pick<
    EnvelopeContractDeps,
    "getActiveEntries" | "getKnownEntriesByContractId"
  >,
  contract: TrellisContractV1,
): Promise<ContractEntry[]> {
  const entriesByDigest = new Map<string, ContractEntry>();
  for (const entry of await deps.getActiveEntries()) {
    entriesByDigest.set(entry.digest, entry);
  }
  const contractIds = new Set<string>();
  for (const group of [contract.uses?.required, contract.uses?.optional]) {
    for (const use of Object.values(group ?? {})) {
      contractIds.add(use.contract);
    }
  }
  for (const contractId of contractIds) {
    for (const entry of await deps.getKnownEntriesByContractId(contractId)) {
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
    contractEvidence: DeploymentContractEvidence;
    history?: EnvelopeHistoryEntry;
  }): Promise<void>;
  approveExpansion?(record: {
    envelope: DeploymentEnvelope;
    delta: EnvelopeBoundary;
    resourceBindings: DeploymentResourceBinding[];
    contractEvidence: DeploymentContractEvidence;
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

type DeploymentContractEvidenceStorage = {
  get(
    deploymentId: string,
    contractDigest: string,
  ): Promise<DeploymentContractEvidence | undefined>;
  put(record: DeploymentContractEvidence): Promise<void>;
  listByDeployment?(
    deploymentId: string,
  ): Promise<DeploymentContractEvidence[]>;
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
};

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

function contractEvidenceRecord(
  input: {
    deploymentId: string;
    contract: TrellisContractV1;
    digest: string;
    now: string;
    existing?: DeploymentContractEvidence;
  },
): DeploymentContractEvidence {
  return {
    deploymentId: input.deploymentId,
    contractId: input.contract.id,
    contractDigest: input.digest,
    contract: { ...input.contract },
    firstSeenAt: input.existing?.firstSeenAt ?? input.now,
    lastSeenAt: input.now,
  };
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
    if (resource.kind === "transfer" || !resource.required) continue;
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
  deploymentContractEvidenceStorage: Pick<
    DeploymentContractEvidenceStorage,
    "listByDeployment"
  >;
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
      contractEvidence: DeploymentContractEvidence[];
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
        contractEvidence,
        expansionRequests,
        portalRoute,
        grantOverrides,
      ] = await Promise.all([
        deps.deploymentResourceBindingStorage.listByDeployment?.(
          req.deploymentId,
        ) ?? Promise.resolve([]),
        deps.deploymentContractEvidenceStorage.listByDeployment?.(
          req.deploymentId,
        ) ?? Promise.resolve([]),
        deps.envelopeExpansionRequestStorage.listByDeployment(req.deploymentId),
        deps.deploymentPortalRouteStorage.get(req.deploymentId),
        deps.deploymentGrantOverrideStorage.listByDeployment(req.deploymentId),
      ]);
      return Result.ok({
        envelope,
        resourceBindings,
        contractEvidence,
        expansionRequests,
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
      contractId: session.currentContractId,
      contractDigest: session.currentContractDigest,
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
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage;
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

  const evidence = await input.deploymentContractEvidenceStorage
    .listByDeployment?.(input.current.deploymentId) ?? [];
  const boundaryByDigest = new Map<string, EnvelopeBoundary>();
  for (const record of evidence) {
    const boundary = await boundaryForKnownDigest({
      contracts: input.contracts,
      digest: record.contractDigest,
    });
    if (!boundary) {
      throw new Error(
        `Unknown deployment contract digest '${record.contractDigest}'`,
      );
    }
    boundaryByDigest.set(record.contractDigest, boundary);
  }

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
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage;
  nats?: NatsConnection;
  provisionResourceBindings?: (
    nats: NatsConnection | undefined,
    contract: TrellisContractV1,
    deploymentId: string,
    options?: ResourceProvisioningOptions,
  ) => Promise<ContractResourceBindings>;
  resourceProvisioningOptions?: ResourceProvisioningOptions;
  now?: () => Date;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}, options: {
  persist?: boolean;
  dependencyResolution?: ExpansionDependencyResolution;
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
      contractEvidence: DeploymentContractEvidence;
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
        deps.contracts,
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
      const resourcesNeedingProvisioning =
        await storedResourceKeysNeedingProvisioning({
          deploymentId: req.deploymentId,
          contract: validated.contract,
          requested,
          storage: deps.deploymentResourceBindingStorage,
        });

      if (resourcesNeedingProvisioning.size > 0) {
        const bindings = await (deps.provisionResourceBindings ??
          provisionContractResourceBindings)(
            deps.nats,
            validated.contract,
            req.deploymentId,
            {
              ...deps.resourceProvisioningOptions,
              knownContractEntries: await knownDependencyEntriesForProvisioning(
                deps.contracts,
                validated.contract,
              ),
              envelopeBoundary: requested,
            },
          );
        resourceBindings = await buildResourceBindingRecords({
          deploymentId: req.deploymentId,
          bindings,
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
      const existingEvidence = await deps.deploymentContractEvidenceStorage.get(
        req.deploymentId,
        analysis.contract.digest,
      );
      const contractEvidence = contractEvidenceRecord({
        deploymentId: req.deploymentId,
        contract: validated.contract,
        digest: analysis.contract.digest,
        now,
        existing: existingEvidence,
      });

      await deps.contractStorage.put(contractStorageRecord({
        digest: analysis.contract.digest,
        contract: validated.contract,
        canonical: validated.canonical,
        installedAt: new Date(now),
      }));

      if (options.persist ?? true) {
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
        if (deps.deploymentEnvelopeStorage.putExpansion) {
          await deps.deploymentEnvelopeStorage.putExpansion({
            envelope,
            delta,
            resourceBindings,
            contractEvidence,
            history,
          });
        } else {
          if (envelope !== current) {
            await deps.deploymentEnvelopeStorage.put(envelope);
          }
          for (const binding of resourceBindings) {
            await deps.deploymentResourceBindingStorage.put(binding);
          }
          await deps.deploymentContractEvidenceStorage.put(contractEvidence);
          await deps.envelopeHistoryStorage?.put(history);
        }
      }

      return Result.ok({
        envelope,
        delta,
        contractEvidence,
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
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage;
  envelopeExpansionRequestStorage: EnvelopeExpansionRequestStorage;
  nats?: NatsConnection;
  provisionResourceBindings?: (
    nats: NatsConnection | undefined,
    contract: TrellisContractV1,
    deploymentId: string,
    options?: ResourceProvisioningOptions,
  ) => Promise<ContractResourceBindings>;
  resourceProvisioningOptions?: ResourceProvisioningOptions;
  now?: () => Date;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  const expand = createAuthEnvelopesExpandHandler(deps, {
    persist: !deps.deploymentEnvelopeStorage.approveExpansion,
    dependencyResolution: "knownOrPending",
  });
  return async (args: {
    input: { requestId: string; reason?: string };
    context: { caller: RpcUser };
  }): Promise<
    Result<{
      request: EnvelopeExpansionRequest;
      envelope: DeploymentEnvelope;
      delta: EnvelopeBoundary;
      contractEvidence: DeploymentContractEvidence;
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
        const updated = await deps.deploymentEnvelopeStorage.approveExpansion({
          envelope: value.envelope,
          delta: value.delta,
          resourceBindings: value.resourceBindings,
          contractEvidence: value.contractEvidence,
          history,
          request: stateUpdate,
        });
        if (!updated) {
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
          return invalid(
            "/requestId",
            "envelope expansion request is not pending",
            { requestId: request.requestId },
          );
        }
      } else {
        throw new Error("expansion request state storage unavailable");
      }

      return Result.ok({ request: approvedRequest, ...value });
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
          await deps.envelopeExpansionRequestStorage.listFilteredPage(
            filters,
            req,
          ),
        );
      }
      const entries = await deps.envelopeExpansionRequestStorage.listFiltered(
        filters,
        req,
      );
      const requests = {
        entries,
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
      return Result.ok({ request: rejectedRequest });
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
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage;
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
        deploymentContractEvidenceStorage:
          deps.deploymentContractEvidenceStorage,
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
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage;
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
        deploymentContractEvidenceStorage:
          deps.deploymentContractEvidenceStorage,
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
