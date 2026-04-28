import type {
  ContractEvent,
  ContractOperation,
  ContractRpcMethod,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { canonicalizeJson, isJsonValue } from "@qlever-llc/trellis/contracts";

import type { ContractStore } from "./store.ts";

export type ContractEntry = { digest: string; contract: TrellisContractV1 };

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

function mergeRpcMethod(
  key: string,
  left: ContractRpcMethod,
  right: ContractRpcMethod,
): ContractRpcMethod {
  requireSameSubject(key, left.subject, right.subject);
  requireSameJsonField(key, "version", left.version, right.version);
  requireSameJsonField(key, "input", left.input, right.input);
  requireSameJsonField(key, "output", left.output, right.output);
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
    ...(left.transfer ?? right.transfer
      ? { transfer: left.transfer ?? right.transfer }
      : {}),
  };
}

function mergeOperation(
  key: string,
  left: ContractOperation,
  right: ContractOperation,
): ContractOperation {
  requireSameSubject(key, left.subject, right.subject);
  requireSameJsonField(key, "version", left.version, right.version);
  requireSameJsonField(key, "input", left.input, right.input);
  requireSameJsonField(key, "progress", left.progress, right.progress);
  requireSameJsonField(key, "output", left.output, right.output);
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
    ...(left.transfer ?? right.transfer
      ? { transfer: left.transfer ?? right.transfer }
      : {}),
    ...(left.cancel || right.cancel ? { cancel: true } : {}),
  };
}

function mergeEvent(
  key: string,
  left: ContractEvent,
  right: ContractEvent,
): ContractEvent {
  requireSameSubject(key, left.subject, right.subject);
  requireSameJsonField(key, "version", left.version, right.version);
  requireSameJsonField(key, "params", left.params, right.params);
  requireSameJsonField(key, "event", left.event, right.event);
  requireSameJsonField(
    key,
    "capabilities",
    left.capabilities,
    right.capabilities,
  );
  return {
    ...left,
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
  return {
    ...first,
    ...(rpc ? { rpc } : {}),
    ...(operations ? { operations } : {}),
    ...(events ? { events } : {}),
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
