import { Result, UnexpectedError } from "@qlever-llc/trellis";
import type { JobArgs, JobResult } from "@qlever-llc/trellis/service";
import { getSiteSummary } from "../../../../shared/field_data.ts";
import contract from "../../../contract.ts";

type Args = JobArgs<typeof contract, "refreshSiteSummary">;
type Return = JobResult<typeof contract, "refreshSiteSummary">;

export async function refreshSiteSummary(
  { job, trellis }: Args,
): Promise<Return> {
  const siteSummary = getSiteSummary(job.payload.siteId);

  await job.progress({
    step: "loading-summary",
    message: `Loading latest field summary for ${job.payload.siteId}`,
    current: 1,
    total: 2,
  }).orThrow();
  await new Promise((resolve) => setTimeout(resolve, 250));

  if (!siteSummary) {
    const message = `Unknown site '${job.payload.siteId}'`;
    return Result.err(new UnexpectedError({ cause: new Error(message) }));
  }

  const refreshed = {
    ...siteSummary,
    latestStatus: siteSummary.overdueInspections > 0
      ? "attention-needed"
      : "refreshed",
    lastReportAt: new Date().toISOString(),
  };

  await trellis.kv.siteSummaries.put(refreshed.siteId, refreshed).orThrow();
  await job.progress({
    step: "stored-summary",
    message: `Stored refreshed summary for ${refreshed.siteName}`,
    current: 2,
    total: 2,
  }).orThrow();

  return Result.ok({
    refreshId: job.ref.id,
    site: refreshed,
    status: "completed",
  });
}
