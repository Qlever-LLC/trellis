import type { ContractResources, TrellisContractV1 } from "@trellis/contracts";
import { isJsonValue } from "@trellis/contracts";
import { isErr, Result } from "@trellis/result";
import { UnexpectedError, ValidationError } from "@trellis/trellis";
import { Value } from "typebox/value";
import type { TrellisCatalog } from "../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import { TrellisCatalogSchema } from "../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";

import { analyzeContract } from "./contract_analysis.ts";
import { resolveContractUsesFromStore } from "./contract_permissions.ts";
import {
  type ContractResourceBindings,
  provisionContractResourceBindings,
} from "./contract_resources.ts";
import { ContractStore } from "./contracts_store.ts";
import { contractsKV, logger, natsTrellis, servicesKV, trellis } from "./globals.ts";
import { setContracts as setPermissionContracts } from "./permissions.ts";

type ServiceContext = {
  user: { origin: string; id: string };
  sessionKey: string;
};

type ServiceRegistryEntry = {
  displayName: string;
  active: boolean;
  capabilities: string[];
  namespaces?: string[];
  description: string;
  contractId?: string;
  contractDigest?: string;
  resourceBindings?: ContractResourceBindings;
  createdAt: Date;
};

type InstalledContractRecord = {
  digest: string;
  id: string;
  contract: string;
  resourceBindings?: ContractResourceBindings;
};

type DigestRequest = { digest: string };
type BindingsRequest = { contractId?: string; digest?: string };
type ListInstalledContractsRequest = { sessionKey?: string };

function describeContract(contract: { contractId: string; displayName: string }): string {
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
  if (parts[0] !== "rpc" && parts[0] !== "events") return null;
  if (!parts[1]?.startsWith("v")) return null;
  return parts[2] ?? null;
}

function ensureNoWildcards(subject: string): void {
  if (subject.includes("*") || subject.includes(">")) {
    throw new Error(`Subject '${subject}' must not contain '*' or '>'`);
  }
}

function ensureSubjectMatchesVersion(
  kind: "rpc" | "events",
  version: string,
  subject: string,
): void {
  const expectedPrefix = `${kind}.${version}.`;
  if (!subject.startsWith(expectedPrefix)) {
    throw new Error(`Subject '${subject}' must start with '${expectedPrefix}' (version mismatch)`);
  }
}

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

function shouldRepairServiceEntry(
  service: ServiceRegistryEntry,
  next: {
    contractId: string;
    contractDigest: string;
    capabilities: string[];
    resourceBindings?: ContractResourceBindings;
  },
): boolean {
  return service.contractId !== next.contractId ||
    service.contractDigest !== next.contractDigest ||
    JSON.stringify(service.capabilities ?? []) !== JSON.stringify(next.capabilities) ||
    JSON.stringify(service.resourceBindings ?? {}) !== JSON.stringify(next.resourceBindings ?? {});
}

async function collectInstalledContractRecords(): Promise<{
  byDigest: Map<string, InstalledContractRecord>;
}> {
  const byDigest = new Map<string, InstalledContractRecord>();
  const keys = (await contractsKV.keys(">")).take();

  if (isErr(keys)) {
    logger.warn({ error: keys.error }, "Failed to list installed contracts");
    return { byDigest };
  }

  for await (const digest of keys) {
    const entry = (await contractsKV.get(digest)).take();
    if (isErr(entry)) continue;

    const record: InstalledContractRecord = {
      digest,
      id: entry.value.id,
      contract: entry.value.contract,
      resourceBindings: entry.value.resourceBindings,
    };
    byDigest.set(digest, record);
  }

  return { byDigest };
}

export function createContractsModule(opts: {
  builtinContracts: Array<{ digest: string; contract: TrellisContractV1 }>;
}) {
  const contractStore = new ContractStore(opts.builtinContracts);

  async function prepareInstalledContract(args: {
    serviceSessionKey: string;
    namespaces: string[];
    contract: unknown;
    currentDigest?: string;
    currentContractId?: string;
  }): Promise<{
      id: string;
      digest: string;
      capabilities: string[];
      resourceBindings: ContractResourceBindings;
    }> {
    if (!args.contract || typeof args.contract !== "object" || Array.isArray(args.contract)) {
      throw new Error("contract must be an object");
    }

    const validated = await contractStore.validate(args.contract);
    if (args.currentContractId && validated.contract.id !== args.currentContractId) {
      throw new Error("contract id must remain stable for service upgrades");
    }

    const activeDigestForId = contractStore.findActiveDigestById(validated.contract.id);
    if (
      activeDigestForId
      && activeDigestForId !== args.currentDigest
      && activeDigestForId !== validated.digest
    ) {
      throw new Error(`Contract id '${validated.contract.id}' is already active in this deployment`);
    }

    const allowedNamespaces = new Set(args.namespaces);
    const usedNamespaces = new Set<string>();
    const rpc = (validated.contract as Record<string, unknown>).rpc as Record<string, unknown> | undefined;
    const events = (validated.contract as Record<string, unknown>).events as Record<string, unknown> | undefined;
    const subjects = (validated.contract as Record<string, unknown>).subjects as Record<string, unknown> | undefined;

    for (const value of Object.values(rpc ?? {})) {
      const method = value as { subject: string; version: string };
      ensureNoWildcards(method.subject);
      ensureSubjectMatchesVersion("rpc", method.version, method.subject);
      const ns = subjectNamespace(method.subject);
      if (!ns) throw new Error(`Invalid RPC subject '${method.subject}'`);
      usedNamespaces.add(ns);
      const prev = contractStore.findActiveSubject(method.subject);
      if (prev && prev.digest !== args.currentDigest && prev.digest !== validated.digest) {
        throw new Error(`RPC subject '${method.subject}' already owned by '${describeContract(prev)}'`);
      }
    }

    for (const value of Object.values(events ?? {})) {
      const event = value as { subject: string; version: string };
      ensureNoWildcards(event.subject);
      ensureSubjectMatchesVersion("events", event.version, event.subject);
      const ns = subjectNamespace(event.subject);
      if (!ns) throw new Error(`Invalid event subject '${event.subject}'`);
      usedNamespaces.add(ns);
      const prev = contractStore.findActiveSubject(event.subject);
      if (prev && prev.digest !== args.currentDigest && prev.digest !== validated.digest) {
        throw new Error(`Event subject '${event.subject}' already owned by '${describeContract(prev)}'`);
      }
    }

    for (const value of Object.values(subjects ?? {})) {
      const subject = value as { subject: string };
      const prev = contractStore.findActiveSubject(subject.subject);
      if (prev && prev.digest !== args.currentDigest && prev.digest !== validated.digest) {
        throw new Error(`Subject '${subject.subject}' already owned by '${describeContract(prev)}'`);
      }
    }

    const missingNamespaces = [...usedNamespaces].filter((ns) => !allowedNamespaces.has(ns));
    if (missingNamespaces.length > 0) {
      throw new Error(`Service is not allowed to install namespaces: ${missingNamespaces.join(", ")}`);
    }

    const resourceBindings = await provisionContractResourceBindings(
      natsTrellis,
      validated.contract,
      args.serviceSessionKey,
    );
    const capabilities = getRequiredServiceCapabilities(contractStore, validated.contract);

    const analyzed = analyzeContract(validated.contract);
    const now = new Date();
    (
      await contractsKV.put(validated.digest, {
        digest: validated.digest,
        id: validated.contract.id,
        displayName: validated.contract.displayName,
        description: validated.contract.description,
        kind: validated.contract.kind,
        sessionKey: args.serviceSessionKey,
        installedAt: now,
        contract: validated.canonical,
        resources: (validated.contract as TrellisContractV1 & { resources?: ContractResources }).resources,
        resourceBindings,
        analysisSummary: analyzed.summary,
        analysis: analyzed.analysis,
      })
    ).inspectErr((error) => logger.warn({ error }, "Failed to persist installed contract"));

      return {
        id: validated.contract.id,
        digest: validated.digest,
        capabilities,
        resourceBindings,
      };
    }

  async function refreshActiveContracts(): Promise<void> {
    const active = new Set<string>();
    for (const digest of contractStore.getBuiltinDigests()) active.add(digest);
    const installedContracts = await collectInstalledContractRecords();

    const svcKeys = (await servicesKV.keys(">")).take();
    if (isErr(svcKeys)) {
      logger.warn({ error: svcKeys.error }, "Failed to list services for contracts");
    } else {
      for await (const sessionKey of svcKeys) {
        const svc = (await servicesKV.get(sessionKey)).take();
        if (isErr(svc)) continue;
        if (!svc.value.active) continue;

        const service = svc.value as ServiceRegistryEntry;
        const installed = service.contractDigest
          ? installedContracts.byDigest.get(service.contractDigest)
          : undefined;

        if (installed) {
          try {
            const parsed = JSON.parse(installed.contract);
            if (!isJsonValue(parsed)) {
              throw new Error("stored contract is not valid JSON value");
            }
            const validated = await contractStore.validate(parsed);
            if (validated.digest !== installed.digest) {
              throw new Error("stored contract digest does not match persisted digest");
            }

            const capabilities = getRequiredServiceCapabilities(contractStore, validated.contract);
            if (shouldRepairServiceEntry(service, {
              contractId: validated.contract.id,
              contractDigest: installed.digest,
              capabilities,
              resourceBindings: installed.resourceBindings,
            })) {
              const repaired = (
                await servicesKV.put(sessionKey, {
                  ...service,
                  contractId: validated.contract.id,
                  contractDigest: installed.digest,
                  capabilities,
                  resourceBindings: installed.resourceBindings,
                })
              ).take();
              if (isErr(repaired)) {
                logger.warn({ error: repaired.error, sessionKey }, "Failed to repair service contract state");
              }
            }

            active.add(installed.digest);
            continue;
          } catch (error) {
            logger.warn({
              sessionKey,
              digest: installed.digest,
              err: error instanceof Error ? error : undefined,
              errorMessage: getErrorMessage(error),
            }, "Failed to reconcile installed service contract");
          }
        }

        if (service.contractDigest) active.add(service.contractDigest);
      }
    }

    for (const digest of active) {
      if (contractStore.getContract(digest, { includeInactive: true })) continue;
      const entry = (await contractsKV.get(digest)).take();
      if (isErr(entry)) continue;
      try {
        const parsed = JSON.parse(entry.value.contract);
        if (!isJsonValue(parsed)) continue;
        const validated = await contractStore.validate(parsed);
        if (validated.digest !== digest) continue;
        contractStore.add(validated.digest, validated.contract);
      } catch (error) {
        logger.warn({
          digest,
          contractId: entry.value.id,
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

  async function registerRpcHandlers(): Promise<void> {
    await trellis.mount("Trellis.Catalog", async () => {
      logger.trace({ rpc: "Trellis.Catalog" }, "RPC request");
      try {
        const catalog = Value.Parse(TrellisCatalogSchema, contractStore.getActiveCatalog()) as TrellisCatalog;
        return Result.ok({ catalog });
      } catch (error) {
        return Result.err(new UnexpectedError({ cause: error }));
      }
    });

    await trellis.mount("Trellis.Contract.Get", async (req: DigestRequest) => {
      logger.trace({ rpc: "Trellis.Contract.Get", digest: req.digest }, "RPC request");
      const contract = contractStore.getContract(req.digest);
      if (!contract) {
        return Result.err(new ValidationError({
          errors: [{ path: "/digest", message: "contract digest not found" }],
          context: { digest: req.digest },
        }));
      }
      return Result.ok({ contract });
    });

    await trellis.mount("Trellis.Bindings.Get", async (req: BindingsRequest | undefined, { user, sessionKey }: ServiceContext) => {
      logger.trace({ rpc: "Trellis.Bindings.Get", user, sessionKey }, "RPC request");
      if (user.origin !== "service") {
        return Result.err(new ValidationError({
          errors: [{ path: "/user", message: "only services can fetch resource bindings" }],
        }));
      }

      const svc = (await servicesKV.get(sessionKey)).take();
      if (isErr(svc)) {
        return Result.err(new ValidationError({
          errors: [{ path: "/service", message: "service principal not found" }],
        }));
      }

      const input = req ?? {};
      if (input.contractId && svc.value.contractId !== input.contractId) {
        return Result.ok({ binding: undefined });
      }
      if (input.digest && svc.value.contractDigest !== input.digest) {
        return Result.ok({ binding: undefined });
      }

      if (!svc.value.contractId || !svc.value.contractDigest || !svc.value.resourceBindings) {
        return Result.ok({ binding: undefined });
      }

      return Result.ok({
        binding: {
          contractId: svc.value.contractId,
          digest: svc.value.contractDigest,
          resources: svc.value.resourceBindings,
        },
      });
    });

    await trellis.mount("Auth.ListInstalledContracts", async (req: ListInstalledContractsRequest) => {
      logger.trace({ rpc: "Auth.ListInstalledContracts", sessionKey: req.sessionKey }, "RPC request");
      const keys = (await contractsKV.keys(">")).take();
      if (isErr(keys)) return Result.err(new UnexpectedError({ cause: keys.error }));

      const contracts = [];
      for await (const digest of keys) {
        const entry = (await contractsKV.get(digest)).take();
        if (isErr(entry)) continue;
        if (req.sessionKey && entry.value.sessionKey !== req.sessionKey) continue;
        contracts.push({
          digest,
          id: entry.value.id,
          displayName: entry.value.displayName,
          description: entry.value.description,
          kind: entry.value.kind,
          sessionKey: entry.value.sessionKey,
          installedAt: entry.value.installedAt.toISOString(),
          analysisSummary: entry.value.analysisSummary,
          resourceBindings: entry.value.resourceBindings,
        });
      }

      contracts.sort((left, right) => String(right.installedAt).localeCompare(String(left.installedAt)));
      return Result.ok({ contracts });
    });

    await trellis.mount("Auth.GetInstalledContract", async (req: DigestRequest) => {
      logger.trace({ rpc: "Auth.GetInstalledContract", digest: req.digest }, "RPC request");
      const entry = (await contractsKV.get(req.digest)).take();
      if (isErr(entry)) {
        return Result.err(new ValidationError({
          errors: [{ path: "/digest", message: "contract not found" }],
        }));
      }

      const contractUnknown = JSON.parse(entry.value.contract) as unknown;
      if (!contractUnknown || typeof contractUnknown !== "object" || Array.isArray(contractUnknown)) {
        return Result.err(new ValidationError({
          errors: [{ path: "/contract", message: "stored contract is not an object" }],
        }));
      }

      return Result.ok({
        contract: {
          digest: entry.value.digest,
          id: entry.value.id,
          displayName: entry.value.displayName,
          description: entry.value.description,
          kind: entry.value.kind,
          sessionKey: entry.value.sessionKey,
          installedAt: entry.value.installedAt.toISOString(),
          analysisSummary: entry.value.analysisSummary,
          analysis: entry.value.analysis,
          resources: entry.value.resources,
          resourceBindings: entry.value.resourceBindings,
          contract: contractUnknown as Record<string, unknown>,
        },
      });
    });
  }

  return { contractStore, prepareInstalledContract, refreshActiveContracts, registerRpcHandlers };
}
