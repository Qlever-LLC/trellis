import { Result, type TypedKV, UnexpectedError } from "@qlever-llc/trellis";
import * as schemas from "../schemas/index.ts";
import { getSiteSummary } from "../../../../shared/field_data.ts";
import type { TSchema } from "typebox";

export function refreshSummaries(
  refreshStatuses: TypedKV<TSchema>,
) {
  return async (
    { job }: {
      job: {
        payload: { siteId: string };
        ref: { id: string };
        progress(update: {
          step: string;
          message: string;
          current: number;
          total: number;
        }): { orThrow(): Promise<unknown> };
      };
    },
  ) => {
    const siteSummary = getSiteSummary(job.payload.siteId);

    await refreshStatuses
        .put(job.ref.id, {
          refreshId: job.ref.id,
          siteId: job.payload.siteId,
          status: "running" as const,
          updatedAt: new Date().toISOString(),
          message: siteSummary
            ? `Refreshing summary for ${siteSummary.siteName}`
          : `Refreshing summary for ${job.payload.siteId}`,
      })
      .orThrow();

    await job
      .progress({
        step: "refreshing-summary",
        message: "Loading latest inspection summary",
        current: 1,
        total: 2,
      })
      .orThrow();
    await new Promise((resolve) => setTimeout(resolve, 250));

    if (!siteSummary) {
      const message = `Unknown site '${job.payload.siteId}'`;
      await refreshStatuses
        .put(job.ref.id, {
          refreshId: job.ref.id,
          siteId: job.payload.siteId,
          status: "failed" as const,
          updatedAt: new Date().toISOString(),
          message,
        })
        .orThrow();
      return Result.err(new UnexpectedError({ cause: new Error(message) }));
    }

    await job
      .progress({
        step: "refreshing-summary",
        message: "Stored refreshed inspection summary",
        current: 2,
        total: 2,
      })
      .orThrow();

    await refreshStatuses
        .put(job.ref.id, {
          refreshId: job.ref.id,
          siteId: job.payload.siteId,
          status: "completed" as const,
          updatedAt: new Date().toISOString(),
          message: `Refresh completed for ${siteSummary.siteName}`,
        })
      .orThrow();

    return Result.ok({
      refreshId: job.ref.id,
      status: "completed" as const,
    });
  };
}
