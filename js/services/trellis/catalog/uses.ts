import type {
  ContractEvent,
  ContractOperation,
  ContractRpcMethod,
  ContractSubject,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";

import type { ContractStore } from "./store.ts";

export type ContractEntry = { digest: string; contract: TrellisContractV1 };

export type ContractUseRef = {
  contract: string;
  rpc?: { call?: string[] };
  operations?: { call?: string[] };
  events?: { publish?: string[]; subscribe?: string[] };
  subjects?: { publish?: string[]; subscribe?: string[] };
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

export type ResolvedSubjectUse = {
  alias: string;
  contractId: string;
  key: string;
  subject: ContractSubject;
};

export type ResolvedContractUses = {
  rpcCalls: ResolvedRpcUse[];
  operationCalls: ResolvedOperationUse[];
  eventPublishes: ResolvedEventUse[];
  eventSubscribes: ResolvedEventUse[];
  subjectPublishes: ResolvedSubjectUse[];
  subjectSubscribes: ResolvedSubjectUse[];
};

function unionCapabilities(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  const merged = sortUniqueStrings([...(left ?? []), ...(right ?? [])]);
  return merged.length === 0 ? undefined : merged;
}

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

function mergeRpcMethod(
  key: string,
  left: ContractRpcMethod,
  right: ContractRpcMethod,
): ContractRpcMethod {
  requireSameSubject(key, left.subject, right.subject);
  const call = unionCapabilities(
    left.capabilities?.call,
    right.capabilities?.call,
  );
  return {
    ...left,
    ...(left.transfer ?? right.transfer
      ? { transfer: left.transfer ?? right.transfer }
      : {}),
    ...(call ? { capabilities: { call } } : {}),
  };
}

function mergeOperation(
  key: string,
  left: ContractOperation,
  right: ContractOperation,
): ContractOperation {
  requireSameSubject(key, left.subject, right.subject);
  const call = unionCapabilities(
    left.capabilities?.call,
    right.capabilities?.call,
  );
  const read = unionCapabilities(
    left.capabilities?.read,
    right.capabilities?.read,
  );
  const cancel = unionCapabilities(
    left.capabilities?.cancel,
    right.capabilities?.cancel,
  );
  return {
    ...left,
    ...(left.transfer ?? right.transfer
      ? { transfer: left.transfer ?? right.transfer }
      : {}),
    ...(left.cancel || right.cancel ? { cancel: true } : {}),
    ...(call || read || cancel
      ? {
        capabilities: {
          ...(call ? { call } : {}),
          ...(read ? { read } : {}),
          ...(cancel ? { cancel } : {}),
        },
      }
      : {}),
  };
}

function mergeEvent(
  key: string,
  left: ContractEvent,
  right: ContractEvent,
): ContractEvent {
  requireSameSubject(key, left.subject, right.subject);
  const publish = unionCapabilities(
    left.capabilities?.publish,
    right.capabilities?.publish,
  );
  const subscribe = unionCapabilities(
    left.capabilities?.subscribe,
    right.capabilities?.subscribe,
  );
  return {
    ...left,
    ...(publish || subscribe
      ? {
        capabilities: {
          ...(publish ? { publish } : {}),
          ...(subscribe ? { subscribe } : {}),
        },
      }
      : {}),
  };
}

function mergeSubject(
  key: string,
  left: ContractSubject,
  right: ContractSubject,
): ContractSubject {
  requireSameSubject(key, left.subject, right.subject);
  const publish = unionCapabilities(
    left.capabilities?.publish,
    right.capabilities?.publish,
  );
  const subscribe = unionCapabilities(
    left.capabilities?.subscribe,
    right.capabilities?.subscribe,
  );
  return {
    ...left,
    ...(publish || subscribe
      ? {
        capabilities: {
          ...(publish ? { publish } : {}),
          ...(subscribe ? { subscribe } : {}),
        },
      }
      : {}),
  };
}

function mergeRecords<T>(
  records: Array<Record<string, T> | undefined>,
  mergeValue: (key: string, left: T, right: T) => T,
): Record<string, T> | undefined {
  const merged: Record<string, T> = {};
  let hasValues = false;
  for (const record of records) {
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      const existing = merged[key];
      merged[key] = existing === undefined
        ? value
        : mergeValue(key, existing, value);
      hasValues = true;
    }
  }
  return hasValues ? merged : undefined;
}

function mergeCompatibleContractSurfaces(
  contracts: TrellisContractV1[],
): TrellisContractV1 | undefined {
  const first = contracts[0];
  if (!first) return undefined;
  const rpc = mergeRecords(
    contracts.map((contract) => contract.rpc),
    mergeRpcMethod,
  );
  const operations = mergeRecords(
    contracts.map((contract) => contract.operations),
    mergeOperation,
  );
  const events = mergeRecords(
    contracts.map((contract) => contract.events),
    mergeEvent,
  );
  const subjects = mergeRecords(
    contracts.map((contract) => contract.subjects),
    mergeSubject,
  );

  return {
    ...first,
    ...(rpc ? { rpc } : {}),
    ...(operations ? { operations } : {}),
    ...(events ? { events } : {}),
    ...(subjects ? { subjects } : {}),
  };
}

function contractUses(
  contract: TrellisContractV1,
): Record<string, ContractUseRef> {
  return (contract as TrellisContractV1 & {
    uses?: Record<string, ContractUseRef>;
  }).uses ?? {};
}

export function templateToWildcard(subject: string): string {
  return subject.replace(/\{[^}]+\}/g, "*");
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
    subjectPublishes: [],
    subjectSubscribes: [],
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

    for (const key of use.subjects?.publish ?? []) {
      const subject = target.subjects?.[key];
      if (!subject) {
        throw new Error(
          `Dependency '${alias}' references missing subject '${key}' on '${use.contract}'`,
        );
      }
      resolved.subjectPublishes.push({
        alias,
        contractId: target.id,
        key,
        subject,
      });
    }

    for (const key of use.subjects?.subscribe ?? []) {
      const subject = target.subjects?.[key];
      if (!subject) {
        throw new Error(
          `Dependency '${alias}' references missing subject '${key}' on '${use.contract}'`,
        );
      }
      resolved.subjectSubscribes.push({
        alias,
        contractId: target.id,
        key,
        subject,
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

export function createActiveContractLookup(
  entries: ContractEntry[],
): Map<string, TrellisContractV1> {
  const entriesById = new Map<string, TrellisContractV1[]>();
  for (const entry of entries) {
    const contracts = entriesById.get(entry.contract.id) ?? [];
    contracts.push(entry.contract);
    entriesById.set(entry.contract.id, contracts);
  }

  const lookup = new Map<string, TrellisContractV1>();
  for (const [id, contracts] of entriesById) {
    const merged = mergeCompatibleContractSurfaces(contracts);
    if (merged) lookup.set(id, merged);
  }
  return lookup;
}
