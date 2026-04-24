import { isErr, ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../contract.ts";

type Args = RpcArgs<typeof contract, "Inspection.Summaries.Get">;
type Result = RpcResult<typeof contract, "Inspection.Summaries.Get">;

export async function getSummary({
  input,
  trellis,
}: Args): Promise<Result> {
  const entry = await trellis.kv.siteSummaries.get(input.siteId).take();

  return ok({
    summary: isErr(entry) ? undefined : entry.value,
  });
}
