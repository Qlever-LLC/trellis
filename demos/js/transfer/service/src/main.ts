import { err, isErr, ok } from "@qlever-llc/trellis";
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
    throw new Error("Usage: deno task start -- <trellisUrl> <sessionKeySeed>");
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-transfer-service",
    sessionKeySeed,
  });
  const uploads = (await service.store.uploads.open()).take();
  if (isErr(uploads)) {
    throw uploads.error;
  }

  await service.operation("Inspection.Evidence.Upload").handle(async ({ input, op, transfer }) => {
    const transferred = (await transfer.completed()).take();
    if (isErr(transferred)) {
      return err(transferred.error);
    }

    await op.started();
    await op.progress({
      stage: "staged",
      message: `Staged ${transferred.size} bytes of ${input.evidenceType} evidence`,
    });

    const entry = (await uploads.get(transferred.key)).take();
    if (isErr(entry)) {
      return err(entry.error);
    }

    await op.progress({
      stage: "processing",
      message: `Inspecting staged evidence at ${transferred.key}`,
    });

    const body = (await entry.stream()).take();
    if (isErr(body)) {
      return err(body.error);
    }

    const processed = await countStreamChunks(body);
    await op.progress({
      stage: "indexed",
      message: `Indexed ${processed.chunkCount} evidence blocks from ${transferred.key}`,
    });

    const output = {
      evidenceId: `evidence-${input.key}`,
      key: transferred.key,
      size: processed.byteCount,
      disposition: "ready-for-review",
    };

    await op.complete(output);
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
