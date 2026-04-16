import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import type {
  InstalledContractDetailSchema,
  InstalledContractSchema,
} from "@qlever-llc/trellis/auth";
import type {
  ContractResources,
  TrellisContractV1,
} from "@qlever-llc/trellis/contracts";
import { isJsonValue } from "@qlever-llc/trellis/contracts";
import { isErr, Result } from "@qlever-llc/result";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { TrellisCatalog } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import { TrellisCatalogSchema } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import type { TrellisContractGetResponse } from "../../../packages/trellis/models/trellis/rpc/TrellisContractGet.ts";
import {
  contractsKV,
  deviceInstancesKV,
  logger,
  natsTrellis,
  serviceInstancesKV,
  trellis,
} from "../bootstrap/globals.ts";
import { analyzeContract } from "./analysis.ts";
import { setContracts as setPermissionContracts } from "./permissions.ts";
import {
  type ContractResourceBindings,
  provisionContractResourceBindings,
} from "./resources.ts";
import { ContractStore } from "./store.ts";
import { resolveContractUsesFromStore } from "./uses.ts";
import { serviceInstanceId } from "../auth/admin/shared.ts";

function toOpenSchemaValue(value: NonNullable<TrellisContractV1["schemas"]>[string]): boolean | Record<string, unknown> {
  if (typeof value === "boolean") {
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Contract schemas must be objects or booleans");
  }
  return value;
}

function toRpcContract(contract: TrellisContractV1): TrellisContractGetResponse["contract"] {
  return {
    format: contract.format,
    id: contract.id,
    displayName: contract.displayName,
    description: contract.description,
    ...(contract.schemas
      ? {
        schemas: Object.fromEntries(
          Object.entries(contract.schemas).map(([name, value]) => [name, toOpenSchemaValue(value)]),
        ),
      }
      : {}),
    ...(contract.uses ? { uses: contract.uses } : {}),
    ...(contract.rpc ? { rpc: contract.rpc } : {}),
    ...(contract.events ? { events: contract.events } : {}),
    ...(contract.subjects ? { subjects: contract.subjects } : {}),
    ...(contract.errors ? { errors: contract.errors } : {}),
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

type ServiceContext = {
  caller: { type: string; origin?: string; id?: string };
  sessionKey: string;
};

type InstalledContractRecord = {
  digest: string;
  id: string;
  contract: string;
};

type DigestRequest = { digest: string };
type BindingsRequest = { contractId?: string; digest?: string };
type ListInstalledContractsRequest = {};

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
    throw new Error(
      `Subject '${subject}' must start with '${expectedPrefix}' (version mismatch)`,
    );
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
    };
    byDigest.set(digest, record);
  }

  return { byDigest };
}

export function createContractsModule(opts: {
  builtinContracts: Array<{ digest: string; contract: TrellisContractV1 }>;
}) {
  const contractStore = new ContractStore(opts.builtinContracts);

  type ValidatedContract = Awaited<ReturnType<typeof contractStore.validate>>;

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
    const rpc = (validated.contract as Record<string, unknown>).rpc as
      | Record<string, unknown>
      | undefined;
    const events = (validated.contract as Record<string, unknown>).events as
      | Record<string, unknown>
      | undefined;
    const subjects = (validated.contract as Record<string, unknown>).subjects as
      | Record<string, unknown>
      | undefined;

    for (const value of Object.values(rpc ?? {})) {
      const method = value as { subject: string; version: string };
      ensureNoWildcards(method.subject);
      ensureSubjectMatchesVersion("rpc", method.version, method.subject);
      const ns = subjectNamespace(method.subject);
      if (!ns) throw new Error(`Invalid RPC subject '${method.subject}'`);
      usedNamespaces.add(ns);
      const prev = contractStore.findActiveSubject(method.subject);
      if (
        prev && prev.digest !== validated.digest &&
        prev.contractId !== validated.contract.id
      ) {
        throw new Error(
          `RPC subject '${method.subject}' already owned by '${
            describeContract(prev)
          }'`,
        );
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
      if (
        prev && prev.digest !== validated.digest &&
        prev.contractId !== validated.contract.id
      ) {
        throw new Error(
          `Event subject '${event.subject}' already owned by '${
            describeContract(prev)
          }'`,
        );
      }
    }

    for (const value of Object.values(subjects ?? {})) {
      const subject = value as { subject: string };
      const prev = contractStore.findActiveSubject(subject.subject);
      if (
        prev && prev.digest !== validated.digest &&
        prev.contractId !== validated.contract.id
      ) {
        throw new Error(
          `Subject '${subject.subject}' already owned by '${
            describeContract(prev)
          }'`,
        );
      }
    }

    return {
      validated,
      usedNamespaces,
      analyzed: analyzeContract(validated.contract),
    };
  }

  async function persistContract(contract: unknown, opts?: { device?: boolean }): Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
    usedNamespaces: string[];
  }> {
    const { validated, usedNamespaces, analyzed } = await validateManagedContract({ contract });
    if (
      opts?.device &&
      (
        analyzed.summary.kvResources > 0 ||
        analyzed.summary.streamsResources > 0 ||
        analyzed.summary.jobsQueues > 0 ||
        (validated.contract as TrellisContractV1 & { resources?: unknown }).resources !== undefined
      )
    ) {
      throw new Error("device contracts may not declare resources");
    }

    const existing = (await contractsKV.get(validated.digest)).take();
    if (!isErr(existing)) {
      return {
        id: validated.contract.id,
        digest: validated.digest,
        displayName: validated.contract.displayName,
        description: validated.contract.description,
        usedNamespaces: [...usedNamespaces].sort((left, right) => left.localeCompare(right)),
      };
    }

    const now = new Date();
    const persisted = (
      await contractsKV.put(validated.digest, {
        digest: validated.digest,
        id: validated.contract.id,
        displayName: validated.contract.displayName,
        description: validated.contract.description,
        installedAt: now,
        contract: validated.canonical,
        resources: (validated.contract as TrellisContractV1 & {
          resources?: ContractResources;
        }).resources,
        analysisSummary: analyzed.summary,
        analysis: analyzed.analysis,
      })
    ).take();
    if (isErr(persisted)) {
      logger.warn({ error: persisted.error }, "Failed to persist managed contract");
      throw persisted.error;
    }

    contractStore.add(validated.digest, validated.contract);

    return {
      id: validated.contract.id,
      digest: validated.digest,
      displayName: validated.contract.displayName,
      description: validated.contract.description,
      usedNamespaces: [...usedNamespaces].sort((left, right) => left.localeCompare(right)),
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

    const installedContracts = await collectInstalledContractRecords();
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

    const serviceKeys = (await serviceInstancesKV.keys(">")).take();
    if (!isErr(serviceKeys)) {
      for await (const instanceId of serviceKeys) {
        const entry = (await serviceInstancesKV.get(instanceId)).take();
        if (isErr(entry)) continue;
        if (!entry.value.disabled && entry.value.currentContractDigest) {
          active.add(entry.value.currentContractDigest);
        }
      }
    }

    const deviceKeys = (await deviceInstancesKV.keys(">")).take();
    if (!isErr(deviceKeys)) {
      for await (const instanceId of deviceKeys) {
        const entry = (await deviceInstancesKV.get(instanceId)).take();
        if (isErr(entry)) continue;
        const instance = entry.value as unknown as {
          state: string;
          currentContractDigest?: string;
        };
        if (instance.state === "activated" && instance.currentContractDigest) {
          active.add(instance.currentContractDigest);
        }
      }
    }

    for (const digest of active) {
      if (contractStore.getContract(digest, { includeInactive: true })) {
        continue;
      }
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

  return { contractStore, installDeviceContract, installServiceContract, refreshActiveContracts };
}

export function createTrellisCatalogHandler(contractStore: ContractStore) {
  return async () => {
    logger.trace({ rpc: "Trellis.Catalog" }, "RPC request");
    try {
      const catalog = Value.Parse(
        TrellisCatalogSchema,
        contractStore.getActiveCatalog(),
      ) as TrellisCatalog;
      return Result.ok({ catalog });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: error }));
    }
  };
}

export function createTrellisContractGetHandler(contractStore: ContractStore) {
  return async (
    req: DigestRequest,
  ): Promise<Result<TrellisContractGetResponse, ValidationError>> => {
    logger.trace(
      { rpc: "Trellis.Contract.Get", digest: req.digest },
      "RPC request",
    );
    const contract = contractStore.getContract(req.digest);
    if (!contract) {
      return Result.err(
        new ValidationError({
          errors: [{ path: "/digest", message: "contract digest not found" }],
          context: { digest: req.digest },
        }),
      );
    }
    return Result.ok({
      contract: toRpcContract(contract),
    });
  };
}

export const trellisBindingsGetHandler = async (
  req: BindingsRequest | undefined,
  { caller, sessionKey }: ServiceContext,
) => {
  logger.trace(
    { rpc: "Trellis.Bindings.Get", caller, sessionKey },
    "RPC request",
  );
  if (caller.type !== "service") {
    return Result.err(
      new ValidationError({
        errors: [{
          path: "/user",
          message: "only services can fetch resource bindings",
        }],
      }),
    );
  }

  const instanceId = serviceInstanceId(sessionKey);
  const svc = (await serviceInstancesKV.get(instanceId)).take();
  if (isErr(svc)) {
    return Result.err(
      new ValidationError({
        errors: [{ path: "/service", message: "service principal not found" }],
      }),
    );
  }

  const input = req ?? {};
  if (input.contractId && svc.value.currentContractId !== input.contractId) {
    return Result.ok({ binding: undefined });
  }
  if (input.digest && svc.value.currentContractDigest !== input.digest) {
    return Result.ok({ binding: undefined });
  }

  if (
    !svc.value.currentContractId || !svc.value.currentContractDigest ||
    !svc.value.resourceBindings
  ) {
    return Result.ok({ binding: undefined });
  }

  return Result.ok({
    binding: {
      contractId: svc.value.currentContractId,
      digest: svc.value.currentContractDigest,
      resources: svc.value.resourceBindings,
    },
  });
};

type InstalledContract = Static<typeof InstalledContractSchema>;
type InstalledContractDetail = Static<typeof InstalledContractDetailSchema>;

export const authListInstalledContractsHandler = async (
  _req: ListInstalledContractsRequest,
): Promise<Result<{ contracts: InstalledContract[] }, UnexpectedError>> => {
  logger.trace({ rpc: "Auth.ListInstalledContracts" }, "RPC request");
  const keys = (await contractsKV.keys(">")).take();
  if (isErr(keys)) {
    return Result.err(new UnexpectedError({ cause: keys.error }));
  }

  const contracts = [];
  for await (const digest of keys) {
    const entry = (await contractsKV.get(digest)).take();
    if (isErr(entry)) continue;
    contracts.push(
      {
        digest,
        id: entry.value.id,
        displayName: entry.value.displayName,
        description: entry.value.description,
        installedAt: entry.value.installedAt.toISOString(),
        analysisSummary: entry.value
          .analysisSummary as InstalledContract["analysisSummary"],
      } satisfies InstalledContract,
    );
  }

  contracts.sort((left, right) =>
    String(right.installedAt).localeCompare(String(left.installedAt))
  );
  return Result.ok({ contracts });
};

export const authGetInstalledContractHandler = async (
  req: DigestRequest,
): Promise<Result<{ contract: InstalledContractDetail }, ValidationError>> => {
  logger.trace(
    { rpc: "Auth.GetInstalledContract", digest: req.digest },
    "RPC request",
  );
  const entry = (await contractsKV.get(req.digest)).take();
  if (isErr(entry)) {
    return Result.err(
      new ValidationError({
        errors: [{ path: "/digest", message: "contract not found" }],
      }),
    );
  }

  const contractUnknown: unknown = JSON.parse(entry.value.contract);
  if (
    !contractUnknown || typeof contractUnknown !== "object" ||
    Array.isArray(contractUnknown)
  ) {
    return Result.err(
      new ValidationError({
        errors: [{
          path: "/contract",
          message: "stored contract is not an object",
        }],
      }),
    );
  }

  return Result.ok({
    contract: {
      digest: entry.value.digest,
      id: entry.value.id,
      displayName: entry.value.displayName,
      description: entry.value.description,
      installedAt: entry.value.installedAt.toISOString(),
      analysisSummary: entry.value
        .analysisSummary as InstalledContractDetail["analysisSummary"],
      analysis: entry.value.analysis as InstalledContractDetail["analysis"],
      resources: entry.value.resources as InstalledContractDetail["resources"],
      contract: contractUnknown as InstalledContractDetail["contract"],
    },
  });
};
