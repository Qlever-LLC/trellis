import { isErr } from "@qlever-llc/result";
import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_device.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const filePath = Deno.args[2]?.trim();

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret || !filePath) {
    throw new Error(
      "Usage: deno task start -- <trellisUrl> <rootSecret> <filePath>",
    );
  }

  console.info(`Connecting to ${trellisUrl}`);
  const trellis = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired: async (activation) => {
      console.info(`device activation required: ${activation.url}`);
      await activation.waitForOnlineApproval();
    },
  });

  // Print who you are
  const me = (await trellis.request("Auth.Me", {})).take();
  if (isErr(me)) {
    return console.error("Could not connect", { err: me });
  }
  console.info("You are:");
  console.dir({ me }, { depth: null });

  // Call a non-trellis core RPC
  const groups = (await trellis.request("Demo.Groups.List", {})).take();
  if (isErr(groups)) {
    return console.error("Could not list groups", { err: groups });
  }

  const bytes = await Deno.readFile(filePath);
  const fileName = filePath.split(/[\\/]/).at(-1) || "upload.txt";
  const contentType = "text/plain";

  const grant = (
    await trellis.request("Demo.Files.InitiateUpload", {
      key: fileName,
      contentType,
    })
  ).take();
  if (isErr(grant)) {
    return console.error("Could not start upload", { err: grant });
  }

  if (grant.kind !== "upload") {
    return console.error("Upload RPC returned unexpected transfer grant", {
      grant,
    });
  }

  const uploaded = (await trellis.transfer(grant).put(bytes)).take();
  if (isErr(uploaded)) {
    return console.error("Upload failed", { err: uploaded });
  }

  console.info("uploaded", uploaded);
}

if (import.meta.main) {
  await main();
}
