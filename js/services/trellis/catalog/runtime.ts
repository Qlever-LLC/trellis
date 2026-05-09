import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { isJsonValue } from "@qlever-llc/trellis/contracts";
import type {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../auth/storage.ts";
import {
  collectActiveContractDigests,
  overlayStagedRecords,
} from "./active_contracts.ts";
import { analyzeContract } from "./analysis.ts";
import {
  type ActiveSubjectOwner,
  buildActiveContractIndexes,
  type ContractEntry,
  findActiveSubject,
  getActiveCapabilityDefinitions,
  getActiveCatalog,
  getContractsById,
  validateActiveDigestEntries,
  validateContractManifest,
  type ValidatedContract,
} from "./store.ts";
import {
  resolveContractUsesFromEntries,
  validateActiveContractCompatibility,
  validateActiveContractUses,
} from "./uses.ts";
import type { SqlContractStorageRepository } from "./storage.ts";

type CatalogLogger = {
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

const consoleLogger: CatalogLogger = {
  warn: (fields, message) => console.warn(message, fields),
  error: (fields, message) => console.error(message, fields),
};

type InstalledContractRecord = {
  digest: string;
  id: string;
  contract: string;
};

type ServiceDeploymentRecord = Awaited<
  ReturnType<SqlServiceDeploymentRepository["listPage"]>
>[number];
type ServiceInstanceRecord = Awaited<
  ReturnType<SqlServiceInstanceRepository["listPage"]>
>[number];
type DeviceDeploymentRecord = Awaited<
  ReturnType<SqlDeviceDeploymentRepository["listPage"]>
>[number];
type DeviceInstanceRecord = Awaited<
  ReturnType<SqlDeviceInstanceRepository["listPage"]>
>[number];
type DeploymentEnvelopeRecord = Awaited<
  ReturnType<SqlDeploymentEnvelopeRepository["listPage"]>
>[number];
type DeploymentContractEvidenceRecord = Awaited<
  ReturnType<SqlDeploymentContractEvidenceRepository["listPage"]>
>[number];

type ActiveCatalogValidationOptions = {
  proposedDigests?: Iterable<string>;
  extraActiveDigests?: Iterable<string>;
  stagedServiceDeployments?: Iterable<ServiceDeploymentRecord>;
  stagedServiceInstances?: Iterable<ServiceInstanceRecord>;
  stagedDeviceDeployments?: Iterable<DeviceDeploymentRecord>;
  stagedDeviceInstances?: Iterable<DeviceInstanceRecord>;
  stagedDeploymentEnvelopes?: Iterable<DeploymentEnvelopeRecord>;
};

function describeContract(
  contract: { contractId: string; displayName: string },
): string {
  return `${contract.displayName} (${contract.contractId})`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function subjectNamespace(subject: string): string | null {
  const parts = subject.split(".");
  if (parts.length < 3) return null;
  if (
    parts[0] !== "rpc" && parts[0] !== "operations" &&
    parts[0] !== "events"
  ) return null;
  if (!parts[1]?.startsWith("v")) return null;
  return parts[2] ?? null;
}

function ensureNoWildcards(subject: string): void {
  if (subject.includes("*") || subject.includes(">")) {
    throw new Error(`Subject '${subject}' must not contain '*' or '>'`);
  }
}

function ensureSubjectMatchesVersion(
  kind: "rpc" | "operations" | "events",
  version: string,
  subject: string,
): void {
  const expectedPrefix = `${kind}.${version}.`;
  if (!subject.startsWith(expectedPrefix)) {
    throw new Error(
      `Subject '${subject}' must start with '${expectedPrefix}' (version mismatch)`,
    );
  }
}

function checkOwnedSubject(args: {
  activeSubjectIndex: ReadonlyMap<string, ActiveSubjectOwner>;
  validated: ValidatedContract;
  label: string;
  subject: string;
}): void {
  const prev = findActiveSubject(args.activeSubjectIndex, args.subject);
  if (
    prev && prev.digest !== args.validated.digest &&
    prev.contractId !== args.validated.contract.id
  ) {
    throw new Error(
      `${args.label} '${args.subject}' already owned by '${
        describeContract(prev)
      }'`,
    );
  }
}

async function hydrateStoredContract(args: {
  logger: CatalogLogger;
  record: InstalledContractRecord;
  message: string;
}): Promise<ContractEntry | undefined> {
  try {
    const parsed = JSON.parse(args.record.contract);
    if (!isJsonValue(parsed)) {
      throw new Error("stored contract is not valid JSON value");
    }
    const validated = await validateContractManifest(parsed);
    if (validated.digest !== args.record.digest) {
      throw new Error("stored contract digest does not match persisted digest");
    }
    return {
      digest: validated.digest,
      contract: validated.contract,
    };
  } catch (error) {
    args.logger.warn({
      digest: args.record.digest,
      contractId: args.record.id,
      err: error instanceof Error ? error : undefined,
      errorMessage: getErrorMessage(error),
    }, args.message);
    return undefined;
  }
}

async function loadStoredContractOrThrow(args: {
  record: InstalledContractRecord;
  message: string;
}): Promise<ContractEntry> {
  try {
    const parsed = JSON.parse(args.record.contract);
    if (!isJsonValue(parsed)) {
      throw new Error("stored contract is not valid JSON value");
    }
    const validated = await validateContractManifest(parsed);
    if (validated.digest !== args.record.digest) {
      throw new Error("stored contract digest does not match persisted digest");
    }
    return { digest: validated.digest, contract: validated.contract };
  } catch (error) {
    throw new Error(`${args.message} '${args.record.digest}'`, {
      cause: error,
    });
  }
}

function getRequiredServiceCapabilities(
  activeEntries: readonly ContractEntry[],
  contract: TrellisContractV1,
): string[] {
  const capabilities = new Set<string>(["service"]);
  const uses = resolveContractUsesFromEntries(activeEntries, contract);

  for (const event of Object.values(contract.events ?? {})) {
    for (const capability of event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const method of uses.rpcCalls) {
    for (const capability of method.method.capabilities?.call ?? []) {
      capabilities.add(capability);
    }
  }

  for (const operation of uses.operationCalls) {
    for (const capability of operation.operation.capabilities?.call ?? []) {
      capabilities.add(capability);
    }
  }

  for (const event of uses.eventPublishes) {
    for (const capability of event.event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const event of uses.eventSubscribes) {
    for (const capability of event.event.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }

  for (const feed of uses.feedSubscribes) {
    for (const capability of feed.feed.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }

  return [...capabilities].sort((left, right) => left.localeCompare(right));
}

function collectDeploymentEvidenceContractRecords(
  evidence: DeploymentContractEvidenceRecord[],
): Map<string, InstalledContractRecord> {
  const byDigest = new Map<string, InstalledContractRecord>();
  for (const entry of evidence) {
    if (byDigest.has(entry.contractDigest)) continue;
    byDigest.set(entry.contractDigest, {
      digest: entry.contractDigest,
      id: entry.contractId,
      contract: JSON.stringify(entry.contract),
    });
  }
  return byDigest;
}

export function createContractsModule(opts: {
  builtinContracts: Array<{ digest: string; contract: TrellisContractV1 }>;
  contractStorage: SqlContractStorageRepository;
  deploymentContractEvidenceStorage?: Pick<
    SqlDeploymentContractEvidenceRepository,
    | "listByDigest"
    | "listByDigests"
    | "listByContractId"
    | "listByDeployments"
  >;
  deploymentEnvelopeStorage: Pick<
    SqlDeploymentEnvelopeRepository,
    "listEnabled"
  >;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  logger?: CatalogLogger;
}) {
  const logger = opts.logger ?? consoleLogger;
  const builtinEntries = opts.builtinContracts.map((entry) => ({
    digest: entry.digest,
    contract: entry.contract,
  }));
  const builtinByDigest = new Map(
    builtinEntries.map((entry) => [entry.digest, entry.contract]),
  );
  const builtinDigests = new Set(
    opts.builtinContracts.map((entry) => entry.digest),
  );

  async function getKnownEntry(
    digest: string,
  ): Promise<ContractEntry | undefined> {
    const builtin = builtinByDigest.get(digest);
    if (builtin) return { digest, contract: builtin };

    const stored = await opts.contractStorage.get(digest);
    if (stored) {
      return await hydrateStoredContract({
        logger,
        record: {
          digest: stored.digest,
          id: stored.id,
          contract: stored.contract,
        },
        message: "Failed to hydrate persisted contract",
      });
    }

    const evidence = (await opts.deploymentContractEvidenceStorage
      ?.listByDigest(digest) ?? [])[0];
    if (!evidence) return undefined;
    return await hydrateStoredContract({
      logger,
      record: {
        digest: evidence.contractDigest,
        id: evidence.contractId,
        contract: JSON.stringify(evidence.contract),
      },
      message: "Failed to hydrate deployment contract evidence",
    });
  }

  async function loadEntriesForDigests(args: {
    digests: Iterable<string>;
    deploymentContractEvidence?: DeploymentContractEvidenceRecord[];
    message: string;
  }): Promise<ContractEntry[]> {
    const requested = new Set(args.digests);
    const entriesByDigest = new Map<string, TrellisContractV1>();
    for (const digest of requested) {
      const builtin = builtinByDigest.get(digest);
      if (builtin) entriesByDigest.set(digest, builtin);
    }

    const missingAfterBuiltins = [...requested].filter((digest) =>
      !entriesByDigest.has(digest)
    );
    const stored = await opts.contractStorage.getMany(missingAfterBuiltins);
    for (const record of stored) {
      const entry = await loadStoredContractOrThrow({
        record: {
          digest: record.digest,
          id: record.id,
          contract: record.contract,
        },
        message: args.message,
      });
      entriesByDigest.set(entry.digest, entry.contract);
    }

    const missingAfterStored = [...requested].filter((digest) =>
      !entriesByDigest.has(digest)
    );
    const evidenceContracts = collectDeploymentEvidenceContractRecords(
      args.deploymentContractEvidence?.filter((entry) =>
        missingAfterStored.includes(entry.contractDigest)
      ) ??
        await opts.deploymentContractEvidenceStorage?.listByDigests(
          missingAfterStored,
        ) ?? [],
    );
    for (const digest of missingAfterStored) {
      const evidence = evidenceContracts.get(digest);
      if (!evidence) {
        throw new Error(`Unknown active contract digest '${digest}'`);
      }
      const entry = await loadStoredContractOrThrow({
        record: evidence,
        message: args.message,
      });
      entriesByDigest.set(entry.digest, entry.contract);
    }

    return validateActiveDigestEntries(entriesByDigest, requested);
  }

  async function getKnownEntriesByContractId(
    contractId: string,
  ): Promise<ContractEntry[]> {
    const entries = new Map<string, TrellisContractV1>();
    for (const entry of builtinEntries) {
      if (entry.contract.id === contractId) {
        entries.set(entry.digest, entry.contract);
      }
    }
    for (
      const record of await opts.contractStorage.listByContractId(contractId)
    ) {
      if (entries.has(record.digest)) continue;
      const entry = await hydrateStoredContract({
        logger,
        record: {
          digest: record.digest,
          id: record.id,
          contract: record.contract,
        },
        message: "Failed to hydrate persisted contract",
      });
      if (entry) entries.set(entry.digest, entry.contract);
    }
    for (
      const evidence of await opts.deploymentContractEvidenceStorage
        ?.listByContractId(contractId) ?? []
    ) {
      if (entries.has(evidence.contractDigest)) continue;
      const entry = await hydrateStoredContract({
        logger,
        record: {
          digest: evidence.contractDigest,
          id: evidence.contractId,
          contract: JSON.stringify(evidence.contract),
        },
        message: "Failed to hydrate deployment contract evidence",
      });
      if (entry) entries.set(entry.digest, entry.contract);
    }
    return [...entries.entries()]
      .map(([digest, contract]) => ({ digest, contract }))
      .sort((left, right) => left.digest.localeCompare(right.digest));
  }

  async function loadActiveEntries(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<ContractEntry[]> {
    const active = await collectProposedActiveDigests(validationOpts);
    return await loadEntriesForDigests({
      digests: active,
      message: "Failed to load active contract",
    });
  }

  async function validateManagedContract(args: {
    contract: unknown;
  }): Promise<{
    validated: ValidatedContract;
    usedNamespaces: Set<string>;
    analyzed: ReturnType<typeof analyzeContract>;
  }> {
    if (
      !args.contract || typeof args.contract !== "object" ||
      Array.isArray(args.contract)
    ) {
      throw new Error("contract must be an object");
    }

    const validated = await validateContractManifest(args.contract);
    const entries = await validateActiveCatalogEntries();
    const indexes = buildActiveContractIndexes(
      new Map(entries.map((entry) => [entry.digest, entry.contract])),
      entries.map((entry) => entry.digest),
    );
    resolveContractUsesFromEntries(entries, validated.contract);

    const usedNamespaces = new Set<string>();
    for (const method of Object.values(validated.contract.rpc ?? {})) {
      ensureNoWildcards(method.subject);
      ensureSubjectMatchesVersion("rpc", method.version, method.subject);
      const ns = subjectNamespace(method.subject);
      if (!ns) throw new Error(`Invalid RPC subject '${method.subject}'`);
      usedNamespaces.add(ns);
      checkOwnedSubject({
        activeSubjectIndex: indexes.activeSubjectIndex,
        validated,
        label: "RPC subject",
        subject: method.subject,
      });
    }

    for (
      const operation of Object.values(validated.contract.operations ?? {})
    ) {
      ensureNoWildcards(operation.subject);
      ensureSubjectMatchesVersion(
        "operations",
        operation.version,
        operation.subject,
      );
      const ns = subjectNamespace(operation.subject);
      if (!ns) {
        throw new Error(`Invalid operation subject '${operation.subject}'`);
      }
      usedNamespaces.add(ns);
      checkOwnedSubject({
        activeSubjectIndex: indexes.activeSubjectIndex,
        validated,
        label: "Operation subject",
        subject: operation.subject,
      });
    }

    for (const event of Object.values(validated.contract.events ?? {})) {
      ensureNoWildcards(event.subject);
      ensureSubjectMatchesVersion("events", event.version, event.subject);
      const ns = subjectNamespace(event.subject);
      if (!ns) throw new Error(`Invalid event subject '${event.subject}'`);
      usedNamespaces.add(ns);
      checkOwnedSubject({
        activeSubjectIndex: indexes.activeSubjectIndex,
        validated,
        label: "Event subject",
        subject: event.subject,
      });
    }

    return {
      validated,
      usedNamespaces,
      analyzed: analyzeContract(validated.contract),
    };
  }

  async function persistContract(
    contract: unknown,
    persistOpts?: { device?: boolean },
  ): Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
    contract: TrellisContractV1;
    usedNamespaces: string[];
  }> {
    const { validated, usedNamespaces, analyzed } =
      await validateManagedContract({ contract });
    const expectedKind = persistOpts?.device ? "device" : "service";
    if (validated.contract.kind !== expectedKind) {
      throw new Error(
        `${expectedKind} contract install requires kind '${expectedKind}', got '${validated.contract.kind}'`,
      );
    }

    if (
      persistOpts?.device &&
      (
        analyzed.summary.kvResources > 0 ||
        analyzed.summary.jobsQueues > 0 ||
        validated.contract.resources !== undefined
      )
    ) {
      throw new Error("device contracts may not declare resources");
    }

    const existing = await opts.contractStorage.get(validated.digest);
    if (existing) {
      return {
        id: validated.contract.id,
        digest: validated.digest,
        displayName: validated.contract.displayName,
        description: validated.contract.description,
        contract: validated.contract,
        usedNamespaces: [...usedNamespaces].sort((left, right) =>
          left.localeCompare(right)
        ),
      };
    }

    const now = new Date();
    await opts.contractStorage.put({
      digest: validated.digest,
      id: validated.contract.id,
      displayName: validated.contract.displayName,
      description: validated.contract.description,
      installedAt: now,
      contract: validated.canonical,
      resources: validated.contract.resources,
      analysisSummary: analyzed.summary,
      analysis: analyzed.analysis,
    });

    return {
      id: validated.contract.id,
      digest: validated.digest,
      displayName: validated.contract.displayName,
      description: validated.contract.description,
      contract: validated.contract,
      usedNamespaces: [...usedNamespaces].sort((left, right) =>
        left.localeCompare(right)
      ),
    };
  }

  async function installServiceContract(contract: unknown) {
    return await persistContract(contract);
  }

  async function installDeviceContract(contract: unknown) {
    return await persistContract(contract, { device: true });
  }

  async function collectProposedActiveDigests(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<Set<string>> {
    const active = validationOpts?.proposedDigests
      ? new Set(validationOpts.proposedDigests)
      : await collectProposedActiveDigestsFromRecords(
        validationOpts,
      );

    for (const digest of validationOpts?.extraActiveDigests ?? []) {
      active.add(digest);
    }

    return active;
  }

  async function collectProposedActiveDigestsFromRecords(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<Set<string>> {
    const deploymentEnvelopes = overlayStagedRecords(
      await opts.deploymentEnvelopeStorage.listEnabled(),
      validationOpts?.stagedDeploymentEnvelopes,
      (envelope) => envelope.deploymentId,
    );
    const deploymentContractEvidence = await opts
      .deploymentContractEvidenceStorage?.listByDeployments(
        deploymentEnvelopes.map((envelope) => envelope.deploymentId),
      ) ?? [];
    const active = collectActiveContractDigests({
      builtinDigests: [...builtinDigests],
      builtinContractIds: opts.builtinContracts.map(({ contract }) =>
        contract.id
      ),
      deploymentEnvelopes,
      deploymentContractEvidence,
    });
    return active;
  }

  async function validateActiveCatalogEntries(
    validationOpts?: ActiveCatalogValidationOptions,
    opts?: { skipActiveUsesValidation?: boolean },
  ): Promise<Array<{ digest: string; contract: TrellisContractV1 }>> {
    const activeEntries = await loadActiveEntries(validationOpts);
    validateActiveContractCompatibility(activeEntries);
    if (opts?.skipActiveUsesValidation !== true) {
      validateActiveContractUses(activeEntries);
    }
    return activeEntries;
  }

  async function validateActiveCatalog(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<Array<{ digest: string; contract: TrellisContractV1 }>> {
    return await validateActiveCatalogEntries(validationOpts);
  }

  async function validateActiveCatalogForRemoval(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<Array<{ digest: string; contract: TrellisContractV1 }>> {
    return await validateActiveCatalogEntries(validationOpts, {
      skipActiveUsesValidation: true,
    });
  }

  async function refreshActiveContracts(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<void> {
    await validateActiveCatalog(validationOpts);
  }

  async function refreshActiveContractsForRemoval(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<void> {
    await validateActiveCatalogForRemoval(validationOpts);
  }

  return {
    validateContract: validateContractManifest,
    getBuiltinDigests: () => [...builtinDigests],
    getContract: async (
      digest: string,
      opts?: { includeInactive?: boolean },
    ) => {
      if (!opts?.includeInactive) {
        const active = await collectProposedActiveDigests();
        if (!active.has(digest)) {
          return undefined;
        }
      }
      const entry = await getKnownEntry(digest);
      return entry?.contract;
    },
    getKnownContract: async (digest: string) => {
      const entry = await getKnownEntry(digest);
      return entry?.contract;
    },
    getKnownEntriesByContractId,
    getActiveEntries: validateActiveCatalog,
    getActiveContractsById: async (id: string) =>
      getContractsById(await validateActiveCatalog(), id),
    getKnownContractsById: async (id: string) =>
      getContractsById(await getKnownEntriesByContractId(id), id),
    findActiveSubject: async (subject: string) => {
      const entries = await validateActiveCatalog();
      const byDigest = new Map(
        entries.map((entry) => [entry.digest, entry.contract]),
      );
      const indexes = buildActiveContractIndexes(
        byDigest,
        entries.map((entry) => entry.digest),
      );
      return findActiveSubject(indexes.activeSubjectIndex, subject);
    },
    getActiveCatalog: async () =>
      getActiveCatalog(await validateActiveCatalog()),
    getActiveCapabilityDefinitions: async () =>
      getActiveCapabilityDefinitions(await validateActiveCatalog()),
    installDeviceContract,
    installServiceContract,
    refreshActiveContracts,
    refreshActiveContractsForRemoval,
    validateActiveCatalog,
    validateActiveCatalogForRemoval,
  };
}

export type ContractsModule = ReturnType<typeof createContractsModule>;
