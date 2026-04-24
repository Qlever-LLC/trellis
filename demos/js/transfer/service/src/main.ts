import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import * as operations from "./operations/index.ts";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-transfer")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-transfer-service",
    sessionKeySeed,
  }).orThrow();

  await service.operation("Inspection.Evidence.Upload").handle(
    operations.uploadEvidence,
  );

  console.log(chalk.green.bold("== Inspection transfer service"));
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
      console.error(chalk.red.bold("Failed to stop transfer service"));
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
