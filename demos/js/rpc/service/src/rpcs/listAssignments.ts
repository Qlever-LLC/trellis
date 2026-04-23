import { ASSIGNED_INSPECTIONS } from "../../../../shared/field_data.ts";
import type contract from "../../contract.ts";
import { ok, type RpcResult } from "@qlever-llc/trellis";

type Result = RpcResult<typeof contract, "Inspection.Assignments.List">;

export function listAssignments(): Result {
  return ok({ assignments: ASSIGNED_INSPECTIONS });
}
