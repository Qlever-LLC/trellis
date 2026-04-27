import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";

import { type AuthRuntimeDeps, authRuntimeDeps } from "../runtime_deps.ts";
import type { Connection } from "../schemas.ts";
import type { SqlSessionRepository } from "../storage.ts";
import { connectionFilterForSession } from "../session/connections.ts";
import { createAuthApplyServiceDeploymentContractHandler as createAuthApplyServiceDeploymentContractHandlerBase } from "./service_deployment_apply.ts";
import {
  normalizeAppliedContracts,
  type ServiceDeployment,
  type ServiceInstance,
  validateServiceDeploymentRequest,
  validateServiceProvisionRequest,
} from "./shared.ts";

type RpcUser = { type: string; id?: string };

type ServiceDeploymentStorage = Pick<
  AuthRuntimeDeps["serviceDeploymentStorage"],
  "get" | "put" | "delete" | "list"
>;
type ServiceInstanceStorage = Pick<
  AuthRuntimeDeps["serviceInstanceStorage"],
  | "get"
  | "getByInstanceKey"
  | "put"
  | "delete"
  | "list"
  | "listByDeployment"
>;

function serviceRpcDeps(): {
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
  serviceDeploymentStorage: ServiceDeploymentStorage;
  serviceInstanceStorage: ServiceInstanceStorage;
} {
  const deps = authRuntimeDeps();
  return {
    logger: deps.logger,
    serviceDeploymentStorage: {
      get: (deploymentId) => deps.serviceDeploymentStorage.get(deploymentId),
      put: (record) => deps.serviceDeploymentStorage.put(record),
      delete: (deploymentId) =>
        deps.serviceDeploymentStorage.delete(deploymentId),
      list: () => deps.serviceDeploymentStorage.list(),
    },
    serviceInstanceStorage: {
      get: (instanceId) => deps.serviceInstanceStorage.get(instanceId),
      getByInstanceKey: (instanceKey) =>
        deps.serviceInstanceStorage.getByInstanceKey(instanceKey),
      put: (record) => deps.serviceInstanceStorage.put(record),
      delete: (instanceId) => deps.serviceInstanceStorage.delete(instanceId),
      list: () => deps.serviceInstanceStorage.list(),
      listByDeployment: (deploymentId) =>
        deps.serviceInstanceStorage.listByDeployment(deploymentId),
    },
  };
}

type KVLike<V> = {
  get: (key: string) => AsyncResult<{ value: V } | V | unknown, BaseError>;
  put: (key: string, value: V) => AsyncResult<void | unknown, BaseError>;
  delete: (key: string) => AsyncResult<void | unknown, BaseError>;
  keys: (
    filter: string,
  ) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
};

function unwrapValue<V>(entry: { value: V } | V | unknown): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return (entry as { value: V }).value;
  }
  return entry as V;
}

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
  connectionsKV?: KVLike<Connection>;
  sessionStorage?: Pick<SqlSessionRepository, "deleteByInstanceKey">;
  kick: (serverId: string, clientId: number) => Promise<void>;
}): Promise<void> {
  const runtime = authRuntimeDeps();
  const connectionStore = args.connectionsKV ?? runtime.connectionsKV;
  const sessionStore = args.sessionStorage ?? runtime.sessionStorage;

  const connectionKeys = await connectionStore.keys(
    connectionFilterForSession(args.instanceKey),
  )
    .take();
  if (!isErr(connectionKeys)) {
    for await (const key of connectionKeys as AsyncIterable<string>) {
      const entry = await connectionStore.get(key).take();
      if (!isErr(entry)) {
        const connection = unwrapValue<Connection>(entry);
        await args.kick(connection.serverId, connection.clientId);
      }
      await connectionStore.delete(key);
    }
  }

  await sessionStore.deleteByInstanceKey(args.instanceKey);
}

async function instancesForDeployment(
  deploymentId: string,
  store: ServiceInstanceStorage = serviceRpcDeps().serviceInstanceStorage,
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

export const authListServiceDeploymentsHandler = async (
  { input: req }: { input: { disabled?: boolean } },
): Promise<Result<{ deployments: ServiceDeployment[] }, UnexpectedError>> => {
  const { logger, serviceDeploymentStorage } = serviceRpcDeps();
  logger.trace({ rpc: "Auth.ListServiceDeployments" }, "RPC request");
  try {
    const deployments = (await serviceDeploymentStorage.list()).filter((
      deployment,
    ) => req.disabled === undefined || deployment.disabled === req.disabled);
    return Result.ok({ deployments });
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
};

export function createAuthCreateServiceDeploymentHandler() {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; namespaces: string[] };
      context: { caller: RpcUser };
    },
  ) => {
    const { logger, serviceDeploymentStorage, serviceInstanceStorage } =
      serviceRpcDeps();
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
  }>;
  refreshActiveContracts: () => Promise<void>;
}) {
  const { logger, serviceDeploymentStorage } = serviceRpcDeps();
  const handler = createAuthApplyServiceDeploymentContractHandlerBase({
    ...deps,
    serviceDeploymentStorage,
  });
  return async (args: {
    input: { deploymentId: string; contract: unknown };
    context: { caller: RpcUser };
  }) => {
    logger.trace({
      rpc: "Auth.ApplyServiceDeploymentContract",
      caller: args.context.caller,
      deploymentId: args.input.deploymentId,
    }, "RPC request");
    return await handler(args);
  };
}

export function createAuthUnapplyServiceDeploymentContractHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; contractId: string; digests?: string[] };
      context: { caller: RpcUser };
    },
  ) => {
    const { logger, serviceDeploymentStorage, serviceInstanceStorage } =
      serviceRpcDeps();
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
          ? { ...applied, allowedDigests: remaining }
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
      await serviceDeploymentStorage.put(nextDeployment);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;

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
      });
    }

    return Result.ok({ deployment: nextDeployment });
  };
}

function toggleDeploymentDisabled(
  deployment: ServiceDeployment,
  disabled: boolean,
): ServiceDeployment {
  return { ...deployment, disabled };
}

export function createAuthDisableServiceDeploymentHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async ({ input: req }: { input: { deploymentId: string } }) => {
    const { serviceDeploymentStorage, serviceInstanceStorage } =
      serviceRpcDeps();
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeployment = toggleDeploymentDisabled(
      deployment,
      true,
    );
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
      });
    }
    return Result.ok({ deployment: nextDeployment });
  };
}

export function createAuthEnableServiceDeploymentHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (
    { input: req }: { input: { deploymentId: string } },
  ): Promise<
    Result<{ deployment: ServiceDeployment }, ValidationError | UnexpectedError>
  > => {
    const { serviceDeploymentStorage } = serviceRpcDeps();
    const deployment = await serviceDeploymentStorage.get(req.deploymentId);
    if (!deployment) {
      return invalid("/deploymentId", "service deployment not found", {
        deploymentId: req.deploymentId,
      });
    }
    const nextDeployment = toggleDeploymentDisabled(
      deployment,
      false,
    );
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
}) {
  return async (
    { input: req }: { input: { deploymentId: string } },
  ): Promise<
    Result<{ success: boolean }, ValidationError | UnexpectedError>
  > => {
    const { serviceDeploymentStorage, serviceInstanceStorage } =
      serviceRpcDeps();
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

export function createAuthProvisionServiceInstanceHandler() {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { deploymentId: string; instanceKey: string };
      context: { caller: RpcUser };
    },
  ) => {
    const { logger, serviceDeploymentStorage, serviceInstanceStorage } =
      serviceRpcDeps();
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

export const authListServiceInstancesHandler = async (
  { input: req }: { input: { deploymentId?: string; disabled?: boolean } },
): Promise<Result<{ instances: ServiceInstance[] }, UnexpectedError>> => {
  const { logger, serviceInstanceStorage } = serviceRpcDeps();
  logger.trace({ rpc: "Auth.ListServiceInstances" }, "RPC request");
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

async function setInstanceDisabled(args: {
  instanceId: string;
  disabled: boolean;
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}): Promise<
  Result<{ instance: ServiceInstance }, ValidationError | UnexpectedError>
> {
  const { serviceInstanceStorage } = serviceRpcDeps();
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
  });
  return Result.ok({ instance: nextInstance });
}

export function createAuthDisableServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async ({ input: req }: { input: { instanceId: string } }) =>
    await setInstanceDisabled({
      ...req,
      disabled: true,
      kick: deps.kick,
      refreshActiveContracts: deps.refreshActiveContracts,
    });
}

export function createAuthEnableServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async ({ input: req }: { input: { instanceId: string } }) =>
    await setInstanceDisabled({
      ...req,
      disabled: false,
      kick: deps.kick,
      refreshActiveContracts: deps.refreshActiveContracts,
    });
}

export function createAuthRemoveServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async ({ input: req }: { input: { instanceId: string } }) => {
    const { serviceInstanceStorage } = serviceRpcDeps();
    const instance = await serviceInstanceStorage.get(req.instanceId);
    if (!instance) {
      return invalid("/instanceId", "service instance not found", {
        instanceId: req.instanceId,
      });
    }
    await kickInstanceRuntimeAccess({
      instanceKey: instance.instanceKey,
      kick: deps.kick,
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

export async function loadServiceInstanceByKey(
  instanceKey: string,
): Promise<ServiceInstance | null> {
  const { serviceInstanceStorage } = serviceRpcDeps();
  return await serviceInstanceStorage.getByInstanceKey(instanceKey) ?? null;
}

export async function loadServiceDeployment(
  deploymentId: string,
): Promise<ServiceDeployment | null> {
  const { serviceDeploymentStorage } = serviceRpcDeps();
  return await serviceDeploymentStorage.get(deploymentId) ?? null;
}
