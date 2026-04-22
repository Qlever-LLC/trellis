import { isErr, Result } from "@qlever-llc/trellis";
import type { RpcArgs, RpcResult } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contract.ts";
import { createRefreshSummariesHandler } from "../jobs/refreshSummaries.ts";
import { InspectionSummariesRefreshStatusSchema } from "../schemas/index.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";

type RefreshArgs = RpcArgs<typeof contract, "Inspection.Summaries.Refresh">;
type RefreshReturn = RpcResult<typeof contract, "Inspection.Summaries.Refresh">;
type GetRefreshStatusArgs = RpcArgs<
  typeof contract,
  "Inspection.Summaries.RefreshStatus.Get"
>;
type GetRefreshStatusReturn = RpcResult<
  typeof contract,
  "Inspection.Summaries.RefreshStatus.Get"
>;

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
  }).orThrow();

  const refreshStatuses = await service.kv.refreshStatuses
    .open(InspectionSummariesRefreshStatusSchema)
    .orThrow();

  await service.jobs.refreshSummaries
    .handle(createRefreshSummariesHandler(refreshStatuses))
    .orThrow();

  const workerHost = await service.jobs
    .startWorkers({
      instanceId: "demo-jobs-service-worker",
    })
    .orThrow();

  async function refresh({ input }: RefreshArgs): Promise<RefreshReturn> {
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
  }

  await service.trellis.mount("Inspection.Summaries.Refresh", refresh);

  async function getRefreshStatus({
    input,
  }: GetRefreshStatusArgs): Promise<GetRefreshStatusReturn> {
    const refreshEntry = await refreshStatuses.get(input.refreshId).take();
    const refresh = isErr(refreshEntry) ? undefined : refreshEntry.value;

    return Result.ok({ refresh });
  }

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
