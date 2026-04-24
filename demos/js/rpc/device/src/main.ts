import contract from "../contract.ts";
import { renderCompactQr } from "../../../shared/compact_qr.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { TrellisDevice } from "@qlever-llc/trellis";
import { checkDeviceActivation } from "@qlever-llc/trellis/device/deno";
import type {
  InspectionAssignment,
  SiteSummary,
} from "@trellis-demo/rpc-service-sdk";

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
    renderCompactQr(activation.activationUrl);
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
  const assignmentsResult = await trellis
    .request("Inspection.Assignments.List", {})
    .orThrow();
  const assignments: InspectionAssignment[] = assignmentsResult.assignments;

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
    const summaryResult = await trellis
      .request("Inspection.Sites.GetSummary", { siteId })
      .orThrow();
    const summary: SiteSummary | undefined = summaryResult.summary;

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
