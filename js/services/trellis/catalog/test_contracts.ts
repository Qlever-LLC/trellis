import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";

import type { ContractsModule } from "./runtime.ts";
import {
  buildActiveContractIndexes,
  type ContractEntry,
  findActiveSubject,
  getActiveCapabilityDefinitions,
  getActiveCatalog,
  getContractsById,
  validateActiveDigestEntries,
  validateContractManifest,
} from "./store.ts";

type TestContracts =
  & Pick<
    ContractsModule,
    | "getActiveContractsById"
    | "getActiveCatalog"
    | "getActiveCapabilityDefinitions"
    | "getActiveEntries"
    | "getContract"
    | "getKnownContract"
    | "getKnownContractsById"
    | "getKnownEntriesByContractId"
    | "validateContract"
  >
  & {
    activateTestContract(entry: ContractEntry): void;
    findActiveSubject(subject: string): ReturnType<typeof findActiveSubject>;
    addKnownTestContract(entry: ContractEntry): void;
    setActiveTestDigests(digests: Iterable<string>): void;
    validateActiveTestDigests(digests: Iterable<string>): ContractEntry[];
  };

/** Creates a minimal contracts-module test double for unit tests. */
export function createTestContracts(
  entries: ContractEntry[] = [],
): TestContracts {
  const entryMap = new Map<string, TrellisContractV1>();
  const activeSet = new Set<string>();

  function addKnownTestContract(entry: ContractEntry): void {
    entryMap.set(entry.digest, entry.contract);
  }

  function knownEntries(): ContractEntry[] {
    return [...entryMap.entries()].map(([digest, contract]) => ({
      digest,
      contract,
    }));
  }

  function activeEntries(): ContractEntry[] {
    return [...activeSet].flatMap((digest) => {
      const contract = entryMap.get(digest);
      return contract ? [{ digest, contract }] : [];
    });
  }

  function setActiveTestDigests(digests: Iterable<string>): void {
    const entries = validateActiveDigestEntries(entryMap, digests);
    activeSet.clear();
    for (const entry of entries) activeSet.add(entry.digest);
  }

  function activateTestContract(entry: ContractEntry): void {
    addKnownTestContract(entry);
    setActiveTestDigests([...activeSet, entry.digest]);
  }

  for (const entry of entries) activateTestContract(entry);

  return {
    validateContract: validateContractManifest,
    addKnownTestContract,
    activateTestContract,
    setActiveTestDigests,
    validateActiveTestDigests: (digests) =>
      validateActiveDigestEntries(entryMap, digests),
    findActiveSubject: (subject) =>
      findActiveSubject(
        buildActiveContractIndexes(entryMap, activeSet)
          .activeSubjectIndex,
        subject,
      ),
    getContract: async (digest, opts) => {
      if (!opts?.includeInactive && !activeSet.has(digest)) {
        return undefined;
      }
      return entryMap.get(digest);
    },
    getKnownContract: async (digest) => entryMap.get(digest),
    getKnownEntriesByContractId: async (id) =>
      knownEntries().filter((entry) => entry.contract.id === id),
    getActiveEntries: async () => activeEntries(),
    getActiveCatalog: async () => getActiveCatalog(activeEntries()),
    getActiveContractsById: async (id) => getContractsById(activeEntries(), id),
    getKnownContractsById: async (id) => getContractsById(knownEntries(), id),
    getActiveCapabilityDefinitions: async () =>
      getActiveCapabilityDefinitions(activeEntries()),
  };
}
