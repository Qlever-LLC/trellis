import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_rpc_device.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();

function formatPriority(priority: "high" | "medium" | "low"): string {
  return priority.toUpperCase();
}

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret) {
    throw new Error("Usage: deno task start -- <trellisUrl> <rootSecret>");
  }

  const device = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired: async (activation) => {
      console.info(activation.url);
      await activation.waitForOnlineApproval();
    },
  });
  const me = await device.request("Auth.Me", {}).take();
  if (isErr(me)) {
    throw me.error;
  }

  printScenarioHeading("Inspection RPC device");
  console.info("Connected as", me.device?.deviceId ?? "unknown-device");

  const assignments = await device
    .request("Inspection.Assignments.List", {})
    .take();
  if (isErr(assignments)) {
    throw assignments.error;
  }

  console.info("Assigned inspections:");
  for (const assignment of assignments.assignments) {
    console.info(
      `- [${formatPriority(
        assignment.priority,
      )}] ${assignment.siteName}: ${assignment.assetName} (${assignment.checklistName}) at ${assignment.scheduledFor}`,
    );
  }

  const siteIds = [
    ...new Set(assignments.assignments.map((assignment) => assignment.siteId)),
  ];
  console.info("Site summaries:");

  for (const siteId of siteIds) {
    const summary = await device
      .request("Inspection.Sites.GetSummary", {
        siteId,
      })
      .take();
    if (isErr(summary)) {
      throw summary.error;
    }

    if (!summary.summary) {
      console.info(`- ${siteId}: no summary available`);
      continue;
    }

    console.info(
      `- ${summary.summary.siteName}: ${summary.summary.openInspections} open, ${summary.summary.overdueInspections} overdue, status ${summary.summary.latestStatus}, last report ${summary.summary.lastReportAt}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
