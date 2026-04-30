import { ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../../contract.ts";
import { recordActivity } from "../activity/index.ts";

type Args = RpcArgs<typeof contract, "Evidence.Delete">;
type Result = RpcResult<typeof contract, "Evidence.Delete">;

/** Deletes a stored evidence object from the demo evidence locker. */
export async function deleteEvidence({ input, trellis }: Args): Promise<Result> {
  const uploads = await trellis.store.uploads.open().orThrow();
  await uploads.delete(input.key).orThrow();
  await recordActivity(trellis, {
    kind: "evidence-deleted",
    message: `Deleted evidence upload ${input.key}`,
  });

  return ok({ key: input.key, deleted: true });
}
