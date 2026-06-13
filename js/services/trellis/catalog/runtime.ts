import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { isJsonValue } from "@qlever-llc/trellis/contracts";
import type {
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlImplementationOfferRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../auth/storage.ts";
import { collectActiveContractDigests } from "./active_contracts.ts";
import { analyzeContract } from "./analysis.ts";
import {
  type ActiveSubjectOwner,
  buildActiveContractIndexes,
  type ContractEntry,
  findActiveSubject,
  getActiveCapabilityDefinitions,
  getActiveCatalog,
  getContractsById,
  validateContractManifest,
  type ValidatedContract,
} from "./store.ts";
import {
  createActiveContractLookup,
  resolveContractUses,
  resolveContractUsesFromEntries,
  resolveContractUsesFromKnownEntries,
  validateActiveContractCompatibility,
  validateActiveContractUses,
} from "./uses.ts";
import type {
  SqlContractStorageRepository,
  StoredContractManifestRecord,
} from "./storage.ts";
import type { DeploymentAuthority } from "../auth/schemas.ts";

type CatalogLogger = {
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

const consoleLogger: CatalogLogger = {
  warn: (fields, message) => console.warn(message, fields),
  error: (fields, message) => console.error(message, fields),
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
type DeploymentAuthorityRecord = DeploymentAuthority;
type ImplementationOfferRecord = Awaited<
  ReturnType<SqlImplementationOfferRepository["listActive"]>
>[number];
type DeploymentAuthorityStorage = {
  listEnabled(): Promise<DeploymentAuthorityRecord[]>;
};

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
  implementationOfferStorage?: Pick<
    SqlImplementationOfferRepository,
    "listActive"
  >;
  deploymentAuthorityStorage: DeploymentAuthorityStorage;
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

  async function hydrateCachedManifest(args: {
    record: StoredContractManifestRecord;
    context: string;
    pruneInvalid?: boolean;
  }): Promise<ContractEntry | undefined> {
    try {
      const parsed = JSON.parse(args.record.contract);
      if (!isJsonValue(parsed)) {
        throw new Error("stored contract is not valid JSON value");
      }
      const validated = await validateContractManifest(parsed);
      if (validated.digest !== args.record.digest) {
        throw new Error(
          "stored contract digest does not match persisted digest",
        );
      }
      return {
        digest: validated.digest,
        contract: validated.contract,
      };
    } catch (error) {
      logger.warn({
        digest: args.record.digest,
        contractId: args.record.id,
        context: args.context,
        err: error instanceof Error ? error : undefined,
        errorMessage: getErrorMessage(error),
      }, "Failed to hydrate cached contract manifest");
      if (args.pruneInvalid === true) {
        try {
          await opts.contractStorage.delete(args.record.digest);
        } catch (deleteError) {
          logger.warn({
            digest: args.record.digest,
            contractId: args.record.id,
            context: args.context,
            err: deleteError instanceof Error ? deleteError : undefined,
            errorMessage: getErrorMessage(deleteError),
          }, "Failed to prune invalid cached contract manifest");
        }
      }
      return undefined;
    }
  }

  async function getKnownEntry(
    digest: string,
  ): Promise<ContractEntry | undefined> {
    const builtin = builtinByDigest.get(digest);
    if (builtin) return { digest, contract: builtin };

    const stored = await opts.contractStorage.getManifest(digest);
    if (stored) {
      return await hydrateCachedManifest({
        record: stored,
        context: "known-contract",
        pruneInvalid: true,
      });
    }

    return undefined;
  }

  async function loadEffectiveEntry(args: {
    digest: string;
    contractId?: string;
    deploymentIds: string[];
    reportCacheIssue: boolean;
  }): Promise<{ entry?: ContractEntry; issue?: ActiveCatalogIssue }> {
    const builtin = builtinByDigest.get(args.digest);
    if (builtin) return { entry: { digest: args.digest, contract: builtin } };

    const stored = await opts.contractStorage.getManifest(args.digest);
    if (!stored) {
      logger.warn({
        digest: args.digest,
        contractId: args.contractId,
        context: "active-catalog",
      }, "Active contract digest is not present in cached manifests");
      if (args.reportCacheIssue) {
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
      return {};
    }

    const entry = await hydrateCachedManifest({
      record: stored,
      context: "active-catalog",
      pruneInvalid: true,
    });
    if (!entry) {
      if (args.reportCacheIssue) {
        return {
          issue: {
            issueId: stableIssueId({
              kind: "invalid-active-contract",
              contractId: args.contractId ?? stored.id,
              digest: args.digest,
            }),
            kind: "invalid-active-contract",
            contractId: args.contractId ?? stored.id,
            digest: args.digest,
            message:
              `Active digest '${args.digest}' references invalid cached contract manifest`,
            deploymentIds: args.deploymentIds,
            actions: [],
          },
        };
      }
      return {};
    }
    return { entry };
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
      const record of await opts.contractStorage.listManifestsByContractId(
        contractId,
      )
    ) {
      if (entries.has(record.digest)) continue;
      const entry = await hydrateCachedManifest({
        record: {
          digest: record.digest,
          id: record.id,
          contract: record.contract,
        },
        context: "known-contract-id",
        pruneInvalid: true,
      });
      if (entry) entries.set(entry.digest, entry.contract);
    }
    return [...entries.entries()]
      .map(([digest, contract]) => ({ digest, contract }))
      .sort((left, right) => left.digest.localeCompare(right.digest));
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
    const entries = await getKnownDependencyEntries(validated.contract);
    const indexes = buildActiveContractIndexes(
      new Map(entries.map((entry) => [entry.digest, entry.contract])),
      entries.map((entry) => entry.digest),
    );
    resolveContractUsesFromKnownEntries(entries, validated.contract);

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

  async function getKnownDependencyEntries(
    contract: TrellisContractV1,
  ): Promise<ContractEntry[]> {
    const dependencyIds = sortUnique([
      ...Object.values(contract.uses?.required ?? {}).map((use) =>
        use.contract
      ),
      ...Object.values(contract.uses?.optional ?? {}).map((use) =>
        use.contract
      ),
    ]);
    const entriesByDigest = new Map<string, ContractEntry>();
    for (const contractId of dependencyIds) {
      for (const entry of await getKnownEntriesByContractId(contractId)) {
        entriesByDigest.set(entry.digest, entry);
      }
    }
    return [...entriesByDigest.values()];
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

    const existing = await opts.contractStorage.getManifest(validated.digest);
    if (existing) {
      const hydrated = await hydrateCachedManifest({
        record: existing,
        context: "persist-contract",
      });
      if (hydrated) {
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
    const active = collectActiveContractDigests({
      builtinDigests: [...builtinDigests],
      builtinContractIds: opts.builtinContracts.map(({ contract }) =>
        contract.id
      ),
      deploymentAuthorities: [],
      implementationOffers: await opts.implementationOfferStorage
        ?.listActive() ?? [],
    });
    return active;
  }

  type ActiveDigestEvidence = {
    digest: string;
    contractId?: string;
    firstSeenAt?: string;
    lastSeenAt?: string;
    deploymentIds: string[];
    deploymentFirstSeenAt: Record<string, string>;
    offerIds: string[];
  };

  function activeDigestEvidenceFromOffers(args: {
    active: Set<string>;
    implementationOffers: ImplementationOfferRecord[];
  }): ActiveDigestEvidence[] {
    const metadata = new Map<string, ActiveDigestEvidence>();
    for (const digest of args.active) {
      metadata.set(digest, {
        digest,
        deploymentIds: [],
        deploymentFirstSeenAt: {},
        offerIds: [],
      });
    }

    for (const offer of args.implementationOffers) {
      if (!args.active.has(offer.contractDigest)) continue;
      const record = metadata.get(offer.contractDigest) ?? {
        digest: offer.contractDigest,
        deploymentIds: [],
        deploymentFirstSeenAt: {},
        offerIds: [],
      };
      record.contractId = offer.contractId;
      if (
        record.firstSeenAt === undefined ||
        offer.firstOfferedAt < record.firstSeenAt
      ) {
        record.firstSeenAt = offer.firstOfferedAt;
      }
      if (
        record.lastSeenAt === undefined ||
        offer.lastRefreshedAt > record.lastSeenAt
      ) {
        record.lastSeenAt = offer.lastRefreshedAt;
      }
      const deploymentFirstSeenAt = record.deploymentFirstSeenAt[
        offer.deploymentId
      ];
      if (
        deploymentFirstSeenAt === undefined ||
        offer.firstOfferedAt < deploymentFirstSeenAt
      ) {
        record.deploymentFirstSeenAt[offer.deploymentId] = offer.firstOfferedAt;
      }
      record.deploymentIds.push(offer.deploymentId);
      record.offerIds.push(offer.offerId);
      metadata.set(offer.contractDigest, record);
    }

    return [...metadata.values()].map((record) => ({
      ...record,
      deploymentIds: sortUnique(record.deploymentIds),
      offerIds: sortUnique(record.offerIds),
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
        offerIds: [],
      }));
    }

    const implementationOffers = await opts.implementationOfferStorage
      ?.listActive() ?? [];
    const active = collectActiveContractDigests({
      builtinDigests: [...builtinDigests],
      builtinContractIds: opts.builtinContracts.map(({ contract }) =>
        contract.id
      ),
      deploymentAuthorities: [],
      implementationOffers,
    });
    for (const digest of validationOpts?.extraActiveDigests ?? []) {
      active.add(digest);
    }
    return activeDigestEvidenceFromOffers({
      active,
      implementationOffers,
    });
  }

  function activeDigestEvidenceCompare(
    left: ActiveDigestEvidence,
    right: ActiveDigestEvidence,
  ): number {
    return (left.firstSeenAt ?? "").localeCompare(right.firstSeenAt ?? "") ||
      left.digest.localeCompare(right.digest);
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
      const effectiveForContract: EffectiveActiveEntry[] = [];
      for (const candidate of entries) {
        try {
          validateActiveContractCompatibility([
            ...effectiveForContract,
            candidate,
          ]);
          effectiveForContract.push(candidate);
        } catch (error) {
          const effectiveDigests = sortUnique(
            effectiveForContract.map((entry) => entry.digest),
          );
          const effectiveDeploymentIds = sortUnique(
            effectiveForContract.flatMap((entry) => entry.deploymentIds),
          );
          issues.push({
            issueId: stableIssueId({
              kind: "incompatible-active-contract",
              contractId: candidate.contract.id,
              digest: candidate.digest,
              effectiveDigests,
              conflictingDigests: [candidate.digest],
            }),
            kind: "incompatible-active-contract",
            contractId: candidate.contract.id,
            digest: candidate.digest,
            message:
              `Active implementation offer digest '${candidate.digest}' for '${candidate.contract.id}' is incompatible with effective active offer digest(s) '${
                effectiveDigests.join(", ")
              }' (${getErrorMessage(error)})`,
            deploymentIds: candidate.deploymentIds,
            effectiveDigests,
            conflictingDigest: candidate.digest,
            conflictingDigests: [candidate.digest],
            effectiveDeploymentIds,
            conflictingDeploymentIds: candidate.deploymentIds,
            actions: [
              catalogIssueAction({
                action: "keep-current",
                risk: "recommended",
                label: "Keep current effective offers",
                description:
                  "Withdraw or let the incompatible implementation offer expire so the current effective digest remains active.",
                deploymentIds: candidate.deploymentIds,
                digests: [candidate.digest],
              }),
              catalogIssueAction({
                action: "force-replace",
                risk: "dangerous",
                label: "Force replace current offers",
                description:
                  "Withdraw the current effective offers and accept a compatible implementation offer set before making this digest effective.",
                deploymentIds: effectiveDeploymentIds,
                digests: effectiveDigests,
              }),
            ],
          });
        }
      }
      effective.push(...effectiveForContract);
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
        `Active implementation offer digest '${entry.digest}' for '${entry.contract.id}' has required dependency not active (${
          getErrorMessage(error)
        })`,
      deploymentIds: entry.deploymentIds,
      actions: entry.deploymentIds.length === 0 ? [] : [
        catalogIssueAction({
          action: "keep-current",
          risk: "recommended",
          label: "Remove invalid active uses",
          description:
            "Withdraw or refresh this implementation offer after required active dependencies are available.",
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
        reportCacheIssue: evidence.offerIds.length === 0,
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
    const activeEntries = effective.entries;
    validateActiveContractCompatibility(activeEntries);
    if (opts?.skipActiveUsesValidation !== true) {
      validateActiveContractUses(activeEntries);
    }
    return activeEntries;
  }

  async function pruneInvalidCachedContracts(): Promise<{
    scanned: number;
    valid: number;
    pruned: number;
  }> {
    const pageSize = 100;
    let offset = 0;
    let scanned = 0;
    let valid = 0;
    let pruned = 0;

    while (true) {
      const records = await opts.contractStorage.listManifestPage({
        offset,
        limit: pageSize,
      });
      if (records.length === 0) break;

      let retainedInPage = 0;
      for (const record of records) {
        scanned += 1;
        const entry = await hydrateCachedManifest({
          record,
          context: "cache-pruning",
          pruneInvalid: true,
        });
        if (entry) {
          valid += 1;
          retainedInPage += 1;
        } else if (!(await opts.contractStorage.has(record.digest))) {
          pruned += 1;
        } else {
          retainedInPage += 1;
        }
      }

      offset += retainedInPage;
      if (records.length < pageSize) break;
    }

    return { scanned, valid, pruned };
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
    pruneInvalidCachedContracts,
    refreshActiveContracts,
    refreshActiveContractsForRemoval,
    validateActiveCatalog,
    validateActiveCatalogForRemoval,
  };
}

export type ContractsModule = ReturnType<typeof createContractsModule>;
