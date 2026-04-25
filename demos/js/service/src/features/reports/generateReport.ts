import type { OperationHandler } from "@qlever-llc/trellis/service";
import { BaseError } from "@qlever-llc/result";
import { isErr, UnexpectedError } from "@qlever-llc/trellis";
import { ASSIGNED_INSPECTIONS } from "../../../../shared/field_data.ts";
import contract from "../../../contract.ts";
import { recordActivity } from "../activity/index.ts";

export const generateReport: OperationHandler<
  typeof contract,
  "Reports.Generate"
> = async ({ input, op, trellis }) => {
  function toBaseError(cause: unknown): BaseError {
    return cause instanceof BaseError ? cause : new UnexpectedError({ cause });
  }

  function isTerminalOperationError(error: BaseError): boolean {
    return error.message === "operation already terminal";
  }

  async function handleOperationError(
    cause: unknown,
  ): Promise<BaseError | null> {
    const error = toBaseError(cause);
    if (isTerminalOperationError(error)) {
      return null;
    }

    const failed = await op.fail(error).take();
    if (isErr(failed)) {
      if (isTerminalOperationError(failed.error)) {
        return null;
      }
      throw failed.error;
    }

    return error;
  }

  const inspection = ASSIGNED_INSPECTIONS.find((candidate) => {
    return candidate.inspectionId === input.inspectionId;
  });
  const inspectionLabel = inspection
    ? `${inspection.siteName} / ${inspection.assetName}`
    : input.inspectionId;
  const reportId = `report-${input.inspectionId}`;

  const started = await op.started().take();
  if (isErr(started)) {
    const error = await handleOperationError(started.error);
    if (!error) return;
    throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));

  for (
    const progress of [
      {
        stage: "drafting",
        message: `Collecting field notes for ${inspectionLabel}`,
      },
      { stage: "rendering", message: `Rendering ${reportId}` },
      {
        stage: "publishing",
        message: `Publishing ${reportId} for ${inspectionLabel}`,
      },
    ]
  ) {
    const updated = await op.progress(progress).take();
    if (isErr(updated)) {
      const error = await handleOperationError(updated.error);
      if (!error) return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const output = {
    reportId,
    inspectionId: input.inspectionId,
    status: "published",
  };

  await trellis.publish("Reports.Published", {
    reportId,
    inspectionId: input.inspectionId,
    siteId: inspection?.siteId,
    publishedAt: new Date().toISOString(),
  }).orThrow();
  await recordActivity(trellis, {
    kind: "report-published",
    message: `Published ${reportId} for ${inspectionLabel}`,
    relatedSiteId: inspection?.siteId,
    relatedInspectionId: input.inspectionId,
  });

  const completed = await op.complete(output).take();
  if (isErr(completed)) {
    const error = await handleOperationError(completed.error);
    if (!error) return;
    throw error;
  }

  return completed;
};
