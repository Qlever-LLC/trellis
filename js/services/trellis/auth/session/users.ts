import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import type { ContractsModule } from "../../catalog/runtime.ts";
import type { AuthLogger } from "../runtime_deps.ts";
import type {
  BoundedListQuery,
  SqlUserProjectionRepository,
} from "../storage.ts";

type RpcUser = { id: string; origin: string; capabilities?: string[] };

const PLATFORM_CAPABILITIES = [{
  key: "admin",
  displayName: "Administer Trellis",
  description:
    "Manage Trellis users, sessions, deployments, and runtime policy.",
  source: "platform" as const,
}];

function requireUserCaller(caller: {
  type: string;
  id?: string;
  origin?: string;
  capabilities?: string[];
}): RpcUser {
  if (caller.type !== "user" || !caller.id || !caller.origin) {
    throw new AuthError({ reason: "insufficient_permissions" });
  }
  return {
    id: caller.id,
    origin: caller.origin,
    capabilities: caller.capabilities,
  };
}

/** Creates the Auth.Users.List RPC handler backed by SQL user storage. */
export function createAuthUsersListHandler(
  userStorage: SqlUserProjectionRepository,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input,
      context: { caller },
    }: {
      input: BoundedListQuery;
      context: {
        caller: {
          type: string;
          id?: string;
          origin?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace(
      { rpc: "Auth.Users.List", caller: `${user.origin}.${user.id}` },
      "RPC request",
    );

    const users = (await userStorage.listPage(input)).map((entry) => ({
      origin: entry.origin,
      id: entry.id,
      name: entry.name,
      email: entry.email,
      active: entry.active,
      capabilities: entry.capabilities,
    }));

    users.sort((a, b) =>
      `${a.origin}.${a.id}`.localeCompare(`${b.origin}.${b.id}`)
    );
    return Result.ok({ users });
  };
}

/** Creates the Auth.Capabilities.List RPC handler backed by active contracts. */
export function createAuthCapabilitiesListHandler(
  contracts: Pick<ContractsModule, "getActiveCapabilityDefinitions">,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input,
      context: { caller },
    }: {
      input: BoundedListQuery;
      context: {
        caller: {
          type: string;
          id?: string;
          origin?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace(
      { rpc: "Auth.Capabilities.List", caller: `${user.origin}.${user.id}` },
      "RPC request",
    );

    const capabilities = [
      ...PLATFORM_CAPABILITIES,
      ...(await contracts.getActiveCapabilityDefinitions()).map(
        (capability) => ({
          ...capability,
          source: "contract" as const,
        }),
      ),
    ].sort((left, right) => left.key.localeCompare(right.key));

    const offset = input.offset ?? 0;
    return Result.ok({
      capabilities: capabilities.slice(offset, offset + input.limit),
    });
  };
}

/** Creates the Auth.Users.Update RPC handler backed by SQL user storage. */
export function createAuthUsersUpdateHandler(
  userStorage: SqlUserProjectionRepository,
  logger: Pick<AuthLogger, "trace">,
) {
  return async (
    {
      input: req,
      context: { caller },
    }: {
      input: {
        origin: string;
        id: string;
        active?: boolean;
        capabilities?: string[];
      };
      context: {
        caller: {
          type: string;
          id?: string;
          origin?: string;
          capabilities?: string[];
        };
      };
    },
  ) => {
    const user = requireUserCaller(caller);
    logger.trace({
      rpc: "Auth.Users.Update",
      target: `${req.origin}.${req.id}`,
      caller: `${user.origin}.${user.id}`,
    }, "RPC request");

    const trellisId = await trellisIdFromOriginId(req.origin, req.id);
    const existing = await userStorage.get(trellisId);
    if (existing === undefined) {
      return Result.err(
        new AuthError({
          reason: "user_not_found",
          context: { origin: req.origin, id: req.id },
        }),
      );
    }

    const updated = { ...existing };
    if (req.active !== undefined) updated.active = req.active;
    if (req.capabilities !== undefined) updated.capabilities = req.capabilities;

    await userStorage.put(trellisId, updated);

    return Result.ok({ success: true });
  };
}
