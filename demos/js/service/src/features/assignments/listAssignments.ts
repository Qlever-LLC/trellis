import { ASSIGNED_INSPECTIONS } from "../../../../shared/field_data.ts";
import { ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../../contract.ts";

type Args = RpcArgs<typeof contract, "Assignments.List">;
type Result = RpcResult<typeof contract, "Assignments.List">;

export function listAssignments({ input }: Args): Result {
  const offset = input.offset ?? 0;
  const count = ASSIGNED_INSPECTIONS.length;
  return ok({
    entries: ASSIGNED_INSPECTIONS.slice(offset, offset + input.limit),
    count,
    offset,
    limit: input.limit,
    ...(input.limit > 0 && offset + input.limit < count
      ? { nextOffset: offset + input.limit }
      : {}),
  });
}
