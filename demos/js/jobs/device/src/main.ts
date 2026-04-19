import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_jobs_device.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const POLL_INTERVAL_MS = 250;

function isTerminalRefreshStatus(status: string): boolean {
  return status === "completed" || status === "failed";
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

  printScenarioHeading("Inspection jobs device");
  console.info("Connected as", me.device?.deviceId ?? "unknown-device");

  const siteId = "site-west-yard";
  const refresh = await device
    .request("Inspection.Summaries.Refresh", { siteId })
    .take();
  if (isErr(refresh)) {
    throw refresh.error;
  }

  console.info(`Queued refresh ${refresh.refreshId} for ${siteId}`);

  while (true) {
    const status = await device
      .request("Inspection.Summaries.RefreshStatus.Get", {
        refreshId: refresh.refreshId,
      })
      .take();
    if (isErr(status)) {
      throw status.error;
    }

    const current = status.refresh;
    if (!current) {
      console.info(`Refresh ${refresh.refreshId}: status not available yet`);
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
