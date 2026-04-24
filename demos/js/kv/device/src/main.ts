import contract from "../contract.ts";
import { renderCompactQr } from "../../../shared/compact_qr.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { TrellisDevice } from "@qlever-llc/trellis";
import { checkDeviceActivation } from "@qlever-llc/trellis/device/deno";
import type { SiteSummary } from "@trellis-demo/kv-service-sdk";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, rootSecret],
  } = await new Command()
    .name("demo-kv")
    .arguments("<trellisUrl:string> <rootSecret:string>", [
      "URL of Trellis instance to connect to",
      "Trellis device root secret",
    ])
    .parse(Deno.args);

  const activation = await checkDeviceActivation({
    trellisUrl,
    contract,
    rootSecret,
  });
  if (activation.status === "not_ready") {
    throw new Error(`Device is not ready: ${activation.reason}`);
  }
  if (activation.status === "activation_required") {
    console.info("Please activate device at:", activation.activationUrl);
    renderCompactQr(activation.activationUrl);
    await activation.waitForOnlineApproval();
  }

  const device = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
  }).orThrow();
  console.log(chalk.green.bold("== Fetching Current Identify"));

  const me = await device.request("Auth.Me", {}).orThrow();
  console.dir(me, { depth: null });

  console.log(chalk.green.bold("== Fetching Site Summaries"));
  const summariesResult = await device.request("Inspection.Summaries.List", {})
    .orThrow();
  const summaries: SiteSummary[] = summariesResult.summaries;

  console.info("Site summaries fetched over RPC:");
  for (const summary of summaries) {
    console.info(
      `- ${summary.siteName}: ${summary.openInspections} open, ${summary.overdueInspections} overdue, status ${summary.latestStatus}`,
    );
  }

  const firstSiteId = summaries[0]?.siteId;
  if (!firstSiteId) {
    return;
  }

  console.log(chalk.green.bold("== Fetching Site Summary Detail"));
  const summaryResult = await device.request("Inspection.Summaries.Get", {
    siteId: firstSiteId,
  }).orThrow();
  const summary: SiteSummary | undefined = summaryResult.summary;

  if (!summary) {
    console.info(`No summary found for ${firstSiteId}`);
    return;
  }

  console.info(
    `Detailed summary via RPC for ${summary.siteName}: last report ${summary.lastReportAt}`,
  );
}

if (import.meta.main) {
  await main();
}
