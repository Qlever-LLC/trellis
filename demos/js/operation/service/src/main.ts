import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import * as operations from "./operations/index.ts";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-operation")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-operation-service",
    sessionKeySeed,
  }).orThrow();

  await service.operation("Inspection.Report.Generate").handle(
    operations.generateReport,
  );

  console.log(chalk.green.bold("== Inspection operation service"));
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
      console.error(chalk.red.bold("Failed to stop operation service"));
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
