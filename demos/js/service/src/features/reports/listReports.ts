import { ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../../contract.ts";
import { listReports as listReportRecords } from "./reportStore.ts";

type Args = RpcArgs<typeof contract, "Reports.List">;
type Result = RpcResult<typeof contract, "Reports.List">;

/** Lists completed closeout reports generated during this demo service run. */
export function listReports({ input }: Args): Result {
  const reports = listReportRecords();
  const offset = input.offset ?? 0;
  const count = reports.length;
  return ok({
    entries: reports.slice(offset, offset + input.limit),
    count,
    offset,
    limit: input.limit,
    ...(input.limit > 0 && offset + input.limit < count
      ? { nextOffset: offset + input.limit }
      : {}),
  });
}
