import { TrellisDevice } from "@qlever-llc/trellis";
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

function progressFields(value: unknown): { stage: string; message: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const stage = record.stage;
  const message = record.message;
  if (typeof stage !== "string" || typeof message !== "string") {
    return null;
  }

  return { stage, message };
}

async function main(): Promise<void> {
  if (!trellisUrl || !rootSecret || !filePath) {
    throw new Error(
      "Usage: deno task start <trellisUrl> <rootSecret> <filePath>",
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
  await device.request("Auth.Me", {}).orThrow();

  printScenarioHeading("Inspection transfer device");
  console.info("Connected to inspection transfer demo device runtime");

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

      const update = progressFields(event.progress);
      if (!update) {
        return;
      }

      console.info(`${update.stage}: ${update.message}`);
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
