import { TrellisDevice } from "@qlever-llc/trellis";
import contract from "../contracts/demo_inspection_transfer_device.ts";
import { Command } from "@cliffy/command";
import { qrcode } from "@libs/qrcode";
import chalk from "chalk";

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, rootSecret, filePath],
  } = await new Command()
    .name("demo-transfer")
    .arguments("<trellisUrl:string> <rootSecret:string> <filePath:string>", [
      "URL of Trellis instance to connect to",
      "Trellis device root secret",
      "Path to file to upload",
    ])
    .parse(Deno.args);

  const device = await TrellisDevice.connect({
    trellisUrl,
    contract,
    rootSecret,
    onActivationRequired: async (activation) => {
      console.info("Please activate device at:", activation.url);
      qrcode(activation.url, { output: "console" });

      await activation.waitForOnlineApproval();
    },
  });
  console.log(chalk.green.bold("== Fetching Current Identify"));

  const me = await device.request("Auth.Me", {}).orThrow();
  console.dir(me, { depth: null });

  console.log(chalk.green.bold("== Starting Evidence Upload"));
  const bytes = await Deno.readFile(filePath);
  const fileName = filePath.split(/[\\/]/).at(-1) || "evidence.bin";
  const key = `evidence/${crypto.randomUUID()}-${fileName}`;
  let nextProgressPercent = 0;

  console.info("starting transfer", {
    filePath,
    key,
    size: bytes.length,
  });

  const upload = await device.operation("Inspection.Evidence.Upload")
    .input({
      key,
      contentType: DEFAULT_CONTENT_TYPE,
      evidenceType: "field-photo",
    })
    .transfer(bytes)
    .onTransfer((event) => {
      const percent = Math.floor(
        event.transfer.transferredBytes / Math.max(bytes.length, 1) * 100,
      );

      if (percent >= nextProgressPercent) {
        console.info(
          "transfer progress",
          `${percent}% (${event.transfer.transferredBytes}/${bytes.length} bytes)`,
        );
        nextProgressPercent = Math.min(100, percent + 10);
      }
    })
    .onProgress((event) => {
      console.info("service progress", event.progress);
    })
    .start()
    .orThrow();

  console.info("upload accepted", {
    id: upload.operation.id,
    operation: upload.operation.operation,
  });

  console.log(chalk.green.bold("== Waiting For Upload Completion"));
  const completed = await upload.wait().orThrow();

  console.info("transfer completed", completed.transferred);
  console.info("terminal output", completed.terminal.output);
}

if (import.meta.main) {
  await main();
}
