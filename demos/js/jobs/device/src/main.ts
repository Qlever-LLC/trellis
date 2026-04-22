import { TransportError, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import { qrcode } from "@libs/qrcode";
import chalk from "chalk";

const POLL_INTERVAL_MS = 250;

async function main(): Promise<void> {
  // Parse demo CLI args
  const { args } = await new Command()
    .name("demo-jobs")
    .arguments("<trellisUrl:string> <rootSecret:string>", [
      "URL of Trellis instance to connect to",
      "Trellis device root secret",
    ])
    .parse(Deno.args);

  // Connect to Trellis
  const device = await TrellisDevice.connect({
    contract,
    trellisUrl: args[0],
    rootSecret: args[1],
    onActivationRequired: async (activation) => {
      console.info("Please activate device at:", activation.url);
      qrcode(activation.url, { output: "console" });

      await activation.waitForOnlineApproval();
    },
  }).orThrow();

  // Fetch authenticated identity
  console.log(chalk.green.bold("== Fetching Current Identify"));
  const me = await device.request("Auth.Me", {}).orThrow();
  console.dir(me, { depth: null });

  // Make a simple RPC
  console.log(chalk.green.bold("== Queueing Summary Refresh"));
  const siteId = "site-west-yard";
  const refresh = await device
    .request("Inspection.Summaries.Refresh", { siteId })
    .orThrow();

  // NOTE: In practice, a Trellis "operation" would be a much better fit
  // for work. Operations integrate seamlessly with Trellis Jobs.
  console.info(`Queued refresh ${refresh.refreshId} for ${siteId}`);
  console.log(chalk.green.bold("== Polling Refresh Status"));
  while (true) {
    const { refresh: current } = await device
      .request("Inspection.Summaries.RefreshStatus.Get", {
        refreshId: refresh.refreshId,
      })
      .orThrow();

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
