import { trellisIdFromOriginId } from "@qlever-llc/trellis/auth";
import { isErr } from "@qlever-llc/result";
import type { AsyncResult, BaseError, Result } from "@qlever-llc/result";
import type { UserProjectionEntry } from "../../state/schemas.ts";

export type UserProjectionKV<E extends BaseError = BaseError> = {
  get: (key: string) => AsyncResult<{ value: UserProjectionEntry }, E>;
  put: (key: string, value: UserProjectionEntry) => AsyncResult<void, E>;
};

export async function upsertUserProjection<E extends BaseError>(
  usersKV: UserProjectionKV<E>,
  entry: UserProjectionEntry,
): Promise<Result<void, E>> {
  const trellisId = await trellisIdFromOriginId(entry.origin, entry.id);
  const existing = await usersKV.get(trellisId).take();
  const merged = isErr(existing)
    ? entry
    : {
      origin: entry.origin,
      id: entry.id,
      name: entry.name ?? existing.value.name,
      email: entry.email ?? existing.value.email,
      active: existing.value.active,
      capabilities: existing.value.capabilities,
    };
  return await usersKV.put(trellisId, merged).map(() => undefined);
}
