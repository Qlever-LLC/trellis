import { isErr } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { SITE_SUMMARIES } from "../../shared/field_data.ts";
import contract from "../contract.ts";
import * as features from "./features/index.ts";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-service")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "field-ops-demo-service",
    sessionKeySeed,
  }).orThrow();

  for (const summary of SITE_SUMMARIES) {
    if (isErr(await service.kv.siteSummaries.get(summary.siteId).take())) {
      await service.kv.siteSummaries.create(summary.siteId, summary).orThrow();
    }
  }

  service.jobs.refreshSiteSummary.handle(features.sites.refreshSiteSummary);

  await service.trellis.mount(
    "Assignments.List",
    features.assignments.listAssignments,
  );
  await service.trellis.mount("Sites.List", features.sites.listSites);
  await service.trellis.mount("Sites.Get", features.sites.getSite);
  await service.trellis.mount("Evidence.List", features.evidence.listEvidence);
  await service.trellis.mount(
    "Evidence.Download",
    features.evidence.downloadEvidence(service),
  );
  await service.operation("Sites.Refresh").handle(features.sites.refreshSite);
  await service.operation("Reports.Generate").handle(
    features.reports.generateReport,
  );
  await service.operation("Evidence.Upload").handle(
    features.evidence.uploadEvidence,
  );

  console.log(chalk.green.bold("== Field Ops demo service"));
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
      console.error(chalk.red.bold("Failed to stop Field Ops demo service"));
      console.error(error);
      Deno.exit(1);
    }
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());

  try {
    await service.wait();
  } catch (error) {
    console.error(
      chalk.red.bold("Field Ops demo service stopped unexpectedly"),
    );
    console.error(error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
