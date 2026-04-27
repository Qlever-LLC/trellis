import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { isJsonValue } from "@qlever-llc/trellis/contracts";
import type {
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../auth/storage.ts";
import { addCurrentContractDigests } from "./active_contracts.ts";
import { analyzeContract } from "./analysis.ts";
import { setContracts as setPermissionContracts } from "./permissions.ts";
import { ContractStore } from "./store.ts";
import { resolveContractUsesFromStore } from "./uses.ts";
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
  contractStore: ContractStore;
  validated: ValidatedContract;
  label: string;
  subject: string;
}): void {
  const prev = args.contractStore.findActiveSubject(args.subject);
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

type ValidatedContract = Awaited<ReturnType<ContractStore["validate"]>>;

function getRequiredServiceCapabilities(
  contractStore: ContractStore,
  contract: TrellisContractV1,
): string[] {
  const capabilities = new Set<string>(["service"]);
  const uses = resolveContractUsesFromStore(contractStore, contract);

  for (const event of Object.values(contract.events ?? {})) {
    for (const capability of event.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const subject of Object.values(contract.subjects ?? {})) {
    for (const capability of subject.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
    for (const capability of subject.capabilities?.subscribe ?? []) {
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

  for (const subject of uses.subjectPublishes) {
    for (const capability of subject.subject.capabilities?.publish ?? []) {
      capabilities.add(capability);
    }
  }

  for (const subject of uses.subjectSubscribes) {
    for (const capability of subject.subject.capabilities?.subscribe ?? []) {
      capabilities.add(capability);
    }
  }

  return [...capabilities].sort((left, right) => left.localeCompare(right));
}

async function collectInstalledContractRecords(
  contractStorage: SqlContractStorageRepository,
  logger: CatalogLogger,
): Promise<{
  byDigest: Map<string, InstalledContractRecord>;
}> {
  const byDigest = new Map<string, InstalledContractRecord>();
  try {
    for (const entry of await contractStorage.list()) {
      const record: InstalledContractRecord = {
        digest: entry.digest,
        id: entry.id,
        contract: entry.contract,
      };
      byDigest.set(entry.digest, record);
    }
  } catch (error) {
    logger.warn({ error }, "Failed to list installed contracts");
    return { byDigest };
  }

  return { byDigest };
}

export function createContractsModule(opts: {
  builtinContracts: Array<{ digest: string; contract: TrellisContractV1 }>;
  contractStorage: SqlContractStorageRepository;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  serviceDeploymentStorage: SqlServiceDeploymentRepository;
  deviceDeploymentStorage: SqlDeviceDeploymentRepository;
  deviceInstanceStorage: SqlDeviceInstanceRepository;
  logger?: CatalogLogger;
}) {
  const logger = opts.logger ?? consoleLogger;
  const contractStore = new ContractStore(opts.builtinContracts);

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

    const validated = await contractStore.validate(args.contract);

    const usedNamespaces = new Set<string>();
    for (const method of Object.values(validated.contract.rpc ?? {})) {
      ensureNoWildcards(method.subject);
      ensureSubjectMatchesVersion("rpc", method.version, method.subject);
      const ns = subjectNamespace(method.subject);
      if (!ns) throw new Error(`Invalid RPC subject '${method.subject}'`);
      usedNamespaces.add(ns);
      checkOwnedSubject({
        contractStore,
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
        contractStore,
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
        contractStore,
        validated,
        label: "Event subject",
        subject: event.subject,
      });
    }

    for (const subject of Object.values(validated.contract.subjects ?? {})) {
      checkOwnedSubject({
        contractStore,
        validated,
        label: "Subject",
        subject: subject.subject,
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
    usedNamespaces: string[];
  }> {
    const { validated, usedNamespaces, analyzed } =
      await validateManagedContract({ contract });
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

    contractStore.add(validated.digest, validated.contract);

    return {
      id: validated.contract.id,
      digest: validated.digest,
      displayName: validated.contract.displayName,
      description: validated.contract.description,
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

  async function refreshActiveContracts(): Promise<void> {
    const active = new Set<string>();
    for (const digest of contractStore.getBuiltinDigests()) active.add(digest);

    const installedContracts = await collectInstalledContractRecords(
      opts.contractStorage,
      logger,
    );
    for (const installed of installedContracts.byDigest.values()) {
      try {
        const parsed = JSON.parse(installed.contract);
        if (!isJsonValue(parsed)) {
          throw new Error("stored contract is not valid JSON value");
        }
        const validated = await contractStore.validate(parsed);
        if (validated.digest !== installed.digest) {
          throw new Error(
            "stored contract digest does not match persisted digest",
          );
        }
        contractStore.add(validated.digest, validated.contract);
      } catch (error) {
        logger.warn({
          digest: installed.digest,
          err: error instanceof Error ? error : undefined,
          errorMessage: getErrorMessage(error),
        }, "Failed to hydrate persisted contract");
      }
    }

    const serviceDeployments = new Map(
      (await opts.serviceDeploymentStorage.list()).map((deployment) => [
        deployment.deploymentId,
        deployment,
      ]),
    );

    addCurrentContractDigests(
      active,
      await opts.serviceInstanceStorage.list(),
      (instance) =>
        !instance.disabled &&
        serviceDeployments.get(instance.deploymentId)?.disabled !== true,
    );

    const deviceDeployments = new Map(
      (await opts.deviceDeploymentStorage.list()).map((deployment) => [
        deployment.deploymentId,
        deployment,
      ]),
    );

    addCurrentContractDigests(
      active,
      await opts.deviceInstanceStorage.list(),
      (instance) =>
        instance.state === "activated" &&
        deviceDeployments.get(instance.deploymentId)?.disabled !== true,
    );

    for (const digest of active) {
      if (contractStore.getContract(digest, { includeInactive: true })) {
        continue;
      }
      const entry = await opts.contractStorage.get(digest);
      if (!entry) continue;
      try {
        const parsed = JSON.parse(entry.contract);
        if (!isJsonValue(parsed)) continue;
        const validated = await contractStore.validate(parsed);
        if (validated.digest !== digest) continue;
        contractStore.add(validated.digest, validated.contract);
      } catch (error) {
        logger.warn({
          digest,
          contractId: entry.id,
          err: error instanceof Error ? error : undefined,
          errorMessage: getErrorMessage(error),
        }, "Failed to load installed contract");
      }
    }

    try {
      contractStore.setActiveDigests(active);
    } catch (error) {
      logger.error({ error }, "Failed to activate installed contracts");
      contractStore.setActiveDigests(contractStore.getBuiltinDigests());
    }
    setPermissionContracts(contractStore.getActiveEntries());
  }

  return {
    contractStore,
    installDeviceContract,
    installServiceContract,
    refreshActiveContracts,
  };
}

export type ContractsModule = ReturnType<typeof createContractsModule>;
