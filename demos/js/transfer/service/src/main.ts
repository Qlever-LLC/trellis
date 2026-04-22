import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract from "../contracts/demo_inspection_transfer_service.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-transfer")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-transfer-service",
    sessionKeySeed,
  });
  const uploads = await service.store.uploads.open().orThrow();

  await service.operation("Inspection.Evidence.Upload").handle(async ({ input, op, transfer }) => {
    const transferred = await transfer.completed().orThrow();

    await op.started().orThrow();
    await op.progress({
      stage: "staged",
      message: `Staged ${transferred.size} bytes of ${input.evidenceType} evidence`,
    }).orThrow();

    const entry = await uploads.get(transferred.key).orThrow();
    const reader = (await entry.stream().orThrow()).getReader();
    let chunkCount = 0;
    let byteCount = 0;

    await op.progress({
      stage: "processing",
      message: `Inspecting staged evidence at ${transferred.key}`,
    }).orThrow();

    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }

        chunkCount += 1;
        byteCount += next.value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }

    await op.progress({
      stage: "indexed",
      message: `Indexed ${chunkCount} evidence blocks from ${transferred.key}`,
    }).orThrow();

    const output = {
      evidenceId: `evidence-${input.key}`,
      key: transferred.key,
      size: byteCount,
      disposition: "ready-for-review",
    };

    return await op.complete(output).orThrow();
  });

  console.log(chalk.green.bold("== Inspection transfer service"));
  const shutdown = async () => {
    await service.stop();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());
  await new Promise<void>(() => {});
}

if (import.meta.main) {
  await main();
}
