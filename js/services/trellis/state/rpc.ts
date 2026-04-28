import type { JsonValue } from "@qlever-llc/trellis/contracts";
import { isJsonValue } from "@qlever-llc/trellis/contracts";
import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import {
  AuthError,
  UnexpectedError,
  ValidationError,
} from "@qlever-llc/trellis";
import { isErr, Result } from "@qlever-llc/result";
import type { parseUnknownSchema } from "../../../packages/trellis/codec.ts";
import type { SchemaLike } from "../../../packages/trellis/contracts.ts";

import type {
  StateAdminDeleteInput,
  StateAdminDeleteResponse,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminDelete.ts";
import type {
  StateAdminGetInput,
  StateAdminGetResponse,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminGet.ts";
import type {
  StateAdminListInput,
  StateAdminListResponse,
} from "../../../packages/trellis/models/trellis/rpc/StateAdminList.ts";
import type {
  StateDeleteInput,
  StateDeleteResponse,
} from "../../../packages/trellis/models/trellis/rpc/StateDelete.ts";
import type {
  StateGetInput,
  StateGetResponse,
} from "../../../packages/trellis/models/trellis/rpc/StateGet.ts";
import type {
  StateListInput,
  StateListResponse,
} from "../../../packages/trellis/models/trellis/rpc/StateList.ts";
import type {
  StatePutInput,
  StatePutResponse,
} from "../../../packages/trellis/models/trellis/rpc/StatePut.ts";
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

type StateRpcError = AuthError | UnexpectedError | ValidationError;

async function loadSessionBySessionKey(
  sessionKey: string,
  sessionStore: SessionLike,
): Promise<Result<Session | null, AuthError>> {
  try {
    return Result.ok(await sessionStore.getOneBySessionKey(sessionKey) ?? null);
  } catch {
    return Result.err(
      new AuthError({
        reason: "session_corrupted",
        context: { sessionKey },
      }),
    );
  }
}

function isAdmin(caller: Caller): boolean {
  return caller.capabilities?.includes("admin") ?? false;
}

function requireAdmin(caller: Caller): Result<void, AuthError> {
  if (!isAdmin(caller)) {
    return Result.err(new AuthError({ reason: "insufficient_permissions" }));
  }
  return Result.ok(undefined);
}

function requireJsonValue(value: unknown): Result<JsonValue, ValidationError> {
  if (!isJsonValue(value)) {
    return Result.err(
      new ValidationError({
        errors: [{ path: "/value", message: "state value must be valid JSON" }],
      }),
    );
  }
  return Result.ok(value);
}

function requireStoreDefinition(
  contract: StateContractLike | undefined,
  store: string,
): Result<ContractStateStore, ValidationError> {
  const definition = contract?.state?.[store];
  if (!definition) {
    return Result.err(
      new ValidationError({
        errors: [{
          path: "/store",
          message: `state store '${store}' is not declared by the contract`,
        }],
      }),
    );
  }
  return Result.ok(definition);
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
): Result<Parameters<typeof parseUnknownSchema>[0], ValidationError> {
  const schema = contract?.schemas?.[definition.schema.schema];
  if (!isSchemaLike(schema)) {
    return Result.err(
      new ValidationError({
        errors: [{
          path: "/store",
          message: `state store '${store}' schema is not available`,
        }],
      }),
    );
  }
  return Result.ok(schema);
}

function requireAcceptedVersionSchemas(
  contract: StateContractLike | undefined,
  definition: ContractStateStore,
  store: string,
): Result<
  Record<string, Parameters<typeof parseUnknownSchema>[0]>,
  ValidationError
> {
  const schemas: Record<string, Parameters<typeof parseUnknownSchema>[0]> = {};
  for (
    const [version, ref] of Object.entries(definition.acceptedVersions ?? {})
  ) {
    const schema = contract?.schemas?.[ref.schema];
    if (!isSchemaLike(schema)) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/store",
            message:
              `state store '${store}' accepted version '${version}' schema is not available`,
          }],
        }),
      );
    }
    schemas[version] = schema;
  }
  return Result.ok(schemas);
}

function unwrapChecked<T>(result: Result<T, AuthError | ValidationError>): T {
  return result.unwrapOrElse(() => {
    throw new Error("checked state RPC result unexpectedly failed");
  });
}

async function resolveCallerStore(
  store: string,
  ctx: { caller: Caller; sessionKey: string },
  deps: RpcDeps,
): Promise<Result<ResolvedStateStore, AuthError | ValidationError>> {
  const sessionResult = await loadSessionBySessionKey(
    ctx.sessionKey,
    deps.sessionStorage,
  );
  if (isErr(sessionResult)) return sessionResult;
  const session = unwrapChecked(sessionResult);
  if (!session) {
    return Result.err(new AuthError({ reason: "insufficient_permissions" }));
  }

  if (ctx.caller.type !== session.type) {
    return Result.err(new AuthError({ reason: "insufficient_permissions" }));
  }

  if (session.type !== "user" && session.type !== "device") {
    return Result.err(new AuthError({ reason: "insufficient_permissions" }));
  }

  const contract = deps.contractStore.getContract(session.contractDigest, {
    includeInactive: true,
  });
  const definitionResult = requireStoreDefinition(contract, store);
  if (isErr(definitionResult)) return definitionResult;
  const definition = unwrapChecked(definitionResult);
  const schemaResult = requireStoreSchema(contract, definition, store);
  if (isErr(schemaResult)) return schemaResult;
  const schema = unwrapChecked(schemaResult);
  const acceptedVersionsResult = requireAcceptedVersionSchemas(
    contract,
    definition,
    store,
  );
  if (isErr(acceptedVersionsResult)) return acceptedVersionsResult;
  const acceptedVersions = unwrapChecked(acceptedVersionsResult);
  return Result.ok({
    ownerType: session.type,
    contractId: session.contractId,
    contractDigest: session.contractDigest,
    ownerKey: session.type === "user" ? session.trellisId : session.instanceId,
    store,
    kind: definition.kind,
    schema,
    stateVersion: definition.stateVersion ?? "v1",
    acceptedVersions,
  });
}

async function resolveAdminStore(
  req: StateAdminGetInput | StateAdminListInput | StateAdminDeleteInput,
  deps: RpcDeps,
): Promise<Result<ResolvedStateStore, ValidationError>> {
  const contract = deps.contractStore.getContract(req.contractDigest, {
    includeInactive: true,
  });
  if (contract && contract.id !== req.contractId) {
    return Result.err(
      new ValidationError({
        errors: [{
          path: "/contractId",
          message: "contractId does not match contractDigest",
        }],
      }),
    );
  }
  const definitionResult = requireStoreDefinition(contract, req.store);
  if (isErr(definitionResult)) return definitionResult;
  const definition = unwrapChecked(definitionResult);
  const schemaResult = requireStoreSchema(contract, definition, req.store);
  if (isErr(schemaResult)) return schemaResult;
  const schema = unwrapChecked(schemaResult);
  const acceptedVersionsResult = requireAcceptedVersionSchemas(
    contract,
    definition,
    req.store,
  );
  if (isErr(acceptedVersionsResult)) return acceptedVersionsResult;
  const acceptedVersions = unwrapChecked(acceptedVersionsResult);
  if (req.scope === "userApp") {
    return Result.ok({
      ownerType: "user",
      contractId: req.contractId,
      contractDigest: req.contractDigest,
      ownerKey: await trellisIdFromOriginId(req.user.origin, req.user.id),
      store: req.store,
      kind: definition.kind,
      schema,
      stateVersion: definition.stateVersion ?? "v1",
      acceptedVersions,
    });
  }

  return Result.ok({
    ownerType: "device",
    contractId: req.contractId,
    contractDigest: req.contractDigest,
    ownerKey: req.deviceId,
    store: req.store,
    kind: definition.kind,
    schema,
    stateVersion: definition.stateVersion ?? "v1",
    acceptedVersions,
  });
}

export function createStateGetHandler(deps: RpcDeps) {
  return async (
    req: StateGetInput,
    ctx: { caller: Caller; sessionKey: string },
  ): Promise<Result<StateGetResponse, StateRpcError>> => {
    const target = await resolveCallerStore(req.store, ctx, deps);
    if (isErr(target)) return target;
    return await deps.state.get(unwrapChecked(target), { key: req.key });
  };
}

export function createStatePutHandler(deps: RpcDeps) {
  return async (
    req: StatePutInput,
    ctx: { caller: Caller; sessionKey: string },
  ): Promise<Result<StatePutResponse, StateRpcError>> => {
    const target = await resolveCallerStore(req.store, ctx, deps);
    if (isErr(target)) return target;
    const value = requireJsonValue(req.value);
    if (isErr(value)) return value;
    return await deps.state.put(unwrapChecked(target), {
      key: req.key,
      expectedRevision: req.expectedRevision,
      value: unwrapChecked(value),
      ttlMs: req.ttlMs,
    });
  };
}

export function createStateDeleteHandler(deps: RpcDeps) {
  return async (
    req: StateDeleteInput,
    ctx: { caller: Caller; sessionKey: string },
  ): Promise<Result<StateDeleteResponse, StateRpcError>> => {
    const target = await resolveCallerStore(req.store, ctx, deps);
    if (isErr(target)) return target;
    return await deps.state.delete(unwrapChecked(target), {
      key: req.key,
      expectedRevision: req.expectedRevision,
    });
  };
}

export function createStateListHandler(deps: RpcDeps) {
  return async (
    req: StateListInput,
    ctx: { caller: Caller; sessionKey: string },
  ): Promise<Result<StateListResponse, StateRpcError>> => {
    const target = await resolveCallerStore(req.store, ctx, deps);
    if (isErr(target)) return target;
    return await deps.state.list(unwrapChecked(target), {
      prefix: req.prefix,
      offset: req.offset,
      limit: req.limit,
    });
  };
}

export function createStateAdminGetHandler(deps: RpcDeps) {
  return async (
    req: StateAdminGetInput,
    ctx: { caller: Caller },
  ): Promise<Result<StateAdminGetResponse, StateRpcError>> => {
    const admin = requireAdmin(ctx.caller);
    if (isErr(admin)) return admin;
    const target = await resolveAdminStore(req, deps);
    if (isErr(target)) return target;
    return await deps.state.get(unwrapChecked(target), { key: req.key });
  };
}

export function createStateAdminListHandler(deps: RpcDeps) {
  return async (
    req: StateAdminListInput,
    ctx: { caller: Caller },
  ): Promise<Result<StateAdminListResponse, StateRpcError>> => {
    const admin = requireAdmin(ctx.caller);
    if (isErr(admin)) return admin;
    const target = await resolveAdminStore(req, deps);
    if (isErr(target)) return target;
    return await deps.state.list(unwrapChecked(target), {
      prefix: req.prefix,
      offset: req.offset,
      limit: req.limit,
    });
  };
}

export function createStateAdminDeleteHandler(deps: RpcDeps) {
  return async (
    req: StateAdminDeleteInput,
    ctx: { caller: Caller },
  ): Promise<Result<StateAdminDeleteResponse, StateRpcError>> => {
    const admin = requireAdmin(ctx.caller);
    if (isErr(admin)) return admin;
    const target = await resolveAdminStore(req, deps);
    if (isErr(target)) return target;
    return await deps.state.delete(unwrapChecked(target), {
      key: req.key,
      expectedRevision: req.expectedRevision,
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
