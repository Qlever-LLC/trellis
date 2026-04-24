import { isErr } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contract.ts";
import { SITE_SUMMARIES } from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import * as rpcs from "./rpcs/index.ts";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-kv")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-kv-service",
    sessionKeySeed,
  }).orThrow();

  const siteSummaries = service.kv.siteSummaries;

  for (const summary of SITE_SUMMARIES) {
    if (isErr(await siteSummaries.get(summary.siteId).take())) {
      await siteSummaries.create(summary.siteId, summary).orThrow();
    }
  }

  await service.trellis.mount("Inspection.Summaries.List", rpcs.listSummaries);
  await service.trellis.mount("Inspection.Summaries.Get", rpcs.getSummary);

  console.log(chalk.green.bold("== Inspection KV service"));
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      await service.stop();
      Deno.exit(0);
    } catch (error) {
      console.error(chalk.red.bold("Failed to stop KV service"));
      console.error(error);
      Deno.exit(1);
    }
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());
  await new Promise<void>(() => {});
}

if (import.meta.main) {
  await main();
}
