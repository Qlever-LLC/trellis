import type { OperationHandler } from "@qlever-llc/trellis/service";
import contract from "../../../contract.ts";
import { recordActivity } from "../activity/index.ts";

export const uploadEvidence: OperationHandler<
  typeof contract,
  "Evidence.Upload"
> = async ({ input, op, transfer, trellis }) => {
  const transferred = await transfer.completed().orThrow();
  const uploads = await trellis.store.uploads.open().orThrow();

  await op.started().orThrow();
  await op.progress({
    stage: "staged",
    message:
      `Staged ${transferred.size} bytes of ${input.evidenceType} evidence`,
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

  await trellis.publish("Evidence.Uploaded", {
    evidenceId: output.evidenceId,
    key: output.key,
    size: output.size,
    evidenceType: input.evidenceType,
    uploadedAt: new Date().toISOString(),
  }).orThrow();
  await recordActivity(trellis, {
    kind: "evidence-uploaded",
    message: `Uploaded ${input.evidenceType} evidence from ${transferred.key}`,
  });

  return await op.complete(output).orThrow();
};
