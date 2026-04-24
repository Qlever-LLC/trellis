import { isErr, ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import type { SiteSummary } from "../../../../shared/field_data.ts";
import contract from "../../contract.ts";

type Args = RpcArgs<typeof contract, "Inspection.Summaries.List">;
type Result = RpcResult<typeof contract, "Inspection.Summaries.List">;

export async function listSummaries({ trellis }: Args): Promise<Result> {
  const summaries: SiteSummary[] = [];
  const keys = await trellis.kv.siteSummaries.keys(">")
    .orThrow();

  for await (const key of keys) {
    const entry = await trellis.kv.siteSummaries.get(key).take();
    if (!isErr(entry)) {
      summaries.push(entry.value);
    }
  }

  summaries.sort((left, right) => left.siteName.localeCompare(right.siteName));

  return ok({ summaries });
}
