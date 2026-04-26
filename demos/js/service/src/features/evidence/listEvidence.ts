import { ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../../contract.ts";

type Args = RpcArgs<typeof contract, "Evidence.List">;
type Result = RpcResult<typeof contract, "Evidence.List">;

function evidenceIdForKey(
  key: string,
  metadata: Record<string, string>,
): string {
  return metadata.evidenceId || key;
}

/** Lists image evidence staged in the demo object store. */
export async function listEvidence({ input, trellis }: Args): Promise<Result> {
  const uploads = await trellis.store.uploads.open().orThrow();
  const entries = await uploads.list(input.prefix ?? "evidence/").orThrow();
  const evidence = [];

  for await (const info of entries) {
    evidence.push({
      evidenceId: evidenceIdForKey(info.key, info.metadata),
      key: info.key,
      size: info.size,
      ...(info.contentType ? { contentType: info.contentType } : {}),
      evidenceType: info.metadata.evidenceType || "image",
      ...(info.metadata.fileName ? { fileName: info.metadata.fileName } : {}),
      uploadedAt: info.updatedAt,
    });
  }

  evidence.sort((left, right) =>
    right.uploadedAt.localeCompare(left.uploadedAt)
  );

  return ok({ evidence });
}
