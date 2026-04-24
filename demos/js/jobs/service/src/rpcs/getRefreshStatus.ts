import { isErr, ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../contract.ts";

type Args = RpcArgs<typeof contract, "Inspection.Summaries.RefreshStatus.Get">;
type Result = RpcResult<typeof contract, "Inspection.Summaries.RefreshStatus.Get">;

export async function getRefreshStatus({
  input,
  trellis,
}: Args): Promise<Result> {
  const refreshEntry = await trellis.kv.refreshStatuses.get(input.refreshId).take();
  const refresh = isErr(refreshEntry) ? undefined : refreshEntry.value;

  return ok({ refresh });
}
