import { TrellisWorkload } from "@qlever-llc/trellis";
import type { WorkloadActivationController } from "@qlever-llc/trellis/workload";
import contract from "../contracts/demo_workload.ts";

const authUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const online = Deno.args[2]?.trim() === "online";

async function main(): Promise<void> {
  if (!authUrl || !rootSecret) {
    throw new Error(
      "Usage: deno task start -- <authUrl> <rootSecret> [online]",
    );
  }

  console.info(`Connecting to ${authUrl}`);

  const trellis = await TrellisWorkload.connect({
    authUrl,
    contract,
    rootSecret,
    onActivationRequired,
  });

  const me = (await trellis.request("Auth.Me", {})).take();

  console.info(`workload authenticated: ${trellis.natsConnection.getServer()}`);
  console.dir({ me }, { depth: null });
}

async function onActivationRequired(activation: WorkloadActivationController) {
  console.info("workload activation required");
  console.info(activation.url);

  if (online) {
    await activation.waitForOnlineApproval();
  } else {
    const code = globalThis.prompt("Enter workload confirmation code")?.trim();
    if (!code) {
      await activation.waitForOnlineApproval();
      return;
    }

    await activation.acceptConfirmationCode(code);
  }
}

if (import.meta.main) {
  await main();
}
