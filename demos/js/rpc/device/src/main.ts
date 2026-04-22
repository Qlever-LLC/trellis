import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import { qrcode } from "@libs/qrcode";
import chalk from "chalk";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, rootSecret],
  } = await new Command()
    .name("demo-rpc")
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

  console.log(chalk.green.bold("== Fetching Assignment List"));
  const { assignments } = await device
    .request("Inspection.Assignments.List", {})
    .orThrow();

  console.info("Assigned inspections:");
  for (const item of assignments) {
    console.info(
      `- [${item.priority.toUpperCase()}] ${item.siteName}: ${item.assetName} (${item.checklistName}) at ${item.scheduledFor}`,
    );
  }

  const siteIds = [...new Set(assignments.map((item) => item.siteId))];
  console.info("Site summaries:");
  for (const siteId of siteIds) {
    const { summary } = await device
      .request("Inspection.Sites.GetSummary", { siteId })
      .orThrow();

    if (!summary) {
      console.info(`- ${siteId}: no summary available`);
      continue;
    }

    console.info(
      `- ${summary.siteName}: ${summary.openInspections} open, ${summary.overdueInspections} overdue, status ${summary.latestStatus}, last report ${summary.lastReportAt}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
