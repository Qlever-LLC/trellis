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
import type {
  DeploymentAuthority,
  DeploymentAuthorityMaterialization,
  DeploymentAuthoritySurfaceAction,
  DeploymentResourceBinding,
} from "../auth/schemas.ts";
import { hasRequiredCapabilities } from "./permissions.ts";
import type { ContractsModule } from "./runtime.ts";
import type { SqlContractStorageRepository } from "./storage.ts";
import type {
  SqlDeviceDeploymentRepository,
  SqlDeviceInstanceRepository,
  SqlImplementationOfferRepository,
  SqlServiceDeploymentRepository,
  SqlServiceInstanceRepository,
} from "../auth/storage.ts";
import type { AuthRuntimeDeps } from "../auth/runtime_deps.ts";
import { connectionFilterForSession } from "../auth/session/connections.ts";
import { analyzeContractProposal } from "../auth/contract_proposal_analysis.ts";

type CatalogLogger = {
  trace: (fields: Record<string, unknown>, message: string) => void;
};

const noopLogger: CatalogLogger = {
  trace: () => {},
};

function resourceKey(kind: string, alias: string): string {
  return `${kind}\u001f${alias}`;
}

function resourceBindingsForResponse(
  records: DeploymentResourceBinding[],
): Record<string, unknown> {
  const resources: Record<string, unknown> = {};
  const resourcesByKind: Record<string, Record<string, unknown>> = {};
  let jobsBinding:
    | {
      namespace: unknown;
      workStream?: unknown;
      queues: Record<string, Record<string, unknown>>;
    }
    | undefined;
  for (const record of records) {
    if (record.kind === "jobs") {
      const { namespace, workStream, ...queueBinding } = record.binding;
      jobsBinding ??= {
        namespace,
        ...(workStream !== undefined ? { workStream } : {}),
        queues: {},
      };
      jobsBinding.queues[record.alias] = queueBinding;
      continue;
    }

    const responseKind = record.kind === "event-consumer"
      ? "eventConsumers"
      : record.kind;
    resourcesByKind[responseKind] ??= {};
    resourcesByKind[responseKind][record.alias] = record.binding;
  }
  for (const [kind, bindings] of Object.entries(resourcesByKind)) {
    resources[kind] = bindings;
  }
  if (jobsBinding) resources.jobs = jobsBinding;
  return resources;
}

async function requestedMaterializedBindings(input: {
  contracts: Pick<
    ContractsModule,
    | "getContract"
    | "validateContract"
    | "getActiveEntries"
    | "getKnownEntriesByContractId"
  >;
  materializedAuthority: DeploymentAuthorityMaterialization;
  contractDigest: string;
}): Promise<DeploymentResourceBinding[]> {
  const contract = await input.contracts.getContract(input.contractDigest);
  if (!contract) return [];
  const analysis = await analyzeContractProposal(input.contracts, contract, {
    dependencyResolution: "known",
  });
  const requestedKeys = new Set(
    [
      ...analysis.required.resources,
      ...analysis.optional.resources,
      ...analysis.contributedAvailability.resources,
    ]
      .filter((resource) => resource.kind !== "transfer")
      .map((resource) => resourceKey(resource.kind, resource.alias)),
  );
  return input.materializedAuthority.resourceBindings.filter((binding) =>
    requestedKeys.has(resourceKey(binding.kind, binding.alias))
  );
}

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
    ...(contract.docs ? { docs: contract.docs } : {}),
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
type DeploymentAuthorityStorage = Pick<
  {
    listEnabledBySurface(surface: {
      contractId: string;
      kind: "rpc" | "operation" | "event" | "feed";
      name: string;
      action?: DeploymentAuthoritySurfaceAction;
    }): Promise<DeploymentAuthority[]>;
  },
  "listEnabledBySurface"
>;
type ImplementationOfferStorage = Pick<
  SqlImplementationOfferRepository,
  "listActiveByContractId" | "listByInstance"
>;

function offerIsActive(offer: {
  status: string;
  acceptedAt: string | null;
  staleAt: string | null;
  expiresAt: string | null;
}, evaluationTime: Date): boolean {
  const now = evaluationTime.toISOString();
  return offer.status === "accepted" && offer.acceptedAt !== null &&
    (offer.staleAt === null || offer.staleAt > now) &&
    (offer.expiresAt === null || offer.expiresAt > now);
}

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
): DeploymentAuthoritySurfaceAction {
  if (req.kind === "event") {
    return req.action === "publish" ? "publish" : "subscribe";
  }
  if (req.kind === "feed") return "subscribe";
  return "call";
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
  contractsModule: Pick<
    ContractsModule,
    "getActiveCatalogState"
  >,
  logger: CatalogLogger = noopLogger,
) {
  return async (): Promise<
    Result<{ catalog: TrellisCatalog }, UnexpectedError>
  > => {
    logger.trace({ rpc: "Trellis.Catalog" }, "RPC request");
    try {
      const { entries, issues } = await contractsModule.getActiveCatalogState();
      const contracts = entries
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
        {
          format: "trellis.catalog.v1",
          contracts,
          issues,
        },
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
  contracts: Pick<
    ContractsModule,
    | "getContract"
    | "validateContract"
    | "getActiveEntries"
    | "getKnownEntriesByContractId"
  >;
  serviceInstanceStorage: SqlServiceInstanceRepository;
  deploymentAuthorityStorage: {
    get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
  };
  materializedAuthorityStorage: {
    get(
      deploymentId: string,
    ): Promise<DeploymentAuthorityMaterialization | undefined>;
  };
  implementationOfferStorage: ImplementationOfferStorage;
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
    const now = new Date();
    const matchingOffer = (await opts.implementationOfferStorage.listByInstance(
      svc.instanceId,
    )).find((offer) =>
      offer.deploymentKind === "service" &&
      offer.deploymentId === svc.deploymentId &&
      offer.instanceId === svc.instanceId &&
      offerIsActive(offer, now) &&
      (input.contractId === undefined ||
        offer.contractId === input.contractId) &&
      (input.digest === undefined || offer.contractDigest === input.digest)
    );

    if (!matchingOffer) return Result.ok({ binding: undefined });

    const authority = await opts.deploymentAuthorityStorage.get(
      svc.deploymentId,
    );
    const materializedAuthority = await opts.materializedAuthorityStorage.get(
      svc.deploymentId,
    );
    if (
      !authority || authority.disabled || !materializedAuthority ||
      materializedAuthority.status !== "current" ||
      materializedAuthority.desiredVersion !== authority.version
    ) {
      return Result.ok({ binding: undefined });
    }

    const resources = resourceBindingsForResponse(
      await requestedMaterializedBindings({
        contracts: opts.contracts,
        materializedAuthority,
        contractDigest: matchingOffer.contractDigest,
      }),
    );

    return Result.ok({
      binding: {
        contractId: matchingOffer.contractId,
        digest: matchingOffer.contractDigest,
        resources,
      },
    });
  };
}

/** Creates the advisory runtime surface availability discovery RPC handler. */
export function createTrellisSurfaceStatusHandler(opts: {
  contracts: Pick<ContractsModule, "getKnownEntriesByContractId">;
  serviceInstanceStorage: Pick<
    SqlServiceInstanceRepository,
    "listByDeployments"
  >;
  serviceDeploymentStorage: Pick<SqlServiceDeploymentRepository, "get">;
  deviceInstanceStorage: Pick<
    SqlDeviceInstanceRepository,
    "listByDeploymentsAndStates"
  >;
  deviceDeploymentStorage: Pick<SqlDeviceDeploymentRepository, "get">;
  deploymentAuthorityStorage: DeploymentAuthorityStorage;
  implementationOfferStorage: ImplementationOfferStorage;
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
    const authorities = await opts.deploymentAuthorityStorage
      .listEnabledBySurface(
        {
          contractId: req.contractId,
          kind: req.kind,
          name: req.surface,
          action,
        },
      );
    const deploymentIds = authorities.map((authority) =>
      authority.deploymentId
    );
    const activeOffers = await opts.implementationOfferStorage
      .listActiveByContractId(req.contractId);
    const activeOffersByDeployment = new Map<string, Set<string>>();
    const activeServiceOffersByInstance = new Map<string, Set<string>>();
    for (const offer of activeOffers) {
      let digests = activeOffersByDeployment.get(offer.deploymentId);
      if (!digests) {
        digests = new Set();
        activeOffersByDeployment.set(offer.deploymentId, digests);
      }
      digests.add(offer.contractDigest);
      if (offer.deploymentKind === "service" && offer.instanceId) {
        let instanceDigests = activeServiceOffersByInstance.get(
          offer.instanceId,
        );
        if (!instanceDigests) {
          instanceDigests = new Set();
          activeServiceOffersByInstance.set(offer.instanceId, instanceDigests);
        }
        instanceDigests.add(offer.contractDigest);
      }
    }
    const availableAuthorities = authorities.filter((authority) =>
      (activeOffersByDeployment.get(authority.deploymentId)?.size ?? 0) > 0
    );
    const availableDigests = new Set(
      availableAuthorities.flatMap((authority) => {
        const digests = activeOffersByDeployment.get(authority.deploymentId);
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
        status: { state: "unavailable", reason: "authority_unavailable" },
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
      availableAuthorities
        .filter((authority) => {
          const digests = activeOffersByDeployment.get(authority.deploymentId);
          return digests !== undefined &&
            [...digests].some((digest) => authorizedDigests.has(digest));
        })
        .map((authority) => authority.deploymentId),
    );
    const instances = await opts.serviceInstanceStorage
      .listByDeployments(availableDeploymentIds);
    let sawDisabledImplementer = false;

    for (const instance of instances) {
      if (
        !availableDeploymentIds.has(instance.deploymentId) ||
        ![...(activeServiceOffersByInstance.get(instance.instanceId) ?? [])]
          .some((digest) => authorizedDigests.has(digest))
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
      const digests = activeOffersByDeployment.get(instance.deploymentId);
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
