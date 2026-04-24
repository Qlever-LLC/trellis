import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import * as jobs from "./jobs/index.ts";
import * as rpcs from "./rpcs/index.ts";

async function main(): Promise<void> {
  // Parse service CLI
  const { args } = await new Command()
    .name("demo-jobs")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  // Connect to service to Trellis
  const trellis = await TrellisService.connect({
    contract,
    trellisUrl: args[0],
    sessionKeySeed: args[1],
    name: "demo-jobs-service",
  }).orThrow();

  trellis.jobs.refreshSummaries.handle(jobs.refreshSummaries);

  await trellis.trellis.mount(
    "Inspection.Summaries.Refresh",
    rpcs.inspectionSummariesRefresh,
  );

  await trellis.trellis.mount(
    "Inspection.Summaries.RefreshStatus.Get",
    rpcs.getRefreshStatus,
  );

  console.log(chalk.green.bold("== Inspection jobs service"));
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await trellis.stop();
      Deno.exit(0);
    } catch (error) {
      console.error(chalk.red.bold("Failed to stop jobs service"));
      console.error(error);
      Deno.exit(1);
    }
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  try {
    await trellis.wait();
  } catch (error) {
    console.error(chalk.red.bold("Jobs service stopped unexpectedly"));
    console.error(error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
