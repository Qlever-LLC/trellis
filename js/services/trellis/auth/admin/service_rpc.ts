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
import type { NatsConnection } from "@nats-io/nats-core/internal";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import type { ContractResourceBindings } from "../../catalog/resources.ts";

import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import { type Connection, ServiceInstanceSchema } from "../schemas.ts";
import type { SqlSessionRepository } from "../storage.ts";
import type { StaticDecode } from "typebox";
import { revokeRuntimeAccessForSession } from "../session/revoke_runtime_access.ts";
import { createAuthApplyServiceDeploymentContractHandler as createAuthApplyServiceDeploymentContractHandlerBase } from "./service_deployment_apply.ts";
import {
  normalizeAppliedContracts,
  type ServiceDeployment,
  validateServiceDeploymentRequest,
  validateServiceProvisionRequest,
} from "./shared.ts";

type ServiceInstance = StaticDecode<typeof ServiceInstanceSchema>;

type RpcUser = { type: string; id?: string; capabilities?: string[] };

type ServiceDeploymentStorage = {
  get(deploymentId: string): Promise<ServiceDeployment | undefined>;
  put(record: ServiceDeployment): Promise<void>;
  delete(deploymentId: string): Promise<void>;
  list(): Promise<ServiceDeployment[]>;
};
type ServiceInstanceStorage = {
  get(instanceId: string): Promise<ServiceInstance | undefined>;
  getByInstanceKey(instanceKey: string): Promise<ServiceInstance | undefined>;
  put(record: ServiceInstance): Promise<void>;
  delete(instanceId: string): Promise<void>;
  list(): Promise<ServiceInstance[]>;
  listByDeployment(deploymentId: string): Promise<ServiceInstance[]>;
};
type RuntimeKickDeps = {
  connectionsKV: KVLike<Connection>;
  sessionStorage: Pick<SqlSessionRepository, "deleteByInstanceKey">;
};

export type ServiceAdminRpcDeps = {
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  serviceInstanceStorage: ServiceInstanceStorage;
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

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function insufficientPermissions() {
  return Result.err(new AuthError({ reason: "insufficient_permissions" }));
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
  refresh: () => Promise<void>,
): Promise<Result<void, UnexpectedError>> {
  try {
    await refresh();
    return Result.ok(undefined);
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createAuthListServiceDeploymentsHandler(
  serviceDeps: ServiceAdminRpcDeps,
) {
  return async (
    { input: req, context: { caller } }: {
      input: { disabled?: boolean };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<{ deployments: ServiceDeployment[] }, AuthError | UnexpectedError>
  > => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const { logger, serviceDeploymentStorage } = serviceDeps;
    logger.trace({ rpc: "Auth.ListServiceDeployments", caller }, "RPC request");
    try {
      const deployments = (await serviceDeploymentStorage.list()).filter((
        deployment,
      ) => req.disabled === undefined || deployment.disabled === req.disabled);
      return Result.ok({ deployments });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

export function createAuthCreateServiceDeploymentHandler(
  serviceDeps: ServiceAdminRpcDeps,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; namespaces: string[] };
      context: { caller: RpcUser };
    },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const { logger, serviceDeploymentStorage } = serviceDeps;
    logger.trace({
      rpc: "Auth.CreateServiceDeployment",
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
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    return Result.ok({ deployment });
  };
}

export function createAuthApplyServiceDeploymentContractHandler(deps: {
  installServiceContract: (contract: unknown) => Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
    usedNamespaces: string[];
    contract: TrellisContractV1;
  }>;
  nats?: NatsConnection;
  provisionResourceBindings?: (
    nats: NatsConnection | undefined,
    contract: TrellisContractV1,
    deploymentId: string,
  ) => Promise<ContractResourceBindings>;
  refreshActiveContracts: () => Promise<void>;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  validateActiveCatalog?: (opts: {
    stagedServiceDeployments?: Iterable<ServiceDeployment>;
  }) => Promise<unknown>;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  const handler = createAuthApplyServiceDeploymentContractHandlerBase({
    ...deps,
  });
  return async (args: {
    input: { deploymentId: string; contract: unknown };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(args.context.caller)) return insufficientPermissions();
    deps.logger.trace({
      rpc: "Auth.ApplyServiceDeploymentContract",
      caller: args.context.caller,
      deploymentId: args.input.deploymentId,
    }, "RPC request");
    return await handler(args);
  };
}

export function createAuthUnapplyServiceDeploymentContractHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    validateActiveCatalog: (validationOpts?: {
      stagedServiceDeployments?: Iterable<ServiceDeployment>;
      stagedServiceInstances?: Iterable<ServiceInstance>;
    }) => Promise<unknown>;
    logger: Pick<AuthRuntimeDeps["logger"], "trace">;
    serviceDeploymentStorage: ServiceDeploymentStorage;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; contractId: string; digests?: string[] };
      context: { caller: RpcUser };
    },
  ) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const { logger, serviceDeploymentStorage, serviceInstanceStorage } = deps;
    logger.trace({
      rpc: "Auth.UnapplyServiceDeploymentContract",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }

    const removeDigests = new Set(req.digests ?? []);
    const nextContracts = deployment.appliedContracts
      .map((applied: ServiceDeployment["appliedContracts"][number]) => {
        if (applied.contractId !== req.contractId) return applied;
        if (removeDigests.size === 0) return null;
        const remaining = applied.allowedDigests.filter((digest: string) =>
          !removeDigests.has(digest)
        );
        return remaining.length > 0
          ? {
            ...applied,
            allowedDigests: remaining,
            resourceBindingsByDigest: Object.fromEntries(
              Object.entries(applied.resourceBindingsByDigest ?? {}).filter(
                ([digest]) => remaining.includes(digest),
              ),
            ),
          }
          : null;
      })
      .filter((
        value: ServiceDeployment["appliedContracts"][number] | null,
      ): value is ServiceDeployment["appliedContracts"][number] =>
        value !== null
      );

    const nextDeployment: ServiceDeployment = {
      ...deployment,
      appliedContracts: normalizeAppliedContracts(nextContracts),
    };

    try {
      await deps.validateActiveCatalog({
        stagedServiceDeployments: [nextDeployment],
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    try {
      await serviceDeploymentStorage.put(nextDeployment);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) {
      try {
        await serviceDeploymentStorage.put(deployment);
      } catch (error) {
        return Result.err(new UnexpectedError({ cause: toError(error) }));
      }
      return refreshed;
    }

    for (
      const instance of await instancesForDeployment(
        deployment.deploymentId,
        serviceInstanceStorage,
      )
    ) {
      if (instance.currentContractId !== req.contractId) continue;
      if (
        removeDigests.size > 0 && instance.currentContractDigest &&
        !removeDigests.has(instance.currentContractDigest)
      ) continue;
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

export function createAuthDisableServiceDeploymentHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    serviceDeploymentStorage: ServiceDeploymentStorage;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { deploymentId: string };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const { serviceDeploymentStorage, serviceInstanceStorage } = deps;
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeployment = { ...deployment, disabled: true };
    try {
      await serviceDeploymentStorage.put(nextDeployment);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;
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

export function createAuthEnableServiceDeploymentHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
  serviceDeploymentStorage: ServiceDeploymentStorage;
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
    if (!isAdmin(caller)) return insufficientPermissions();
    const { serviceDeploymentStorage } = deps;
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeployment = { ...deployment, disabled: false };
    try {
      await serviceDeploymentStorage.put(nextDeployment);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthRemoveServiceDeploymentHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  serviceInstanceStorage: ServiceInstanceStorage;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: { deploymentId: string };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<{ success: boolean }, AuthError | ValidationError | UnexpectedError>
  > => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const { serviceDeploymentStorage, serviceInstanceStorage } = deps;
    const instances = await instancesForDeployment(
      req.deploymentId,
      serviceInstanceStorage,
    );
    if (instances.length > 0) {
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
    try {
      await serviceDeploymentStorage.delete(req.deploymentId);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ success: true });
  };
}

export function createAuthProvisionServiceInstanceHandler(
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
    if (!isAdmin(caller)) return insufficientPermissions();
    const { logger, serviceDeploymentStorage, serviceInstanceStorage } =
      serviceDeps;
    logger.trace({
      rpc: "Auth.ProvisionServiceInstance",
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

export function createAuthListServiceInstancesHandler(
  serviceDeps: ServiceAdminRpcDeps,
) {
  return async (
    { input: req, context: { caller } }: {
      input: { deploymentId?: string; disabled?: boolean };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<{ instances: ServiceInstance[] }, AuthError | UnexpectedError>
  > => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const { logger, serviceInstanceStorage } = serviceDeps;
    logger.trace({ rpc: "Auth.ListServiceInstances", caller }, "RPC request");
    try {
      const instances = (req.deploymentId === undefined
        ? await serviceInstanceStorage.list()
        : await serviceInstanceStorage.listByDeployment(req.deploymentId))
        .filter((instance) =>
          req.disabled === undefined || instance.disabled === req.disabled
        );
      return Result.ok({ instances });
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
  const nextInstance = { ...instance, disabled: args.disabled };
  try {
    await serviceInstanceStorage.put(nextInstance);
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
  const refreshed = await refreshActiveContracts(args.refreshActiveContracts);
  if (isErr(refreshed)) return refreshed;
  await kickInstanceRuntimeAccess({
    instanceKey: nextInstance.instanceKey,
    kick: args.kick,
    connectionsKV: args.connectionsKV,
    sessionStorage: args.sessionStorage,
  });
  return Result.ok({ instance: nextInstance });
}

export function createAuthDisableServiceInstanceHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    return await setInstanceDisabled({
      ...req,
      disabled: true,
      kick: deps.kick,
      refreshActiveContracts: deps.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    });
  };
}

export function createAuthEnableServiceInstanceHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    return await setInstanceDisabled({
      ...req,
      disabled: false,
      kick: deps.kick,
      refreshActiveContracts: deps.refreshActiveContracts,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
      serviceInstanceStorage: deps.serviceInstanceStorage,
    });
  };
}

export function createAuthRemoveServiceInstanceHandler(
  deps: {
    kick: (serverId: string, clientId: number) => Promise<void>;
    refreshActiveContracts: () => Promise<void>;
    serviceInstanceStorage: ServiceInstanceStorage;
  } & RuntimeKickDeps,
) {
  return async ({ input: req, context: { caller } }: {
    input: { instanceId: string };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    const { serviceInstanceStorage } = deps;
    const instance = await serviceInstanceStorage.get(req.instanceId);
    if (!instance) {
      return invalid("/instanceId", "service instance not found", {
        instanceId: req.instanceId,
      });
    }
    await kickInstanceRuntimeAccess({
      instanceKey: instance.instanceKey,
      kick: deps.kick,
      connectionsKV: deps.connectionsKV,
      sessionStorage: deps.sessionStorage,
    });
    try {
      await serviceInstanceStorage.delete(req.instanceId);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ success: true });
  };
}
