import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_transfer_device.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";
import { UploadProgress } from "./upload_progress.ts";

const trellisUrl = Deno.args[0]?.trim();
const rootSecret = Deno.args[1]?.trim();
const filePath = Deno.args[2]?.trim();

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) || "evidence.bin";
}

function buildEvidenceKey(path: string): string {
  return `evidence/${crypto.randomUUID()}-${fileNameFromPath(path)}`;
}

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret || !filePath) {
    throw new Error(
      "Usage: deno task start -- <trellisUrl> <rootSecret> <filePath>",
    );
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
  const me = (await device.request("Auth.Me", {})).take();
  if (isErr(me)) {
    throw me.error;
  }

  printScenarioHeading("Inspection transfer device");
  console.info("Connected as", me.device?.deviceId ?? "unknown-device");

  const bytes = await Deno.readFile(filePath);
  const key = buildEvidenceKey(filePath);
  const progress = new UploadProgress(bytes.length);
  let progressFinished = false;
  let lastTransferredBytes = -1;

  const upload = await device.operation("Inspection.Evidence.Upload")
    .input({
      key,
      contentType: DEFAULT_CONTENT_TYPE,
      evidenceType: "field-photo",
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

      console.info(`${event.progress.stage}: ${event.progress.message}`);
    })
    .start()
    .orThrow();

  console.info("upload accepted", {
    id: upload.operation.id,
    operation: upload.operation.operation,
  });

  const completed = await (async () => {
    try {
      return await upload.wait().orThrow();
    } finally {
      if (!progressFinished) {
        progress.finish();
      }
    }
  })();

  console.info("transfer completed", completed.transferred);
  console.info("terminal output", completed.terminal.output);
}

if (import.meta.main) {
  await main();
}
