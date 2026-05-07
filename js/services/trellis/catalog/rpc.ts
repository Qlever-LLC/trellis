import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import type {
  InstalledContractDetailSchema,
  InstalledContractSchema,
} from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { isErr, Result } from "@qlever-llc/result";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { TrellisCatalog } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import { TrellisCatalogSchema } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import type { TrellisContractGetResponse } from "../../../packages/trellis/models/trellis/rpc/TrellisContractGet.ts";
import type {
  TrellisSurfaceStatusRequest,
  TrellisSurfaceStatusResponse,
} from "../../../packages/trellis/models/trellis/rpc/TrellisSurfaceStatus.ts";
import { TrellisSurfaceStatusRequestSchema } from "../../../packages/trellis/models/trellis/rpc/TrellisSurfaceStatus.ts";
import { hasRequiredCapabilities } from "./permissions.ts";
import { ContractStore } from "./store.ts";
import type { SqlContractStorageRepository } from "./storage.ts";
import type {
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../auth/storage.ts";
import type { AuthRuntimeDeps } from "../auth/runtime_deps.ts";
import { connectionFilterForSession } from "../auth/session/connections.ts";

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
    ...(contract.errors ? { errors: contract.errors } : {}),
    ...(contract.jobs ? { jobs: contract.jobs } : {}),
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

type ServiceContext = {
  caller: { type: string; origin?: string; id?: string };
  sessionKey: string;
};

type SurfaceStatusContext = {
  caller: {
    type: string;
    origin?: string;
    id?: string;
    capabilities: string[];
  };
  sessionKey: string;
};

type DigestRequest = { digest: string };
type BindingsRequest = { contractId?: string; digest?: string };
type ListInstalledContractsRequest = {};
type ActiveEntry = { digest: string; contract: TrellisContractV1 };
type SurfaceCapabilities = {
  requiredCapabilities: string[];
  surfaceDigests: string[];
};

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validationError(path: string, message: string): ValidationError {
  return new ValidationError({ errors: [{ path, message }] });
}

function validateSurfaceStatusAction(
  req: TrellisSurfaceStatusRequest,
): Result<void, ValidationError> {
  if (req.kind === "event") {
    if (req.action === "publish" || req.action === "subscribe") {
      return Result.ok(undefined);
    }
    return Result.err(
      validationError(
        "/action",
        "event surfaces require action 'publish' or 'subscribe'",
      ),
    );
  }

  if (req.kind === "feed") {
    if (req.action === undefined || req.action === "subscribe") {
      return Result.ok(undefined);
    }
    return Result.err(
      validationError(
        "/action",
        "feed surfaces only allow action 'subscribe'",
      ),
    );
  }

  if (req.action === undefined || req.action === "call") {
    return Result.ok(undefined);
  }
  return Result.err(
    validationError("/action", `${req.kind} surfaces only allow action 'call'`),
  );
}

function requiredSurfaceCapabilities(
  entries: ActiveEntry[],
  req: TrellisSurfaceStatusRequest,
): Result<SurfaceCapabilities | undefined, ValidationError> {
  const requiredCapabilities: string[] = [];
  const surfaceDigests: string[] = [];

  for (const { digest, contract } of entries) {
    if (req.kind === "rpc") {
      const surface = contract.rpc?.[req.surface];
      if (surface) {
        surfaceDigests.push(digest);
        requiredCapabilities.push(...(surface.capabilities?.call ?? []));
      }
      continue;
    }

    if (req.kind === "operation") {
      const surface = contract.operations?.[req.surface];
      if (surface) {
        surfaceDigests.push(digest);
        requiredCapabilities.push(...(surface.capabilities?.call ?? []));
      }
      continue;
    }

    if (req.kind === "feed") {
      const surface = contract.feeds?.[req.surface];
      if (surface) {
        surfaceDigests.push(digest);
        requiredCapabilities.push(...(surface.capabilities?.subscribe ?? []));
      }
      continue;
    }

    const surface = contract.events?.[req.surface];
    if (!surface) continue;
    surfaceDigests.push(digest);
    requiredCapabilities.push(
      ...(req.action === "publish"
        ? surface.capabilities?.publish ?? []
        : surface.capabilities?.subscribe ?? []),
    );
  }

  if (surfaceDigests.length === 0) return Result.ok(undefined);
  return Result.ok({
    requiredCapabilities: sortedUnique(requiredCapabilities),
    surfaceDigests: sortedUnique(surfaceDigests),
  });
}

async function hasLiveConnection(
  connectionsKV: AuthRuntimeDeps["connectionsKV"],
  instanceKey: string,
): Promise<boolean> {
  const keys = await connectionsKV.keys(
    connectionFilterForSession(instanceKey),
  ).take();
  if (isErr(keys)) return false;

  for await (const _key of keys) {
    return true;
  }
  return false;
}

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

/** Creates the advisory runtime surface availability discovery RPC handler. */
export function createTrellisSurfaceStatusHandler(opts: {
  contractStore: ContractStore;
  serviceInstanceStorage: Pick<SqlServiceInstanceRepository, "list">;
  serviceDeploymentStorage: Pick<SqlServiceDeploymentRepository, "get">;
  connectionsKV: AuthRuntimeDeps["connectionsKV"];
  logger?: CatalogLogger;
}) {
  const logger = opts.logger ?? noopLogger;
  return async (
    rawReq: TrellisSurfaceStatusRequest,
    { caller, sessionKey }: SurfaceStatusContext,
  ): Promise<
    Result<TrellisSurfaceStatusResponse, ValidationError | UnexpectedError>
  > => {
    logger.trace(
      { rpc: "Trellis.Surface.Status", caller, sessionKey },
      "RPC request",
    );

    let req: TrellisSurfaceStatusRequest;
    try {
      req = Value.Parse(TrellisSurfaceStatusRequestSchema, rawReq);
    } catch (error) {
      return Result.err(
        new ValidationError({
          errors: [{ path: "/", message: "invalid surface status request" }],
          context: { cause: error },
        }),
      );
    }

    const actionResult = validateSurfaceStatusAction(req);
    if (actionResult.isErr()) return actionResult;

    const entries = opts.contractStore.getActiveEntries().filter((entry) =>
      entry.contract.id === req.contractId
    );
    if (entries.length === 0) {
      return Result.ok({
        status: { state: "unknown_contract", contractId: req.contractId },
      });
    }

    const capabilitiesResult = requiredSurfaceCapabilities(entries, req);
    if (capabilitiesResult.isErr()) return capabilitiesResult;
    const capabilitiesTaken = capabilitiesResult.take();
    if (isErr(capabilitiesTaken)) return capabilitiesTaken;
    const surfaceCapabilities = capabilitiesTaken;
    if (!surfaceCapabilities) {
      return Result.ok({
        status: {
          state: "unknown_surface",
          contractId: req.contractId,
          kind: req.kind,
          surface: req.surface,
        },
      });
    }
    const { requiredCapabilities } = surfaceCapabilities;

    if (!hasRequiredCapabilities(caller.capabilities, requiredCapabilities)) {
      const callerCapabilities = new Set(caller.capabilities);
      return Result.ok({
        status: {
          state: "unauthorized",
          missingCapabilities: requiredCapabilities.filter((capability) =>
            !callerCapabilities.has(capability)
          ),
        },
      });
    }

    const activeDigests = new Set(surfaceCapabilities.surfaceDigests);
    const instances = await opts.serviceInstanceStorage.list();
    let sawDisabledImplementer = false;

    for (const instance of instances) {
      if (
        !instance.currentContractDigest ||
        !activeDigests.has(instance.currentContractDigest)
      ) {
        continue;
      }

      const deployment = await opts.serviceDeploymentStorage.get(
        instance.deploymentId,
      );
      if (instance.disabled || !deployment || deployment.disabled) {
        sawDisabledImplementer = true;
        continue;
      }

      if (await hasLiveConnection(opts.connectionsKV, instance.instanceKey)) {
        return Result.ok({ status: { state: "available" } });
      }
    }

    return Result.ok({
      status: {
        state: "unavailable",
        reason: sawDisabledImplementer ? "disabled" : "no_live_implementer",
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
