import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { type AsyncResult, type BaseError, isErr, Result } from "@qlever-llc/result";

import {
  connectionsKV,
  logger,
  serviceInstancesKV,
  serviceProfilesKV,
  sessionKV,
} from "../../bootstrap/globals.ts";
import type { Connection, Session } from "../../state/schemas.ts";
import {
  normalizeAppliedContracts,
  type ServiceInstance,
  serviceInstanceId,
  type ServiceProfile,
  validateServiceProfileRequest,
  validateServiceProvisionRequest,
} from "./shared.ts";

type RpcUser = { type: string; id?: string };

type KVLike<V> = {
  get: (key: string) => AsyncResult<{ value: V } | V | unknown, BaseError>;
  put: (key: string, value: V) => AsyncResult<void | unknown, BaseError>;
  delete: (key: string) => AsyncResult<void | unknown, BaseError>;
  keys: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
  create?: (key: string, value: V) => AsyncResult<void | unknown, BaseError>;
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

async function listValues<V extends { [key: string]: unknown }>(
  store: KVLike<V>,
): Promise<V[]> {
  const keys = await store.keys(">").take();
  if (isErr(keys)) return [];
  const values: V[] = [];
  for await (const key of keys as AsyncIterable<string>) {
    const entry = await store.get(key).take();
    if (!isErr(entry)) values.push(unwrapValue<V>(entry));
  }
  return values;
}

async function kickInstanceRuntimeAccess(args: {
  instanceKey: string;
  connectionsKV?: KVLike<Connection>;
  sessionKV?: KVLike<Session>;
  kick: (serverId: string, clientId: number) => Promise<void>;
}): Promise<void> {
  const connectionStore = args.connectionsKV ?? connectionsKV;
  const sessionStore = args.sessionKV ?? sessionKV;

  const connectionKeys = await connectionStore.keys(`${args.instanceKey}.>.>`).take();
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

  const sessionKeys = await sessionStore.keys(`${args.instanceKey}.>`).take();
  if (!isErr(sessionKeys)) {
    for await (const key of sessionKeys as AsyncIterable<string>) {
      await sessionStore.delete(key);
    }
  }
}

async function instancesForProfile(
  profileId: string,
  store: KVLike<ServiceInstance>,
): Promise<ServiceInstance[]> {
  return (await listValues(store)).filter((instance) =>
    instance.profileId === profileId);
}

export const authListServiceProfilesHandler = async (
  req: { disabled?: boolean },
): Promise<Result<{ profiles: ServiceProfile[] }, UnexpectedError>> => {
  logger.trace({ rpc: "Auth.ListServiceProfiles" }, "RPC request");
  const profiles = (await listValues<ServiceProfile>(
    serviceProfilesKV as unknown as KVLike<ServiceProfile>,
  )).filter((profile) =>
      req.disabled === undefined || profile.disabled === req.disabled)
    .sort((left, right) => left.profileId.localeCompare(right.profileId));
  return Result.ok({ profiles });
};

export function createAuthCreateServiceProfileHandler() {
  return async (
    req: { profileId: string; namespaces: string[] },
    { caller }: { caller: RpcUser },
  ) => {
    logger.trace({
      rpc: "Auth.CreateServiceProfile",
      caller,
      profileId: req.profileId,
    }, "RPC request");
    const validated = validateServiceProfileRequest(req).take();
    if (isErr(validated)) return Result.err(validated.error);
    const { profile } = validated;

    const existing = await serviceProfilesKV.get(profile.profileId).take();
    if (!isErr(existing)) {
      return invalid("/profileId", "service profile already exists", {
        profileId: profile.profileId,
      });
    }

    const created =
      await serviceProfilesKV.create!(profile.profileId, profile).take();
    if (isErr(created)) {
      return Result.err(
        new UnexpectedError({ cause: created.error as BaseError }),
      );
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
}) {
  return async (
    req: { profileId: string; contract: unknown },
    { caller }: { caller: RpcUser },
  ) => {
    logger.trace({
      rpc: "Auth.ApplyServiceProfileContract",
      caller,
      profileId: req.profileId,
    }, "RPC request");
    const entry = await serviceProfilesKV.get(req.profileId).take();
    if (isErr(entry)) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    const profile = unwrapValue<ServiceProfile>(entry);

    const installed = await deps.installServiceContract(req.contract);
    const nextProfile: ServiceProfile = {
      ...profile,
      namespaces: [
        ...new Set([...profile.namespaces, ...installed.usedNamespaces]),
      ]
        .sort((left, right) => left.localeCompare(right)),
      appliedContracts: normalizeAppliedContracts([
        ...profile.appliedContracts,
        { contractId: installed.id, allowedDigests: [installed.digest] },
      ]),
    };
    const put =
      await serviceProfilesKV.put(nextProfile.profileId, nextProfile).take();
    if (isErr(put)) {
      return Result.err(new UnexpectedError({ cause: put.error as BaseError }));
    }

    return Result.ok({
      profile: nextProfile,
      contract: {
        digest: installed.digest,
        id: installed.id,
        displayName: installed.displayName,
        description: installed.description,
        installedAt: new Date().toISOString(),
      },
    });
  };
}

export function createAuthUnapplyServiceProfileContractHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async (
    req: { profileId: string; contractId: string; digests?: string[] },
    { caller }: { caller: RpcUser },
  ) => {
    logger.trace({
      rpc: "Auth.UnapplyServiceProfileContract",
      caller,
      profileId: req.profileId,
    }, "RPC request");
    const entry = await serviceProfilesKV.get(req.profileId).take();
    if (isErr(entry)) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    const profile = unwrapValue<ServiceProfile>(entry);

    const removeDigests = new Set(req.digests ?? []);
    const nextContracts = profile.appliedContracts
      .map((applied) => {
        if (applied.contractId !== req.contractId) return applied;
        if (removeDigests.size === 0) return null;
        const remaining = applied.allowedDigests.filter((digest) =>
          !removeDigests.has(digest)
        );
        return remaining.length > 0
          ? { ...applied, allowedDigests: remaining }
          : null;
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    const nextProfile: ServiceProfile = {
      ...profile,
      appliedContracts: normalizeAppliedContracts(nextContracts),
    };
    const put =
      await serviceProfilesKV.put(nextProfile.profileId, nextProfile).take();
    if (isErr(put)) {
      return Result.err(new UnexpectedError({ cause: put.error as BaseError }));
    }

    for (
      const instance of await instancesForProfile(
        profile.profileId,
        serviceInstancesKV,
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
}) {
  return async (req: { profileId: string }) => {
    const entry = await serviceProfilesKV.get(req.profileId).take();
    if (isErr(entry)) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    const nextProfile = toggleProfileDisabled(
      unwrapValue<ServiceProfile>(entry),
      true,
    );
    const put =
      await serviceProfilesKV.put(nextProfile.profileId, nextProfile).take();
    if (isErr(put)) {
      return Result.err(new UnexpectedError({ cause: put.error as BaseError }));
    }
    for (
      const instance of await instancesForProfile(
        nextProfile.profileId,
        serviceInstancesKV,
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

export const authEnableServiceProfileHandler = async (
  req: { profileId: string },
): Promise<
  Result<{ profile: ServiceProfile }, ValidationError | UnexpectedError>
> => {
  const entry = await serviceProfilesKV.get(req.profileId).take();
  if (isErr(entry)) {
    return invalid("/profileId", "service profile not found", {
      profileId: req.profileId,
    });
  }
  const nextProfile = toggleProfileDisabled(
    unwrapValue<ServiceProfile>(entry),
    false,
  );
  const put = await serviceProfilesKV.put(nextProfile.profileId, nextProfile).take();
  if (isErr(put)) {
    return Result.err(new UnexpectedError({ cause: put.error as BaseError }));
  }
  return Result.ok({ profile: nextProfile });
};

export const authRemoveServiceProfileHandler = async (
  req: { profileId: string },
): Promise<Result<{ success: boolean }, ValidationError | UnexpectedError>> => {
  const instances = await instancesForProfile(
    req.profileId,
    serviceInstancesKV,
  );
  if (instances.length > 0) {
    return invalid("/profileId", "service profile still has instances", {
      profileId: req.profileId,
    });
  }
  const deleted = await serviceProfilesKV.delete(req.profileId).take();
  if (isErr(deleted)) {
    return Result.err(
      new UnexpectedError({ cause: deleted.error as BaseError }),
    );
  }
  return Result.ok({ success: true });
};

export function createAuthProvisionServiceInstanceHandler() {
  return async (
    req: { profileId: string; instanceKey: string },
    { caller }: { caller: RpcUser },
  ) => {
    logger.trace({
      rpc: "Auth.ProvisionServiceInstance",
      caller,
      profileId: req.profileId,
    }, "RPC request");
    const profileEntry = await serviceProfilesKV.get(req.profileId).take();
    if (isErr(profileEntry)) {
      return invalid("/profileId", "service profile not found", {
        profileId: req.profileId,
      });
    }
    const profile = unwrapValue<ServiceProfile>(profileEntry);
    if (profile.disabled) {
      return invalid("/profileId", "service profile is disabled", {
        profileId: req.profileId,
      });
    }

    const validated = validateServiceProvisionRequest(req).take();
    if (isErr(validated)) return Result.err(validated.error);
    const { instance } = validated;

    const existing = await serviceInstancesKV.get(instance.instanceId).take();
    if (!isErr(existing)) {
      return invalid("/instanceKey", "service instance already exists", {
        instanceId: instance.instanceId,
      });
    }

    const created =
      await serviceInstancesKV.create!(instance.instanceId, instance).take();
    if (isErr(created)) {
      return Result.err(
        new UnexpectedError({ cause: created.error as BaseError }),
      );
    }
    return Result.ok({ instance });
  };
}

export const authListServiceInstancesHandler = async (
  req: { profileId?: string; disabled?: boolean },
): Promise<Result<{ instances: ServiceInstance[] }, UnexpectedError>> => {
  logger.trace({ rpc: "Auth.ListServiceInstances" }, "RPC request");
  const instances = (await listValues<ServiceInstance>(
    serviceInstancesKV as unknown as KVLike<ServiceInstance>,
  )).filter((instance) =>
      req.profileId === undefined || instance.profileId === req.profileId)
    .filter((instance) =>
      req.disabled === undefined || instance.disabled === req.disabled
    )
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  return Result.ok({ instances });
};

async function setInstanceDisabled(args: {
  instanceId: string;
  disabled: boolean;
  kick: (serverId: string, clientId: number) => Promise<void>;
}): Promise<
  Result<{ instance: ServiceInstance }, ValidationError | UnexpectedError>
> {
  const entry = await serviceInstancesKV.get(args.instanceId).take();
  if (isErr(entry)) {
    return invalid("/instanceId", "service instance not found", {
      instanceId: args.instanceId,
    });
  }
  const instance = unwrapValue<ServiceInstance>(entry);
  const nextInstance = { ...instance, disabled: args.disabled };
  const put =
    await serviceInstancesKV.put(nextInstance.instanceId, nextInstance).take();
  if (isErr(put)) {
    return Result.err(new UnexpectedError({ cause: put.error as BaseError }));
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
  return async (req: { instanceId: string }) =>
    await setInstanceDisabled({ ...req, disabled: true, kick: deps.kick });
}

export function createAuthEnableServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
}) {
  return async (req: { instanceId: string }) =>
    await setInstanceDisabled({ ...req, disabled: false, kick: deps.kick });
}

export function createAuthRemoveServiceInstanceHandler(deps: {
  kick: (serverId: string, clientId: number) => Promise<void>;
  refreshActiveContracts: () => Promise<void>;
}) {
  return async (req: { instanceId: string }) => {
    const entry = await serviceInstancesKV.get(req.instanceId).take();
    if (isErr(entry)) {
      return invalid("/instanceId", "service instance not found", {
        instanceId: req.instanceId,
      });
    }
    const instance = unwrapValue<ServiceInstance>(entry);
    await kickInstanceRuntimeAccess({
      instanceKey: instance.instanceKey,
      kick: deps.kick,
    });
    const deleted = await serviceInstancesKV.delete(req.instanceId).take();
    if (isErr(deleted)) {
      return Result.err(
        new UnexpectedError({ cause: deleted.error as BaseError }),
      );
    }
    await deps.refreshActiveContracts();
    return Result.ok({ success: true });
  };
}

export async function loadServiceInstanceByKey(
  instanceKey: string,
): Promise<ServiceInstance | null> {
  const entry = await serviceInstancesKV.get(serviceInstanceId(instanceKey)).take();
  if (isErr(entry)) return null;
  const instance = unwrapValue<ServiceInstance>(entry);
  return instance.instanceKey === instanceKey ? instance : null;
}

export async function loadServiceProfile(
  profileId: string,
): Promise<ServiceProfile | null> {
  const entry = await serviceProfilesKV.get(profileId).take();
  if (isErr(entry)) return null;
  return unwrapValue<ServiceProfile>(entry);
}
