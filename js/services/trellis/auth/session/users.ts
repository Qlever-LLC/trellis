import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { Result } from "@qlever-llc/result";
import { AuthError } from "@qlever-llc/trellis";

import { logger } from "../../bootstrap/globals.ts";
import type { SqlUserProjectionRepository } from "../storage.ts";

type RpcUser = { id: string; origin: string; capabilities?: string[] };

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

/** Creates the Auth.ListUsers RPC handler backed by SQL user storage. */
export function createAuthListUsersHandler(
  userStorage: SqlUserProjectionRepository,
) {
  return async (
    {
      context: { caller },
    }: {
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
      { rpc: "Auth.ListUsers", caller: `${user.origin}.${user.id}` },
      "RPC request",
    );

    const users = (await userStorage.list()).map((entry) => ({
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

/** Creates the Auth.UpdateUser RPC handler backed by SQL user storage. */
export function createAuthUpdateUserHandler(
  userStorage: SqlUserProjectionRepository,
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
      rpc: "Auth.UpdateUser",
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
