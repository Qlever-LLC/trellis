import type { JsonValue } from "@qlever-llc/trellis/contracts";
import { isJsonValue } from "@qlever-llc/trellis/contracts";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import type { AsyncResult, BaseError } from "@qlever-llc/result";
import { isErr } from "@qlever-llc/result";
import { AuthError, ValidationError } from "@qlever-llc/trellis";

import type {
  StateAdminDeleteInput,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminDelete.ts";
import type { StateAdminGetInput } from "../../../packages/trellis/models/trellis/rpc/StateAdminGet.ts";
import type { StateAdminListInput } from "../../../packages/trellis/models/trellis/rpc/StateAdminList.ts";
import type { StateCompareAndSetInput } from "../../../packages/trellis/models/trellis/rpc/StateCompareAndSet.ts";
import type { StateDeleteInput } from "../../../packages/trellis/models/trellis/rpc/StateDelete.ts";
import type { StateGetInput } from "../../../packages/trellis/models/trellis/rpc/StateGet.ts";
import type { StateListInput } from "../../../packages/trellis/models/trellis/rpc/StateList.ts";
import type { StatePutInput } from "../../../packages/trellis/models/trellis/rpc/StatePut.ts";
import type { Session } from "../state/schemas.ts";
import type { StateNamespace } from "./model.ts";
import { StateStore } from "./storage.ts";

type SessionLike = {
  get: (key: string) => AsyncResult<{ value: Session } | Session | unknown, BaseError>;
  keys: (filter: string) => AsyncResult<AsyncIterable<string> | unknown, BaseError>;
};

type Caller = {
  type: string;
  origin?: string;
  id?: string;
  capabilities?: string[];
};

type RpcDeps = {
  sessionKV: SessionLike;
  state: StateStore;
};

function unwrapValue<V>(entry: unknown): V {
  if (entry && typeof entry === "object" && "value" in entry) {
    return (entry as { value: V }).value;
  }
  return entry as V;
}

async function loadSessionBySessionKey(sessionKey: string, sessionStore: SessionLike): Promise<Session | null> {
  const keysIter = unwrapValue<AsyncIterable<string>>((await sessionStore.keys(`${sessionKey}.>`)).take());
  if (isErr(keysIter)) return null;

  let sessionKeyId: string | undefined;
  for await (const key of keysIter) {
    if (!sessionKeyId) sessionKeyId = key;
    else {
      throw new AuthError({ reason: "session_corrupted", context: { sessionKey } });
    }
  }

  if (!sessionKeyId) return null;
  const sessionValue = unwrapValue<Session>((await sessionStore.get(sessionKeyId)).take());
  if (isErr(sessionValue)) return null;
  return sessionValue;
}

function isAdmin(caller: Caller): boolean {
  return caller.capabilities?.includes("admin") ?? false;
}

async function resolveCallerNamespace(
  req: { scope?: string },
  ctx: { caller: Caller; sessionKey: string },
  deps: RpcDeps,
): Promise<StateNamespace> {
  const session = await loadSessionBySessionKey(ctx.sessionKey, deps.sessionKV);
  if (!session) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  if (req.scope === "userApp") {
    if (ctx.caller.type !== "user" || session.type !== "user") {
      throw new AuthError({ reason: "insufficient_permissions" });
    }

    return {
      scope: "userApp",
      contractId: session.contractId,
      ownerKey: session.trellisId,
    };
  }

  if (req.scope !== "deviceApp" || ctx.caller.type !== "device" || session.type !== "device") {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  return {
    scope: "deviceApp",
    contractId: session.contractId,
    ownerKey: session.instanceId,
  };
}

async function resolveAdminNamespace(req: StateAdminGetInput | StateAdminListInput | StateAdminDeleteInput): Promise<StateNamespace> {
  if (req.scope === "userApp") {
    return {
      scope: "userApp",
      contractId: req.contractId,
      ownerKey: await trellisIdFromOriginId(req.user.origin, req.user.id),
    };
  }

  return {
    scope: "deviceApp",
    contractId: req.contractId,
    ownerKey: req.deviceId,
  };
}

function requireAdmin(caller: Caller): void {
  if (!isAdmin(caller)) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
}

function requireJsonValue(value: unknown): JsonValue {
  if (!isJsonValue(value)) {
    throw new ValidationError({
      errors: [{ path: "/value", message: "state value must be valid JSON" }],
    });
  }
  return value;
}

export function createStateGetHandler(deps: RpcDeps) {
  return async (req: StateGetInput, ctx: { caller: Caller; sessionKey: string }) => {
    const namespace = await resolveCallerNamespace(req, ctx, deps);
    return deps.state.get(namespace, req.key);
  };
}

export function createStatePutHandler(deps: RpcDeps) {
  return async (req: StatePutInput, ctx: { caller: Caller; sessionKey: string }) => {
    const namespace = await resolveCallerNamespace(req, ctx, deps);
    return deps.state.put(namespace, req.key, requireJsonValue(req.value), req.ttlMs);
  };
}

export function createStateDeleteHandler(deps: RpcDeps) {
  return async (req: StateDeleteInput, ctx: { caller: Caller; sessionKey: string }) => {
    const namespace = await resolveCallerNamespace(req, ctx, deps);
    return deps.state.delete(namespace, req.key, req.expectedRevision);
  };
}

export function createStateCompareAndSetHandler(deps: RpcDeps) {
  return async (req: StateCompareAndSetInput, ctx: { caller: Caller; sessionKey: string }) => {
    const namespace = await resolveCallerNamespace(req, ctx, deps);
    return deps.state.compareAndSet(
      namespace,
      req.key,
      req.expectedRevision,
      requireJsonValue(req.value),
      req.ttlMs,
    );
  };
}

export function createStateListHandler(deps: RpcDeps) {
  return async (req: StateListInput, ctx: { caller: Caller; sessionKey: string }) => {
    const namespace = await resolveCallerNamespace(req, ctx, deps);
    return deps.state.list(namespace, { prefix: req.prefix, offset: req.offset, limit: req.limit });
  };
}

export function createStateAdminGetHandler(deps: RpcDeps) {
  return async (req: StateAdminGetInput, ctx: { caller: Caller }) => {
    requireAdmin(ctx.caller);
    const namespace = await resolveAdminNamespace(req);
    return deps.state.get(namespace, req.key);
  };
}

export function createStateAdminListHandler(deps: RpcDeps) {
  return async (req: StateAdminListInput, ctx: { caller: Caller }) => {
    requireAdmin(ctx.caller);
    const namespace = await resolveAdminNamespace(req);
    return deps.state.list(namespace, { prefix: req.prefix, offset: req.offset, limit: req.limit });
  };
}

export function createStateAdminDeleteHandler(deps: RpcDeps) {
  return async (req: StateAdminDeleteInput, ctx: { caller: Caller }) => {
    requireAdmin(ctx.caller);
    const namespace = await resolveAdminNamespace(req);
    return deps.state.delete(namespace, req.key, req.expectedRevision);
  };
}

export function createStateHandlers(deps: RpcDeps) {
  return {
    get: createStateGetHandler(deps),
    put: createStatePutHandler(deps),
    delete: createStateDeleteHandler(deps),
    compareAndSet: createStateCompareAndSetHandler(deps),
    list: createStateListHandler(deps),
    adminGet: createStateAdminGetHandler(deps),
    adminList: createStateAdminListHandler(deps),
    adminDelete: createStateAdminDeleteHandler(deps),
  };
}
