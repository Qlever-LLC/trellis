import type { OperationInvoker, RpcOutputOf } from "@qlever-llc/trellis";
import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_device.ts";

import config from "../deno.json" with { type: "json" };

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const filePath = Deno.args[2]?.trim();

type DemoGroupsListOutput = RpcOutputOf<typeof contract.API.trellis, "Demo.Groups.List">;
type DemoFilesInitiateUploadOutput = RpcOutputOf<
  typeof contract.API.trellis,
  "Demo.Files.InitiateUpload"
>;
type ProcessInvoker = OperationInvoker<
  typeof contract.API.trellis.operations["Demo.Files.Process"]
>;

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
      console.info(`device activation flow: ${activation.url}`);
      await activation.waitForOnlineApproval();
    },
  });
  // Set static health/service info
  trellis.health.setInfo({
    info: {
      name: config.name,
      version: config.version,
      serial: "asd1234",
      demo: true,
    },
  });

  // Add a health check
  trellis.health.add("Johnny_5", () => ({
    status: Math.random() > 0.2 ? "ok" : "failed",
  }));

  // Print who you are
  const me = (await trellis.request("Auth.Me", {})).match({
    ok: (value) => value,
    err: (error) => {
      console.error("Could not connect", { err: error });
      return undefined;
    },
  });
  if (!me) {
    return;
  }
  console.info("You are:");
  console.dir({ me }, { depth: null });

  // Call a non-trellis core RPC
  const groups = (await trellis.request("Demo.Groups.List", {})).match({
    ok: (value: DemoGroupsListOutput) => value,
    err: (error) => {
      console.error("Could not list groups", { err: error });
      return undefined;
    },
  });
  if (!groups) {
    return;
  }

  const bytes = await Deno.readFile(filePath);
  const fileName = filePath.split(/[\\/]/).at(-1) || "upload.txt";
  const contentType = "text/plain";

  const started = await (await trellis.request("Demo.Files.InitiateUpload", {
    key: fileName,
    contentType,
  })).match({
    ok: (value) => value as DemoFilesInitiateUploadOutput,
    err: (error) => {
      console.error("Could not start file processing", { err: error });
      return undefined;
    },
  });
  if (!started) {
    return;
  }

  if (started.transfer.kind !== "upload") {
    return console.error(
      "Process start RPC returned unexpected transfer grant",
      {
        transfer: started.transfer,
      },
    );
  }

  const process = (trellis.operation("Demo.Files.Process") as ProcessInvoker)
    .resume(started.operation.ref);
  const watch = await (await process.watch()).match({
    ok: (value) => value,
    err: (error) => {
      console.error("Could not watch file processing", { err: error });
      return undefined;
    },
  });
  if (!watch) {
    return;
  }

  console.info("process accepted", started.operation.snapshot);

  const watchTask = (async () => {
    for await (const event of watch) {
      console.info("process event", event);
    }
  })();

  const uploaded = await (await trellis.transfer(started.transfer).put(bytes))
    .match({
      ok: (value) => value,
      err: (error) => {
        console.error("Upload failed", { err: error });
        return undefined;
      },
    });
  if (!uploaded) {
    return;
  }

  console.info("uploaded", uploaded);
  await watchTask;

  Deno.exit();
}

if (import.meta.main) {
  await main();
}
