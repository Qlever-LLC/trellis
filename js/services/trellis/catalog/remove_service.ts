import { UnexpectedError } from "@qlever-llc/trellis";
import { type AsyncResult, isErr, Result, type BaseError } from "@qlever-llc/result";

import type {
  Connection,
  ContractRecord,
  ServiceRegistryEntry,
  Session,
} from "../state/schemas.ts";

export type KVLike<V> = {
  get: (key: string) => AsyncResult<{ value: V }, BaseError>;
  put: (key: string, value: V) => AsyncResult<void, BaseError>;
  delete: (key: string) => AsyncResult<void, BaseError>;
  keys: (filter: string) => AsyncResult<AsyncIterable<string>, BaseError>;
};

export type RpcUser = {
  type: string;
  id?: string;
  origin?: string;
};

function revokedByLabel(caller: RpcUser): string {
  if (caller.origin && caller.id) {
    return `${caller.origin}.${caller.id}`;
  }
  return caller.id ?? caller.type;
}

async function revokeServiceRuntimeAccess(opts: {
  sessionKey: string;
  caller: RpcUser;
  sessionKV: KVLike<Session>;
  connectionsKV: KVLike<Connection>;
  kick: (serverId: string, clientId: number) => Promise<void>;
  publishSessionRevoked: (
    session: Session,
    sessionKey: string,
    revokedBy: string,
  ) => Promise<void>;
}) {
  const sessionIter = await opts.sessionKV.keys(`${opts.sessionKey}.>`).take();
  if (isErr(sessionIter)) {
    return Result.err(new UnexpectedError({ cause: sessionIter.error }));
  }

  const sessionKeys: string[] = [];
  for await (const key of sessionIter) {
    sessionKeys.push(key);
  }

  const connectionIter = await opts.connectionsKV.keys(`${opts.sessionKey}.>.>`).take();
  if (isErr(connectionIter)) {
    return Result.err(new UnexpectedError({ cause: connectionIter.error }));
  }

  for await (const key of connectionIter) {
    const connectionEntry = await opts.connectionsKV.get(key).take();
    if (!isErr(connectionEntry)) {
      await opts.kick(connectionEntry.value.serverId, connectionEntry.value.clientId);
    }
    const deleted = await opts.connectionsKV.delete(key).take();
    if (isErr(deleted)) {
      return Result.err(new UnexpectedError({ cause: deleted.error }));
    }
  }

  const revokedBy = revokedByLabel(opts.caller);
  for (const key of sessionKeys) {
    const sessionEntry = await opts.sessionKV.get(key).take();
    if (!isErr(sessionEntry)) {
      await opts.publishSessionRevoked(
        sessionEntry.value,
        opts.sessionKey,
        revokedBy,
      );
    }
    const deleted = await opts.sessionKV.delete(key).take();
    if (isErr(deleted)) {
      return Result.err(new UnexpectedError({ cause: deleted.error }));
    }
  }

  return Result.ok(undefined);
}

async function findReplacementServiceKey(opts: {
  servicesKV: KVLike<ServiceRegistryEntry>;
  removedSessionKey: string;
  digest: string;
}) {
  const keys = await opts.servicesKV.keys(">" ).take();
  if (isErr(keys)) {
    return Result.err(new UnexpectedError({ cause: keys.error }));
  }

  for await (const sessionKey of keys) {
    if (sessionKey === opts.removedSessionKey) {
      continue;
    }
    const service = await opts.servicesKV.get(sessionKey).take();
    if (isErr(service)) {
      continue;
    }
    if (service.value.contractDigest === opts.digest) {
      return Result.ok<string | undefined>(sessionKey);
    }
  }

  return Result.ok(undefined);
}

async function repairInstalledContractLink(opts: {
  contractsKV: KVLike<ContractRecord>;
  servicesKV: KVLike<ServiceRegistryEntry>;
  removedSessionKey: string;
  digest?: string;
}) {
  if (!opts.digest) {
    return Result.ok(undefined);
  }

  const contractEntry = await opts.contractsKV.get(opts.digest).take();
  if (isErr(contractEntry)) {
    return Result.ok(undefined);
  }
  if (contractEntry.value.sessionKey !== opts.removedSessionKey) {
    return Result.ok(undefined);
  }

  const replacement = await findReplacementServiceKey({
    servicesKV: opts.servicesKV,
    removedSessionKey: opts.removedSessionKey,
    digest: opts.digest,
  }).then((result) => result.take());
  if (isErr(replacement)) {
    return replacement;
  }

  const nextRecord = replacement
    ? { ...contractEntry.value, sessionKey: replacement }
    : (() => {
      const { sessionKey: _sessionKey, ...rest } = contractEntry.value;
      return rest;
    })();
  const put = await opts.contractsKV.put(opts.digest, nextRecord).take();
  if (isErr(put)) {
    return Result.err(new UnexpectedError({ cause: put.error }));
  }

  return Result.ok(undefined);
}

export function createAuthRemoveServiceHandler(deps: {
  refreshActiveContracts: () => Promise<void>;
  kick: (serverId: string, clientId: number) => Promise<void>;
  servicesKV: KVLike<ServiceRegistryEntry>;
  sessionKV: KVLike<Session>;
  connectionsKV: KVLike<Connection>;
  contractsKV: KVLike<ContractRecord>;
  publishSessionRevoked: (
    session: Session,
    sessionKey: string,
    revokedBy: string,
  ) => Promise<void>;
}) {
  return async (
    req: { sessionKey: string },
    { caller }: { caller: RpcUser },
  ) => {
    const serviceEntry = await deps.servicesKV.get(req.sessionKey).take();
    if (isErr(serviceEntry)) {
      return Result.ok({ success: false });
    }

    const revokeResult = await revokeServiceRuntimeAccess({
      sessionKey: req.sessionKey,
      caller,
      sessionKV: deps.sessionKV,
      connectionsKV: deps.connectionsKV,
      kick: deps.kick,
      publishSessionRevoked: deps.publishSessionRevoked,
    });
    if (isErr(revokeResult)) {
      return revokeResult;
    }

    const deleted = await deps.servicesKV.delete(req.sessionKey).take();
    if (isErr(deleted)) {
      return Result.err(new UnexpectedError({ cause: deleted.error }));
    }

    const repairResult = await repairInstalledContractLink({
      contractsKV: deps.contractsKV,
      servicesKV: deps.servicesKV,
      removedSessionKey: req.sessionKey,
      digest: serviceEntry.value.contractDigest,
    });
    if (isErr(repairResult)) {
      return repairResult;
    }

    await deps.refreshActiveContracts();
    return Result.ok({ success: true });
  };
}
