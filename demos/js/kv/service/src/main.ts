import { isErr, Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract, {
  SiteSummarySchema,
} from "../contracts/demo_inspection_kv_service.ts";
import { SITE_SUMMARIES } from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";

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
  });

  const siteSummaries = await service.kv.siteSummaries.open(SiteSummarySchema)
    .orThrow();

  for (const summary of SITE_SUMMARIES) {
    if (isErr(await siteSummaries.get(summary.siteId).take())) {
      await siteSummaries.create(summary.siteId, summary).orThrow();
    }
  }

  await service.trellis.mount("Inspection.Summaries.List", async () => {
    const summaries = [];
    const keys = await siteSummaries.keys(">")
      .orThrow();

    for await (const key of keys) {
      const entry = await siteSummaries.get(key).take();
      if (!isErr(entry)) {
        summaries.push(entry.value);
      }
    }

    summaries.sort((left, right) => left.siteName.localeCompare(right.siteName));
    return Result.ok({ summaries });
  });

  await service.trellis.mount("Inspection.Summaries.Get", async (input) => {
    const entry = await siteSummaries.get(input.siteId).take();
    return Result.ok({ summary: isErr(entry) ? undefined : entry.value });
  });

  console.log(chalk.green.bold("== Inspection KV service"));
  const shutdown = async () => {
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
