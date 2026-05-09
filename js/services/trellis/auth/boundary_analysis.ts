import type {
  ContractEvent,
  ContractFeed,
  ContractOperation,
  ContractRpcMethod,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import { getContractResourceAnalysis } from "../catalog/resources.ts";
import type { ContractsModule } from "../catalog/runtime.ts";
import {
  resolveContractUsesFromEntries,
  sortUniqueStrings,
} from "../catalog/uses.ts";
import { operationControlCapabilityRules } from "../catalog/permissions.ts";
import type {
  EnvelopeBoundary,
  EnvelopeBoundaryContract,
  EnvelopeBoundaryResource,
  EnvelopeBoundarySurface,
  EnvelopeSurfaceAction,
  EnvelopeSurfaceKind,
} from "./schemas.ts";

const EMPTY_BOUNDARY: EnvelopeBoundary = {
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

type ContractUses = ContractUsesFlat | ContractUsesGrouped;

type ContractWithUses = TrellisContractV1 & { uses?: ContractUses };

export type ContractEnvelopeBoundary = {
  contract: {
    id: string;
    digest: string;
    kind: TrellisContractV1["kind"];
  };
  required: EnvelopeBoundary;
  optional: EnvelopeBoundary;
  resources: EnvelopeBoundaryResource[];
  contributedAvailability: EnvelopeBoundary;
};

type ContractBoundaryDeps = Pick<
  ContractsModule,
  "validateContract" | "getActiveEntries"
>;

function emptyBoundary(): EnvelopeBoundary {
  return {
    contracts: [],
    surfaces: [],
    capabilities: [],
    resources: [],
  };
}

function isContractUseRef(value: unknown): value is ContractUseRef {
  return !!value && typeof value === "object" &&
    typeof (value as { contract?: unknown }).contract === "string";
}

function getGroupedUses(contract: TrellisContractV1): ContractUsesGrouped {
  const uses = (contract as ContractWithUses).uses;
  if (!uses) return {};
  const maybeGrouped = uses as ContractUsesGrouped;
  const grouped = (maybeGrouped.required !== undefined &&
    !isContractUseRef(maybeGrouped.required)) ||
    (maybeGrouped.optional !== undefined &&
      !isContractUseRef(maybeGrouped.optional));
  if (grouped) return maybeGrouped;
  return { required: uses as ContractUsesFlat };
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
  surfaces: EnvelopeBoundarySurface[],
  options: {
    contractId: string;
    kind: EnvelopeSurfaceKind;
    name: string;
    action: EnvelopeSurfaceAction;
    required: boolean;
  },
): void {
  surfaces.push(options);
}

function addTransferResource(
  resources: EnvelopeBoundaryResource[],
  direction: "receive" | "send",
  required: boolean,
): void {
  resources.push({
    kind: "transfer",
    alias: direction === "receive" ? "download" : "upload",
    required,
  });
}

function addRpc(
  boundary: EnvelopeBoundary,
  contractId: string,
  name: string,
  method: ContractRpcMethod,
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  pushSurface(boundary.surfaces, {
    contractId,
    kind: "rpc",
    name,
    action: "call",
    required,
  });
  if (options.includeCapabilities ?? true) {
    boundary.capabilities.push(...(method.capabilities?.call ?? []));
  }
  if (method.transfer?.direction === "receive") {
    addTransferResource(boundary.resources, "receive", required);
  }
}

function addOperation(
  boundary: EnvelopeBoundary,
  contractId: string,
  name: string,
  operation: ContractOperation,
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  const includeCapabilities = options.includeCapabilities ?? true;
  pushSurface(boundary.surfaces, {
    contractId,
    kind: "operation",
    name,
    action: "call",
    required,
  });
  if (includeCapabilities) {
    boundary.capabilities.push(...(operation.capabilities?.call ?? []));
  }

  pushSurface(boundary.surfaces, {
    contractId,
    kind: "operation",
    name,
    action: "read",
    required,
  });
  if (includeCapabilities) {
    boundary.capabilities.push(
      ...(operation.capabilities?.read ?? operation.capabilities?.call ?? []),
    );
    boundary.capabilities.push(...(operation.capabilities?.control ?? []));
  }

  if (operation.cancel) {
    pushSurface(boundary.surfaces, {
      contractId,
      kind: "operation",
      name,
      action: "cancel",
      required,
    });
    for (const capabilities of operationControlCapabilityRules(operation)) {
      if (includeCapabilities) boundary.capabilities.push(...capabilities);
    }
  }

  if (operation.transfer?.direction === "send") {
    addTransferResource(boundary.resources, "send", required);
  }
}

function addEvent(
  boundary: EnvelopeBoundary,
  contractId: string,
  name: string,
  event: ContractEvent,
  action: "publish" | "subscribe",
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  pushSurface(boundary.surfaces, {
    contractId,
    kind: "event",
    name,
    action,
    required,
  });
  if (options.includeCapabilities ?? true) {
    boundary.capabilities.push(...(event.capabilities?.[action] ?? []));
  }
}

function addFeed(
  boundary: EnvelopeBoundary,
  contractId: string,
  name: string,
  feed: ContractFeed,
  required: boolean,
  options: { includeCapabilities?: boolean } = {},
): void {
  pushSurface(boundary.surfaces, {
    contractId,
    kind: "feed",
    name,
    action: "read",
    required,
  });
  if (options.includeCapabilities ?? true) {
    boundary.capabilities.push(...(feed.capabilities?.subscribe ?? []));
  }
}

function surfaceKey(surface: EnvelopeBoundarySurface): string {
  return [
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action,
    String(surface.required),
  ].join("\u001f");
}

function resourceKey(resource: EnvelopeBoundaryResource): string {
  return [resource.kind, resource.alias, String(resource.required)].join(
    "\u001f",
  );
}

function contractKey(contract: EnvelopeBoundaryContract): string {
  return [contract.contractId, String(contract.required)].join("\u001f");
}

function normalizeBoundary(boundary: EnvelopeBoundary): EnvelopeBoundary {
  const contracts = new Map<string, EnvelopeBoundaryContract>();
  for (const contract of boundary.contracts) {
    contracts.set(contractKey(contract), contract);
  }

  const surfaces = new Map<string, EnvelopeBoundarySurface>();
  for (const surface of boundary.surfaces) {
    surfaces.set(surfaceKey(surface), surface);
  }

  const resources = new Map<string, EnvelopeBoundaryResource>();
  for (const resource of boundary.resources) {
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
      left.action.localeCompare(right.action) ||
      String(left.required).localeCompare(String(right.required))
    ),
    capabilities: sortUniqueStrings(boundary.capabilities),
    resources: [...resources.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.alias.localeCompare(right.alias) ||
      String(left.required).localeCompare(String(right.required))
    ),
  };
}

async function deriveUseBoundary(
  contracts: ContractBoundaryDeps,
  contract: TrellisContractV1,
  key: "required" | "optional",
  uses: ContractUsesFlat | undefined,
): Promise<EnvelopeBoundary> {
  const required = key === "required";
  const boundary = emptyBoundary();
  const contractWithUses = withUses(contract, key, uses);
  const activeEntries = await contracts.getActiveEntries();
  const resolved = resolveContractUsesFromEntries(
    activeEntries,
    contractWithUses,
  );
  const activeIds = new Set(activeEntries.map((entry) => entry.contract.id));

  for (const use of Object.values(uses ?? {})) {
    if (activeIds.has(use.contract)) {
      boundary.contracts.push({ contractId: use.contract, required });
    }
  }

  for (const method of resolved.rpcCalls) {
    boundary.contracts.push({ contractId: method.contractId, required });
    addRpc(boundary, method.contractId, method.key, method.method, required);
  }
  for (const operation of resolved.operationCalls) {
    boundary.contracts.push({ contractId: operation.contractId, required });
    addOperation(
      boundary,
      operation.contractId,
      operation.key,
      operation.operation,
      required,
    );
  }
  for (const event of resolved.eventPublishes) {
    boundary.contracts.push({ contractId: event.contractId, required });
    addEvent(
      boundary,
      event.contractId,
      event.key,
      event.event,
      "publish",
      required,
    );
  }
  for (const event of resolved.eventSubscribes) {
    boundary.contracts.push({ contractId: event.contractId, required });
    addEvent(
      boundary,
      event.contractId,
      event.key,
      event.event,
      "subscribe",
      required,
    );
  }
  for (const feed of resolved.feedSubscribes) {
    boundary.contracts.push({ contractId: feed.contractId, required });
    addFeed(boundary, feed.contractId, feed.key, feed.feed, required);
  }

  return normalizeBoundary(boundary);
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

function deriveContractResources(
  contract: TrellisContractV1,
): EnvelopeBoundaryResource[] {
  const resources = getContractResourceAnalysis(contract);
  return [
    ...resources.jobs.map((job) => ({
      kind: "jobs" as const,
      alias: job.queueType,
      required: true,
    })),
    ...resources.kv.map((resource) => ({
      kind: "kv" as const,
      alias: resource.alias,
      required: resource.required,
    })),
    ...resources.store.map((resource) => ({
      kind: "store" as const,
      alias: resource.alias,
      required: resource.required,
    })),
  ].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.alias.localeCompare(right.alias)
  );
}

function deriveOwnTransferResources(
  contract: TrellisContractV1,
): EnvelopeBoundaryResource[] {
  const resources: EnvelopeBoundaryResource[] = [];
  for (const method of Object.values(contract.rpc ?? {})) {
    if (method.transfer?.direction === "receive") {
      addTransferResource(resources, "receive", true);
    }
  }
  for (const operation of Object.values(contract.operations ?? {})) {
    if (operation.transfer?.direction === "send") {
      addTransferResource(resources, "send", true);
    }
  }
  return normalizeBoundary({ ...EMPTY_BOUNDARY, resources }).resources;
}

function deriveContributedAvailability(
  contract: TrellisContractV1,
): EnvelopeBoundary {
  const boundary = emptyBoundary();
  boundary.contracts.push({ contractId: contract.id, required: true });

  for (const [name, method] of Object.entries(contract.rpc ?? {})) {
    addRpc(boundary, contract.id, name, method, true, {
      includeCapabilities: false,
    });
  }
  for (const [name, operation] of Object.entries(contract.operations ?? {})) {
    addOperation(boundary, contract.id, name, operation, true, {
      includeCapabilities: false,
    });
  }
  for (const [name, event] of Object.entries(contract.events ?? {})) {
    addEvent(boundary, contract.id, name, event, "publish", true, {
      includeCapabilities: false,
    });
    addEvent(boundary, contract.id, name, event, "subscribe", true, {
      includeCapabilities: false,
    });
  }
  for (const [name, feed] of Object.entries(contract.feeds ?? {})) {
    addFeed(boundary, contract.id, name, feed, true, {
      includeCapabilities: false,
    });
  }

  boundary.resources = [];
  return normalizeBoundary(boundary);
}

/**
 * Validates a raw contract and derives the reusable envelope boundaries for it.
 */
export async function analyzeContractEnvelopeBoundary(
  contracts: ContractBoundaryDeps,
  rawContract: unknown,
): Promise<ContractEnvelopeBoundary> {
  const validated = await contracts.validateContract(rawContract);
  const groupedUses = getGroupedUses(validated.contract);
  const required = await deriveUseBoundary(
    contracts,
    validated.contract,
    "required",
    groupedUses.required,
  );
  const optional = await deriveUseBoundary(
    contracts,
    validated.contract,
    "optional",
    optionalUsesWithoutRequiredAliases(groupedUses),
  );
  const resources = deriveContractResources(validated.contract);
  const ownTransferResources = deriveOwnTransferResources(validated.contract);

  required.resources = normalizeBoundary({
    ...EMPTY_BOUNDARY,
    resources: [
      ...required.resources,
      ...resources.filter((resource) => resource.required),
      ...ownTransferResources,
    ],
  }).resources;
  optional.resources = normalizeBoundary({
    ...EMPTY_BOUNDARY,
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
    required: normalizeBoundary(required),
    optional: normalizeBoundary(optional),
    resources,
    contributedAvailability: deriveContributedAvailability(validated.contract),
  };
}
