import { TransportError } from "@qlever-llc/trellis/errors";
import contract from "../contract.ts";
import { renderCompactQr } from "../../../shared/compact_qr.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { TrellisDevice } from "@qlever-llc/trellis";
import { checkDeviceActivation } from "@qlever-llc/trellis/device/deno";
import type { InspectionSummariesRefreshStatus } from "@trellis-demo/jobs-service-sdk";

const POLL_INTERVAL_MS = 250;

async function main(): Promise<void> {
  ////////////////////////////
  // 1. Parse demo CLI args //
  ////////////////////////////
  const {
    args: [trellisUrl, rootSecret],
  } = await new Command()
    .name("demo-jobs")
    .arguments("<trellisUrl:string> <rootSecret:string>", [
      "URL of Trellis instance to connect to",
      "Trellis device root secret",
    ])
    .parse(Deno.args);

  ////////////////////////////
  // 2. Check device status //
  ////////////////////////////
  const activation = await checkDeviceActivation({
    contract,
    trellisUrl,
    rootSecret,
  });

  switch (activation.status) {
    case "not_ready":
      throw new Error(`Device is not ready: ${activation.reason}`);

    case "activation_required":
      console.info("Please activate device at:", activation.activationUrl);
      renderCompactQr(activation.activationUrl);
      await activation.waitForOnlineApproval();
      console.info("Activated!");

      break;

    case "activated":
      console.log("Device is already activated. Continueing.");
  }

  ///////////////////////////
  // 3. Connect to Trellis //
  ///////////////////////////
  const device = await TrellisDevice.connect({
    contract,
    trellisUrl,
    rootSecret,
  }).orThrow();

  /////////////////////////
  // 4. RPC triggers Job //
  /////////////////////////
  console.log(chalk.green.bold("== Queueing Summary Refresh"));
  const refresh = await device
    .request("Inspection.Summaries.Refresh", { siteId: "site-west-yard" })
    .orThrow();
  ////////////////////////////
  // 5. Check on Job status //
  ////////////////////////////
  // NOTE: In practice, a Trellis "operation" would be a much better fit
  // for work. Operations integrate seamlessly with Trellis Jobs.
  console.info(`Queued refresh ${refresh.refreshId}`);
  console.log(chalk.green.bold("== Polling Refresh Status"));
  while (true) {
    const refreshStatus = await device
      .request("Inspection.Summaries.RefreshStatus.Get", {
        refreshId: refresh.refreshId,
      })
      .orThrow();
    const current: InspectionSummariesRefreshStatus | undefined =
      refreshStatus.refresh;

    if (!current) {
      console.info(`Refresh ${refresh.refreshId}: status not available yet`);
    } else {
      console.info(
        `Refresh ${current.refreshId}: ${current.status} at ${current.updatedAt} for ${current.siteId}`,
      );

      if (current.status === "completed" || current.status === "failed") {
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof TransportError) {
      console.error(chalk.red.bold("Trellis request failed"));
      console.error(`${error.message} (${error.code})`);
      console.error(error.hint);
      Deno.exit(1);
    }

    throw error;
  }
}
