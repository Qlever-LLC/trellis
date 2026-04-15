import { isErr } from "@qlever-llc/result";
import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_device.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const online = Deno.args[2]?.trim() === "online";
const filePathArg = Deno.args[3]?.trim() || (online ? undefined : Deno.args[2]?.trim());

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
    onActivationRequired: async (activation) => {
      console.info("device activation required");
      console.info(activation.url);

      if (online) {
        await activation.waitForOnlineApproval();
      } else {
        const code =
          globalThis.prompt("Enter device confirmation code")?.trim() || "";

        await activation.acceptConfirmationCode(code);
      }
    },
  });

  const me = (await trellis.request("Auth.Me", {})).take();
  if (isErr(me)) {
    return console.error("Could not connect", { err: me });
  }

  const groups = (await trellis.request("Demo.Groups.List", {})).take();
  if (isErr(groups)) {
    return console.error("Could not list groups", { err: groups });
  }

  const filePath = filePathArg || globalThis.prompt("Enter path to upload")?.trim();
  if (!filePath) {
    return console.error("No file path provided");
  }

  const bytes = await Deno.readFile(filePath);
  const fileName = filePath.split(/[\\/]/).at(-1) || "upload.txt";
  const contentType = fileName.endsWith(".json") ? "application/json" : "text/plain";

  const grant = (await trellis.request("Demo.Files.InitiateUpload", {
    key: `incoming/${fileName}`,
    contentType,
  })).take();
  if (isErr(grant)) {
    return console.error("Could not start upload", { err: grant });
  }

  if (grant.kind !== "upload") {
    return console.error("Upload RPC returned unexpected transfer grant", { grant });
  }

  const uploaded = (await trellis.transfer(grant).put(bytes)).take();
  if (isErr(uploaded)) {
    return console.error("Upload failed", { err: uploaded });
  }

  console.info(`device authenticated: ${trellis.natsConnection.getServer()}`);
  console.info("demo groups", groups.groups);
  console.info("uploaded", uploaded);
  console.dir({ me }, { depth: null });
}

if (import.meta.main) {
  await main();
}
