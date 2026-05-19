import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { AuthRequestsValidateResponseSchema } from "@qlever-llc/trellis/auth";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { isErr, Result } from "@qlever-llc/result";
import type { StaticDecode } from "typebox";
import { Value } from "typebox/value";
import type { TrellisCatalog } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import { TrellisCatalogSchema } from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import type { TrellisContractGetResponse } from "../../../packages/trellis/models/trellis/rpc/TrellisContractGet.ts";
import type {
  TrellisSurfaceStatusRequest,
  TrellisSurfaceStatusResponse,
} from "../../../packages/trellis/models/trellis/rpc/TrellisSurfaceStatus.ts";
import { TrellisSurfaceStatusRequestSchema } from "../../../packages/trellis/models/trellis/rpc/TrellisSurfaceStatus.ts";
import type { EnvelopeSurfaceAction } from "../auth/schemas.ts";
import { hasRequiredCapabilities } from "./permissions.ts";
import type { ContractsModule } from "./runtime.ts";
import type { SqlContractStorageRepository } from "./storage.ts";
import type {
  SqlDeploymentContractEvidenceRepository,
  SqlDeploymentEnvelopeRepository,
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
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

type Caller = StaticDecode<typeof AuthRequestsValidateResponseSchema>["caller"];

type ServiceContext = {
  caller: Caller;
  sessionKey: string;
};

type SurfaceStatusContext = {
  caller: Caller;
  sessionKey: string;
};

type DigestRequest = { digest: string };
type BindingsRequest = { contractId?: string; digest?: string };
type ActiveEntry = { digest: string; contract: TrellisContractV1 };
type SurfaceCapabilities = {
  requiredCapabilities: string[];
  digestCapabilities: Array<{ digest: string; requiredCapabilities: string[] }>;
};
type DigestCapabilities = SurfaceCapabilities["digestCapabilities"][number];
type DeploymentEnvelopeStorage = Pick<
  SqlDeploymentEnvelopeRepository,
  "listEnabledByContractId" | "listEnabledBySurface"
>;
type DeploymentContractEvidenceStorage = Pick<
  SqlDeploymentContractEvidenceRepository,
  "listByDeploymentsAndContractId"
>;

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
    if (req.action === undefined || req.action === "read") {
      return Result.ok(undefined);
    }
    return Result.err(
      validationError(
        "/action",
        "feed surfaces only allow action 'read'",
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
  const digestCapabilities: Array<{
    digest: string;
    requiredCapabilities: string[];
  }> = [];

  for (const { digest, contract } of entries) {
    if (req.kind === "rpc") {
      const surface = contract.rpc?.[req.surface];
      if (surface) {
        digestCapabilities.push({
          digest,
          requiredCapabilities: sortedUnique(surface.capabilities?.call ?? []),
        });
      }
      continue;
    }

    if (req.kind === "operation") {
      const surface = contract.operations?.[req.surface];
      if (surface) {
        digestCapabilities.push({
          digest,
          requiredCapabilities: sortedUnique(surface.capabilities?.call ?? []),
        });
      }
      continue;
    }

    if (req.kind === "feed") {
      const surface = contract.feeds?.[req.surface];
      if (surface) {
        digestCapabilities.push({
          digest,
          requiredCapabilities: sortedUnique(
            surface.capabilities?.subscribe ?? [],
          ),
        });
      }
      continue;
    }

    const surface = contract.events?.[req.surface];
    if (!surface) continue;
    digestCapabilities.push({
      digest,
      requiredCapabilities: sortedUnique(
        req.action === "publish"
          ? surface.capabilities?.publish ?? []
          : surface.capabilities?.subscribe ?? [],
      ),
    });
  }

  if (digestCapabilities.length === 0) return Result.ok(undefined);
  return Result.ok({
    requiredCapabilities: sortedUnique(
      digestCapabilities.flatMap((entry) => entry.requiredCapabilities),
    ),
    digestCapabilities,
  });
}

function defaultSurfaceAction(
  req: TrellisSurfaceStatusRequest,
): EnvelopeSurfaceAction {
  if (req.kind === "event") return req.action ?? "subscribe";
  if (req.kind === "feed") return "read";
  return "call";
}

function evidenceDigestsByDeployment(
  evidence: Array<
    { deploymentId: string; contractId: string; contractDigest: string }
  >,
): Map<string, Map<string, Set<string>>> {
  const byDeployment = new Map<string, Map<string, Set<string>>>();
  for (const record of evidence) {
    let byContract = byDeployment.get(record.deploymentId);
    if (!byContract) {
      byContract = new Map();
      byDeployment.set(record.deploymentId, byContract);
    }
    let digests = byContract.get(record.contractId);
    if (!digests) {
      digests = new Set();
      byContract.set(record.contractId, digests);
    }
    digests.add(record.contractDigest);
  }
  return byDeployment;
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
  contractsModule: Pick<ContractsModule, "getActiveEntries">,
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage,
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage,
  logger: CatalogLogger = noopLogger,
) {
  return async (): Promise<
    Result<{ catalog: TrellisCatalog }, UnexpectedError>
  > => {
    logger.trace({ rpc: "Trellis.Catalog" }, "RPC request");
    try {
      const entries = await contractsModule.getActiveEntries();
      const availableEntries: ActiveEntry[] = [];
      for (const entry of entries) {
        const envelopes = await deploymentEnvelopeStorage
          .listEnabledByContractId(entry.contract.id);
        const deploymentIds = envelopes.map((envelope) =>
          envelope.deploymentId
        );
        const evidence = await deploymentContractEvidenceStorage
          .listByDeploymentsAndContractId(deploymentIds, entry.contract.id);
        if (
          evidence.some((record) => record.contractDigest === entry.digest)
        ) {
          availableEntries.push(entry);
        }
      }
      const contracts = availableEntries
        .map(({ digest, contract }) => ({
          id: contract.id,
          digest,
          displayName: contract.displayName,
          description: contract.description,
        }))
        .sort((left, right) =>
          left.id.localeCompare(right.id) ||
          left.digest.localeCompare(right.digest)
        );
      const catalog = Value.Parse(
        TrellisCatalogSchema,
        { format: "trellis.catalog.v1", contracts },
      ) as TrellisCatalog;
      return Result.ok({ catalog });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: error }));
    }
  };
}

export function createTrellisContractGetHandler(
  contractsModule: Pick<ContractsModule, "getKnownContract">,
  logger: CatalogLogger = noopLogger,
) {
  return async (
    req: DigestRequest,
  ): Promise<Result<TrellisContractGetResponse, ValidationError>> => {
    logger.trace(
      { rpc: "Trellis.Contract.Get", digest: req.digest },
      "RPC request",
    );
    const contract = await contractsModule.getKnownContract(req.digest);
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
  contracts: Pick<ContractsModule, "getKnownEntriesByContractId">;
  serviceInstanceStorage: Pick<
    SqlServiceInstanceRepository,
    "listByDeploymentAndDigest"
  >;
  serviceDeploymentStorage: Pick<SqlServiceDeploymentRepository, "get">;
  deviceInstanceStorage: Pick<
    SqlDeviceInstanceRepository,
    "listByDeploymentsAndStates"
  >;
  deviceDeploymentStorage: Pick<SqlDeviceDeploymentRepository, "get">;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  deploymentContractEvidenceStorage: DeploymentContractEvidenceStorage;
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

    const entries = await opts.contracts.getKnownEntriesByContractId(
      req.contractId,
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
    const action = defaultSurfaceAction(req);
    const envelopes = await opts.deploymentEnvelopeStorage.listEnabledBySurface(
      {
        contractId: req.contractId,
        kind: req.kind,
        name: req.surface,
        action,
      },
    );
    const deploymentIds = envelopes.map((envelope) => envelope.deploymentId);
    const evidenceByDeployment = evidenceDigestsByDeployment(
      await opts.deploymentContractEvidenceStorage
        .listByDeploymentsAndContractId(deploymentIds, req.contractId),
    );
    const availableEnvelopes = envelopes.filter((envelope) =>
      (evidenceByDeployment.get(envelope.deploymentId)?.get(req.contractId)
        ?.size ?? 0) > 0
    );
    const availableDigests = new Set(
      availableEnvelopes.flatMap((envelope) => {
        const digests = evidenceByDeployment.get(envelope.deploymentId)?.get(
          req.contractId,
        );
        return digests ? [...digests] : [];
      }),
    );
    const authorizedDigests = new Set<string>();
    const candidateCapabilities: DigestCapabilities[] = surfaceCapabilities
      .digestCapabilities.filter((entry: DigestCapabilities) =>
        availableDigests.has(entry.digest)
      );
    if (candidateCapabilities.length === 0) {
      return Result.ok({
        status: { state: "unavailable", reason: "envelope_unavailable" },
      });
    }

    for (const candidate of candidateCapabilities) {
      if (
        hasRequiredCapabilities(
          caller.capabilities,
          candidate.requiredCapabilities,
        )
      ) {
        authorizedDigests.add(candidate.digest);
      }
    }
    if (authorizedDigests.size === 0) {
      const callerCapabilities = new Set(caller.capabilities);
      return Result.ok({
        status: {
          state: "unauthorized",
          missingCapabilities: sortedUnique(
            candidateCapabilities.flatMap((candidate: DigestCapabilities) =>
              candidate.requiredCapabilities.filter((capability: string) =>
                !callerCapabilities.has(capability)
              )
            ),
          ),
        },
      });
    }

    const availableDeploymentIds = new Set(
      availableEnvelopes
        .filter((envelope) => {
          const digests = evidenceByDeployment.get(envelope.deploymentId)?.get(
            req.contractId,
          );
          return digests !== undefined &&
            [...digests].some((digest) => authorizedDigests.has(digest));
        })
        .map((envelope) => envelope.deploymentId),
    );
    const instances = await opts.serviceInstanceStorage
      .listByDeploymentAndDigest(availableDeploymentIds, authorizedDigests);
    let sawDisabledImplementer = false;

    for (const instance of instances) {
      if (
        !instance.currentContractDigest ||
        !authorizedDigests.has(instance.currentContractDigest) ||
        !availableDeploymentIds.has(instance.deploymentId)
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
        return Result.ok({
          status: {
            state: "available",
            liveImplementer: true,
            runtime: "live",
          },
        });
      }
    }

    const deviceInstances = await opts.deviceInstanceStorage
      .listByDeploymentsAndStates(availableDeploymentIds, [
        "registered",
        "activated",
      ]);
    for (const instance of deviceInstances) {
      if (!availableDeploymentIds.has(instance.deploymentId)) continue;
      const digests = evidenceByDeployment.get(instance.deploymentId)?.get(
        req.contractId,
      );
      if (
        digests === undefined ||
        ![...digests].some((digest) => authorizedDigests.has(digest))
      ) continue;

      const deployment = await opts.deviceDeploymentStorage.get(
        instance.deploymentId,
      );
      if (
        instance.state === "disabled" || instance.state === "revoked" ||
        !deployment || deployment.disabled
      ) {
        sawDisabledImplementer = true;
        continue;
      }

      return Result.ok({
        status: {
          state: "available",
          liveImplementer: true,
          runtime: "live",
        },
      });
    }

    return Result.ok({
      status: {
        state: "available",
        liveImplementer: false,
        runtime: sawDisabledImplementer ? "disabled" : "no_live_implementer",
      },
    });
  };
}
