import { ASSIGNED_INSPECTIONS } from "../../../../shared/field_data.ts";
import { ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../contract.ts";

type Args = RpcArgs<typeof contract, "Inspection.Assignments.List">;
type Result = RpcResult<typeof contract, "Inspection.Assignments.List">;

export function listAssignments(_: Args): Result {
  return ok({ assignments: ASSIGNED_INSPECTIONS });
}
