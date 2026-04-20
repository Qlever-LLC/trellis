import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_rpc_device.ts";
import type {
  InspectionAssignment,
  SiteSummary,
} from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();

function formatPriority(priority: "high" | "medium" | "low"): string {
  return priority.toUpperCase();
}

type AuthMeResponse = {
  device?: {
    deviceId?: string;
  };
};

type AssignmentsResponse = {
  assignments: InspectionAssignment[];
};

type SiteSummaryResponse = {
  summary?: SiteSummary;
};

function asAuthMeResponse(value: unknown): AuthMeResponse {
  if (!value || typeof value !== "object") {
    return {};
  }

  const response = value as Record<string, unknown>;
  const device = response.device;
  if (!device || typeof device !== "object") {
    return {};
  }

  const record = device as Record<string, unknown>;
  return {
    device: {
      deviceId: typeof record.deviceId === "string" ? record.deviceId : undefined,
    },
  };
}

function asAssignmentsResponse(value: unknown): AssignmentsResponse {
  if (!value || typeof value !== "object") {
    throw new Error("assignments response must be an object");
  }

  const assignments = (value as Record<string, unknown>).assignments;
  if (!Array.isArray(assignments)) {
    throw new Error("assignments response is missing assignments");
  }

  return { assignments: assignments as InspectionAssignment[] };
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
  const authMe = asAuthMeResponse(me);

  printScenarioHeading("Inspection RPC device");
  console.info("Connected as", authMe.device?.deviceId ?? "unknown-device");

  const assignments = await device
    .request("Inspection.Assignments.List", {})
    .take();
  if (isErr(assignments)) {
    throw assignments.error;
  }
  const assignmentList = asAssignmentsResponse(assignments);

  console.info("Assigned inspections:");
  for (const assignment of assignmentList.assignments) {
    console.info(
      `- [${formatPriority(
        assignment.priority,
      )}] ${assignment.siteName}: ${assignment.assetName} (${assignment.checklistName}) at ${assignment.scheduledFor}`,
    );
  }

  const siteIds = [
    ...new Set(assignmentList.assignments.map((assignment) => assignment.siteId)),
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
    const siteSummary = asSiteSummaryResponse(summary);

    if (!siteSummary.summary) {
      console.info(`- ${siteId}: no summary available`);
      continue;
    }

    console.info(
      `- ${siteSummary.summary.siteName}: ${siteSummary.summary.openInspections} open, ${siteSummary.summary.overdueInspections} overdue, status ${siteSummary.summary.latestStatus}, last report ${siteSummary.summary.lastReportAt}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
