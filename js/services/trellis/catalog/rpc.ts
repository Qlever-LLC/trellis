import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import type {
  InstalledContractDetailSchema,
  InstalledContractSchema,
} from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Result } from "@qlever-llc/result";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { TrellisCatalog } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import { TrellisCatalogSchema } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import type { TrellisContractGetResponse } from "../../../packages/trellis/models/trellis/rpc/TrellisContractGet.ts";
import { ContractStore } from "./store.ts";
import type { SqlContractStorageRepository } from "./storage.ts";
import type { SqlServiceInstanceRepository } from "../auth/storage.ts";

type CatalogLogger = {
  trace: (fields: Record<string, unknown>, message: string) => void;
};

const noopLogger: CatalogLogger = {
  trace: () => {},
};

function toOpenSchemaValue(
  value: NonNullable<TrellisContractV1["schemas"]>[string],
): boolean | Record<string, unknown> {
  if (typeof value === "boolean") {
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Contract schemas must be objects or booleans");
  }
  return value;
}

function toRpcContract(
  contract: TrellisContractV1,
): TrellisContractGetResponse["contract"] {
  return {
    format: contract.format,
    id: contract.id,
    displayName: contract.displayName,
    description: contract.description,
    kind: contract.kind,
    ...(contract.schemas
      ? {
        schemas: Object.fromEntries(
          Object.entries(contract.schemas).map((
            [name, value],
          ) => [name, toOpenSchemaValue(value)]),
        ),
      }
      : {}),
    ...(contract.exports ? { exports: contract.exports } : {}),
    ...(contract.uses ? { uses: contract.uses } : {}),
    ...(contract.state ? { state: contract.state } : {}),
    ...(contract.rpc ? { rpc: contract.rpc } : {}),
    ...(contract.operations ? { operations: contract.operations } : {}),
    ...(contract.events ? { events: contract.events } : {}),
    ...(contract.subjects ? { subjects: contract.subjects } : {}),
    ...(contract.errors ? { errors: contract.errors } : {}),
    ...(contract.jobs ? { jobs: contract.jobs } : {}),
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

type ServiceContext = {
  caller: { type: string; origin?: string; id?: string };
  sessionKey: string;
};

type DigestRequest = { digest: string };
type BindingsRequest = { contractId?: string; digest?: string };
type ListInstalledContractsRequest = {};

export function createTrellisCatalogHandler(
  contractStore: ContractStore,
  logger: CatalogLogger = noopLogger,
) {
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

export function createTrellisContractGetHandler(
  contractStore: ContractStore,
  logger: CatalogLogger = noopLogger,
) {
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

export function createTrellisBindingsGetHandler(opts: {
  serviceInstanceStorage: SqlServiceInstanceRepository;
  logger?: CatalogLogger;
}) {
  const logger = opts.logger ?? noopLogger;
  return async (
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

    const svc = await opts.serviceInstanceStorage.getByInstanceKey(sessionKey);
    if (!svc) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/service",
            message: "service principal not found",
          }],
        }),
      );
    }

    const input = req ?? {};
    if (input.contractId && svc.currentContractId !== input.contractId) {
      return Result.ok({ binding: undefined });
    }
    if (input.digest && svc.currentContractDigest !== input.digest) {
      return Result.ok({ binding: undefined });
    }

    if (
      !svc.currentContractId || !svc.currentContractDigest ||
      !svc.resourceBindings
    ) {
      return Result.ok({ binding: undefined });
    }

    return Result.ok({
      binding: {
        contractId: svc.currentContractId,
        digest: svc.currentContractDigest,
        resources: svc.resourceBindings,
      },
    });
  };
}

type InstalledContract = Static<typeof InstalledContractSchema>;
type InstalledContractDetail = Static<typeof InstalledContractDetailSchema>;

export function createAuthListInstalledContractsHandler(
  contractStorage: SqlContractStorageRepository,
  logger: CatalogLogger = noopLogger,
) {
  return async (
    _req: ListInstalledContractsRequest,
  ): Promise<Result<{ contracts: InstalledContract[] }, UnexpectedError>> => {
    logger.trace({ rpc: "Auth.ListInstalledContracts" }, "RPC request");
    try {
      const contracts = (await contractStorage.list()).map((entry) => ({
        digest: entry.digest,
        id: entry.id,
        displayName: entry.displayName,
        description: entry.description,
        installedAt: entry.installedAt.toISOString(),
        analysisSummary: entry
          .analysisSummary as InstalledContract["analysisSummary"],
      } satisfies InstalledContract));

      contracts.sort((left, right) =>
        String(right.installedAt).localeCompare(String(left.installedAt))
      );
      return Result.ok({ contracts });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: error }));
    }
  };
}

export function createAuthGetInstalledContractHandler(
  contractStorage: SqlContractStorageRepository,
  logger: CatalogLogger = noopLogger,
) {
  return async (
    req: DigestRequest,
  ): Promise<
    Result<{ contract: InstalledContractDetail }, ValidationError>
  > => {
    logger.trace(
      { rpc: "Auth.GetInstalledContract", digest: req.digest },
      "RPC request",
    );
    const entry = await contractStorage.get(req.digest);
    if (!entry) {
      return Result.err(
        new ValidationError({
          errors: [{ path: "/digest", message: "contract not found" }],
        }),
      );
    }

    const contractUnknown: unknown = JSON.parse(entry.contract);
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
        digest: entry.digest,
        id: entry.id,
        displayName: entry.displayName,
        description: entry.description,
        installedAt: entry.installedAt.toISOString(),
        analysisSummary: entry
          .analysisSummary as InstalledContractDetail["analysisSummary"],
        analysis: entry.analysis as InstalledContractDetail["analysis"],
        resources: entry.resources as InstalledContractDetail["resources"],
        contract: contractUnknown as InstalledContractDetail["contract"],
      },
    });
  };
}
