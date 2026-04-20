import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_jobs_device.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const POLL_INTERVAL_MS = 250;

type RefreshResponse = {
  refreshId: string;
  status: string;
};

type RefreshStatus = {
  refreshId: string;
  siteId: string;
  status: string;
  updatedAt: string;
};

type RefreshStatusResponse = {
  refresh?: RefreshStatus;
};

function asRefreshResponse(value: unknown): RefreshResponse {
  if (!value || typeof value !== "object") {
    throw new Error("refresh response must be an object");
  }

  const record = value as Record<string, unknown>;
  const refreshId = record.refreshId;
  const status = record.status;
  if (typeof refreshId !== "string" || typeof status !== "string") {
    throw new Error("refresh response is missing fields");
  }

  return { refreshId, status };
}

function asRefreshStatusResponse(value: unknown): RefreshStatusResponse {
  if (!value || typeof value !== "object") {
    throw new Error("refresh status response must be an object");
  }

  const refresh = (value as Record<string, unknown>).refresh;
  return {
    refresh: refresh && typeof refresh === "object" ? refresh as RefreshStatus : undefined,
  };
}

function isTerminalRefreshStatus(status: string): boolean {
  return status === "completed" || status === "failed";
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

  printScenarioHeading("Inspection jobs device");
  console.info("Connected to inspection jobs demo device runtime");

  const siteId = "site-west-yard";
  const refresh = await device
    .request("Inspection.Summaries.Refresh", { siteId })
    .take();
  if (isErr(refresh)) {
    throw refresh.error;
  }
  const refreshRequest = asRefreshResponse(refresh);

  console.info(`Queued refresh ${refreshRequest.refreshId} for ${siteId}`);

  while (true) {
    const status = await device
      .request("Inspection.Summaries.RefreshStatus.Get", {
        refreshId: refreshRequest.refreshId,
      })
      .take();
    if (isErr(status)) {
      throw status.error;
    }
    const refreshStatus = asRefreshStatusResponse(status);

    const current = refreshStatus.refresh;
    if (!current) {
      console.info(`Refresh ${refreshRequest.refreshId}: status not available yet`);
    } else {
      console.info(
        `Refresh ${current.refreshId}: ${current.status} at ${current.updatedAt} for ${current.siteId}`,
      );

      if (isTerminalRefreshStatus(current.status)) {
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (import.meta.main) {
  await main();
}
