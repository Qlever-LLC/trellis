import type { JsonValue } from "@qlever-llc/trellis/contracts";
import { isJsonValue } from "@qlever-llc/trellis/contracts";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { AuthError, ValidationError } from "@qlever-llc/trellis";
import { type BaseError, Result } from "@qlever-llc/result";
import type { parseUnknownSchema } from "../../../packages/trellis/codec.ts";
import type { SchemaLike } from "../../../packages/trellis/contracts.ts";

import type {
  StateAdminDeleteInput,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminDelete.ts";
import type { StateAdminGetInput } from "../../../packages/trellis/models/trellis/rpc/StateAdminGet.ts";
import type { StateAdminListInput } from "../../../packages/trellis/models/trellis/rpc/StateAdminList.ts";
import type { StateDeleteInput } from "../../../packages/trellis/models/trellis/rpc/StateDelete.ts";
import type { StateGetInput } from "../../../packages/trellis/models/trellis/rpc/StateGet.ts";
import type { StateListInput } from "../../../packages/trellis/models/trellis/rpc/StateList.ts";
import type { StatePutInput } from "../../../packages/trellis/models/trellis/rpc/StatePut.ts";
import type { StateStoreKind } from "../../../packages/trellis/models/trellis/State.ts";
import type { Session } from "../auth/schemas.ts";
import type { ResolvedStateStore } from "./model.ts";
import { StateStore } from "./storage.ts";
import type { SqlSessionRepository } from "../auth/storage.ts";

type ContractStateStore = {
  kind: StateStoreKind;
  schema: { schema: string };
  stateVersion?: string;
  acceptedVersions?: Record<string, { schema: string }>;
};

type StateContractLike = {
  id: string;
  schemas?: Record<string, unknown>;
  state?: Record<string, ContractStateStore | undefined>;
};

type SessionLike = {
  getOneBySessionKey: SqlSessionRepository["getOneBySessionKey"];
};

type ContractStoreLike = {
  getContract: (
    digest: string,
    opts?: { includeInactive?: boolean },
  ) => StateContractLike | undefined;
};

type Caller = {
  type: string;
  origin?: string;
  id?: string;
  capabilities?: string[];
};

type RpcDeps = {
  sessionStorage: SessionLike;
  state: StateStore;
  contractStore: ContractStoreLike;
};

async function loadSessionBySessionKey(
  sessionKey: string,
  sessionStore: SessionLike,
): Promise<Session | null> {
  try {
    return await sessionStore.getOneBySessionKey(sessionKey) ?? null;
  } catch {
    throw new AuthError({
      reason: "session_corrupted",
      context: { sessionKey },
    });
  }
}

function isAdmin(caller: Caller): boolean {
  return caller.capabilities?.includes("admin") ?? false;
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

function expectedStateRpcError(
  error: unknown,
): AuthError | ValidationError | undefined {
  if (error instanceof AuthError || error instanceof ValidationError) {
    return error;
  }
  return undefined;
}

async function runStateRpc<T, E extends BaseError>(
  operation: () => Promise<Result<T, E>>,
): Promise<Result<T, E | AuthError | ValidationError>> {
  try {
    return await operation();
  } catch (error) {
    const expected = expectedStateRpcError(error);
    if (expected) return Result.err(expected);
    throw error;
  }
}

function requireStoreDefinition(
  contract: StateContractLike | undefined,
  store: string,
): ContractStateStore {
  const definition = contract?.state?.[store];
  if (!definition) {
    throw new ValidationError({
      errors: [{
        path: "/store",
        message: `state store '${store}' is not declared by the contract`,
      }],
    });
  }
  return definition;
}

function isSchemaLike(
  schema: unknown,
): schema is Parameters<typeof parseUnknownSchema>[0] {
  return typeof schema === "boolean" ||
    (schema !== null && typeof schema === "object");
}

function requireStoreSchema(
  contract: StateContractLike | undefined,
  definition: ContractStateStore,
  store: string,
): Parameters<typeof parseUnknownSchema>[0] {
  const schema = contract?.schemas?.[definition.schema.schema];
  if (!isSchemaLike(schema)) {
    throw new ValidationError({
      errors: [{
        path: "/store",
        message: `state store '${store}' schema is not available`,
      }],
    });
  }
  return schema;
}

function requireAcceptedVersionSchemas(
  contract: StateContractLike | undefined,
  definition: ContractStateStore,
  store: string,
): Record<string, Parameters<typeof parseUnknownSchema>[0]> {
  const schemas: Record<string, Parameters<typeof parseUnknownSchema>[0]> = {};
  for (
    const [version, ref] of Object.entries(definition.acceptedVersions ?? {})
  ) {
    const schema = contract?.schemas?.[ref.schema];
    if (!isSchemaLike(schema)) {
      throw new ValidationError({
        errors: [{
          path: "/store",
          message:
            `state store '${store}' accepted version '${version}' schema is not available`,
        }],
      });
    }
    schemas[version] = schema;
  }
  return schemas;
}

async function resolveCallerStore(
  store: string,
  ctx: { caller: Caller; sessionKey: string },
  deps: RpcDeps,
): Promise<ResolvedStateStore> {
  const session = await loadSessionBySessionKey(
    ctx.sessionKey,
    deps.sessionStorage,
  );
  if (!session) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  if (ctx.caller.type !== session.type) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  if (session.type !== "user" && session.type !== "device") {
    throw new AuthError({ reason: "insufficient_permissions" });
  }

  const contract = deps.contractStore.getContract(session.contractDigest, {
    includeInactive: true,
  });
  const definition = requireStoreDefinition(contract, store);
  const schema = requireStoreSchema(contract, definition, store);
  const acceptedVersions = requireAcceptedVersionSchemas(
    contract,
    definition,
    store,
  );
  return {
    ownerType: session.type,
    contractId: session.contractId,
    contractDigest: session.contractDigest,
    ownerKey: session.type === "user" ? session.trellisId : session.instanceId,
    store,
    kind: definition.kind,
    schema,
    stateVersion: definition.stateVersion ?? "v1",
    acceptedVersions,
  };
}

async function resolveAdminStore(
  req: StateAdminGetInput | StateAdminListInput | StateAdminDeleteInput,
  deps: RpcDeps,
): Promise<ResolvedStateStore> {
  const contract = deps.contractStore.getContract(req.contractDigest, {
    includeInactive: true,
  });
  if (contract && contract.id !== req.contractId) {
    throw new ValidationError({
      errors: [{
        path: "/contractId",
        message: "contractId does not match contractDigest",
      }],
    });
  }
  const definition = requireStoreDefinition(contract, req.store);
  const schema = requireStoreSchema(contract, definition, req.store);
  const acceptedVersions = requireAcceptedVersionSchemas(
    contract,
    definition,
    req.store,
  );
  if (req.scope === "userApp") {
    return {
      ownerType: "user",
      contractId: req.contractId,
      contractDigest: req.contractDigest,
      ownerKey: await trellisIdFromOriginId(req.user.origin, req.user.id),
      store: req.store,
      kind: definition.kind,
      schema,
      stateVersion: definition.stateVersion ?? "v1",
      acceptedVersions,
    };
  }

  return {
    ownerType: "device",
    contractId: req.contractId,
    contractDigest: req.contractDigest,
    ownerKey: req.deviceId,
    store: req.store,
    kind: definition.kind,
    schema,
    stateVersion: definition.stateVersion ?? "v1",
    acceptedVersions,
  };
}

export function createStateGetHandler(deps: RpcDeps) {
  return async (
    req: StateGetInput,
    ctx: { caller: Caller; sessionKey: string },
  ) => {
    return await runStateRpc(async () => {
      const target = await resolveCallerStore(req.store, ctx, deps);
      return await deps.state.get(target, { key: req.key });
    });
  };
}

export function createStatePutHandler(deps: RpcDeps) {
  return async (
    req: StatePutInput,
    ctx: { caller: Caller; sessionKey: string },
  ) => {
    return await runStateRpc(async () => {
      const target = await resolveCallerStore(req.store, ctx, deps);
      return await deps.state.put(target, {
        key: req.key,
        expectedRevision: req.expectedRevision,
        value: requireJsonValue(req.value),
        ttlMs: req.ttlMs,
      });
    });
  };
}

export function createStateDeleteHandler(deps: RpcDeps) {
  return async (
    req: StateDeleteInput,
    ctx: { caller: Caller; sessionKey: string },
  ) => {
    return await runStateRpc(async () => {
      const target = await resolveCallerStore(req.store, ctx, deps);
      return await deps.state.delete(target, {
        key: req.key,
        expectedRevision: req.expectedRevision,
      });
    });
  };
}

export function createStateListHandler(deps: RpcDeps) {
  return async (
    req: StateListInput,
    ctx: { caller: Caller; sessionKey: string },
  ) => {
    return await runStateRpc(async () => {
      const target = await resolveCallerStore(req.store, ctx, deps);
      return await deps.state.list(target, {
        prefix: req.prefix,
        offset: req.offset,
        limit: req.limit,
      });
    });
  };
}

export function createStateAdminGetHandler(deps: RpcDeps) {
  return async (req: StateAdminGetInput, ctx: { caller: Caller }) => {
    return await runStateRpc(async () => {
      requireAdmin(ctx.caller);
      const target = await resolveAdminStore(req, deps);
      return await deps.state.get(target, { key: req.key });
    });
  };
}

export function createStateAdminListHandler(deps: RpcDeps) {
  return async (req: StateAdminListInput, ctx: { caller: Caller }) => {
    return await runStateRpc(async () => {
      requireAdmin(ctx.caller);
      const target = await resolveAdminStore(req, deps);
      return await deps.state.list(target, {
        prefix: req.prefix,
        offset: req.offset,
        limit: req.limit,
      });
    });
  };
}

export function createStateAdminDeleteHandler(deps: RpcDeps) {
  return async (req: StateAdminDeleteInput, ctx: { caller: Caller }) => {
    return await runStateRpc(async () => {
      requireAdmin(ctx.caller);
      const target = await resolveAdminStore(req, deps);
      return await deps.state.delete(target, {
        key: req.key,
        expectedRevision: req.expectedRevision,
      });
    });
  };
}

export function createStateHandlers(deps: RpcDeps) {
  return {
    get: createStateGetHandler(deps),
    put: createStatePutHandler(deps),
    delete: createStateDeleteHandler(deps),
    list: createStateListHandler(deps),
    adminGet: createStateAdminGetHandler(deps),
    adminList: createStateAdminListHandler(deps),
    adminDelete: createStateAdminDeleteHandler(deps),
  };
}
