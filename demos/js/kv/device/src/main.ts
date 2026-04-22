import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import { qrcode } from "@libs/qrcode";
import chalk from "chalk";

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

  const device = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired: async (activation) => {
      console.info("Please activate device at:", activation.url);
      qrcode(activation.url, { output: "console" });

      await activation.waitForOnlineApproval();
    },
  }).orThrow();
  console.log(chalk.green.bold("== Fetching Current Identify"));

  const me = await device.request("Auth.Me", {}).orThrow();
  console.dir(me, { depth: null });

  console.log(chalk.green.bold("== Fetching Site Summaries"));
  const { summaries } = await device.request("Inspection.Summaries.List", {})
    .orThrow();

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
  const { summary } = await device.request("Inspection.Summaries.Get", {
    siteId: firstSiteId,
  }).orThrow();

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
