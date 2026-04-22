import { Result, type TypedKV, UnexpectedError } from "@qlever-llc/trellis";
import type { JobHandler } from "@qlever-llc/trellis/service";
import type contract from "../contract.ts";
import type * as schemas from "../schemas/index.ts";
import { getSiteSummary } from "../../../shared/field_data.ts";

export function createRefreshSummariesHandler(
  refreshStatuses: TypedKV<
    typeof schemas.InspectionSummariesRefreshStatusSchema
  >,
): JobHandler<typeof contract, "refreshSummaries"> {
  return async ({ job }) => {
    const siteSummary = getSiteSummary(job.payload.siteId);

    await refreshStatuses
      .put(job.ref.id, {
        refreshId: job.ref.id,
        siteId: job.payload.siteId,
        status: "running",
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
          status: "failed",
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
        status: "completed",
        updatedAt: new Date().toISOString(),
        message: `Refresh completed for ${siteSummary.siteName}`,
      })
      .orThrow();

    return Result.ok({
      refreshId: job.ref.id,
      status: "completed",
    });
  };
}
