import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import {
  type AsyncResult,
  type BaseError,
  isErr,
  Result,
} from "@qlever-llc/result";

import {
  connectionsKV,
  logger,
  serviceInstanceStorage,
  serviceProfileStorage,
  sessionStorage,
} from "../../bootstrap/globals.ts";
import type { Connection } from "../../state/schemas.ts";
import type { SqlSessionRepository } from "../storage.ts";
import { connectionFilterForSession } from "../session/connections.ts";
import { createAuthApplyServiceProfileContractHandler as createAuthApplyServiceProfileContractHandlerBase } from "./service_profile_apply.ts";
import {
  normalizeAppliedContracts,
  type ServiceInstance,
  type ServiceProfile,
  validateServiceProfileRequest,
  validateServiceProvisionRequest,
} from "./shared.ts";

type RpcUser = { type: string; id?: string };

type ServiceProfileStorage = typeof serviceProfileStorage;
type ServiceInstanceStorage = typeof serviceInstanceStorage;

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
  const connectionStore = args.connectionsKV ?? connectionsKV;
  const sessionStore = args.sessionStorage ?? sessionStorage;

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

async function instancesForProfile(
  profileId: string,
  store: ServiceInstanceStorage = serviceInstanceStorage,
): Promise<ServiceInstance[]> {
  return await store.listByProfile(profileId);
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

export const authListServiceProfilesHandler = async (
  { input: req }: { input: { disabled?: boolean } },
): Promise<Result<{ profiles: ServiceProfile[] }, UnexpectedError>> => {
  logger.trace({ rpc: "Auth.ListServiceProfiles" }, "RPC request");
  try {
    const profiles = (await serviceProfileStorage.list()).filter((profile) =>
      req.disabled === undefined || profile.disabled === req.disabled
    );
    return Result.ok({ profiles });
  } catch (error) {
    return Result.err(new UnexpectedError({ cause: toError(error) }));
  }
};

export function createAuthCreateServiceProfileHandler() {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { profileId: string; namespaces: string[] };
      context: { caller: RpcUser };
    },
  ) => {
    logger.trace({
      rpc: "Auth.CreateServiceProfile",
      caller,
      profileId: req.profileId,
    }, "RPC request");
    const validated = validateServiceProfileRequest(req).take();
    if (isErr(validated)) return Result.err(validated.error);
    const { profile } = validated;

    const existing = await serviceProfileStorage.get(profile.profileId);
    if (existing) {
      return invalid("/profileId", "service profile already exists", {
        profileId: profile.profileId,
      });
    }

    try {
      await serviceProfileStorage.put(profile);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    return Result.ok({ profile });
  };
}

export function createAuthApplyServiceProfileContractHandler(deps: {
  installServiceContract: (contract: unknown) => Promise<{
    id: string;
    digest: string;
    displayName: string;
    description: string;
    usedNamespaces: string[];
  }>;
  refreshActiveContracts: () => Promise<void>;
}) {
  const handler = createAuthApplyServiceProfileContractHandlerBase({
    ...deps,
    serviceProfileStorage,
  });
  return async (args: {
    input: { profileId: string; contract: unknown };
    context: { caller: RpcUser };
  }) => {
    logger.trace({
      rpc: "Auth.ApplyServiceProfileContract",
      caller: args.context.caller,
      profileId: args.input.profileId,
    }, "RPC request");
    return await handler(args);
  };
}

export function createAuthUnapplyServiceProfileContractHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: { profileId: string; contractId: string; digests?: string[] };
      context: { caller: RpcUser };
    },
  ) => {
    logger.trace({
      rpc: "Auth.UnapplyServiceProfileContract",
      caller,
      profileId: req.profileId,
    }, "RPC request");
    const profile = await serviceProfileStorage.get(req.profileId);
    if (!profile) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }

    const removeDigests = new Set(req.digests ?? []);
    const nextContracts = profile.appliedContracts
      .map((applied: ServiceProfile["appliedContracts"][number]) => {
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
        value: ServiceProfile["appliedContracts"][number] | null,
      ): value is ServiceProfile["appliedContracts"][number] => value !== null);

    const nextProfile: ServiceProfile = {
      ...profile,
      appliedContracts: normalizeAppliedContracts(nextContracts),
    };
    try {
      await serviceProfileStorage.put(nextProfile);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }

    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;

    for (
      const instance of await instancesForProfile(
        profile.profileId,
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

    return Result.ok({ profile: nextProfile });
  };
}

function toggleProfileDisabled(
  profile: ServiceProfile,
  disabled: boolean,
): ServiceProfile {
  return { ...profile, disabled };
}

export function createAuthDisableServiceProfileHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async ({ input: req }: { input: { profileId: string } }) => {
    const profile = await serviceProfileStorage.get(req.profileId);
    if (!profile) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    const nextProfile = toggleProfileDisabled(
      profile,
      true,
    );
    try {
      await serviceProfileStorage.put(nextProfile);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;
    for (
      const instance of await instancesForProfile(
        nextProfile.profileId,
        serviceInstanceStorage,
      )
    ) {
      await kickInstanceRuntimeAccess({
        instanceKey: instance.instanceKey,
        kick: deps.kick,
      });
    }
    return Result.ok({ profile: nextProfile });
  };
}

export function createAuthEnableServiceProfileHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (
    { input: req }: { input: { profileId: string } },
  ): Promise<
    Result<{ profile: ServiceProfile }, ValidationError | UnexpectedError>
  > => {
    const profile = await serviceProfileStorage.get(req.profileId);
    if (!profile) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    const nextProfile = toggleProfileDisabled(
      profile,
      false,
    );
    try {
      await serviceProfileStorage.put(nextProfile);
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
    const refreshed = await refreshActiveContracts(deps.refreshActiveContracts);
    if (isErr(refreshed)) return refreshed;
    return Result.ok({ profile: nextProfile });
  };
}

export function createAuthRemoveServiceProfileHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (
    { input: req }: { input: { profileId: string } },
  ): Promise<
    Result<{ success: boolean }, ValidationError | UnexpectedError>
  > => {
    const instances = await instancesForProfile(
      req.profileId,
      serviceInstanceStorage,
    );
    if (instances.length > 0) {
      return invalid("/profileId", "service profile still has instances", {
        profileId: req.profileId,
      });
    }
    const existing = await serviceProfileStorage.get(req.profileId);
    if (!existing) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    try {
      await serviceProfileStorage.delete(req.profileId);
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
      input: { profileId: string; instanceKey: string };
      context: { caller: RpcUser };
    },
  ) => {
    logger.trace({
      rpc: "Auth.ProvisionServiceInstance",
      caller,
      profileId: req.profileId,
    }, "RPC request");
    const profile = await serviceProfileStorage.get(req.profileId);
    if (!profile) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    if (profile.disabled) {
      return invalid("/profileId", "service profile is disabled", {
        profileId: req.profileId,
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
  { input: req }: { input: { profileId?: string; disabled?: boolean } },
): Promise<Result<{ instances: ServiceInstance[] }, UnexpectedError>> => {
  logger.trace({ rpc: "Auth.ListServiceInstances" }, "RPC request");
  try {
    const instances = (req.profileId === undefined
      ? await serviceInstanceStorage.list()
      : await serviceInstanceStorage.listByProfile(req.profileId))
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
}): Promise<
  Result<{ instance: ServiceInstance }, ValidationError | UnexpectedError>
> {
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
  await kickInstanceRuntimeAccess({
    instanceKey: nextInstance.instanceKey,
    kick: args.kick,
  });
  return Result.ok({ instance: nextInstance });
}

export function createAuthDisableServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async ({ input: req }: { input: { instanceId: string } }) =>
    await setInstanceDisabled({ ...req, disabled: true, kick: deps.kick });
}

export function createAuthEnableServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async ({ input: req }: { input: { instanceId: string } }) =>
    await setInstanceDisabled({ ...req, disabled: false, kick: deps.kick });
}

export function createAuthRemoveServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async ({ input: req }: { input: { instanceId: string } }) => {
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
  return await serviceInstanceStorage.getByInstanceKey(instanceKey) ?? null;
}

export async function loadServiceProfile(
  profileId: string,
): Promise<ServiceProfile | null> {
  return await serviceProfileStorage.get(profileId) ?? null;
}
