import { BaseError } from "@qlever-llc/result";
import { isErr, UnexpectedError } from "@qlever-llc/trellis";
import type { OperationHandler } from "@qlever-llc/trellis/service";
import contract from "../../contract.ts";
import { ASSIGNED_INSPECTIONS } from "../../../../shared/field_data.ts";

type GenerateReport = OperationHandler<
  typeof contract,
  "Inspection.Report.Generate"
>;
type OperationHandle = Parameters<GenerateReport>[0]["op"];

function toBaseError(cause: unknown): BaseError {
  return cause instanceof BaseError ? cause : new UnexpectedError({ cause });
}

function isTerminalOperationError(error: BaseError): boolean {
  return error.message === "operation already terminal";
}

async function handleOperationError(
  op: OperationHandle,
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

export const generateReport: GenerateReport = async ({ input, op }) => {
  const inspection = ASSIGNED_INSPECTIONS.find((candidate) => {
    return candidate.inspectionId === input.inspectionId;
  });
  const inspectionLabel = inspection
    ? `${inspection.siteName} / ${inspection.assetName}`
    : input.inspectionId;
  const reportId = `report-${input.inspectionId}`;
  const progressUpdates = [
    {
      stage: "drafting",
      message: `Collecting field notes for ${inspectionLabel}`,
    },
    {
      stage: "rendering",
      message: `Rendering ${reportId}`,
    },
    {
      stage: "publishing",
      message: `Publishing ${reportId} for ${inspectionLabel}`,
    },
  ] as const;

  const started = await op.started().take();
  if (isErr(started)) {
    const error = await handleOperationError(op, started.error);
    if (!error) {
      return;
    }
    throw error;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));

  for (const progress of progressUpdates) {
    const updated = await op.progress(progress).take();
    if (isErr(updated)) {
      const error = await handleOperationError(op, updated.error);
      if (!error) {
        return;
      }
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const completed = await op.complete({
    reportId,
    inspectionId: input.inspectionId,
    status: "published",
  }).take();
  if (isErr(completed)) {
    const error = await handleOperationError(op, completed.error);
    if (!error) {
      return;
    }
    throw error;
  }

  return completed;
};
