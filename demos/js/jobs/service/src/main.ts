import { isErr, Result } from "@qlever-llc/trellis";
import type { RpcHandler } from "@qlever-llc/trellis/service";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contracts/demo_inspection_jobs_service.ts";
import { createRefreshSummariesHandler } from "../jobs/refreshSummaries.ts";
import { InspectionSummariesRefreshStatusSchema } from "../schemas/index.ts";
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

  await service.jobs.refreshSummaries.handle(
    createRefreshSummariesHandler(refreshStatuses),
  ).orThrow();

  const workerHost = await service.jobs
    .startWorkers({
      instanceId: "demo-jobs-service-worker",
    })
    .orThrow();

  const refresh: RpcHandler<typeof contract, "Inspection.Summaries.Refresh"> =
    async ({ input }) => {
    const created = await service.jobs.refreshSummaries
      .create({
        siteId: input.siteId,
      })
      .orThrow();
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
    };

  await service.trellis.mount("Inspection.Summaries.Refresh", refresh);

  const getRefreshStatus: RpcHandler<
    typeof contract,
    "Inspection.Summaries.RefreshStatus.Get"
  > = async ({ input }) => {
    const refreshEntry = await refreshStatuses.get(input.refreshId).take();
    const refresh = isErr(refreshEntry) ? undefined : refreshEntry.value;

    return Result.ok({ refresh });
  };

  await service.trellis.mount(
    "Inspection.Summaries.RefreshStatus.Get",
    getRefreshStatus,
  );

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
