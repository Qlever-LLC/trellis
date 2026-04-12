import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import type { DeviceActivationController } from "@qlever-llc/trellis/device";
import contract from "../contracts/demo_device.ts";

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

  const trellis = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired,
  });

  const me = (await trellis.request("Auth.Me", {})).take();
  if (isErr(me)) {
    return console.error("Could not connect", { err: me });
  }

  console.info(`device authenticated: ${trellis.natsConnection.getServer()}`);
  console.dir({ me }, { depth: null });
}

async function onActivationRequired(activation: DeviceActivationController) {
  console.info("device activation required");
  console.info(activation.url);

  if (online) {
    await activation.waitForOnlineApproval();
  } else {
    const code =
      globalThis.prompt("Enter device confirmation code")?.trim() || "";

    await activation.acceptConfirmationCode(code);
  }
}

if (import.meta.main) {
  await main();
}
