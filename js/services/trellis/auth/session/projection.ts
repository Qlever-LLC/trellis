import type { UserProjectionEntry } from "../schemas.ts";

type UserProjectionStorage = {
  get(trellisId: string): Promise<UserProjectionEntry | undefined>;
  put(trellisId: string, record: UserProjectionEntry): Promise<void>;
};

/** Inserts or updates a user projection in SQL while preserving admin-managed fields. */
export async function upsertUserProjectionInSql(
  userStorage: UserProjectionStorage,
  entry: UserProjectionEntry,
): Promise<void> {
  const existing = await userStorage.get(entry.id);
  const merged = existing === undefined ? entry : {
    origin: entry.origin,
    id: entry.id,
    name: entry.name ?? existing.name,
    email: entry.email ?? existing.email,
    active: existing.active,
    capabilities: existing.capabilities,
    capabilityGroups: existing.capabilityGroups,
  };
  await userStorage.put(entry.id, merged);
}
