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
import { AuthRequestsValidateResponseSchema } from "@qlever-llc/trellis/auth";
import { ulid } from "ulid";

import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import {
  type Connection,
  type DeploymentAuthority,
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
type ActiveCatalogValidator = (validationOpts: {
  extraActiveDigests?: Iterable<string>;
  stagedServiceDeployments?: Iterable<ServiceDeployment>;
  stagedServiceInstances?: Iterable<ServiceInstance>;
}) => Promise<unknown>;
type ActiveContractsRefresher = (
  validationOpts?: Parameters<ActiveCatalogValidator>[0],
) => Promise<void>;
type DeploymentAuthorityStorage = {
  get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
  put(record: DeploymentAuthority): Promise<void>;
};
type AuthorityReconciler = {
  reconcileDeployment(
    deploymentId: string,
    opts?: { desiredVersion?: string },
  ): Promise<unknown>;
};

export type ServiceAdminRpcDeps = {
  logger:
    & Pick<AuthRuntimeDeps["logger"], "trace">
    & Partial<Pick<AuthRuntimeDeps["logger"], "warn">>;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  serviceInstanceStorage: ServiceInstanceStorage;
  deploymentAuthorityStorage?: DeploymentAuthorityStorage;
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

function emptyDeploymentAuthority(args: {
  deploymentId: string;
  kind: DeploymentAuthority["kind"];
  disabled?: boolean;
  now?: string;
}): DeploymentAuthority {
  const now = args.now ?? new Date().toISOString();
  return {
    deploymentId: args.deploymentId,
    kind: args.kind,
    disabled: args.disabled ?? false,
    desiredState: {
      needs: { contracts: [], surfaces: [], capabilities: [], resources: [] },
      capabilities: [],
      resources: [],
      surfaces: [],
    },
    version: ulid(),
    createdAt: now,
    updatedAt: now,
  };
}

async function setDeploymentAuthorityDisabled(args: {
  storage: DeploymentAuthorityStorage;
  deploymentId: string;
  disabled: boolean;
  now?: string;
}): Promise<DeploymentAuthority | undefined> {
  const authority = await args.storage.get(args.deploymentId);
  if (!authority) throw new Error("deployment authority not found");
  if (authority.disabled === args.disabled) return undefined;
  const updatedAt = args.now ?? new Date().toISOString();
  const updatedAuthority = {
    ...authority,
    disabled: args.disabled,
    version: ulid(),
    updatedAt,
  };
  await args.storage.put(updatedAuthority);
  return updatedAuthority;
}

async function setDeploymentAuthorityDisabledIfPresent(args: {
  storage: DeploymentAuthorityStorage;
  deploymentId: string;
  disabled: boolean;
  now?: string;
}): Promise<
  | { previous: DeploymentAuthority; updated: DeploymentAuthority }
  | undefined
> {
  let authority: DeploymentAuthority | undefined;
  try {
    authority = await args.storage.get(args.deploymentId);
  } catch {
    return undefined;
  }
  if (!authority || authority.disabled === args.disabled) return undefined;
  const updatedAt = args.now ?? new Date().toISOString();
  const updatedAuthority = {
    ...authority,
    disabled: args.disabled,
    version: ulid(),
    updatedAt,
  };
  await args.storage.put(updatedAuthority);
  return { previous: authority, updated: updatedAuthority };
}

async function reconcileDeploymentAuthorityChange(args: {
  authority: DeploymentAuthority | undefined;
  authorityReconciler?: AuthorityReconciler;
  logger?: Partial<Pick<AuthRuntimeDeps["logger"], "warn">>;
}): Promise<void> {
  if (!args.authority || !args.authorityReconciler) return;
  try {
    await args.authorityReconciler.reconcileDeployment(
      args.authority.deploymentId,
      { desiredVersion: args.authority.version },
    );
  } catch (error) {
    args.logger?.warn?.({
      err: toError(error),
      deploymentId: args.authority.deploymentId,
    }, "Deployment authority reconciliation trigger failed");
  }
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
    const { logger, serviceDeploymentStorage, deploymentAuthorityStorage } =
      serviceDeps;
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
    const { logger, serviceDeploymentStorage, deploymentAuthorityStorage } =
      serviceDeps;
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
      if (deploymentAuthorityStorage) {
        await deploymentAuthorityStorage.put(emptyDeploymentAuthority({
          deploymentId: deployment.deploymentId,
          kind: "service",
        }));
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
    authorityReconciler?: AuthorityReconciler;
    logger?: Partial<Pick<AuthRuntimeDeps["logger"], "warn">>;
    serviceDeploymentStorage: ServiceDeploymentStorage;
    serviceInstanceStorage: ServiceInstanceStorage;
    deploymentAuthorityStorage: DeploymentAuthorityStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    const {
      deploymentAuthorityStorage,
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
    const deploymentAuthority = await deploymentAuthorityStorage.get(
      req.deploymentId,
    );
    if (!deploymentAuthority) {
      return invalid("/deploymentId", "deployment authority not found", {
        deploymentId: req.deploymentId,
      });
    }
    const validated = await validateActiveCatalog(
      deps.validateActiveCatalogForRemoval ?? deps.validateActiveCatalog,
      {
        stagedServiceDeployments: [nextDeployment],
      },
    );
    if (isErr(validated)) return validated;
    let updatedAuthority: DeploymentAuthority | undefined;
    try {
      await serviceDeploymentStorage.put(nextDeployment);
      updatedAuthority = await setDeploymentAuthorityDisabled({
        storage: deploymentAuthorityStorage,
        deploymentId: nextDeployment.deploymentId,
        disabled: true,
      });
      const refreshed = await refreshActiveContracts(
        deps.refreshActiveContracts,
      );
      if (isErr(refreshed)) {
        return await rollbackRefreshFailure<
          { deployment: typeof nextDeployment }
        >(
          refreshed.error,
          async () => {
            await serviceDeploymentStorage.put(deployment);
            await deploymentAuthorityStorage.put(deploymentAuthority);
          },
        );
      }
      await reconcileDeploymentAuthorityChange({
        authority: updatedAuthority,
        authorityReconciler: deps.authorityReconciler,
        logger: deps.logger,
      });
    } catch (error) {
      await serviceDeploymentStorage.put(deployment).catch(() => undefined);
      return Result.err(new UnexpectedError({ cause: toError(error) }));
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
  deploymentAuthorityStorage: DeploymentAuthorityStorage;
  authorityReconciler?: AuthorityReconciler;
  logger?: Partial<Pick<AuthRuntimeDeps["logger"], "warn">>;
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
    const { deploymentAuthorityStorage, serviceDeploymentStorage } = deps;
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeployment = { ...deployment, disabled: false };
    const deploymentAuthority = await deploymentAuthorityStorage.get(
      req.deploymentId,
    );
    if (!deploymentAuthority) {
      return invalid("/deploymentId", "deployment authority not found", {
        deploymentId: req.deploymentId,
      });
    }
    const validated = await validateActiveCatalog(deps.validateActiveCatalog, {
      stagedServiceDeployments: [nextDeployment],
    });
    if (isErr(validated)) return validated;
    try {
      await serviceDeploymentStorage.put(nextDeployment);
      const updatedAuthority = await setDeploymentAuthorityDisabled({
        storage: deploymentAuthorityStorage,
        deploymentId: nextDeployment.deploymentId,
        disabled: false,
      });
      const refreshed = await refreshActiveContracts(
        deps.refreshActiveContracts,
      );
      if (isErr(refreshed)) {
        return await rollbackRefreshFailure(
          refreshed.error,
          async () => {
            await serviceDeploymentStorage.put(deployment);
            await deploymentAuthorityStorage.put(deploymentAuthority);
          },
        );
      }
      await reconcileDeploymentAuthorityChange({
        authority: updatedAuthority,
        authorityReconciler: deps.authorityReconciler,
        logger: deps.logger,
      });
    } catch (error) {
      await serviceDeploymentStorage.put(deployment).catch(() => undefined);
      return Result.err(new UnexpectedError({ cause: toError(error) }));
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
      deploymentAuthorityStorage: DeploymentAuthorityStorage;
      authorityReconciler?: AuthorityReconciler;
      logger?: {
        trace?: AuthRuntimeDeps["logger"]["trace"];
        warn?: AuthRuntimeDeps["logger"]["warn"];
      };
    }
    & RuntimeKickDeps
    & {
      kick: (serverId: string, clientId: number) => Promise<void>;
    },
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
    if (req.purgeResources === true) {
      return invalid(
        "/purgeResources",
        "direct physical resource purge is no longer supported by service removal",
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
    if (req.purgeUnusedContracts === true) {
      deps.logger?.warn?.(
        { deploymentId: req.deploymentId },
        "Unused contract purge no longer applies to offer-backed runtime state and was skipped",
      );
    }
    let previousAuthority: DeploymentAuthority | undefined;
    const restoreDeletedRecords = async () => {
      await serviceDeploymentStorage.put(existing);
      if (previousAuthority) {
        await deps.deploymentAuthorityStorage.put(previousAuthority);
      }
      for (const instance of instances) {
        await serviceInstanceStorage.put(instance);
      }
    };
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
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    let updatedAuthority: DeploymentAuthority | undefined;
    try {
      const authorityChange = await setDeploymentAuthorityDisabledIfPresent({
        storage: deps.deploymentAuthorityStorage,
        deploymentId: req.deploymentId,
        disabled: true,
      });
      previousAuthority = authorityChange?.previous;
      updatedAuthority = authorityChange?.updated;
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
    await reconcileDeploymentAuthorityChange({
      authority: updatedAuthority,
      authorityReconciler: deps.authorityReconciler,
      logger: deps.logger,
    });
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
