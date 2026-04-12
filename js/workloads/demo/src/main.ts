import { isErr, TrellisWorkload } from "@qlever-llc/trellis";
import type { WorkloadActivationController } from "@qlever-llc/trellis/workload";
import contract from "../contracts/demo_workload.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const online = Deno.args[2]?.trim() === "online";

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret) {
    throw new Error(
      "Usage: deno task start -- <trellisUrl> <rootSecret> [online]",
    );
  }

  console.info(`Connecting to ${trellisUrl}`);

  const trellis = await TrellisWorkload.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired,
  });

  const me = (await trellis.request("Auth.Me", {})).take();
  if (isErr(me)) {
    return console.error("Could not connect", { err: me });
  }

  console.info(`workload authenticated: ${trellis.natsConnection.getServer()}`);
  console.dir({ me }, { depth: null });
}

async function onActivationRequired(activation: WorkloadActivationController) {
  console.info("workload activation required");
  console.info(activation.url);

  if (online) {
    await activation.waitForOnlineApproval();
  } else {
    const code =
      globalThis.prompt("Enter workload confirmation code")?.trim() || "";

    await activation.acceptConfirmationCode(code);
  }
}

if (import.meta.main) {
  await main();
}
