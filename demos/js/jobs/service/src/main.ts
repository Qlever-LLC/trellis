import { isErr, Result, UnexpectedError } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract, {
  InspectionSummariesRefreshStatusSchema,
} from "../contracts/demo_inspection_jobs_service.ts";
import { getSiteSummary } from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-jobs")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-jobs-service",
    sessionKeySeed,
  });

  const refreshStatuses = await service.kv.refreshStatuses
    .open(InspectionSummariesRefreshStatusSchema)
    .orThrow();

  await service.jobs.refreshSummaries.handle(async (job) => {
    const siteSummary = getSiteSummary(job.payload.siteId);

    await refreshStatuses.put(job.ref.id, {
      refreshId: job.ref.id,
      siteId: job.payload.siteId,
      status: "running",
      updatedAt: new Date().toISOString(),
      message: siteSummary
        ? `Refreshing summary for ${siteSummary.siteName}`
        : `Refreshing summary for ${job.payload.siteId}`,
    }).orThrow();

    await job.progress({
      step: "refreshing-summary",
      message: "Loading latest inspection summary",
      current: 1,
      total: 2,
    }).orThrow();
    await new Promise((resolve) => setTimeout(resolve, 250));

    if (!siteSummary) {
      const message = `Unknown site '${job.payload.siteId}'`;
      await refreshStatuses.put(job.ref.id, {
        refreshId: job.ref.id,
        siteId: job.payload.siteId,
        status: "failed",
        updatedAt: new Date().toISOString(),
        message,
      }).orThrow();
      return Result.err(new UnexpectedError({ cause: new Error(message) }));
    }

    await job.progress({
      step: "refreshing-summary",
      message: "Stored refreshed inspection summary",
      current: 2,
      total: 2,
    }).orThrow();

    await refreshStatuses.put(job.ref.id, {
      refreshId: job.ref.id,
      siteId: job.payload.siteId,
      status: "completed",
      updatedAt: new Date().toISOString(),
      message: `Refresh completed for ${siteSummary.siteName}`,
    }).orThrow();

    return Result.ok({
      refreshId: job.ref.id,
      status: "completed",
    });
  }).orThrow();

  const workerHost = await service.jobs.startWorkers({
    instanceId: "demo-jobs-service-worker",
  }).orThrow();

  await service.trellis.mount("Inspection.Summaries.Refresh", async (input) => {
    const created = await service.jobs.refreshSummaries.create({
      siteId: input.siteId,
    }).orThrow();
    const queuedStatus = {
      refreshId: created.id,
      siteId: input.siteId,
      status: "queued",
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
      status: "queued",
    });
  });

  await service.trellis.mount("Inspection.Summaries.RefreshStatus.Get", async (input) => {
    const refreshEntry = await refreshStatuses.get(input.refreshId).take();
    const refresh = isErr(refreshEntry) ? undefined : refreshEntry.value;

    return Result.ok({ refresh });
  });

  console.log(chalk.green.bold("== Inspection jobs service"));
  const shutdown = async () => {
    try {
      await workerHost.stop().orThrow();
    } catch (error) {
      console.warn("failed to stop jobs worker host", error);
    }
    await service.stop();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());
  await new Promise<void>(() => {});
}

if (import.meta.main) {
  await main();
}
