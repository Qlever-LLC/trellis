import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_kv_device.ts";
import type { SiteSummary } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();

type SiteSummariesResponse = {
  summaries: SiteSummary[];
};

type SiteSummaryResponse = {
  summary?: SiteSummary;
};

function asSiteSummariesResponse(value: unknown): SiteSummariesResponse {
  if (!value || typeof value !== "object") {
    throw new Error("site summaries response must be an object");
  }

  const summaries = (value as Record<string, unknown>).summaries;
  if (!Array.isArray(summaries)) {
    throw new Error("site summaries response is missing summaries");
  }

  return { summaries: summaries as SiteSummary[] };
}

function asSiteSummaryResponse(value: unknown): SiteSummaryResponse {
  if (!value || typeof value !== "object") {
    throw new Error("site summary response must be an object");
  }

  const summary = (value as Record<string, unknown>).summary;
  return {
    summary: summary && typeof summary === "object" ? summary as SiteSummary : undefined,
  };
}

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret) {
    throw new Error("Usage: deno task start <trellisUrl> <rootSecret>");
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

  printScenarioHeading("Inspection KV device");
  console.info("Connected to inspection KV demo device runtime");

  const summariesResult = await device.request("Inspection.Summaries.List", {});
  const summaries = summariesResult.take();
  if (isErr(summaries)) {
    throw summaries.error;
  }
  const siteSummaries = asSiteSummariesResponse(summaries);

  console.info("Site summaries fetched over RPC:");
  for (const summary of siteSummaries.summaries) {
    console.info(
      `- ${summary.siteName}: ${summary.openInspections} open, ${summary.overdueInspections} overdue, status ${summary.latestStatus}`,
    );
  }

  const firstSiteId = siteSummaries.summaries[0]?.siteId;
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
  const siteSummary = asSiteSummaryResponse(summary);

  if (!siteSummary.summary) {
    console.info(`No summary found for ${firstSiteId}`);
    return;
  }

  console.info(
    `Detailed summary via RPC for ${siteSummary.summary.siteName}: last report ${siteSummary.summary.lastReportAt}`,
  );
}

if (import.meta.main) {
  await main();
}
