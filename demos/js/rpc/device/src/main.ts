import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { TrellisDevice } from "@qlever-llc/trellis";
import { checkDeviceActivation } from "@qlever-llc/trellis/device/deno";
import { qrcode } from "@libs/qrcode";

type Assignment = {
  priority: string;
  siteId: string;
  siteName: string;
  assetName: string;
  checklistName: string;
  scheduledFor: string;
};

type SiteSummary = {
  siteName: string;
  openInspections: number;
  overdueInspections: number;
  latestStatus: string;
  lastReportAt?: string;
};

async function main(): Promise<void> {
  // Process demo CLI arguments
  const { args } = await new Command()
    .name("demo-rpc")
    .arguments("<trellisUrl:string> <rootSecret:string>", [
      "URL of Trellis instance to connect to",
      "Trellis device root secret",
    ])
    .parse(Deno.args);

  const activation = await checkDeviceActivation({
    contract,
    trellisUrl: args[0],
    rootSecret: args[1],
  });
  if (activation.status === "not_ready") {
    throw new Error(`Device is not ready: ${activation.reason}`);
  }
  if (activation.status === "activation_required") {
    console.info("Please activate device at:", activation.activationUrl);
    qrcode(activation.activationUrl, { output: "console" });
    await activation.waitForOnlineApproval();
  }

  // Connect device to Trellis after activation if needed
  const trellis = await TrellisDevice.connect({
    contract,
    trellisUrl: args[0],
    rootSecret: args[1],
  }).orThrow();

  // Check who we are authenticated as
  console.log(chalk.green.bold("== Fetching Current Identify"));
  const me = await trellis.request("Auth.Me", {}).orThrow();
  console.dir(me, { depth: null });

  // Make a simple RPC
  console.log(chalk.green.bold("== Fetching Assignment List"));
  const { assignments } = (await trellis
    .request("Inspection.Assignments.List", {})
    .orThrow()) as { assignments: Assignment[] };

  console.info("Assigned inspections:");
  for (const item of assignments) {
    console.info(
      `- [${item.priority.toUpperCase()}] ${item.siteName}: ${item.assetName} (${item.checklistName}) at ${item.scheduledFor}`,
    );
  }

  // Make an RPC call with input
  const siteIds = [...new Set(assignments.map((item) => item.siteId))];
  console.info("Site summaries:");
  for (const siteId of siteIds) {
    const { summary } = (await trellis
      .request("Inspection.Sites.GetSummary", { siteId })
      .orThrow()) as { summary?: SiteSummary };

    if (!summary) {
      console.info(`- ${siteId}: no summary available`);
    } else {
      console.info(
        `- ${summary.siteName}: ${summary.openInspections} open, ${summary.overdueInspections} overdue, status ${summary.latestStatus}, last report ${summary.lastReportAt}`,
      );
    }
  }
}

if (import.meta.main) {
  await main();
}
