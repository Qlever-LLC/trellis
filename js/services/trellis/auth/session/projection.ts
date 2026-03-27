import { trellisIdFromOriginId } from "@qlever-llc/trellis-auth";
import type { Result } from "@qlever-llc/trellis-result";
import type { KVError, TypedKV } from "@qlever-llc/trellis-trellis";
import type { UserProjectionEntry, UserProjectionSchema } from "../../state/schemas.ts";

export type UserProjectionKV = TypedKV<typeof UserProjectionSchema>;

export async function upsertUserProjection(
  usersKV: UserProjectionKV,
  entry: UserProjectionEntry,
): Promise<Result<void, KVError>> {
  const trellisId = await trellisIdFromOriginId(entry.origin, entry.id);
  return (await usersKV.put(trellisId, entry)).map(() => undefined);
}
