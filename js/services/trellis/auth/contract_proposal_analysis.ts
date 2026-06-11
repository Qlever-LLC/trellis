import type {
  ContractEvent,
  ContractFeed,
  ContractOperation,
  ContractRpcMethod,
  ContractUses,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import {
  type EventConsumerGroupRequest,
  getContractResourceAnalysis,
  getEventConsumerGroupRequests,
  type JobsQueueRequest,
  type KvResourceRequest,
  type StoreResourceRequest,
} from "../catalog/resources.ts";
import type { ContractsModule } from "../catalog/runtime.ts";
import {
  type ContractEntry,
  ContractUseDependencyError,
  resolveContractUsesFromEntries,
  resolveContractUsesFromKnownEntries,
  sortUniqueStrings,
} from "../catalog/uses.ts";
import { operationControlCapabilityRules } from "../catalog/permissions.ts";
import type {
  AuthorityNeedSet,
  AuthorityNeedSetContract,
  AuthorityNeedSetResource,
  AuthorityNeedSetSurface,
  AuthoritySurfaceAction,
  AuthoritySurfaceKind,
  DeploymentAuthorityCapabilityDefinition,
} from "./schemas.ts";

const EMPTY_AUTHORITY_NEEDS: AuthorityNeedSet = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

type ContractUseRef = {
  contract: string;
  rpc?: { call?: string[] };
  operations?: { call?: string[] };
  events?: { publish?: string[]; subscribe?: string[] };
  feeds?: { subscribe?: string[] };
};

type ContractUsesFlat = Record<string, ContractUseRef>;

type ContractUsesGrouped = {
  required?: ContractUsesFlat;
  optional?: ContractUsesFlat;
};

type ContractWithUses = TrellisContractV1 & { uses?: ContractUses };

export type ContractProposalAnalysis = {
  contract: {
    id: string;
    digest: string;
    kind: TrellisContractV1["kind"];
  };
  required: AuthorityNeedSet;
  optional: AuthorityNeedSet;
  resources: AuthorityNeedSetResource[];
  contributedAvailability: AuthorityNeedSet;
  capabilityDefinitions: DeploymentAuthorityCapabilityDefinition[];
};

type ContractProposalDeps =
  & Pick<
    ContractsModule,
    "validateContract" | "getActiveEntries"
  >
  & {
    getKnownEntriesByContractId?:
      ContractsModule["getKnownEntriesByContractId"];
    getAcceptedFallbackEntryByContractId?: (
      contractId: string,
    ) => Promise<ContractEntry | undefined>;
  };

type ContractProposalAnalysisOptions = {
  dependencyResolution?:
    | "active"
    | "activeOrAccepted"
    | "known"
    | "knownOrPending";
};

function emptyAuthorityNeeds(): AuthorityNeedSet {
  return {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
  };
}

function getGroupedUses(contract: TrellisContractV1): ContractUsesGrouped {
  const uses = (contract as ContractWithUses).uses;
  return uses ?? {};
}

function withUses(
  contract: TrellisContractV1,
  key: "required" | "optional",
  uses: ContractUsesFlat | undefined,
): TrellisContractV1 {
  if (!uses || Object.keys(uses).length === 0) {
    return { ...contract, uses: { [key]: {} } } as TrellisContractV1;
  }
  return { ...contract, uses: { [key]: uses } } as TrellisContractV1;
}

function pushSurface(
  surfaces: AuthorityNeedSetSurface[],
  options: {
    contractId: string;
    kind: AuthoritySurfaceKind;
    name: string;
    action: AuthoritySurfaceAction;
    required: boolean;
  },
): void {
  surfaces.push(options);
}

function addTransferResource(
  resources: AuthorityNeedSetResource[],
  contractId: string,
  surfaceKind: "rpc" | "operation",
  surfaceName: string,
  direction: "receive" | "send",
  required: boolean,
  transfer?: { direction?: string; store?: string; key?: string },
): void {
  resources.push({
    kind: "transfer",
    alias: `${contractId}:${surfaceKind}:${surfaceName}:${direction}`,
    required,
    definition: {
      type: "transfer",
      direction,
      contractId,
      surfaceKind,
      surface: surfaceName,
      materialization: "backing-store",
      ...(transfer?.store === undefined ? {} : { store: transfer.store }),
      ...(transfer?.key === undefined ? {} : { key: transfer.key }),
    },
  });
}

function addRpc(
  needs: AuthorityNeedSet,
  contractId: string,
  name: string,
  method: ContractRpcMethod,
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  pushSurface(needs.surfaces, {
    contractId,
    kind: "rpc",
    name,
    action: "call",
    required,
  });
  if (options.includeCapabilities ?? true) {
    needs.capabilities.push(...(method.capabilities?.call ?? []));
  }
  if (method.transfer?.direction === "receive") {
    addTransferResource(
      needs.resources,
      contractId,
      "rpc",
      name,
      "receive",
      required,
      method.transfer,
    );
  }
}

function addOperation(
  needs: AuthorityNeedSet,
  contractId: string,
  name: string,
  operation: ContractOperation,
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  const includeCapabilities = options.includeCapabilities ?? true;
  pushSurface(needs.surfaces, {
    contractId,
    kind: "operation",
    name,
    action: "call",
    required,
  });
  if (includeCapabilities) {
    needs.capabilities.push(...(operation.capabilities?.call ?? []));
  }

  pushSurface(needs.surfaces, {
    contractId,
    kind: "operation",
    name,
    action: "observe",
    required,
  });
  if (includeCapabilities) {
    needs.capabilities.push(
      ...(operation.capabilities?.observe ?? operation.capabilities?.call ??
        []),
    );
    needs.capabilities.push(...(operation.capabilities?.control ?? []));
  }

  if (operation.cancel) {
    pushSurface(needs.surfaces, {
      contractId,
      kind: "operation",
      name,
      action: "cancel",
      required,
    });
    for (const capabilities of operationControlCapabilityRules(operation)) {
      if (includeCapabilities) needs.capabilities.push(...capabilities);
    }
  }

  if (operation.transfer?.direction === "send") {
    addTransferResource(
      needs.resources,
      contractId,
      "operation",
      name,
      "send",
      required,
      operation.transfer,
    );
  }
}

function addEvent(
  needs: AuthorityNeedSet,
  contractId: string,
  name: string,
  event: ContractEvent,
  action: "publish" | "subscribe",
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  pushSurface(needs.surfaces, {
    contractId,
    kind: "event",
    name,
    action,
    required,
  });
  if (options.includeCapabilities ?? true) {
    needs.capabilities.push(...(event.capabilities?.[action] ?? []));
  }
}

function addFeed(
  needs: AuthorityNeedSet,
  contractId: string,
  name: string,
  feed: ContractFeed,
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  pushSurface(needs.surfaces, {
    contractId,
    kind: "feed",
    name,
    action: "subscribe",
    required,
  });
  if (options.includeCapabilities ?? true) {
    needs.capabilities.push(...(feed.capabilities?.subscribe ?? []));
  }
}

function surfaceKey(surface: AuthorityNeedSetSurface): string {
  return [
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action,
    String(surface.required),
  ].join("\u001f");
}

function resourceKey(resource: AuthorityNeedSetResource): string {
  return [resource.kind, resource.alias, String(resource.required)].join(
    "\u001f",
  );
}

function contractKey(contract: AuthorityNeedSetContract): string {
  return [contract.contractId, String(contract.required)].join("\u001f");
}

function normalizeAuthorityNeeds(needs: AuthorityNeedSet): AuthorityNeedSet {
  const contracts = new Map<string, AuthorityNeedSetContract>();
  for (const contract of needs.contracts) {
    contracts.set(contractKey(contract), contract);
  }

  const surfaces = new Map<string, AuthorityNeedSetSurface>();
  for (const surface of needs.surfaces) {
    surfaces.set(surfaceKey(surface), surface);
  }

  const resources = new Map<string, AuthorityNeedSetResource>();
  for (const resource of needs.resources) {
    resources.set(resourceKey(resource), resource);
  }

  return {
    contracts: [...contracts.values()].sort((left, right) =>
      left.contractId.localeCompare(right.contractId) ||
      String(left.required).localeCompare(String(right.required))
    ),
    surfaces: [...surfaces.values()].sort((left, right) =>
      left.contractId.localeCompare(right.contractId) ||
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name) ||
      (left.action ?? "").localeCompare(right.action ?? "") ||
      String(left.required).localeCompare(String(right.required))
    ),
    capabilities: sortUniqueStrings(needs.capabilities),
    resources: [...resources.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.alias.localeCompare(right.alias) ||
      String(left.required).localeCompare(String(right.required))
    ),
  };
}

function groupEntriesByContractId(
  entries: ContractEntry[],
): Map<string, ContractEntry[]> {
  const byContractId = new Map<string, ContractEntry[]>();
  for (const entry of entries) {
    const existing = byContractId.get(entry.contract.id) ?? [];
    existing.push(entry);
    byContractId.set(entry.contract.id, existing);
  }
  return byContractId;
}

function selectResolvableKnownOrPendingUses(args: {
  contract: TrellisContractV1;
  key: "required" | "optional";
  uses: ContractUsesFlat | undefined;
  entries: ContractEntry[];
}): {
  entries: ContractEntry[];
  entryIds: Set<string>;
  uses: ContractUsesFlat | undefined;
} {
  if (!args.uses || Object.keys(args.uses).length === 0) {
    return { entries: [], entryIds: new Set(), uses: undefined };
  }

  // Stale inactive manifests can be incompatible with each other and have no
  // direct admin remediation path. Treat those dependencies as unresolved blockers.
  const entriesByContractId = groupEntriesByContractId(args.entries);
  const selectedEntries = new Map<string, ContractEntry>();
  const selectedUses: ContractUsesFlat = {};
  const entryIds = new Set<string>();

  for (const [alias, use] of Object.entries(args.uses)) {
    const dependencyEntries = entriesByContractId.get(use.contract) ?? [];
    if (dependencyEntries.length === 0) continue;

    try {
      resolveContractUsesFromKnownEntries(
        dependencyEntries,
        withUses(args.contract, args.key, { [alias]: use }),
      );
    } catch (error) {
      if (error instanceof ContractUseDependencyError) throw error;
      continue;
    }

    selectedUses[alias] = use;
    entryIds.add(use.contract);
    for (const entry of dependencyEntries) {
      selectedEntries.set(entry.digest, entry);
    }
  }

  return {
    entries: [...selectedEntries.values()],
    entryIds,
    uses: Object.keys(selectedUses).length > 0 ? selectedUses : undefined,
  };
}

async function deriveUseNeeds(
  contracts: ContractProposalDeps,
  contract: TrellisContractV1,
  key: "required" | "optional",
  uses: ContractUsesFlat | undefined,
  options: ContractProposalAnalysisOptions,
): Promise<AuthorityNeedSet> {
  const required = key === "required";
  const needs = emptyAuthorityNeeds();
  const dependencyResolution = options.dependencyResolution ?? "active";
  let entries = dependencyResolution === "active"
    ? await contracts.getActiveEntries()
    : dependencyResolution === "activeOrAccepted"
    ? await getActiveOrAcceptedDependencyEntries(contracts, uses)
    : await getKnownDependencyEntries(contracts, uses);
  let entryIds = new Set(entries.map((entry) => entry.contract.id));
  let resolvableUses = dependencyResolution === "knownOrPending"
    ? usesForKnownEntries(uses, entryIds)
    : uses;

  if (dependencyResolution === "knownOrPending") {
    const selected = selectResolvableKnownOrPendingUses({
      contract,
      key,
      uses,
      entries,
    });
    entries = selected.entries;
    entryIds = selected.entryIds;
    resolvableUses = selected.uses;
  }

  const contractWithUses = withUses(contract, key, resolvableUses);
  const resolved = dependencyResolution === "active" ||
      dependencyResolution === "activeOrAccepted"
    ? resolveContractUsesFromEntries(entries, contractWithUses)
    : resolveContractUsesFromKnownEntries(entries, contractWithUses);

  for (const use of Object.values(uses ?? {})) {
    if (
      entryIds.has(use.contract) ||
      (required && dependencyResolution === "knownOrPending")
    ) {
      needs.contracts.push({ contractId: use.contract, required });
    }
  }

  for (const method of resolved.rpcCalls) {
    needs.contracts.push({ contractId: method.contractId, required });
    addRpc(needs, method.contractId, method.key, method.method, required);
  }
  for (const operation of resolved.operationCalls) {
    needs.contracts.push({ contractId: operation.contractId, required });
    addOperation(
      needs,
      operation.contractId,
      operation.key,
      operation.operation,
      required,
    );
  }
  for (const event of resolved.eventPublishes) {
    needs.contracts.push({ contractId: event.contractId, required });
    addEvent(
      needs,
      event.contractId,
      event.key,
      event.event,
      "publish",
      required,
    );
  }
  for (const event of resolved.eventSubscribes) {
    needs.contracts.push({ contractId: event.contractId, required });
    addEvent(
      needs,
      event.contractId,
      event.key,
      event.event,
      "subscribe",
      required,
    );
  }
  for (const feed of resolved.feedSubscribes) {
    needs.contracts.push({ contractId: feed.contractId, required });
    addFeed(needs, feed.contractId, feed.key, feed.feed, required);
  }

  return normalizeAuthorityNeeds(needs);
}

async function getActiveOrAcceptedDependencyEntries(
  contracts: ContractProposalDeps,
  uses: ContractUsesFlat | undefined,
): Promise<ContractEntry[]> {
  const activeEntries = await contracts.getActiveEntries();
  if (!uses || Object.keys(uses).length === 0) return activeEntries;

  const entriesByDigest = new Map(
    activeEntries.map((entry) => [entry.digest, entry]),
  );
  const activeContractIds = new Set(
    activeEntries.map((entry) => entry.contract.id),
  );

  for (
    const contractId of sortUniqueStrings(
      Object.values(uses).map((use) => use.contract),
    )
  ) {
    if (activeContractIds.has(contractId)) continue;
    const fallback = await contracts.getAcceptedFallbackEntryByContractId?.(
      contractId,
    );
    if (fallback) entriesByDigest.set(fallback.digest, fallback);
  }

  return [...entriesByDigest.values()];
}

function usesForKnownEntries(
  uses: ContractUsesFlat | undefined,
  knownContractIds: Set<string>,
): ContractUsesFlat | undefined {
  if (!uses) return undefined;
  return Object.fromEntries(
    Object.entries(uses).filter(([, use]) =>
      knownContractIds.has(use.contract)
    ),
  );
}

async function getKnownDependencyEntries(
  contracts: ContractProposalDeps,
  uses: ContractUsesFlat | undefined,
): Promise<ContractEntry[]> {
  if (!uses || Object.keys(uses).length === 0) return [];
  if (!contracts.getKnownEntriesByContractId) {
    throw new Error("Known contract dependency lookup is unavailable");
  }
  const entriesByDigest = new Map<string, ContractEntry>();
  const activeEntriesByContractId = new Map<string, ContractEntry[]>();
  for (const entry of await contracts.getActiveEntries()) {
    const entries = activeEntriesByContractId.get(entry.contract.id) ?? [];
    entries.push(entry);
    activeEntriesByContractId.set(entry.contract.id, entries);
  }
  for (
    const contractId of sortUniqueStrings(
      Object.values(uses ?? {}).map((use) => use.contract),
    )
  ) {
    const activeEntries = activeEntriesByContractId.get(contractId);
    const acceptedFallback = activeEntries === undefined
      ? await contracts.getAcceptedFallbackEntryByContractId?.(contractId)
      : undefined;
    const dependencyEntries = activeEntries ??
      (acceptedFallback
        ? [acceptedFallback]
        : await contracts.getKnownEntriesByContractId(contractId));
    for (const entry of dependencyEntries) {
      entriesByDigest.set(entry.digest, entry);
    }
  }
  return [...entriesByDigest.values()];
}

function optionalUsesWithoutRequiredAliases(
  uses: ContractUsesGrouped,
): ContractUsesFlat | undefined {
  if (!uses.optional) return undefined;
  const requiredAliases = new Set(Object.keys(uses.required ?? {}));
  return Object.fromEntries(
    Object.entries(uses.optional).filter(([alias]) =>
      !requiredAliases.has(alias)
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractSchemaMetadata(
  contract: TrellisContractV1,
  schema: { schema?: string } | undefined,
): Record<string, unknown> | undefined {
  if (!schema?.schema) return undefined;
  return {
    name: schema.schema,
    exported: contract.exports?.schemas?.includes(schema.schema) ?? false,
  };
}

function kvDefinition(
  contract: TrellisContractV1,
  resource: KvResourceRequest,
): Record<string, unknown> {
  const declared = contract.resources?.kv?.[resource.alias];
  const schema = contractSchemaMetadata(contract, declared?.schema);
  return {
    type: "kv",
    history: resource.history,
    ttlMs: resource.ttlMs,
    ...(resource.maxValueBytes === undefined
      ? {}
      : { maxValueBytes: resource.maxValueBytes }),
    ...(schema === undefined ? {} : { schema }),
  };
}

function storeDefinition(
  resource: StoreResourceRequest,
): Record<string, unknown> {
  return {
    type: "store",
    ttlMs: resource.ttlMs,
    ...(resource.maxObjectBytes === undefined
      ? {}
      : { maxObjectBytes: resource.maxObjectBytes }),
    ...(resource.maxTotalBytes === undefined
      ? {}
      : { maxTotalBytes: resource.maxTotalBytes }),
  };
}

function jobsDefinition(queue: JobsQueueRequest): Record<string, unknown> {
  return {
    type: "jobs-queue",
    queueType: queue.queueType,
    payload: queue.payload,
    ...(queue.result === undefined ? {} : { result: queue.result }),
    maxDeliver: queue.maxDeliver,
    backoffMs: queue.backoffMs,
    ackWaitMs: queue.ackWaitMs,
    ...(queue.defaultDeadlineMs === undefined
      ? {}
      : { defaultDeadlineMs: queue.defaultDeadlineMs }),
    progress: queue.progress,
    logs: queue.logs,
    dlq: queue.dlq,
    concurrency: queue.concurrency,
  };
}

function eventConsumerEventRefs(
  contract: TrellisContractV1,
  alias: string,
): Array<{ use: string; event: string }> {
  const group = validatedEventConsumers(contract)[alias];
  if (!isRecord(group) || !Array.isArray(group.events)) return [];
  return group.events.flatMap((eventRef) => {
    if (!isRecord(eventRef)) return [];
    if (
      typeof eventRef.use !== "string" || typeof eventRef.event !== "string"
    ) {
      return [];
    }
    return [{ use: eventRef.use, event: eventRef.event }];
  });
}

function eventConsumerDefinition(
  contract: TrellisContractV1,
  consumer: EventConsumerGroupRequest,
): Record<string, unknown> {
  return {
    type: "event-consumer",
    stream: consumer.stream,
    filterSubjects: consumer.filterSubjects,
    eventRefs: eventConsumerEventRefs(contract, consumer.alias),
    replay: consumer.replay,
    ordering: consumer.ordering,
    concurrency: consumer.concurrency,
    ackWaitMs: consumer.ackWaitMs,
    maxDeliver: consumer.maxDeliver,
    backoffMs: consumer.backoffMs,
  };
}

async function deriveEventConsumerRequests(
  contracts: ContractProposalDeps,
  contract: TrellisContractV1,
  groupedUses: ContractUsesGrouped,
  requested: Pick<AuthorityNeedSet, "surfaces">,
  options: ContractProposalAnalysisOptions,
): Promise<EventConsumerGroupRequest[]> {
  if (Object.keys(validatedEventConsumers(contract)).length === 0) return [];
  const uses = { ...groupedUses.required, ...groupedUses.optional };
  const dependencyResolution = options.dependencyResolution ?? "active";
  const entries = dependencyResolution === "active"
    ? await contracts.getActiveEntries()
    : dependencyResolution === "activeOrAccepted"
    ? await getActiveOrAcceptedDependencyEntries(contracts, uses)
    : await getKnownDependencyEntries(contracts, uses);
  return getEventConsumerGroupRequests(contract, {
    knownContractEntries: entries,
    authorityNeeds: requested,
  });
}

function deriveContractResources(
  contract: TrellisContractV1,
  eventConsumers: EventConsumerGroupRequest[],
): AuthorityNeedSetResource[] {
  const resources = getContractResourceAnalysis(contract);
  return [
    ...eventConsumers.map((consumer) => ({
      kind: "event-consumer" as const,
      alias: consumer.alias,
      required: true,
      definition: eventConsumerDefinition(contract, consumer),
    })),
    ...resources.jobs.map((job) => ({
      kind: "jobs" as const,
      alias: job.queueType,
      required: true,
      definition: jobsDefinition(job),
    })),
    ...resources.kv.map((resource) => ({
      kind: "kv" as const,
      alias: resource.alias,
      required: resource.required,
      definition: kvDefinition(contract, resource),
    })),
    ...resources.store.map((resource) => ({
      kind: "store" as const,
      alias: resource.alias,
      required: resource.required,
      definition: storeDefinition(resource),
    })),
  ].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.alias.localeCompare(right.alias)
  );
}

function validatedEventConsumers(
  contract: TrellisContractV1,
): Record<string, unknown> {
  return (contract as TrellisContractV1 & {
    eventConsumers?: Record<string, unknown>;
  })
    .eventConsumers ?? {};
}

function fallbackCapabilityDescription(key: string): string {
  return `Requires ${key}.`;
}

function ownedCapabilityKeys(contract: TrellisContractV1): string[] {
  const keys: string[] = Object.keys(contract.capabilities ?? {});

  for (const method of Object.values(contract.rpc ?? {})) {
    keys.push(...(method.capabilities?.call ?? []));
  }
  for (const operation of Object.values(contract.operations ?? {})) {
    keys.push(...(operation.capabilities?.call ?? []));
    keys.push(...(operation.capabilities?.observe ?? []));
    keys.push(...(operation.capabilities?.control ?? []));
    for (const capabilities of operationControlCapabilityRules(operation)) {
      keys.push(...capabilities);
    }
  }
  for (const event of Object.values(contract.events ?? {})) {
    keys.push(...(event.capabilities?.publish ?? []));
    keys.push(...(event.capabilities?.subscribe ?? []));
  }
  for (const feed of Object.values(contract.feeds ?? {})) {
    keys.push(...(feed.capabilities?.subscribe ?? []));
  }

  return sortUniqueStrings(keys);
}

function capabilityDefinitionsForContract(input: {
  deploymentId: string;
  contract: TrellisContractV1;
  digest: string;
  direction: DeploymentAuthorityCapabilityDefinition["direction"];
  capabilities?: Iterable<string>;
}): DeploymentAuthorityCapabilityDefinition[] {
  const requested = input.capabilities === undefined
    ? undefined
    : new Set(input.capabilities);
  const keys = requested === undefined
    ? Object.keys(input.contract.capabilities ?? {})
    : [...requested];
  return sortUniqueStrings(keys).map((key) => {
    const metadata = input.contract.capabilities?.[key];
    return {
      deploymentId: input.deploymentId,
      key,
      displayName: metadata?.displayName ?? key,
      description: metadata?.description ?? fallbackCapabilityDescription(key),
      ...(metadata?.consequence === undefined
        ? {}
        : { consequence: metadata.consequence }),
      source: "contract" as const,
      contractId: input.contract.id,
      contractDigest: input.digest,
      contractDisplayName: input.contract.displayName,
      direction: input.direction,
    };
  });
}

/**
 * Derives capability definitions created by a deployment's owned contract
 * surfaces, using metadata from the contract's optional top-level capability
 * catalog when present.
 */
export function deriveOwnedCapabilityDefinitions(input: {
  deploymentId: string;
  contract: TrellisContractV1;
  digest: string;
}): DeploymentAuthorityCapabilityDefinition[] {
  return capabilityDefinitionsForContract({
    deploymentId: input.deploymentId,
    contract: input.contract,
    digest: input.digest,
    direction: "creates",
    capabilities: ownedCapabilityKeys(input.contract),
  });
}

function uniqueCapabilityDefinitions(
  definitions: DeploymentAuthorityCapabilityDefinition[],
): DeploymentAuthorityCapabilityDefinition[] {
  const byKey = new Map<string, DeploymentAuthorityCapabilityDefinition>();
  for (const definition of definitions) {
    byKey.set(
      JSON.stringify([
        definition.deploymentId,
        definition.key,
        definition.direction,
        definition.contractId ?? "",
        definition.contractDigest ?? "",
      ]),
      definition,
    );
  }
  return [...byKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key) ||
    left.deploymentId.localeCompare(right.deploymentId) ||
    (left.contractId ?? "").localeCompare(right.contractId ?? "") ||
    (left.contractDigest ?? "").localeCompare(right.contractDigest ?? "") ||
    left.direction.localeCompare(right.direction)
  );
}

function deriveOwnTransferResources(
  contract: TrellisContractV1,
): AuthorityNeedSetResource[] {
  const resources: AuthorityNeedSetResource[] = [];
  for (const [name, method] of Object.entries(contract.rpc ?? {})) {
    if (method.transfer?.direction === "receive") {
      addTransferResource(
        resources,
        contract.id,
        "rpc",
        name,
        "receive",
        true,
        method.transfer,
      );
    }
  }
  for (const [name, operation] of Object.entries(contract.operations ?? {})) {
    if (operation.transfer?.direction === "send") {
      addTransferResource(
        resources,
        contract.id,
        "operation",
        name,
        "send",
        true,
        operation.transfer,
      );
    }
  }
  return normalizeAuthorityNeeds({ ...EMPTY_AUTHORITY_NEEDS, resources })
    .resources;
}

function deriveContributedAvailability(
  contract: TrellisContractV1,
): AuthorityNeedSet {
  const needs = emptyAuthorityNeeds();
  needs.contracts.push({ contractId: contract.id, required: true });

  for (const [name, method] of Object.entries(contract.rpc ?? {})) {
    addRpc(needs, contract.id, name, method, true, {
      includeCapabilities: false,
    });
  }
  for (const [name, operation] of Object.entries(contract.operations ?? {})) {
    addOperation(needs, contract.id, name, operation, true, {
      includeCapabilities: false,
    });
  }
  for (const [name, event] of Object.entries(contract.events ?? {})) {
    addEvent(needs, contract.id, name, event, "publish", true, {
      includeCapabilities: false,
    });
    addEvent(needs, contract.id, name, event, "subscribe", true, {
      includeCapabilities: false,
    });
  }
  for (const [name, feed] of Object.entries(contract.feeds ?? {})) {
    addFeed(needs, contract.id, name, feed, true, {
      includeCapabilities: false,
    });
  }

  needs.resources = [];
  return normalizeAuthorityNeeds(needs);
}

/**
 * Validates a raw contract and derives the reusable desired need sets for it.
 */
export async function analyzeContractProposal(
  contracts: ContractProposalDeps,
  rawContract: unknown,
  options: ContractProposalAnalysisOptions = {},
): Promise<ContractProposalAnalysis> {
  const validated = await contracts.validateContract(rawContract);
  const groupedUses = getGroupedUses(validated.contract);
  const required = await deriveUseNeeds(
    contracts,
    validated.contract,
    "required",
    groupedUses.required,
    options,
  );
  const optional = await deriveUseNeeds(
    contracts,
    validated.contract,
    "optional",
    optionalUsesWithoutRequiredAliases(groupedUses),
    options,
  );
  const eventConsumers = await deriveEventConsumerRequests(
    contracts,
    validated.contract,
    groupedUses,
    { surfaces: [...required.surfaces, ...optional.surfaces] },
    options,
  );
  const resources = deriveContractResources(validated.contract, eventConsumers);
  const ownTransferResources = deriveOwnTransferResources(validated.contract);

  required.resources = normalizeAuthorityNeeds({
    ...EMPTY_AUTHORITY_NEEDS,
    resources: [
      ...required.resources,
      ...resources.filter((resource) => resource.required),
      ...ownTransferResources,
    ],
  }).resources;
  optional.resources = normalizeAuthorityNeeds({
    ...EMPTY_AUTHORITY_NEEDS,
    resources: [
      ...optional.resources,
      ...resources.filter((resource) => !resource.required),
    ],
  }).resources;

  return {
    contract: {
      id: validated.contract.id,
      digest: validated.digest,
      kind: validated.contract.kind,
    },
    required: normalizeAuthorityNeeds(required),
    optional: normalizeAuthorityNeeds(optional),
    resources,
    contributedAvailability: deriveContributedAvailability(validated.contract),
    capabilityDefinitions: uniqueCapabilityDefinitions([
      ...capabilityDefinitionsForContract({
        deploymentId: validated.contract.id,
        contract: validated.contract,
        digest: validated.digest,
        direction: "creates",
        capabilities: ownedCapabilityKeys(validated.contract),
      }),
      ...capabilityDefinitionsForContract({
        deploymentId: validated.contract.id,
        contract: validated.contract,
        digest: validated.digest,
        direction: "given",
        capabilities: [...required.capabilities, ...optional.capabilities],
      }),
    ]),
  };
}
