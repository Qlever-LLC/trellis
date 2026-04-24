import { Result, UnexpectedError } from "@qlever-llc/trellis";
import type { JobArgs, JobResult } from "@qlever-llc/trellis/service";
import contract from "../../contract.ts";
import { getSiteSummary } from "../../../../shared/field_data.ts";

type Args = JobArgs<typeof contract, "refreshSummaries">;
type Return = JobResult<typeof contract, "refreshSummaries">;

export async function refreshSummaries({
  job,
  trellis,
}: Args): Promise<Return> {
  const refreshStatuses = trellis.kv.refreshStatuses;
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
}
