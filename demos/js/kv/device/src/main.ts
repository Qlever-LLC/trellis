import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_kv_device.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();

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
  const me = (await device.request("Auth.Me", {})).take();
  if (isErr(me)) {
    throw me.error;
  }

  printScenarioHeading("Inspection KV device");
  console.info("Connected as", me.device?.deviceId ?? "unknown-device");

  const summariesResult = await device.request("Inspection.Summaries.List", {});
  const summaries = summariesResult.take();
  if (isErr(summaries)) {
    throw summaries.error;
  }

  console.info("Site summaries fetched over RPC:");
  for (const summary of summaries.summaries) {
    console.info(
      `- ${summary.siteName}: ${summary.openInspections} open, ${summary.overdueInspections} overdue, status ${summary.latestStatus}`,
    );
  }

  const firstSiteId = summaries.summaries[0]?.siteId;
  if (!firstSiteId) {
    return;
  }

  const summaryResult = await device.request("Inspection.Summaries.Get", {
    siteId: firstSiteId,
  });
  const summary = summaryResult.take();
  if (isErr(summary)) {
    throw summary.error;
  }

  if (!summary.summary) {
    console.info(`No summary found for ${firstSiteId}`);
    return;
  }

  console.info(
    `Detailed summary via RPC for ${summary.summary.siteName}: last report ${summary.summary.lastReportAt}`,
  );
}

if (import.meta.main) {
  await main();
}
