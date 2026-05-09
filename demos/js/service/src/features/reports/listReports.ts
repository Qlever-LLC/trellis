import { ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../../contract.ts";
import { listReports as listReportRecords } from "./reportStore.ts";

type Args = RpcArgs<typeof contract, "Reports.List">;
type Result = RpcResult<typeof contract, "Reports.List">;

/** Lists completed closeout reports generated during this demo service run. */
export function listReports({ input }: Args): Result {
  const reports = listReportRecords();
  return ok({ reports: reports.slice(input.offset, input.offset + input.limit) });
}
