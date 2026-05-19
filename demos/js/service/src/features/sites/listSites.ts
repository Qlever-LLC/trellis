import { isErr, ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import type { SiteSummary } from "../../../../shared/field_data.ts";
import contract from "../../../contract.ts";

type Args = RpcArgs<typeof contract, "Sites.List">;
type Result = RpcResult<typeof contract, "Sites.List">;

export async function listSites({ input, trellis }: Args): Promise<Result> {
  const sites: SiteSummary[] = [];
  const keys = await trellis.kv.siteSummaries.keys(">").orThrow();

  for await (const key of keys) {
    const entry = await trellis.kv.siteSummaries.get(key).take();
    if (!isErr(entry)) {
      sites.push(entry.value);
    }
  }

  sites.sort((left, right) => left.siteName.localeCompare(right.siteName));
  const offset = input.offset ?? 0;
  const count = sites.length;

  return ok({
    entries: sites.slice(offset, offset + input.limit),
    count,
    offset,
    limit: input.limit,
    ...(input.limit > 0 && offset + input.limit < count
      ? { nextOffset: offset + input.limit }
      : {}),
  });
}
