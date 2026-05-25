import { isErr, ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../../contract.ts";

type Args = RpcArgs<typeof contract, "Sites.Get">;
type Result = RpcResult<typeof contract, "Sites.Get">;

export async function getSite({ input, client }: Args): Promise<Result> {
  const entry = await client.kv.siteSummaries.get(input.siteId).take();

  return ok({ site: isErr(entry) ? undefined : entry.value });
}
