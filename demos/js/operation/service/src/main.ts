import { BaseError } from "@qlever-llc/result";
import {
  isErr,
  UnexpectedError,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract from "../contracts/demo_inspection_operation_service.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inspectionLabel(inspectionId: string): string {
  const inspection = ASSIGNED_INSPECTIONS.find((candidate) => {
    return candidate.inspectionId === inspectionId;
  });

  return inspection
    ? `${inspection.siteName} / ${inspection.assetName}`
    : inspectionId;
}

function asBaseError(cause: unknown): BaseError {
  return cause instanceof BaseError
    ? cause
    : new UnexpectedError({ cause });
}

async function main(): Promise<void> {
  if (!trellisUrl || !sessionKeySeed) {
    throw new Error("Usage: deno task start <trellisUrl> <sessionKeySeed>");
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-operation-service",
    sessionKeySeed,
  });

  const operationIsCancelled = async (operationId: string): Promise<boolean> => {
    const snapshot = await service.operations.get(operationId).take();
    if (isErr(snapshot)) {
      throw snapshot.error;
    }

    return snapshot.state === "cancelled";
  };

  await service.operation("Inspection.Report.Generate").handle(async ({ input, op }) => {
    const reportId = `report-${input.inspectionId}`;

    try {
      await op.started().orThrow();
      await sleep(250);
      await op.progress({
        stage: "drafting",
        message: `Collecting field notes for ${inspectionLabel(input.inspectionId)}`,
      }).orThrow();
      await sleep(300);

      if (await operationIsCancelled(op.id)) {
        return;
      }

      await op.progress({
        stage: "rendering",
        message: `Rendering ${reportId}`,
      }).orThrow();
      await sleep(300);

      if (await operationIsCancelled(op.id)) {
        return;
      }

      await op.progress({
        stage: "publishing",
        message: `Publishing ${reportId} for ${inspectionLabel(input.inspectionId)}`,
      }).orThrow();
      await sleep(300);

      if (await operationIsCancelled(op.id)) {
        return;
      }

      return await op.complete({
        reportId,
        inspectionId: input.inspectionId,
        status: "published",
      }).orThrow();
    } catch (cause) {
      const error = asBaseError(cause);
      if (!(await operationIsCancelled(op.id))) {
        const failed = await service.operations.fail(op.id, error).take();
        if (isErr(failed) && !(await operationIsCancelled(op.id))) {
          throw failed.error;
        }
      }
      throw error;
    }
  });

  printScenarioHeading("Inspection operation service");
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
