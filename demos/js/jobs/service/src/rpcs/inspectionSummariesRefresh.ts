import { isErr, ok, type RpcArgs, type RpcResult } from "@qlever-llc/trellis";
import contract from "../../contract.ts";

type Args = RpcArgs<typeof contract, "Inspection.Summaries.Refresh">;
type Result = RpcResult<typeof contract, "Inspection.Summaries.Refresh">;

export async function inspectionSummariesRefresh({
  input,
  trellis,
}: Args): Promise<Result> {
  const created = await trellis.jobs.refreshSummaries
    .create({ siteId: input.siteId })
    .orThrow();

  const queuedStatus = {
    refreshId: created.id,
    siteId: input.siteId,
    status: "queued" as const,
    updatedAt: new Date().toISOString(),
    message: `Queued summary refresh for ${input.siteId}`,
  };

  const persisted = await trellis.kv.refreshStatuses.create(
    created.id,
    queuedStatus,
  ).take();
  if (isErr(persisted)) {
    const current = await trellis.kv.refreshStatuses.get(created.id).take();
    if (isErr(current)) {
      console.warn("failed to persist queued refresh status", {
        refreshId: created.id,
        siteId: input.siteId,
        error: persisted.error,
      });
    }
  }

  return ok({
    refreshId: created.id,
    status: "queued" as const,
  });
}
