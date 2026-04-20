import { ok } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract from "../contracts/demo_inspection_transfer_service.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

async function countStreamChunks(
  stream: ReadableStream<Uint8Array>,
): Promise<{ chunkCount: number; byteCount: number }> {
  const reader = stream.getReader();
  let chunkCount = 0;
  let byteCount = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return { chunkCount, byteCount };
      }

      chunkCount += 1;
      byteCount += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

async function main(): Promise<void> {
  if (!trellisUrl || !sessionKeySeed) {
    throw new Error("Usage: deno task start <trellisUrl> <sessionKeySeed>");
  }

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

    await op.progress({
      stage: "processing",
      message: `Inspecting staged evidence at ${transferred.key}`,
    }).orThrow();

    const body = await entry.stream().orThrow();

    const processed = await countStreamChunks(body);
    await op.progress({
      stage: "indexed",
      message: `Indexed ${processed.chunkCount} evidence blocks from ${transferred.key}`,
    }).orThrow();

    const output = {
      evidenceId: `evidence-${input.key}`,
      key: transferred.key,
      size: processed.byteCount,
      disposition: "ready-for-review",
    };

    await op.complete(output).orThrow();
    return ok(output);
  });

  printScenarioHeading("Inspection transfer service");
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
