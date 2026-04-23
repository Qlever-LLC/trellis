import { getSiteSummary } from "../../../../shared/field_data.ts";
import type contract from "../../contract.ts";
import { ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";

type Args = RpcArgs<typeof contract, "Inspection.Sites.GetSummary">;
type Result = RpcResult<typeof contract, "Inspection.Sites.GetSummary">;

export function getSummary({ input }: Args): Result {
  return ok({ summary: getSiteSummary(input.siteId) });
}
