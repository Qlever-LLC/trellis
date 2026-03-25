import { trellisIdFromOriginId } from "@trellis/auth";
import type { Result } from "@trellis/result";
import type { KVError, TypedKV } from "@trellis/trellis";
import type { UserProjectionEntry, UserProjectionSchema } from "./schemas.ts";

export type UserProjectionKV = TypedKV<typeof UserProjectionSchema>;

export async function upsertUserProjection(
  usersKV: UserProjectionKV,
  entry: UserProjectionEntry,
): Promise<Result<void, KVError>> {
  const trellisId = await trellisIdFromOriginId(entry.origin, entry.id);
  return (await usersKV.put(trellisId, entry)).map(() => undefined);
}
