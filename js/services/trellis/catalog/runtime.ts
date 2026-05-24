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
  createActiveContractLookup,
  resolveContractUses,
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
  ReturnType<SqlDeploymentContractEvidenceRepository["listByDeployments"]>
>[number];

/** Describes an active catalog digest that was excluded from the effective runtime catalog. */
export type ActiveCatalogIssue = {
  issueId: string;
  kind:
    | "missing-active-contract"
    | "invalid-active-contract"
    | "incompatible-active-contract"
    | "invalid-active-contract-uses";
  contractId?: string;
  digest?: string;
  message: string;
  deploymentIds: string[];
  effectiveDigests?: string[];
  conflictingDigest?: string;
  conflictingDigests?: string[];
  effectiveDeploymentIds?: string[];
  conflictingDeploymentIds?: string[];
  actions: ActiveCatalogIssueAction[];
};

export type ActiveCatalogIssueAction = {
  action: "keep-current" | "force-replace";
  label: string;
  description: string;
  risk: "recommended" | "dangerous";
  deploymentIds: string[];
  digests: string[];
};

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

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stableIssueId(args: {
  kind: ActiveCatalogIssue["kind"];
  contractId?: string;
  digest?: string;
  effectiveDigests?: Iterable<string>;
  conflictingDigests?: Iterable<string>;
}): string {
  return [
    args.kind,
    args.contractId ?? "",
    args.digest ?? "",
    sortUnique(args.effectiveDigests ?? []).join(","),
    sortUnique(args.conflictingDigests ?? []).join(","),
  ].join(":");
}

function catalogIssueAction(args: {
  action: "keep-current" | "force-replace";
  risk: "recommended" | "dangerous";
  label: string;
  description: string;
  deploymentIds: Iterable<string>;
  digests: Iterable<string>;
}): ActiveCatalogIssueAction {
  return {
    action: args.action,
    label: args.label,
    description: args.description,
    risk: args.risk,
    deploymentIds: sortUnique(args.deploymentIds),
    digests: sortUnique(args.digests),
  };
}

function summarizeActiveCatalogIssue(issue: ActiveCatalogIssue): string {
  return issue.message;
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

export function createContractsModule(opts: {
  builtinContracts: Array<{ digest: string; contract: TrellisContractV1 }>;
  contractStorage: SqlContractStorageRepository;
  deploymentContractEvidenceStorage?: Pick<
    SqlDeploymentContractEvidenceRepository,
    "deleteEvidence" | "listByDeployments"
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

    return undefined;
  }

  async function loadEntriesForDigests(args: {
    digests: Iterable<string>;
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
    for (const digest of missingAfterStored) {
      throw new Error(`Unknown active contract digest '${digest}'`);
    }

    return validateActiveDigestEntries(entriesByDigest, requested);
  }

  async function loadEffectiveEntry(args: {
    digest: string;
    contractId?: string;
    deploymentIds: string[];
  }): Promise<{ entry?: ContractEntry; issue?: ActiveCatalogIssue }> {
    const builtin = builtinByDigest.get(args.digest);
    if (builtin) return { entry: { digest: args.digest, contract: builtin } };

    const stored = await opts.contractStorage.get(args.digest);
    if (!stored) {
      return {
        issue: {
          issueId: stableIssueId({
            kind: "missing-active-contract",
            contractId: args.contractId,
            digest: args.digest,
          }),
          kind: "missing-active-contract",
          ...(args.contractId ? { contractId: args.contractId } : {}),
          digest: args.digest,
          message: `Unknown active contract digest '${args.digest}'`,
          deploymentIds: args.deploymentIds,
          actions: [],
        },
      };
    }

    const entry = await hydrateStoredContract({
      logger,
      record: {
        digest: stored.digest,
        id: stored.id,
        contract: stored.contract,
      },
      message: "Failed to hydrate active contract",
    });
    if (!entry) {
      await pruneInvalidActiveContract({
        digest: args.digest,
        contractId: args.contractId ?? stored.id,
      });
      return {};
    }
    return { entry };
  }

  async function pruneInvalidActiveContract(args: {
    digest: string;
    contractId: string;
  }): Promise<void> {
    const deletedEvidence = await opts.deploymentContractEvidenceStorage
      ?.deleteEvidence({
        contractId: args.contractId,
        contractDigests: [args.digest],
      }) ?? [];
    await opts.contractStorage.delete(args.digest);

    const instances = await opts.serviceInstanceStorage
      .listByCurrentContractDigests([args.digest]);
    for (const instance of instances) {
      await opts.serviceInstanceStorage.put({
        ...instance,
        currentContractId: undefined,
        currentContractDigest: undefined,
      });
    }

    logger.warn({
      digest: args.digest,
      contractId: args.contractId,
      deletedEvidenceCount: deletedEvidence.length,
      clearedServiceInstanceCount: instances.length,
    }, "Pruned invalid active contract digest");
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
    const entries = (await loadEffectiveActiveCatalogState()).entries;
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
    const deploymentEnvelopes = applyStagedParentDeploymentDisabled(
      overlayStagedRecords(
        await opts.deploymentEnvelopeStorage.listEnabled(),
        validationOpts?.stagedDeploymentEnvelopes,
        (envelope) => envelope.deploymentId,
      ),
      validationOpts,
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

  function applyStagedParentDeploymentDisabled(
    deploymentEnvelopes: DeploymentEnvelopeRecord[],
    validationOpts?: ActiveCatalogValidationOptions,
  ): DeploymentEnvelopeRecord[] {
    const disabledDeploymentIds = new Set<string>();
    for (const deployment of validationOpts?.stagedServiceDeployments ?? []) {
      if (deployment.disabled) {
        disabledDeploymentIds.add(deployment.deploymentId);
      }
    }
    for (const deployment of validationOpts?.stagedDeviceDeployments ?? []) {
      if (deployment.disabled) {
        disabledDeploymentIds.add(deployment.deploymentId);
      }
    }
    if (disabledDeploymentIds.size === 0) return deploymentEnvelopes;
    return deploymentEnvelopes.map((envelope) =>
      disabledDeploymentIds.has(envelope.deploymentId)
        ? { ...envelope, disabled: true }
        : envelope
    );
  }

  type ActiveDigestEvidence = {
    digest: string;
    contractId?: string;
    firstSeenAt?: string;
    lastSeenAt?: string;
    deploymentIds: string[];
    deploymentFirstSeenAt: Record<string, string>;
  };

  function activeDigestEvidenceFromRecords(args: {
    active: Set<string>;
    deploymentEnvelopes: DeploymentEnvelopeRecord[];
    deploymentContractEvidence: DeploymentContractEvidenceRecord[];
  }): ActiveDigestEvidence[] {
    const activeContractsByDeployment = new Map<string, Set<string>>();
    const builtinContractIds = new Set(
      opts.builtinContracts.map(({ contract }) => contract.id),
    );
    for (const envelope of args.deploymentEnvelopes) {
      if (envelope.disabled) continue;
      activeContractsByDeployment.set(
        envelope.deploymentId,
        new Set([
          ...envelope.boundary.contracts.map((contract) => contract.contractId),
          ...envelope.boundary.surfaces.map((surface) => surface.contractId),
        ]),
      );
    }

    const metadata = new Map<string, ActiveDigestEvidence>();
    for (const digest of args.active) {
      metadata.set(digest, {
        digest,
        deploymentIds: [],
        deploymentFirstSeenAt: {},
      });
    }

    for (const evidence of args.deploymentContractEvidence) {
      if (evidence.ignoredAt) continue;
      if (builtinContractIds.has(evidence.contractId)) continue;
      if (!args.active.has(evidence.contractDigest)) continue;
      if (
        !activeContractsByDeployment.get(evidence.deploymentId)?.has(
          evidence.contractId,
        )
      ) continue;
      const record = metadata.get(evidence.contractDigest) ?? {
        digest: evidence.contractDigest,
        deploymentIds: [],
        deploymentFirstSeenAt: {},
      };
      record.contractId = evidence.contractId;
      if (
        record.firstSeenAt === undefined ||
        evidence.firstSeenAt < record.firstSeenAt
      ) {
        record.firstSeenAt = evidence.firstSeenAt;
      }
      if (
        record.lastSeenAt === undefined ||
        evidence.lastSeenAt > record.lastSeenAt
      ) {
        record.lastSeenAt = evidence.lastSeenAt;
      }
      const deploymentFirstSeenAt = record.deploymentFirstSeenAt[
        evidence.deploymentId
      ];
      if (
        deploymentFirstSeenAt === undefined ||
        evidence.firstSeenAt < deploymentFirstSeenAt
      ) {
        record.deploymentFirstSeenAt[evidence.deploymentId] =
          evidence.firstSeenAt;
      }
      record.deploymentIds.push(evidence.deploymentId);
      metadata.set(evidence.contractDigest, record);
    }

    return [...metadata.values()].map((record) => ({
      ...record,
      deploymentIds: sortUnique(record.deploymentIds),
    }));
  }

  async function collectActiveDigestEvidence(
    validationOpts?: ActiveCatalogValidationOptions,
  ): Promise<ActiveDigestEvidence[]> {
    if (validationOpts?.proposedDigests) {
      const active = await collectProposedActiveDigests(validationOpts);
      return [...active].map((digest) => ({
        digest,
        deploymentIds: [],
        deploymentFirstSeenAt: {},
      }));
    }

    const deploymentEnvelopes = applyStagedParentDeploymentDisabled(
      overlayStagedRecords(
        await opts.deploymentEnvelopeStorage.listEnabled(),
        validationOpts?.stagedDeploymentEnvelopes,
        (envelope) => envelope.deploymentId,
      ),
      validationOpts,
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
    for (const digest of validationOpts?.extraActiveDigests ?? []) {
      active.add(digest);
    }
    return activeDigestEvidenceFromRecords({
      active,
      deploymentEnvelopes,
      deploymentContractEvidence,
    });
  }

  function activeDigestEvidenceCompare(
    left: ActiveDigestEvidence,
    right: ActiveDigestEvidence,
  ): number {
    return (left.firstSeenAt ?? "").localeCompare(right.firstSeenAt ?? "") ||
      left.digest.localeCompare(right.digest);
  }

  function latestActiveEvidence(
    entries: Array<ActiveDigestEvidence & ContractEntry>,
  ): ActiveDigestEvidence & ContractEntry {
    const sorted = [...entries].sort((left, right) =>
      (left.lastSeenAt ?? "").localeCompare(right.lastSeenAt ?? "") ||
      activeDigestEvidenceCompare(left, right)
    );
    const latest = sorted[sorted.length - 1];
    if (!latest) throw new Error("expected active evidence entry");
    return latest;
  }

  type EffectiveActiveEntry = ActiveDigestEvidence & ContractEntry;

  function selectEffectiveCompatibleEntries(
    candidates: Array<ActiveDigestEvidence & ContractEntry>,
  ): { entries: EffectiveActiveEntry[]; issues: ActiveCatalogIssue[] } {
    const byContractId = new Map<
      string,
      Array<ActiveDigestEvidence & ContractEntry>
    >();
    for (const candidate of candidates) {
      const entries = byContractId.get(candidate.contract.id) ?? [];
      entries.push(candidate);
      byContractId.set(candidate.contract.id, entries);
    }

    const effective: EffectiveActiveEntry[] = [];
    const issues: ActiveCatalogIssue[] = [];
    for (const entries of byContractId.values()) {
      entries.sort(activeDigestEvidenceCompare);
      const current = entries[0];
      if (!current) continue;
      const conflictingEntries = entries.slice(1);
      if (conflictingEntries.length > 0) {
        const proposed = latestActiveEvidence(conflictingEntries);
        const effectiveDigests = [current.digest];
        const effectiveDeploymentIds = sortUnique(current.deploymentIds);
        const conflictingDigests = sortUnique(
          conflictingEntries.map((entry) => entry.digest),
        );
        const conflictingDeploymentIds = sortUnique(
          conflictingEntries.flatMap((entry) => entry.deploymentIds),
        );
        const forceReplaceEntries = entries.filter((entry) =>
          entry.digest !== proposed.digest
        );
        const forceReplaceDeploymentIds = sortUnique(
          forceReplaceEntries.flatMap((entry) => entry.deploymentIds),
        );
        const forceReplaceDigests = sortUnique(
          forceReplaceEntries.map((entry) => entry.digest),
        );
        let conflictMessage = "same contract id already has an active digest";
        try {
          validateActiveContractCompatibility([current, proposed]);
        } catch (error) {
          conflictMessage = getErrorMessage(error);
        }
        issues.push({
          issueId: stableIssueId({
            kind: "incompatible-active-contract",
            contractId: proposed.contract.id,
            digest: proposed.digest,
            effectiveDigests,
            conflictingDigests,
          }),
          kind: "incompatible-active-contract",
          contractId: proposed.contract.id,
          digest: proposed.digest,
          message:
            `Active contract digest '${proposed.digest}' for '${proposed.contract.id}' conflicts with effective digest '${
              effectiveDigests[0]
            }' (${conflictMessage})`,
          deploymentIds: conflictingDeploymentIds,
          effectiveDigests,
          conflictingDigest: proposed.digest,
          conflictingDigests,
          effectiveDeploymentIds,
          conflictingDeploymentIds,
          actions: [
            catalogIssueAction({
              action: "keep-current",
              risk: "recommended",
              label: "Keep current effective contract",
              description:
                "Delete the conflicting deployment evidence so the current effective digest remains active.",
              deploymentIds: conflictingDeploymentIds,
              digests: conflictingDigests,
            }),
            catalogIssueAction({
              action: "force-replace",
              risk: "dangerous",
              label: "Force replace current contract",
              description:
                "Delete all non-selected deployment evidence so the proposed digest becomes active.",
              deploymentIds: forceReplaceDeploymentIds,
              digests: forceReplaceDigests,
            }),
          ],
        });
      }
      effective.push(current);
    }
    effective.sort((left, right) => left.digest.localeCompare(right.digest));
    return { entries: effective, issues };
  }

  function activeUseIssue(
    entry: EffectiveActiveEntry,
    error: unknown,
  ): ActiveCatalogIssue {
    return {
      issueId: stableIssueId({
        kind: "invalid-active-contract-uses",
        contractId: entry.contract.id,
        digest: entry.digest,
      }),
      kind: "invalid-active-contract-uses",
      contractId: entry.contract.id,
      digest: entry.digest,
      message:
        `Active contract digest '${entry.digest}' for '${entry.contract.id}' has invalid active dependencies (${
          getErrorMessage(error)
        })`,
      deploymentIds: entry.deploymentIds,
      actions: entry.deploymentIds.length === 0 ? [] : [
        catalogIssueAction({
          action: "keep-current",
          risk: "recommended",
          label: "Remove invalid active uses",
          description:
            "Delete this digest's deployment evidence so active dependencies can be repaired.",
          deploymentIds: entry.deploymentIds,
          digests: [entry.digest],
        }),
      ],
    };
  }

  function selectEntriesWithValidUses(
    entries: EffectiveActiveEntry[],
  ): { entries: EffectiveActiveEntry[]; issues: ActiveCatalogIssue[] } {
    const issues: ActiveCatalogIssue[] = [];
    let remaining = [...entries];
    let changed = true;
    while (changed) {
      changed = false;
      const activeById = createActiveContractLookup(remaining);
      const next: EffectiveActiveEntry[] = [];
      for (const entry of remaining) {
        try {
          resolveContractUses(entry.contract, (_alias, use, options) => {
            const target = activeById.get(use.contract);
            if (!target) {
              if (!options.required) return null;
              throw new Error(
                `Dependency references inactive contract '${use.contract}'`,
              );
            }
            return target;
          });
          next.push(entry);
        } catch (error) {
          issues.push(activeUseIssue(entry, error));
          changed = true;
        }
      }
      remaining = next;
    }
    return { entries: remaining, issues };
  }

  async function loadEffectiveActiveCatalogState(
    validationOpts?: ActiveCatalogValidationOptions,
    loadOpts?: { skipActiveUsesValidation?: boolean },
  ): Promise<{ entries: ContractEntry[]; issues: ActiveCatalogIssue[] }> {
    const digestEvidence = await collectActiveDigestEvidence(validationOpts);
    const candidates: Array<ActiveDigestEvidence & ContractEntry> = [];
    const issues: ActiveCatalogIssue[] = [];
    for (const evidence of digestEvidence) {
      const result = await loadEffectiveEntry({
        digest: evidence.digest,
        contractId: evidence.contractId,
        deploymentIds: evidence.deploymentIds,
      });
      if (result.issue) {
        issues.push(result.issue);
        continue;
      }
      if (result.entry) {
        candidates.push({ ...evidence, ...result.entry });
      }
    }

    const compatible = selectEffectiveCompatibleEntries(candidates);
    const uses = loadOpts?.skipActiveUsesValidation === true
      ? { entries: compatible.entries, issues: [] }
      : selectEntriesWithValidUses(compatible.entries);
    return {
      entries: uses.entries,
      issues: [...issues, ...compatible.issues, ...uses.issues],
    };
  }

  async function validateActiveCatalogEntries(
    validationOpts?: ActiveCatalogValidationOptions,
    opts?: { skipActiveUsesValidation?: boolean },
  ): Promise<Array<{ digest: string; contract: TrellisContractV1 }>> {
    const effective = await loadEffectiveActiveCatalogState(
      validationOpts,
      opts,
    );
    const firstIssue = effective.issues[0];
    if (firstIssue) {
      throw new Error(summarizeActiveCatalogIssue(firstIssue));
    }
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
    await loadEffectiveActiveCatalogState(validationOpts);
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
        const active = new Set(
          (await loadEffectiveActiveCatalogState()).entries.map((entry) =>
            entry.digest
          ),
        );
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
    getActiveEntries: async () =>
      (await loadEffectiveActiveCatalogState()).entries,
    getActiveContractsById: async (id: string) =>
      getContractsById((await loadEffectiveActiveCatalogState()).entries, id),
    getKnownContractsById: async (id: string) =>
      getContractsById(await getKnownEntriesByContractId(id), id),
    findActiveSubject: async (subject: string) => {
      const entries = (await loadEffectiveActiveCatalogState()).entries;
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
      getActiveCatalog((await loadEffectiveActiveCatalogState()).entries),
    getActiveCatalogState: async () => await loadEffectiveActiveCatalogState(),
    getActiveCatalogIssues: async () =>
      (await loadEffectiveActiveCatalogState()).issues,
    getActiveCapabilityDefinitions: async () =>
      getActiveCapabilityDefinitions(
        (await loadEffectiveActiveCatalogState()).entries,
      ),
    installDeviceContract,
    installServiceContract,
    refreshActiveContracts,
    refreshActiveContractsForRemoval,
    validateActiveCatalog,
    validateActiveCatalogForRemoval,
  };
}

export type ContractsModule = ReturnType<typeof createContractsModule>;
