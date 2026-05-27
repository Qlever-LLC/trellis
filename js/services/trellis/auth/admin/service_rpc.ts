import {
  AuthError,
  UnexpectedError,
  ValidationError,
} from "@qlever-llc/trellis";
import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";
import { AuthRequestsValidateResponseSchema } from "@qlever-llc/trellis/auth";
import {
  createNatsResourcePurgeManager,
  type PurgeableContractResourceBindings,
  purgeContractResourceBindings,
} from "../../catalog/resources.ts";

import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import {
  type Connection,
  type DeploymentEnvelope,
  type DeploymentResourceBinding,
  type EnvelopeBoundary,
  type IdentityEnvelopeRecord,
  ServiceInstanceSchema,
} from "../schemas.ts";
import type {
  BoundedListQuery,
  ListPage,
  SqlSessionRepository,
} from "../storage.ts";
import type { StaticDecode } from "typebox";
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";
import {
  collectDeploymentContractEvidenceDigests,
  purgeUnusedInstalledContracts,
} from "./contract_gc.ts";
import {
  type AdminCaller,
  requireAdmin,
  type ServiceDeployment,
  validateServiceDeploymentRequest,
  validateServiceProvisionRequest,
} from "./shared.ts";

type ServiceInstance = StaticDecode<typeof ServiceInstanceSchema>;

type RpcUser =
  & StaticDecode<
    typeof AuthRequestsValidateResponseSchema
  >["caller"]
  & AdminCaller;

const EMPTY_BOUNDARY: EnvelopeBoundary = {
  contracts: [],
  surfaces: [],
  capabilities: [],
  resources: [],
};

type ServiceDeploymentStorage = {
  get(deploymentId: string): Promise<ServiceDeployment | undefined>;
  put(record: ServiceDeployment): Promise<void>;
  delete(deploymentId: string): Promise<void>;
  listPage(query: BoundedListQuery): Promise<ServiceDeployment[]>;
  listFiltered(
    filters: { disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<ServiceDeployment[]>;
  listFilteredPage(
    filters: { disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<ListPage<ServiceDeployment>>;
  listByDeploymentIds?(
    deploymentIds: Iterable<string>,
    filters?: { disabled?: boolean },
  ): Promise<ServiceDeployment[]>;
};
type ServiceInstanceStorage = {
  get(instanceId: string): Promise<ServiceInstance | undefined>;
  getByInstanceKey(instanceKey: string): Promise<ServiceInstance | undefined>;
  put(record: ServiceInstance): Promise<void>;
  delete(instanceId: string): Promise<void>;
  listPage(query: BoundedListQuery): Promise<ServiceInstance[]>;
  listFiltered(
    filters: { disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<ServiceInstance[]>;
  listFilteredPage(
    filters: { deploymentId?: string; disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<ListPage<ServiceInstance>>;
  listByCurrentContractDigests?(
    contractDigests: Iterable<string>,
  ): Promise<ServiceInstance[]>;
  listByDeployment(
    deploymentId: string,
    filters?: { disabled?: boolean },
  ): Promise<ServiceInstance[]>;
};
type RuntimeKickDeps = {
  connectionsKV: KVLike<Connection>;
  sessionStorage:
    & Pick<SqlSessionRepository, "deleteByInstanceKey">
    & Partial<
      Pick<SqlSessionRepository, "listEntries" | "listEntriesByContractDigests">
    >;
};
type InstalledContractCleanupDeps = {
  builtinContractDigests?: Iterable<string>;
  contractStorage?: { delete(digest: string): Promise<void> };
  deviceDeploymentStorage?: {
    listByDeploymentIds?(
      deploymentIds: Iterable<string>,
      filters?: { disabled?: boolean },
    ): Promise<Array<{ deploymentId: string; disabled?: boolean }>>;
  };
  deploymentContractEvidenceStorage?: {
    listByDeployment(deploymentId: string): Promise<
      Array<
        { deploymentId: string; contractId: string; contractDigest: string }
      >
    >;
    listByDigests?(contractDigests: Iterable<string>): Promise<
      Array<
        { deploymentId: string; contractId: string; contractDigest: string }
      >
    >;
  };
  contractApprovalStorage?: {
    listByApprovalEvidenceContractDigests?(
      contractDigests: Iterable<string>,
    ): Promise<IdentityEnvelopeRecord[]>;
  };
};
type DeploymentResourceBindingStorage = {
  listByDeployment(deploymentId: string): Promise<DeploymentResourceBinding[]>;
};
type ActiveCatalogValidator = (validationOpts: {
  extraActiveDigests?: Iterable<string>;
  stagedServiceDeployments?: Iterable<ServiceDeployment>;
  stagedServiceInstances?: Iterable<ServiceInstance>;
  stagedDeploymentEnvelopes?: Iterable<DeploymentEnvelope>;
}) => Promise<unknown>;
type ActiveContractsRefresher = (
  validationOpts?: Parameters<ActiveCatalogValidator>[0],
) => Promise<void>;
type DeploymentEnvelopeStorage = {
  get(deploymentId: string): Promise<DeploymentEnvelope | undefined>;
  put(record: DeploymentEnvelope): Promise<void>;
};

export type ServiceAdminRpcDeps = {
  logger:
    & Pick<AuthRuntimeDeps["logger"], "trace">
    & Partial<Pick<AuthRuntimeDeps["logger"], "warn">>;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  serviceInstanceStorage: ServiceInstanceStorage;
  deploymentEnvelopeStorage?: DeploymentEnvelopeStorage;
};

type KVLike<V> = {
  get: (
    key: string,
  ) => AsyncResult<{ value: V } | Result<never, BaseError>, BaseError>;
  put: (
    key: string,
    value: V,
  ) => AsyncResult<void | Result<never, BaseError>, BaseError>;
  delete: (
    key: string,
  ) => AsyncResult<void | Result<never, BaseError>, BaseError>;
  keys: (
    filter: string,
  ) => AsyncResult<AsyncIterable<string> | Result<never, BaseError>, BaseError>;
};

function invalid(
  path: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return Result.err(
    new ValidationError({
      errors: [{ path, message }],
      ...(context ? { context } : {}),
    }),
  );
}

async function kickInstanceRuntimeAccess(args: {
  instanceKey: string;
  connectionsKV: KVLike<Connection>;
  sessionStorage: Pick<SqlSessionRepository, "deleteByInstanceKey">;
  kick: (serverId: string, clientId: number) => Promise<void>;
}): Promise<void> {
  await revokeRuntimeAccessForSession({
    sessionKey: args.instanceKey,
    connectionsKV: args.connectionsKV,
    kick: args.kick,
    deleteSession: () =>
      args.sessionStorage.deleteByInstanceKey(args.instanceKey),
  });
}

async function instancesForDeployment(
  deploymentId: string,
  store: ServiceInstanceStorage,
): Promise<ServiceInstance[]> {
  return await store.listByDeployment(deploymentId);
}

async function refreshActiveContracts(
  refresh: ActiveContractsRefresher,
  validationOpts?: Parameters<ActiveCatalogValidator>[0],
): Promise<Result<void, UnexpectedError>> {
  try {
    await refresh(validationOpts);
    return Result.ok(undefined);
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
}

async function validateActiveCatalog(
  validate: ActiveCatalogValidator,
  validationOpts: Parameters<ActiveCatalogValidator>[0],
): Promise<Result<void, UnexpectedError>> {
  try {
    await validate(validationOpts);
    return Result.ok(undefined);
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
}

async function setDeploymentEnvelopeDisabled(args: {
  storage: DeploymentEnvelopeStorage;
  deploymentId: string;
  disabled: boolean;
  now?: string;
}): Promise<DeploymentEnvelope> {
  const envelope = await args.storage.get(args.deploymentId);
  if (!envelope) throw new Error("deployment envelope not found");
  if (envelope.disabled === args.disabled) return envelope;
  await args.storage.put({
    ...envelope,
    disabled: args.disabled,
    updatedAt: args.now ?? new Date().toISOString(),
  });
  return envelope;
}

async function setDeploymentEnvelopeDisabledIfPresent(args: {
  storage: DeploymentEnvelopeStorage;
  deploymentId: string;
  disabled: boolean;
  now?: string;
}): Promise<void> {
  let envelope: DeploymentEnvelope | undefined;
  try {
    envelope = await args.storage.get(args.deploymentId);
  } catch {
    return;
  }
  if (!envelope || envelope.disabled === args.disabled) return;
  await args.storage.put({
    ...envelope,
    disabled: args.disabled,
    updatedAt: args.now ?? new Date().toISOString(),
  });
}

async function rollbackRefreshFailure<T>(
  refreshError: UnexpectedError,
  rollback: () => Promise<void>,
): Promise<Result<T, UnexpectedError>> {
  try {
    await rollback();
  } catch (rollbackError) {
    return Result.err(
      new UnexpectedError({
        cause: new AggregateError(
          [refreshError, toError(rollbackError)],
          "active catalog refresh failed and rollback failed",
        ),
      }),
    );
  }
  return Result.err(refreshError);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function missingInstalledContractCleanupDependency(
  name: string,
): UnexpectedError {
  return new UnexpectedError({
    cause: new Error(`unused contract cleanup requires ${name}`),
  });
}

function stringField(
  value: Record<string, unknown>,
  field: string,
): string | undefined {
  const fieldValue = value[field];
  return typeof fieldValue === "string" && fieldValue.length > 0
    ? fieldValue
    : undefined;
}

function deploymentResourceBindingsToPurgeable(
  bindings: DeploymentResourceBinding[],
): PurgeableContractResourceBindings[] {
  const purgeable: PurgeableContractResourceBindings = {};
  for (const binding of bindings) {
    if (binding.kind === "kv") {
      const bucket = stringField(binding.binding, "bucket");
      if (bucket) {
        purgeable.kv ??= {};
        purgeable.kv[binding.alias] = {
          bucket,
          history: typeof binding.binding.history === "number"
            ? binding.binding.history
            : 0,
          ttlMs: typeof binding.binding.ttlMs === "number"
            ? binding.binding.ttlMs
            : 0,
          ...(typeof binding.binding.maxValueBytes === "number"
            ? { maxValueBytes: binding.binding.maxValueBytes }
            : {}),
        };
      }
      continue;
    }
    if (binding.kind === "store") {
      const name = stringField(binding.binding, "name");
      if (name) {
        purgeable.store ??= {};
        purgeable.store[binding.alias] = {
          name,
          ttlMs: typeof binding.binding.ttlMs === "number"
            ? binding.binding.ttlMs
            : 0,
          ...(typeof binding.binding.maxTotalBytes === "number"
            ? { maxTotalBytes: binding.binding.maxTotalBytes }
            : {}),
        };
      }
    }
  }
  return [purgeable];
}

function buildInstalledContractCleanupDeps(
  deps:
    & {
      serviceDeploymentStorage: ServiceDeploymentStorage;
      serviceInstanceStorage: ServiceInstanceStorage;
    }
    & RuntimeKickDeps
    & InstalledContractCleanupDeps,
):
  | { ok: true; deps: Parameters<typeof purgeUnusedInstalledContracts>[1] }
  | { ok: false; error: UnexpectedError } {
  if (!deps.contractStorage) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency("contractStorage"),
    };
  }
  if (!deps.deviceDeploymentStorage) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "deviceDeploymentStorage",
      ),
    };
  }
  if (!deps.contractApprovalStorage) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "contractApprovalStorage",
      ),
    };
  }
  if (!deps.deploymentContractEvidenceStorage) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "deploymentContractEvidenceStorage",
      ),
    };
  }
  if (!deps.serviceDeploymentStorage.listByDeploymentIds) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "serviceDeploymentStorage.listByDeploymentIds",
      ),
    };
  }
  if (!deps.deviceDeploymentStorage.listByDeploymentIds) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "deviceDeploymentStorage.listByDeploymentIds",
      ),
    };
  }
  if (!deps.deploymentContractEvidenceStorage.listByDigests) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "deploymentContractEvidenceStorage.listByDigests",
      ),
    };
  }
  if (!deps.serviceInstanceStorage.listByCurrentContractDigests) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "serviceInstanceStorage.listByCurrentContractDigests",
      ),
    };
  }
  if (!deps.sessionStorage.listEntriesByContractDigests) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "sessionStorage.listEntriesByContractDigests",
      ),
    };
  }
  if (!deps.contractApprovalStorage.listByApprovalEvidenceContractDigests) {
    return {
      ok: false,
      error: missingInstalledContractCleanupDependency(
        "contractApprovalStorage.listByApprovalEvidenceContractDigests",
      ),
    };
  }
  const serviceDeploymentStorage = deps.serviceDeploymentStorage
    .listByDeploymentIds;
  const deviceDeploymentStorage = deps.deviceDeploymentStorage
    .listByDeploymentIds;
  const listEvidenceByDigests = deps.deploymentContractEvidenceStorage
    .listByDigests;
  const listInstancesByDigest = deps.serviceInstanceStorage
    .listByCurrentContractDigests;
  const listSessionsByDigest = deps.sessionStorage.listEntriesByContractDigests;
  const listApprovalsByDigest = deps.contractApprovalStorage
    .listByApprovalEvidenceContractDigests;
  return {
    ok: true,
    deps: {
      builtinContractDigests: deps.builtinContractDigests ?? [],
      contractStorage: deps.contractStorage,
      serviceDeploymentStorage: {
        listByDeploymentIds: (deploymentIds, filters) =>
          serviceDeploymentStorage.call(
            deps.serviceDeploymentStorage,
            deploymentIds,
            filters,
          ),
      },
      deviceDeploymentStorage: {
        listByDeploymentIds: (deploymentIds, filters) =>
          deviceDeploymentStorage.call(
            deps.deviceDeploymentStorage,
            deploymentIds,
            filters,
          ),
      },
      deploymentContractEvidenceStorage: {
        listByDigests: (contractDigests) =>
          listEvidenceByDigests.call(
            deps.deploymentContractEvidenceStorage,
            contractDigests,
          ),
      },
      serviceInstanceStorage: {
        listByCurrentContractDigests: (contractDigests) =>
          listInstancesByDigest.call(
            deps.serviceInstanceStorage,
            contractDigests,
          ),
      },
      sessionStorage: {
        listEntriesByContractDigests: (contractDigests) =>
          listSessionsByDigest.call(deps.sessionStorage, contractDigests),
      },
      contractApprovalStorage: {
        listByApprovalEvidenceContractDigests: (contractDigests) =>
          listApprovalsByDigest.call(
            deps.contractApprovalStorage,
            contractDigests,
          ),
      },
    },
  };
}

export function createAuthDeploymentsServiceListHandler(
  serviceDeps: ServiceAdminRpcDeps,
) {
  return async (
    { input: req, context: { caller } }: {
      input: BoundedListQuery & { disabled?: boolean };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<ListPage<ServiceDeployment>, AuthError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const { logger, serviceDeploymentStorage } = serviceDeps;
    logger.trace(
      { rpc: "Auth.Deployments.List", kind: "service", caller },
      "RPC request",
    );
    try {
      const deployments = await serviceDeploymentStorage.listFilteredPage({
        disabled: req.disabled,
      }, req);
      return Result.ok(deployments);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

export function createAuthDeploymentsServiceCreateHandler(
  serviceDeps: ServiceAdminRpcDeps,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: {
        deploymentId: string;
        namespaces: string[];
        contractCompatibilityMode?: "strict" | "mutable-dev";
      };
      context: { caller: RpcUser };
    },
  ) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const { logger, serviceDeploymentStorage } = serviceDeps;
    logger.trace({
      rpc: "Auth.Deployments.Create",
      kind: "service",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");
    const validated = validateServiceDeploymentRequest(req).take();
    if (isErr(validated)) return Result.err(validated.error);
    const { deployment } = validated;

    const existing = await serviceDeploymentStorage.get(
      deployment.deploymentId,
    );
    if (existing) {
      return invalid("/deploymentId", "service deployment already exists", {
        deploymentId: deployment.deploymentId,
      });
    }

    try {
      await serviceDeploymentStorage.put(deployment);
      if (serviceDeps.deploymentEnvelopeStorage) {
        const existingEnvelope = await serviceDeps.deploymentEnvelopeStorage
          .get(
            deployment.deploymentId,
          );
        if (!existingEnvelope) {
          const now = new Date().toISOString();
          await serviceDeps.deploymentEnvelopeStorage.put({
            deploymentId: deployment.deploymentId,
            kind: "service",
            disabled: false,
            createdAt: now,
            updatedAt: now,
            boundary: EMPTY_BOUNDARY,
          });
        }
      }
    } catch (error) {
      await serviceDeploymentStorage.delete(deployment.deploymentId).catch(() =>
        undefined
      );
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    return Result.ok({ deployment });
  };
}

export function createAuthDeploymentsServiceDisableHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: ActiveCatalogValidator;
    validateActiveCatalogForRemoval?: ActiveCatalogValidator;
    serviceDeploymentStorage: ServiceDeploymentStorage;
    serviceInstanceStorage: ServiceInstanceStorage;
    deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const {
      deploymentEnvelopeStorage,
      serviceDeploymentStorage,
      serviceInstanceStorage,
    } = deps;
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeployment = { ...deployment, disabled: true };
    const deploymentEnvelope = await deploymentEnvelopeStorage.get(
      req.deploymentId,
    );
    if (!deploymentEnvelope) {
      return invalid("/deploymentId", "deployment envelope not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeploymentEnvelope = {
      ...deploymentEnvelope,
      disabled: true,
    };
    const validated = await validateActiveCatalog(
      deps.validateActiveCatalogForRemoval ?? deps.validateActiveCatalog,
      {
        stagedServiceDeployments: [nextDeployment],
        stagedDeploymentEnvelopes: [nextDeploymentEnvelope],
      },
    );
    if (isErr(validated)) return validated;
    try {
      await serviceDeploymentStorage.put(nextDeployment);
      await setDeploymentEnvelopeDisabled({
        storage: deploymentEnvelopeStorage,
        deploymentId: nextDeployment.deploymentId,
        disabled: true,
      });
    } catch (error) {
      await serviceDeploymentStorage.put(deployment).catch(() => undefined);
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<
        { deployment: typeof nextDeployment }
      >(
        refreshed.error,
        async () => {
          await serviceDeploymentStorage.put(deployment);
          await setDeploymentEnvelopeDisabled({
            storage: deploymentEnvelopeStorage,
            deploymentId: deployment.deploymentId,
            disabled: deployment.disabled,
          });
        },
      );
    }
    for (
      const instance of await instancesForDeployment(
        nextDeployment.deploymentId,
        serviceInstanceStorage,
      )
    ) {
      await kickInstanceRuntimeAccess({
        instanceKey: instance.instanceKey,
        kick: deps.kick,
        connectionsKV: deps.connectionsKV,
        sessionStorage: deps.sessionStorage,
      });
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthDeploymentsServiceEnableHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
  validateActiveCatalog: ActiveCatalogValidator;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  deploymentEnvelopeStorage: DeploymentEnvelopeStorage;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: { deploymentId: string };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<
      { deployment: ServiceDeployment },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const { deploymentEnvelopeStorage, serviceDeploymentStorage } = deps;
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeployment = { ...deployment, disabled: false };
    const deploymentEnvelope = await deploymentEnvelopeStorage.get(
      req.deploymentId,
    );
    if (!deploymentEnvelope) {
      return invalid("/deploymentId", "deployment envelope not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeploymentEnvelope = {
      ...deploymentEnvelope,
      disabled: false,
    };
    const validated = await validateActiveCatalog(deps.validateActiveCatalog, {
      stagedServiceDeployments: [nextDeployment],
      stagedDeploymentEnvelopes: [nextDeploymentEnvelope],
    });
    if (isErr(validated)) return validated;
    try {
      await serviceDeploymentStorage.put(nextDeployment);
      await setDeploymentEnvelopeDisabled({
        storage: deploymentEnvelopeStorage,
        deploymentId: nextDeployment.deploymentId,
        disabled: false,
      });
    } catch (error) {
      await serviceDeploymentStorage.put(deployment).catch(() => undefined);
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure(
        refreshed.error,
        async () => {
          await serviceDeploymentStorage.put(deployment);
          await setDeploymentEnvelopeDisabled({
            storage: deploymentEnvelopeStorage,
            deploymentId: deployment.deploymentId,
            disabled: deployment.disabled,
          });
        },
      );
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthDeploymentsServiceRemoveHandler(
  deps:
    & {
      refreshActiveContracts: ActiveContractsRefresher;
      refreshActiveContractsForRemoval?: ActiveContractsRefresher;
      validateActiveCatalog: ActiveCatalogValidator;
      validateActiveCatalogForRemoval?: ActiveCatalogValidator;
      serviceDeploymentStorage: ServiceDeploymentStorage;
      serviceInstanceStorage: ServiceInstanceStorage;
      deploymentEnvelopeStorage?: DeploymentEnvelopeStorage;
      nats?: NatsConnection;
      deploymentResourceBindingStorage?: DeploymentResourceBindingStorage;
      logger?: {
        trace?: AuthRuntimeDeps["logger"]["trace"];
        warn?: AuthRuntimeDeps["logger"]["warn"];
      };
      purgeResourceBindings?: (
        bindings: Iterable<PurgeableContractResourceBindings>,
      ) => Promise<void>;
    }
    & RuntimeKickDeps
    & {
      kick: (serverId: string, clientId: number) => Promise<void>;
    }
    & InstalledContractCleanupDeps,
) {
  return async (
    { input: req, context: { caller } }: {
      input: {
        deploymentId: string;
        cascade?: boolean;
        purgeResources?: boolean;
        purgeUnusedContracts?: boolean;
      };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<{ success: boolean }, AuthError | ValidationError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const { serviceDeploymentStorage, serviceInstanceStorage } = deps;
    if (req.purgeResources === true && req.cascade !== true) {
      return invalid(
        "/purgeResources",
        "resource purge requires cascade removal",
        { deploymentId: req.deploymentId },
      );
    }
    if (req.purgeUnusedContracts === true && req.cascade !== true) {
      return invalid(
        "/purgeUnusedContracts",
        "unused contract cleanup requires cascade removal",
        { deploymentId: req.deploymentId },
      );
    }
    const instances = await instancesForDeployment(
      req.deploymentId,
      serviceInstanceStorage,
    );
    if (instances.length > 0 && req.cascade !== true) {
      return invalid(
        "/deploymentId",
        "service deployment still has instances",
        {
          deploymentId: req.deploymentId,
        },
      );
    }
    const existing = await serviceDeploymentStorage.get(req.deploymentId);
    if (!existing) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const validationOpts: Parameters<ActiveCatalogValidator>[0] = {
      stagedServiceDeployments: [{
        ...existing,
        disabled: true,
      }],
    };
    if (instances.length > 0) {
      validationOpts.stagedServiceInstances = instances.map((instance) => ({
        ...instance,
        disabled: true,
      }));
    }
    const validated = await validateActiveCatalog(
      deps.validateActiveCatalogForRemoval ?? deps.validateActiveCatalog,
      validationOpts,
    );
    if (isErr(validated)) return validated;
    let installedContractCleanupDeps:
      | Parameters<typeof purgeUnusedInstalledContracts>[1]
      | undefined;
    let removedContractEvidence: Array<{
      deploymentId: string;
      contractId: string;
      contractDigest: string;
    }> = [];
    if (req.purgeUnusedContracts === true) {
      const cleanupDeps = buildInstalledContractCleanupDeps(deps);
      if (!cleanupDeps.ok) return Result.err(cleanupDeps.error);
      installedContractCleanupDeps = cleanupDeps.deps;
      removedContractEvidence = await deps.deploymentContractEvidenceStorage!
        .listByDeployment(req.deploymentId);
    }
    const restoreDeletedRecords = async () => {
      await serviceDeploymentStorage.put(existing);
      if (deps.deploymentEnvelopeStorage) {
        await setDeploymentEnvelopeDisabledIfPresent({
          storage: deps.deploymentEnvelopeStorage,
          deploymentId: existing.deploymentId,
          disabled: existing.disabled,
        });
      }
      for (const instance of instances) {
        await serviceInstanceStorage.put(instance);
      }
    };
    if (req.purgeResources === true) {
      if (!deps.deploymentResourceBindingStorage) {
        return Result.err(
          new UnexpectedError({
            cause: new Error(
              "resource purge requires deploymentResourceBindingStorage",
            ),
          }),
        );
      }
      const bindings = deploymentResourceBindingsToPurgeable(
        await deps.deploymentResourceBindingStorage.listByDeployment(
          req.deploymentId,
        ),
      );
      try {
        if (deps.purgeResourceBindings) {
          await deps.purgeResourceBindings(bindings);
        } else {
          if (!deps.nats) {
            throw new Error("NATS connection is required to purge resources");
          }
          await purgeContractResourceBindings(
            bindings,
            createNatsResourcePurgeManager(deps.nats),
          );
        }
      } catch (error) {
        return Result.err(new UnexpectedError({ cause: toError(error) }));
      }
    }
    try {
      for (const instance of instances) {
        await kickInstanceRuntimeAccess({
          instanceKey: instance.instanceKey,
          kick: deps.kick,
          connectionsKV: deps.connectionsKV,
          sessionStorage: deps.sessionStorage,
        });
      }
    } catch (error) {
      if (req.purgeResources === true) {
        void error;
        for (const instance of instances) {
          try {
            await deps.sessionStorage.deleteByInstanceKey(instance.instanceKey);
          } catch {
            // Resource purge already succeeded; session deletion is best-effort.
          }
        }
      } else {
        return Result.err(new UnexpectedError({ cause: toError(error) }));
      }
    }
    try {
      if (deps.deploymentEnvelopeStorage) {
        await setDeploymentEnvelopeDisabledIfPresent({
          storage: deps.deploymentEnvelopeStorage,
          deploymentId: req.deploymentId,
          disabled: true,
        });
      }
      for (const instance of instances) {
        await serviceInstanceStorage.delete(instance.instanceId);
      }
      await serviceDeploymentStorage.delete(req.deploymentId);
    } catch (error) {
      try {
        await restoreDeletedRecords();
      } catch (rollbackError) {
        return Result.err(
          new UnexpectedError({
            cause: new AggregateError(
              [toError(error), toError(rollbackError)],
              "service deployment removal failed and rollback failed",
            ),
          }),
        );
      }
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(
      deps.refreshActiveContractsForRemoval ?? deps.refreshActiveContracts,
    );
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure(
        refreshed.error,
        restoreDeletedRecords,
      );
    }
    if (req.purgeUnusedContracts === true) {
      if (!installedContractCleanupDeps) {
        return Result.err(
          missingInstalledContractCleanupDependency(
            "installedContractCleanupDeps",
          ),
        );
      }
      try {
        await purgeUnusedInstalledContracts(
          collectDeploymentContractEvidenceDigests(removedContractEvidence),
          installedContractCleanupDeps,
        );
      } catch (error) {
        deps.logger?.warn?.(
          { deploymentId: req.deploymentId, error: toError(error) },
          "Failed to clean up unused installed contracts after service deployment removal",
        );
      }
    }
    return Result.ok({ success: true });
  };
}

export function createAuthServiceInstancesProvisionHandler(
  serviceDeps: ServiceAdminRpcDeps,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; instanceKey: string };
      context: { caller: RpcUser };
    },
  ) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const { logger, serviceDeploymentStorage, serviceInstanceStorage } =
      serviceDeps;
    logger.trace({
      rpc: "Auth.ServiceInstances.Provision",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    if (deployment.disabled) {
      return invalid("/deploymentId", "service deployment is disabled", {
        deploymentId: req.deploymentId,
      });
    }

    const validated = validateServiceProvisionRequest(req).take();
    if (isErr(validated)) return Result.err(validated.error);
    const { instance } = validated;

    const existing = await serviceInstanceStorage.get(instance.instanceId);
    if (existing) {
      return invalid("/instanceKey", "service instance already exists", {
        instanceId: instance.instanceId,
      });
    }

    try {
      await serviceInstanceStorage.put(instance);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    return Result.ok({ instance });
  };
}

export function createAuthServiceInstancesListHandler(
  serviceDeps: ServiceAdminRpcDeps,
) {
  return async (
    { input: req, context: { caller } }: {
      input: BoundedListQuery & { deploymentId?: string; disabled?: boolean };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<ListPage<ServiceInstance>, AuthError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const { logger, serviceInstanceStorage } = serviceDeps;
    logger.trace({ rpc: "Auth.ServiceInstances.List", caller }, "RPC request");
    try {
      const instances = await serviceInstanceStorage.listFilteredPage({
        deploymentId: req.deploymentId,
        disabled: req.disabled,
      }, req);
      return Result.ok(instances);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

async function setInstanceDisabled(
  args: {
    instanceId: string;
    disabled: boolean;
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: ActiveCatalogValidator;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
): Promise<
  Result<{ instance: ServiceInstance }, ValidationError | UnexpectedError>
> {
  const { serviceInstanceStorage } = args;
  const instance = await serviceInstanceStorage.get(args.instanceId);
  if (!instance) {
    return invalid("/instanceId", "service instance not found", {
      instanceId: args.instanceId,
    });
  }
  const nextInstance: ServiceInstance = {
    ...instance,
    disabled: args.disabled,
  };
  const validated = await validateActiveCatalog(args.validateActiveCatalog, {
    stagedServiceInstances: [nextInstance],
  });
  if (isErr(validated)) return validated;
  try {
    await serviceInstanceStorage.put(nextInstance);
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
  const refreshed = await refreshActiveContracts(args.refreshActiveContracts);
  if (isErr(refreshed)) {
    return await rollbackRefreshFailure(
      refreshed.error,
      () => serviceInstanceStorage.put(instance),
    );
  }
  await kickInstanceRuntimeAccess({
    instanceKey: nextInstance.instanceKey,
    kick: args.kick,
    connectionsKV: args.connectionsKV,
    sessionStorage: args.sessionStorage,
  });
  return Result.ok({ instance: nextInstance });
}

export function createAuthServiceInstancesDisableHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: ActiveCatalogValidator;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    return await setInstanceDisabled({
      ...req,
      disabled: true,
      kick: deps.kick,
      refreshActiveContracts: deps.refreshActiveContracts,
      validateActiveCatalog: deps.validateActiveCatalog,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    });
  };
}

export function createAuthServiceInstancesEnableHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: ActiveCatalogValidator;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    return await setInstanceDisabled({
      ...req,
      disabled: false,
      kick: deps.kick,
      refreshActiveContracts: deps.refreshActiveContracts,
      validateActiveCatalog: deps.validateActiveCatalog,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    });
  };
}

export function createAuthServiceInstancesRemoveHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: ActiveCatalogValidator;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const { serviceInstanceStorage } = deps;
    const instance = await serviceInstanceStorage.get(req.instanceId);
    if (!instance) {
      return invalid("/instanceId", "service instance not found", {
        instanceId: req.instanceId,
      });
    }
    const validated = await validateActiveCatalog(deps.validateActiveCatalog, {
      stagedServiceInstances: [{ ...instance, disabled: true }],
    });
    if (isErr(validated)) return validated;
    try {
      await serviceInstanceStorage.delete(req.instanceId);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) {
      return await rollbackRefreshFailure<{ success: boolean }>(
        refreshed.error,
        () => serviceInstanceStorage.put(instance),
      );
    }
    await kickInstanceRuntimeAccess({
      instanceKey: instance.instanceKey,
      kick: deps.kick,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
    });
    return Result.ok({ success: true });
  };
}
