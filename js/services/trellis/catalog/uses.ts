import type {
  ContractEvent,
  ContractJobQueue,
  ContractOperation,
  ContractRpcMethod,
  ContractSchemaRef,
  ContractSchemas,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { canonicalizeJson, isJsonValue } from "@qlever-llc/trellis/contracts";

import {
  mergeCompatibleSchemaRefs,
  mergeCompatibleSchemas,
} from "./schema_compatibility.ts";
import type { ContractStore } from "./store.ts";
export { templateToWildcard } from "./subject_templates.ts";
import { templateToWildcard } from "./subject_templates.ts";

type ActiveCompatibleOperation = Omit<ContractOperation, "output"> & {
  output?: ContractSchemaRef;
};

type ActiveCompatibleContract = Omit<TrellisContractV1, "operations"> & {
  operations?: Record<string, ActiveCompatibleOperation>;
};

export type ContractEntry = { digest: string; contract: TrellisContractV1 };

type ActiveCompatibleContractEntry = {
  digest: string;
  contract: ActiveCompatibleContract;
};

type SubjectSurface = {
  kind: "rpc" | "operations" | "events";
  key: string;
};

type SubjectRegistration = SubjectSurface & {
  contractId: string;
  effectiveSubject: string;
};

export type ContractUseRef = {
  contract: string;
  rpc?: { call?: string[] };
  operations?: { call?: string[] };
  events?: { publish?: string[]; subscribe?: string[] };
};

export type ResolvedRpcUse = {
  alias: string;
  contractId: string;
  key: string;
  method: ContractRpcMethod;
};

export type ResolvedEventUse = {
  alias: string;
  contractId: string;
  key: string;
  event: ContractEvent;
};

export type ResolvedOperationUse = {
  alias: string;
  contractId: string;
  key: string;
  operation: ContractOperation;
};

export type ResolvedContractUses = {
  rpcCalls: ResolvedRpcUse[];
  operationCalls: ResolvedOperationUse[];
  eventPublishes: ResolvedEventUse[];
  eventSubscribes: ResolvedEventUse[];
};

function requireSameSubject(
  key: string,
  left: string,
  right: string,
): void {
  if (left !== right) {
    throw new Error(
      `Active compatible digests define '${key}' with different subjects`,
    );
  }
}

function subjectSurfaceLabel(surface: SubjectSurface): string {
  return `${surface.kind}.${surface.key}`;
}

function requireSameSubjectSurface(
  left: SubjectRegistration,
  right: SubjectRegistration,
): void {
  if (left.kind === right.kind && left.key === right.key) return;
  throw new Error(
    `Active compatible digests for '${left.contractId}' define subject '${left.effectiveSubject}' for different logical surfaces '${
      subjectSurfaceLabel(left)
    }' and '${subjectSurfaceLabel(right)}'`,
  );
}

function validateConcreteSubjectSurfaces(
  contractId: string,
  contracts: ActiveCompatibleContract[],
): void {
  const registrations = new Map<string, SubjectRegistration>();
  for (const contract of contracts) {
    for (const [key, method] of Object.entries(contract.rpc ?? {})) {
      const registration = {
        contractId,
        kind: "rpc" as const,
        key,
        effectiveSubject: templateToWildcard(method.subject),
      };
      const existing = registrations.get(registration.effectiveSubject);
      if (existing) requireSameSubjectSurface(existing, registration);
      registrations.set(registration.effectiveSubject, registration);
    }
    for (const [key, operation] of Object.entries(contract.operations ?? {})) {
      const registration = {
        contractId,
        kind: "operations" as const,
        key,
        effectiveSubject: templateToWildcard(operation.subject),
      };
      const existing = registrations.get(registration.effectiveSubject);
      if (existing) requireSameSubjectSurface(existing, registration);
      registrations.set(registration.effectiveSubject, registration);
    }
    for (const [key, event] of Object.entries(contract.events ?? {})) {
      const registration = {
        contractId,
        kind: "events" as const,
        key,
        effectiveSubject: templateToWildcard(event.subject),
      };
      const existing = registrations.get(registration.effectiveSubject);
      if (existing) requireSameSubjectSurface(existing, registration);
      registrations.set(registration.effectiveSubject, registration);
    }
  }
}

function requireOperationOutputs(
  contract: ActiveCompatibleContract,
): asserts contract is TrellisContractV1 {
  for (const [key, operation] of Object.entries(contract.operations ?? {})) {
    if (!operation.output) {
      throw new Error(
        `Active compatible digests define operation '${key}' with missing output`,
      );
    }
  }
}

function requireSameJsonField(
  key: string,
  field: string,
  left: unknown,
  right: unknown,
): void {
  if (left === undefined && right === undefined) return;
  if (left === undefined || right === undefined) {
    throw new Error(
      `Active compatible digests define '${key}' with different ${field}`,
    );
  }
  if (!isJsonValue(left) || !isJsonValue(right)) {
    throw new Error(
      `Active compatible digests define '${key}' with non-JSON ${field}`,
    );
  }
  if (
    canonicalizeJson(left) !== canonicalizeJson(right)
  ) {
    throw new Error(
      `Active compatible digests define '${key}' with different ${field}`,
    );
  }
}

function projectCompatibleSchemaField(
  key: string,
  field: string,
  left: ContractSchemaRef | undefined,
  leftContract: TrellisContractV1,
  right: ContractSchemaRef | undefined,
  rightContract: TrellisContractV1,
  projectedSchemas: ContractSchemas,
): ContractSchemaRef | undefined {
  if (left === undefined && right === undefined) return undefined;
  if (left === undefined || right === undefined) {
    throw new Error(
      `Active compatible digests define '${key}' with different ${field}`,
    );
  }
  const mergedSchema = mergeCompatibleSchemaRefs(
    left,
    leftContract.schemas,
    right,
    rightContract.schemas,
  );
  if (mergedSchema === null) {
    throw new Error(
      `Active compatible digests define '${key}' with incompatible ${field}`,
    );
  }
  projectedSchemas[left.schema] = mergedSchema;
  return left;
}

function mergeRpcMethod(
  key: string,
  left: ContractRpcMethod,
  leftContract: TrellisContractV1,
  right: ContractRpcMethod,
  rightContract: TrellisContractV1,
  projectedSchemas: ContractSchemas,
): ContractRpcMethod {
  requireSameSubject(key, left.subject, right.subject);
  requireSameJsonField(key, "version", left.version, right.version);
  const input = projectCompatibleSchemaField(
    key,
    "input",
    left.input,
    leftContract,
    right.input,
    rightContract,
    projectedSchemas,
  );
  const output = projectCompatibleSchemaField(
    key,
    "output",
    left.output,
    leftContract,
    right.output,
    rightContract,
    projectedSchemas,
  );
  requireSameJsonField(key, "transfer", left.transfer, right.transfer);
  requireSameJsonField(key, "errors", left.errors, right.errors);
  requireSameJsonField(
    key,
    "capabilities",
    left.capabilities,
    right.capabilities,
  );
  return {
    ...left,
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(left.transfer ?? right.transfer
      ? { transfer: left.transfer ?? right.transfer }
      : {}),
  };
}

function mergeOperation(
  key: string,
  left: ContractOperation,
  leftContract: TrellisContractV1,
  right: ContractOperation,
  rightContract: TrellisContractV1,
  projectedSchemas: ContractSchemas,
): ContractOperation {
  requireSameSubject(key, left.subject, right.subject);
  requireSameJsonField(key, "version", left.version, right.version);
  const input = projectCompatibleSchemaField(
    key,
    "input",
    left.input,
    leftContract,
    right.input,
    rightContract,
    projectedSchemas,
  );
  const progress = projectCompatibleSchemaField(
    key,
    "progress",
    left.progress,
    leftContract,
    right.progress,
    rightContract,
    projectedSchemas,
  );
  const output = projectCompatibleSchemaField(
    key,
    "output",
    left.output,
    leftContract,
    right.output,
    rightContract,
    projectedSchemas,
  );
  requireSameJsonField(key, "transfer", left.transfer, right.transfer);
  requireSameJsonField(key, "cancel", left.cancel, right.cancel);
  requireSameJsonField(
    key,
    "capabilities",
    left.capabilities,
    right.capabilities,
  );
  return {
    ...left,
    ...(input ? { input } : {}),
    ...(progress ? { progress } : {}),
    ...(output ? { output } : {}),
    ...(left.transfer ?? right.transfer
      ? { transfer: left.transfer ?? right.transfer }
      : {}),
    ...(left.cancel || right.cancel ? { cancel: true } : {}),
  };
}

function mergeEvent(
  key: string,
  left: ContractEvent,
  leftContract: TrellisContractV1,
  right: ContractEvent,
  rightContract: TrellisContractV1,
  projectedSchemas: ContractSchemas,
): ContractEvent {
  requireSameSubject(key, left.subject, right.subject);
  requireSameJsonField(key, "version", left.version, right.version);
  requireSameJsonField(key, "params", left.params, right.params);
  const event = projectCompatibleSchemaField(
    key,
    "event",
    left.event,
    leftContract,
    right.event,
    rightContract,
    projectedSchemas,
  );
  requireSameJsonField(
    key,
    "capabilities",
    left.capabilities,
    right.capabilities,
  );
  return {
    ...left,
    ...(event ? { event } : {}),
  };
}

function mergeJobQueue(
  key: string,
  left: ContractJobQueue,
  leftContract: TrellisContractV1,
  right: ContractJobQueue,
  rightContract: TrellisContractV1,
  projectedSchemas: ContractSchemas,
): ContractJobQueue {
  const payload = projectCompatibleSchemaField(
    key,
    "payload",
    left.payload,
    leftContract,
    right.payload,
    rightContract,
    projectedSchemas,
  );
  const result = projectCompatibleSchemaField(
    key,
    "result",
    left.result,
    leftContract,
    right.result,
    rightContract,
    projectedSchemas,
  );
  requireSameJsonField(key, "maxDeliver", left.maxDeliver, right.maxDeliver);
  requireSameJsonField(key, "backoffMs", left.backoffMs, right.backoffMs);
  requireSameJsonField(key, "ackWaitMs", left.ackWaitMs, right.ackWaitMs);
  requireSameJsonField(
    key,
    "defaultDeadlineMs",
    left.defaultDeadlineMs,
    right.defaultDeadlineMs,
  );
  requireSameJsonField(key, "progress", left.progress, right.progress);
  requireSameJsonField(key, "logs", left.logs, right.logs);
  requireSameJsonField(key, "dlq", left.dlq, right.dlq);
  requireSameJsonField(key, "concurrency", left.concurrency, right.concurrency);
  return {
    ...left,
    ...(payload ? { payload } : {}),
    ...(result ? { result } : {}),
  };
}

function mergeRecords<T>(
  contracts: TrellisContractV1[],
  getRecord: (contract: TrellisContractV1) => Record<string, T> | undefined,
  mergeValue: (
    key: string,
    left: T,
    leftContract: TrellisContractV1,
    right: T,
    rightContract: TrellisContractV1,
  ) => T,
): Record<string, T> | undefined {
  const merged = new Map<
    string,
    Array<{ value: T; contract: TrellisContractV1 }>
  >();
  let hasValues = false;
  for (const contract of contracts) {
    const record = getRecord(contract);
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, [{ value, contract }]);
      } else {
        for (const entry of existing) {
          mergeValue(
            key,
            entry.value,
            entry.contract,
            value,
            contract,
          );
        }
        existing.push({ value, contract });
      }
      hasValues = true;
    }
  }
  return hasValues
    ? Object.fromEntries(
      [...merged.entries()].map(([key, entries]) => [key, entries[0].value]),
    )
    : undefined;
}

function mergeContractSchemas(contracts: TrellisContractV1[]): ContractSchemas {
  const schemas: ContractSchemas = {};
  for (const contract of contracts) {
    for (const [name, schema] of Object.entries(contract.schemas ?? {})) {
      const existing = schemas[name];
      if (existing === undefined) {
        schemas[name] = schema;
        continue;
      }
      const mergedSchema = mergeCompatibleSchemas(existing, schema);
      if (mergedSchema === null) {
        throw new Error(
          `Active compatible digests define schema '${name}' incompatibly`,
        );
      }
      schemas[name] = mergedSchema;
    }
  }
  return schemas;
}

function mergeCompatibleContractSurfaces(
  contracts: TrellisContractV1[],
): TrellisContractV1 | undefined {
  const first = contracts[0];
  if (!first) return undefined;
  const schemas = mergeContractSchemas(contracts);
  const rpc = mergeRecords(
    contracts,
    (contract) => contract.rpc,
    (key, left, leftContract, right, rightContract) =>
      mergeRpcMethod(key, left, leftContract, right, rightContract, schemas),
  );
  const operations = mergeRecords(
    contracts,
    (contract) => contract.operations,
    (key, left, leftContract, right, rightContract) =>
      mergeOperation(key, left, leftContract, right, rightContract, schemas),
  );
  const events = mergeRecords(
    contracts,
    (contract) => contract.events,
    (key, left, leftContract, right, rightContract) =>
      mergeEvent(key, left, leftContract, right, rightContract, schemas),
  );
  const jobs = mergeRecords(
    contracts,
    (contract) => contract.jobs,
    (key, left, leftContract, right, rightContract) =>
      mergeJobQueue(key, left, leftContract, right, rightContract, schemas),
  );
  return {
    ...first,
    schemas,
    ...(rpc ? { rpc } : {}),
    ...(operations ? { operations } : {}),
    ...(events ? { events } : {}),
    ...(jobs ? { jobs } : {}),
  };
}

function contractUses(
  contract: TrellisContractV1,
): Record<string, ContractUseRef> {
  return (contract as TrellisContractV1 & {
    uses?: Record<string, ContractUseRef>;
  }).uses ?? {};
}

export function sortUniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function resolveContractUses(
  contract: TrellisContractV1,
  resolveTargetContract: (
    alias: string,
    use: ContractUseRef,
  ) => TrellisContractV1 | null,
): ResolvedContractUses {
  const resolved: ResolvedContractUses = {
    rpcCalls: [],
    operationCalls: [],
    eventPublishes: [],
    eventSubscribes: [],
  };

  for (const [alias, use] of Object.entries(contractUses(contract))) {
    const target = resolveTargetContract(alias, use);
    if (!target) {
      continue;
    }

    for (const key of use.rpc?.call ?? []) {
      const method = target.rpc?.[key];
      if (!method) {
        throw new Error(
          `Dependency '${alias}' references missing RPC '${key}' on '${use.contract}'`,
        );
      }
      resolved.rpcCalls.push({ alias, contractId: target.id, key, method });
    }

    for (const key of use.operations?.call ?? []) {
      const operation = target.operations?.[key];
      if (!operation) {
        throw new Error(
          `Dependency '${alias}' references missing operation '${key}' on '${use.contract}'`,
        );
      }
      resolved.operationCalls.push({
        alias,
        contractId: target.id,
        key,
        operation,
      });
    }

    for (const key of use.events?.publish ?? []) {
      const event = target.events?.[key];
      if (!event) {
        throw new Error(
          `Dependency '${alias}' references missing event '${key}' on '${use.contract}'`,
        );
      }
      resolved.eventPublishes.push({
        alias,
        contractId: target.id,
        key,
        event,
      });
    }

    for (const key of use.events?.subscribe ?? []) {
      const event = target.events?.[key];
      if (!event) {
        throw new Error(
          `Dependency '${alias}' references missing event '${key}' on '${use.contract}'`,
        );
      }
      resolved.eventSubscribes.push({
        alias,
        contractId: target.id,
        key,
        event,
      });
    }
  }

  return resolved;
}

export function resolveContractUsesFromStore(
  contractStore: ContractStore,
  contract: TrellisContractV1,
  options?: {
    ignoreInactiveContracts?: boolean;
  },
): ResolvedContractUses {
  return resolveContractUses(contract, (alias, use) => {
    const targets = contractStore.getActiveContractsById(use.contract);
    const target = mergeCompatibleContractSurfaces(targets);
    if (!target) {
      if (options?.ignoreInactiveContracts) {
        return null;
      }
      throw new Error(
        `Dependency '${alias}' references inactive contract '${use.contract}'`,
      );
    }

    return target;
  });
}

export function resolveContractUsesFromKnownStore(
  contractStore: ContractStore,
  contract: TrellisContractV1,
): ResolvedContractUses {
  return resolveContractUses(contract, (alias, use) => {
    const target = mergeCompatibleContractSurfaces(
      contractStore.getKnownContractsById(use.contract),
    );
    if (!target) {
      throw new Error(
        `Dependency '${alias}' references unknown contract '${use.contract}'`,
      );
    }

    return target;
  });
}

export function createActiveContractLookup(
  entries: ActiveCompatibleContractEntry[],
): Map<string, TrellisContractV1> {
  const entriesById = new Map<string, ActiveCompatibleContract[]>();
  for (const entry of entries) {
    const contracts = entriesById.get(entry.contract.id) ?? [];
    contracts.push(entry.contract);
    entriesById.set(entry.contract.id, contracts);
  }

  const lookup = new Map<string, TrellisContractV1>();
  for (const [id, contracts] of entriesById) {
    validateConcreteSubjectSurfaces(id, contracts);
    const validatedContracts: TrellisContractV1[] = [];
    for (const contract of contracts) {
      requireOperationOutputs(contract);
      validatedContracts.push(contract);
    }
    const merged = mergeCompatibleContractSurfaces(validatedContracts);
    if (merged) lookup.set(id, merged);
  }
  return lookup;
}

/** Validates that concurrently active digests remain compatible by lineage. */
export function validateActiveContractCompatibility(
  entries: ActiveCompatibleContractEntry[],
): void {
  createActiveContractLookup(entries);
}

/** Validates that active contracts only use surfaces from the proposed active set. */
export function validateActiveContractUses(
  entries: ContractEntry[],
): void {
  const activeById = createActiveContractLookup(entries);
  for (const entry of entries) {
    resolveContractUses(entry.contract, (alias, use) => {
      const target = activeById.get(use.contract);
      if (!target) {
        throw new Error(
          `Dependency '${alias}' references inactive contract '${use.contract}'`,
        );
      }
      return target;
    });
  }
}
