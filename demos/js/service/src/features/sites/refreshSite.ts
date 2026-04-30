import { UnexpectedError } from "@qlever-llc/trellis";
import type { OperationHandler } from "@qlever-llc/trellis/service";
import contract from "../../../contract.ts";
import { recordActivity } from "../activity/index.ts";

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const refreshSite: OperationHandler<
  typeof contract,
  "Sites.Refresh"
> = async ({ input, op, trellis }) => {
  await op.started().orThrow();
  await op.progress({
    stage: "queued",
    message: `Queued summary refresh for ${input.siteId}`,
  }).orThrow();
  await pause(900);

  const job = await trellis.jobs.refreshSiteSummary.create({
    siteId: input.siteId,
  }).orThrow();
  await pause(700);

  await op.progress({
    stage: "refreshing",
    message: `Running private job ${job.id}`,
  }).orThrow();

  const completedJob = await job.wait().orThrow();
  if (completedJob.state !== "completed" || !completedJob.result) {
    await op.fail(
      new UnexpectedError({
        cause: new Error(
          `Site refresh job ${job.id} ended as ${completedJob.state}`,
        ),
      }),
    ).orThrow();
    return;
  }

  await pause(700);

  try {
    await trellis.publish("Sites.Refreshed", {
      refreshId: completedJob.result.refreshId,
      site: completedJob.result.site,
      refreshedAt: new Date().toISOString(),
    }).orThrow();
    await pause(700);
    await recordActivity(trellis, {
      kind: "site-refreshed",
      message: `Refreshed ${completedJob.result.site.siteName}`,
      relatedSiteId: completedJob.result.site.siteId,
    });
  } catch (cause) {
    console.warn("Site refresh side-effect publish failed", cause);
  }

  return await op.complete(completedJob.result).orThrow();
};
