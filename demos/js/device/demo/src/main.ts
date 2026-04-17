import type { OperationEvent, RpcOutputOf } from "@qlever-llc/trellis";
import { isErr, TrellisDevice } from "@qlever-llc/trellis";
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

  const me = (await trellis.request("Auth.Me", {})).take();
  if (isErr(me)) {
    console.error("Could not connect", { err: me });
    Deno.exit();
  }

  console.info("You are:");
  console.dir({ me }, { depth: null });

  const groups = (await trellis.request("Demo.Groups.List", {})).take();
  if (isErr(groups)) {
    console.error("Could not list groups", { err: groups });
    Deno.exit();
  }

  console.info("groups", groups);

  const bytes = await Deno.readFile(filePath);
  const fileName = fileNameFromPath(filePath);

  const started = await trellis.operation("Demo.Files.Upload").start({
    key: fileName,
    contentType: DEFAULT_CONTENT_TYPE,
  });
  const operation = started.take();
  if (isErr(operation)) {
    console.error("Could not start file upload", { err: operation });
    Deno.exit();
  }

  const watch = (await operation.watch()).take();
  if (isErr(watch)) {
    console.error("Could not watch file upload", { err: watch });
    Deno.exit();
  }

  console.info("upload accepted", {
    id: operation.id,
    operation: operation.operation,
  });

  const progress = new UploadProgress(bytes.length);
  const transferResultPromise = operation.transfer(bytes);
  const waitResultPromise = operation.wait();

  let progressFinished = false;
  let lastTransferredBytes = -1;
  for await (const event of watch as AsyncIterable<
    OperationEvent<{ stage: string; message: string }, unknown>
  >) {
    if (event.type === "transfer") {
      if (event.transfer.transferredBytes !== lastTransferredBytes) {
        progress.update(event.transfer.transferredBytes);
        lastTransferredBytes = event.transfer.transferredBytes;
      }
      continue;
    }

    if (event.type === "progress" && event.snapshot.progress) {
      if (!progressFinished) {
        progress.finish();
        progressFinished = true;
      }

      console.info(
        `${event.snapshot.progress.stage}: ${event.snapshot.progress.message}`,
      );
    }
  }

  if (!progressFinished) {
    progress.finish();
  }

  const transferResult = await transferResultPromise;
  const uploaded = transferResult.take();
  if (isErr(uploaded)) {
    console.error("Upload failed", { err: uploaded });
    Deno.exit();
  }

  console.info("uploaded", uploaded);
  const waited = await waitResultPromise;
  const terminal = waited.take();
  if (isErr(terminal)) {
    console.error("Upload operation failed", { err: terminal });
    Deno.exit();
  }

  console.info("upload completed", terminal.output);

  Deno.exit();
}

if (import.meta.main) {
  await main();
}
