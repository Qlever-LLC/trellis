import { isErr, Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract, { SiteSummarySchema } from "../contract.ts";
import { SITE_SUMMARIES } from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { Value } from "typebox/value";

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

  async function listSummaries() {
    const summaries: Array<(typeof SITE_SUMMARIES)[number]> = [];
    const keys = await siteSummaries.keys(">")
      .orThrow();

    for await (const key of keys) {
      const entry = await siteSummaries.get(key).take();
      if (!isErr(entry)) {
        summaries.push(Value.Parse(SiteSummarySchema, entry.value));
      }
    }

    summaries.sort((left, right) =>
      left.siteName.localeCompare(right.siteName)
    );
    return Result.ok({ summaries });
  }

  async function getSummary(
    { input }: { input: { siteId: string } },
  ) {
    const entry = await siteSummaries.get(input.siteId).take();
    return Result.ok({
      summary: isErr(entry)
        ? undefined
        : Value.Parse(SiteSummarySchema, entry.value),
    });
  }

  await service.trellis.mount("Inspection.Summaries.List", listSummaries);
  await service.trellis.mount("Inspection.Summaries.Get", getSummary);

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
