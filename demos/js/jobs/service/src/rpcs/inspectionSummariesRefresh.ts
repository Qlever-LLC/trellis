import { isErr, Result, type TypedKV } from "@qlever-llc/trellis";
import * as schemas from "../schemas/index.ts";
import type { TSchema } from "typebox";

export function inspectionSummariesRefreshRpc(
  refreshStatuses: TypedKV<TSchema>,
  refreshSummaries: {
    create(payload: { siteId: string }): {
      orThrow(): Promise<{ id: string }>;
    };
  },
) {
  return async ({ input }: { input: { siteId: string } }) => {
    const created = await refreshSummaries
      .create({
        siteId: input.siteId,
      })
      .orThrow();
    const queuedStatus = {
      refreshId: created.id,
      siteId: input.siteId,
      status: "queued" as const,
      updatedAt: new Date().toISOString(),
      message: `Queued summary refresh for ${input.siteId}`,
    };

    try {
      await refreshStatuses.create(created.id, queuedStatus).orThrow();
    } catch (error) {
      if (isErr(await refreshStatuses.get(created.id).take())) {
        console.warn("failed to persist queued refresh status", {
          refreshId: created.id,
          siteId: input.siteId,
          error,
        });
      }
    }

    return Result.ok({
      refreshId: created.id,
      status: "queued" as const,
    });
  };
}
