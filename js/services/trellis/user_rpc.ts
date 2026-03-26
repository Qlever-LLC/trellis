import { trellisIdFromOriginId } from "@qlever-llc/trellis-auth";
import { isErr, Result } from "@qlever-llc/trellis-result";
import { AuthError } from "@qlever-llc/trellis-trellis";

import { logger, trellis, usersKV } from "./globals.ts";

type RpcUser = { id: string; origin: string; capabilities?: string[] };

export async function registerUserRpcHandlers(): Promise<void> {
  await trellis.mount(
    "Auth.ListUsers",
    async (_req: unknown, { user }: { user: RpcUser }) => {
      logger.trace({ rpc: "Auth.ListUsers", caller: `${user.origin}.${user.id}` }, "RPC request");

      const keys = (await usersKV.keys(">")).take();
      if (isErr(keys)) return Result.ok({ users: [] });

      const users = [];
      for await (const key of keys) {
        const entry = (await usersKV.get(key)).take();
        if (isErr(entry)) continue;
        users.push({
          origin: entry.value.origin,
          id: entry.value.id,
          name: entry.value.name,
          email: entry.value.email,
          active: entry.value.active,
          capabilities: entry.value.capabilities,
        });
      }

      users.sort((a, b) => `${a.origin}.${a.id}`.localeCompare(`${b.origin}.${b.id}`));
      return Result.ok({ users });
    },
  );

  await trellis.mount(
    "Auth.UpdateUser",
    async (
      req: { origin: string; id: string; active?: boolean; capabilities?: string[] },
      { user }: { user: RpcUser },
    ) => {
      logger.trace({ rpc: "Auth.UpdateUser", target: `${req.origin}.${req.id}`, caller: `${user.origin}.${user.id}` }, "RPC request");

      const trellisId = await trellisIdFromOriginId(req.origin, req.id);
      const existing = (await usersKV.get(trellisId)).take();
      if (isErr(existing)) {
        return Result.err(new AuthError({ reason: "user_not_found", context: { origin: req.origin, id: req.id } }));
      }

      const updated = { ...existing.value };
      if (req.active !== undefined) updated.active = req.active;
      if (req.capabilities !== undefined) updated.capabilities = req.capabilities;

      const putResult = (await usersKV.put(trellisId, updated)).take();
      if (isErr(putResult)) {
        return Result.err(new AuthError({ reason: "user_not_found", context: { op: "put" } }));
      }

      return Result.ok({ success: true });
    },
  );
}
