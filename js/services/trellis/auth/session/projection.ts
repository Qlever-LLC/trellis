import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import type { SqlUserProjectionRepository } from "../storage.ts";
import type { UserProjectionEntry } from "../../state/schemas.ts";

/** Inserts or updates a user projection in SQL while preserving admin-managed fields. */
export async function upsertUserProjectionInSql(
  userStorage: SqlUserProjectionRepository,
  entry: UserProjectionEntry,
): Promise<void> {
  const trellisId = await trellisIdFromOriginId(entry.origin, entry.id);
  const existing = await userStorage.get(trellisId);
  const merged = existing === undefined ? entry : {
    origin: entry.origin,
    id: entry.id,
    name: entry.name ?? existing.name,
    email: entry.email ?? existing.email,
    active: existing.active,
    capabilities: existing.capabilities,
  };
  await userStorage.put(trellisId, merged);
}
