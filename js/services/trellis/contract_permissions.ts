import type {
  ContractEvent,
  ContractRpcMethod,
  ContractSubject,
  TrellisContractV1,
} from "@trellis/contracts";

import type { ContractStore } from "./contracts_store.ts";

export type ContractEntry = { digest: string; contract: TrellisContractV1 };

export type ContractUseRef = {
  contract: string;
  rpc?: { call?: string[] };
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

export type ResolvedSubjectUse = {
  alias: string;
  contractId: string;
  key: string;
  subject: ContractSubject;
};

export type ResolvedContractUses = {
  rpcCalls: ResolvedRpcUse[];
  eventPublishes: ResolvedEventUse[];
  eventSubscribes: ResolvedEventUse[];
  subjectPublishes: ResolvedSubjectUse[];
  subjectSubscribes: ResolvedSubjectUse[];
};

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
  resolveTargetContract: (alias: string, use: ContractUseRef) => TrellisContractV1,
): ResolvedContractUses {
  const resolved: ResolvedContractUses = {
    rpcCalls: [],
    eventPublishes: [],
    eventSubscribes: [],
    subjectPublishes: [],
    subjectSubscribes: [],
  };

  for (const [alias, use] of Object.entries(contractUses(contract))) {
    const target = resolveTargetContract(alias, use);

    for (const key of use.rpc?.call ?? []) {
      const method = target.rpc?.[key];
      if (!method) {
        throw new Error(
          `Dependency '${alias}' references missing RPC '${key}' on '${use.contract}'`,
        );
      }
      resolved.rpcCalls.push({ alias, contractId: target.id, key, method });
    }

    for (const key of use.events?.publish ?? []) {
      const event = target.events?.[key];
      if (!event) {
        throw new Error(
          `Dependency '${alias}' references missing event '${key}' on '${use.contract}'`,
        );
      }
      resolved.eventPublishes.push({ alias, contractId: target.id, key, event });
    }

    for (const key of use.events?.subscribe ?? []) {
      const event = target.events?.[key];
      if (!event) {
        throw new Error(
          `Dependency '${alias}' references missing event '${key}' on '${use.contract}'`,
        );
      }
      resolved.eventSubscribes.push({ alias, contractId: target.id, key, event });
    }

    for (const key of use.subjects?.publish ?? []) {
      const subject = target.subjects?.[key];
      if (!subject) {
        throw new Error(
          `Dependency '${alias}' references missing subject '${key}' on '${use.contract}'`,
        );
      }
      resolved.subjectPublishes.push({ alias, contractId: target.id, key, subject });
    }

    for (const key of use.subjects?.subscribe ?? []) {
      const subject = target.subjects?.[key];
      if (!subject) {
        throw new Error(
          `Dependency '${alias}' references missing subject '${key}' on '${use.contract}'`,
        );
      }
      resolved.subjectSubscribes.push({ alias, contractId: target.id, key, subject });
    }
  }

  return resolved;
}

export function resolveContractUsesFromStore(
  contractStore: ContractStore,
  contract: TrellisContractV1,
): ResolvedContractUses {
  return resolveContractUses(contract, (alias, use) => {
    const targetDigest = contractStore.findActiveDigestById(use.contract);
    if (!targetDigest) {
      throw new Error(
        `Dependency '${alias}' references inactive contract '${use.contract}'`,
      );
    }

    const target = contractStore.getContract(targetDigest, { includeInactive: true });
    if (!target) {
      throw new Error(
        `Dependency '${alias}' references unknown contract '${use.contract}'`,
      );
    }

    return target;
  });
}

export function createActiveContractLookup(entries: ContractEntry[]): Map<string, TrellisContractV1> {
  return new Map(entries.map((entry) => [entry.contract.id, entry.contract]));
}
