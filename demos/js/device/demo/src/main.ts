import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_device.ts";
import config from "../deno.json" with { type: "json" };
import { UploadProgress } from "./upload_progress.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const filePath = Deno.args[2]?.trim();

const DEFAULT_UPLOAD_FILE_NAME = "upload.txt";
const DEFAULT_CONTENT_TYPE = "text/plain";

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) || DEFAULT_UPLOAD_FILE_NAME;
}

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

  trellis.health.setInfo({
    info: {
      name: config.name,
      version: config.version,
      serial: "asd1234",
      demo: true,
    },
  });

  trellis.health.add("Johnny_5", () => ({
    status: Math.random() > 0.2 ? "ok" : "failed",
  }));

  const me = (await trellis.request("Auth.Me", {})).orThrow();

  console.info("You are:");
  console.dir({ me }, { depth: null });

  const groups = (await trellis.request("Demo.Groups.List", {})).orThrow();

  console.info("groups", groups);

  const bytes = await Deno.readFile(filePath);
  const fileName = fileNameFromPath(filePath);

  const progress = new UploadProgress(bytes.length);
  let progressFinished = false;
  let lastTransferredBytes = -1;

  const upload = await trellis.operation("Demo.Files.Upload")
    .input({
      key: fileName,
      contentType: DEFAULT_CONTENT_TYPE,
    })
    .transfer(bytes)
    .onTransfer((event) => {
      if (event.transfer.transferredBytes !== lastTransferredBytes) {
        progress.update(event.transfer.transferredBytes);
        lastTransferredBytes = event.transfer.transferredBytes;
      }
    })
    .onProgress((event) => {
      if (!progressFinished) {
        progress.finish();
        progressFinished = true;
      }

      console.info(
        `${event.progress.stage}: ${event.progress.message}`,
      );
    })
    .start()
    .orThrow();

  console.info("upload accepted", {
    id: upload.operation.id,
    operation: upload.operation.operation,
  });

  const completed = await upload.wait().orThrow();

  if (!progressFinished) {
    progress.finish();
  }

  console.info("uploaded", completed.transferred);
  console.info("upload completed", completed.terminal.output);
}

if (import.meta.main) {
  try {
    await main();
    Deno.exit(0);
  } catch (error) {
    console.error("demo device failed", error);
    Deno.exit(1);
  }
}
