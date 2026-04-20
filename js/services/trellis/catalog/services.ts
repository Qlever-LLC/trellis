import { UnexpectedError, ValidationError } from "@qlever-llc/trellis";
import { type AsyncResult, isErr, Result, type BaseError } from "@qlever-llc/result";

import {
  connectionsKV,
  contractsKV,
  logger,
  servicesKV,
  sessionKV,
  trellis,
} from "../bootstrap/globals.ts";
import type { ContractResourceBindings } from "./resources.ts";
import type {
  Connection,
  ContractRecord,
  ServiceRegistryEntry,
  Session,
} from "../state/schemas.ts";
import {
  createAuthRemoveServiceHandler as createInjectedAuthRemoveServiceHandler,
  type KVLike as RemoveKVLike,
  type RpcUser,
} from "./remove_service.ts";

type ServiceLike = {
  displayName: string;
  active: boolean;
  capabilities: string[];
  namespaces?: string[];
  description: string;
  contractId?: string;
  contractDigest?: string;
  resourceBindings?: ContractResourceBindings;
  createdAt: Date;
};

type ServiceRow = {
  sessionKey: string;
  displayName: string;
  active: boolean;
  capabilities: string[];
  namespaces: string[];
  description: string;
  contractId?: string;
  contractDigest?: string;
  resourceBindings?: ServiceLike["resourceBindings"];
  createdAt: string;
};

type KVLike<V> = {
  get: (key: string) => AsyncResult<{ value: V }, BaseError>;
  put: (key: string, value: V) => AsyncResult<void, BaseError>;
  delete: (key: string) => AsyncResult<void, BaseError>;
  keys: (filter: string) => AsyncResult<AsyncIterable<string>, BaseError>;
};

type CreateKVLike<V> = KVLike<V> & {
  create: (key: string, value: V) => AsyncResult<void, BaseError>;
};

async function publishSessionRevoked(
  session: Session,
  sessionKey: string,
  revokedBy: string,
): Promise<void> {
  if (session.type === "device") {
    return;
  }
  (await trellis.publish("Auth.SessionRevoked", {
    origin: session.origin,
    id: session.id,
    sessionKey,
    revokedBy,
  })).inspectErr((error) =>
    logger.warn({ error }, "Failed to publish Auth.SessionRevoked")
  );
}

export const authListServicesHandler = async () => {
  logger.trace({ rpc: "Auth.ListServices" }, "RPC request");
  const keys = await servicesKV.keys(">").take();
  if (isErr(keys)) {
    return Result.err(new UnexpectedError({ cause: keys.error }));
  }

  const services: ServiceRow[] = [];
  for await (const sessionKey of keys) {
    const svc = await servicesKV.get(sessionKey).take();
    if (isErr(svc)) continue;
    services.push({
      sessionKey,
      displayName: svc.value.displayName,
      active: svc.value.active,
      capabilities: svc.value.capabilities,
      namespaces: svc.value.namespaces ?? [],
      description: svc.value.description,
      contractId: svc.value.contractId,
      contractDigest: svc.value.contractDigest,
      resourceBindings: svc.value.resourceBindings,
      createdAt: svc.value.createdAt.toISOString(),
    });
  }

  services.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return Result.ok({ services });
};

export function createAuthInstallServiceHandler(
  deps: {
    servicesKV?: CreateKVLike<ServiceRegistryEntry>;
    refreshActiveContracts: () => Promise<void>;
    prepareInstalledContract: (opts: {
      serviceSessionKey: string;
      namespaces: string[];
      contract: unknown;
      currentDigest?: string;
      currentContractId?: string;
    }) => Promise<{
      id: string;
      digest: string;
      capabilities: string[];
      resourceBindings: NonNullable<ServiceLike["resourceBindings"]>;
    }>;
  },
) {
  return async (
    req: {
      sessionKey: string;
      displayName: string;
      active?: boolean;
      namespaces: string[];
      description: string;
      contract: unknown;
    },
    { caller }: { caller: { type: string; id?: string } },
  ) => {
    logger.trace({
      rpc: "Auth.InstallService",
      caller,
      displayName: req.displayName,
    }, "RPC request");

    const serviceStore = deps.servicesKV ?? servicesKV;

    const existing = await serviceStore.get(req.sessionKey).take();
    if (!isErr(existing)) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/sessionKey",
            message: "service principal already exists",
          }],
          context: { sessionKey: req.sessionKey },
        }),
      );
    }

    let installed;
    try {
      installed = await deps.prepareInstalledContract({
        serviceSessionKey: req.sessionKey,
        namespaces: req.namespaces,
        contract: req.contract,
      });
    } catch (error) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/contract",
            message: error instanceof Error
              ? error.message
              : "invalid contract",
          }],
        }),
      );
    }

    const now = new Date();
    const created = await serviceStore.create(
        req.sessionKey,
        {
          displayName: req.displayName,
          active: req.active ?? true,
          capabilities: installed.capabilities,
          namespaces: req.namespaces,
          description: req.description,
          contractId: installed.id,
          contractDigest: installed.digest,
          resourceBindings: installed.resourceBindings,
          createdAt: now,
        } satisfies ServiceLike,
      ).take();

    if (isErr(created)) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/sessionKey",
            message:
              "service principal already exists (or could not be created)",
          }],
          context: { sessionKey: req.sessionKey },
        }),
      );
    }

    await deps.refreshActiveContracts();
    return Result.ok({
      success: true,
      sessionKey: req.sessionKey,
      contractId: installed.id,
      contractDigest: installed.digest,
      resourceBindings: installed.resourceBindings,
    });
  };
}

export function createAuthUpgradeServiceContractHandler(
  deps: {
    servicesKV?: KVLike<ServiceRegistryEntry>;
    refreshActiveContracts: () => Promise<void>;
    prepareInstalledContract: (opts: {
      serviceSessionKey: string;
      namespaces: string[];
      contract: unknown;
      currentDigest?: string;
      currentContractId?: string;
    }) => Promise<{
      id: string;
      digest: string;
      capabilities: string[];
      resourceBindings: NonNullable<ServiceLike["resourceBindings"]>;
    }>;
  },
) {
  return async (
    req: { sessionKey: string; contract: unknown },
    { caller }: { caller: { type: string; id?: string } },
  ) => {
    logger.trace({
      rpc: "Auth.UpgradeServiceContract",
      caller,
      sessionKey: req.sessionKey,
    }, "RPC request");
    const serviceStore = deps.servicesKV ?? servicesKV;
    const entry = await serviceStore.get(req.sessionKey).take();
    if (isErr(entry)) {
      return Result.err(
        new ValidationError({
          errors: [{ path: "/sessionKey", message: "service not found" }],
        }),
      );
    }

    let installed;
    try {
      installed = await deps.prepareInstalledContract({
        serviceSessionKey: req.sessionKey,
        namespaces: entry.value.namespaces ?? [],
        contract: req.contract,
        currentDigest: entry.value.contractDigest,
        currentContractId: entry.value.contractId,
      });
    } catch (error) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/contract",
            message: error instanceof Error
              ? error.message
              : "invalid contract",
          }],
        }),
      );
    }

    const put = await serviceStore.put(req.sessionKey, {
        ...entry.value,
        capabilities: installed.capabilities,
        contractId: installed.id,
        contractDigest: installed.digest,
        resourceBindings: installed.resourceBindings,
      }).take();
    if (isErr(put)) {
      return Result.err(new UnexpectedError({ cause: put.error }));
    }

    await deps.refreshActiveContracts();
    return Result.ok({
      success: true,
      sessionKey: req.sessionKey,
      contractId: installed.id,
      contractDigest: installed.digest,
      resourceBindings: installed.resourceBindings,
    });
  };
}

export function createAuthRemoveServiceHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
  kick: (serverId: string, clientId: number) => Promise<void>;
  servicesKV?: RemoveKVLike<ServiceRegistryEntry>;
  sessionKV?: RemoveKVLike<Session>;
  connectionsKV?: RemoveKVLike<Connection>;
  contractsKV?: RemoveKVLike<ContractRecord>;
  publishSessionRevoked?: (
    session: Session,
    sessionKey: string,
    revokedBy: string,
  ) => Promise<void>;
}) {
  const handler = createInjectedAuthRemoveServiceHandler({
    refreshActiveContracts: deps.refreshActiveContracts,
    kick: deps.kick,
    servicesKV: deps.servicesKV ?? servicesKV,
    sessionKV: deps.sessionKV ?? sessionKV,
    connectionsKV: deps.connectionsKV ?? connectionsKV,
    contractsKV: deps.contractsKV ?? contractsKV,
    publishSessionRevoked: deps.publishSessionRevoked ?? publishSessionRevoked,
  });

  return async (req: { sessionKey: string }, context: { caller: RpcUser }) => {
    logger.trace({
      rpc: "Auth.RemoveService",
      caller: context.caller,
      sessionKey: req.sessionKey,
    }, "RPC request");
    return handler(req, context);
  };
}
