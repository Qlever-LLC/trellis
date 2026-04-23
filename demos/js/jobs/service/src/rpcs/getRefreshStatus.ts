import { isErr, ok, type TypedKV } from "@qlever-llc/trellis";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import * as schemas from "../schemas/index.ts";

export function getRefreshStatus(
  refreshStatuses: TypedKV<TSchema>,
) {
  return async ({ input }: { input: { refreshId: string } }) => {
  const refreshEntry = await refreshStatuses.get(input.refreshId).take();
  const refresh = isErr(refreshEntry)
    ? undefined
    : Value.Parse(
      schemas.InspectionSummariesRefreshStatusSchema,
      refreshEntry.value,
    );

  return ok({ refresh });
  };
}
