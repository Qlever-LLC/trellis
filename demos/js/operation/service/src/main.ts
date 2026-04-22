import { BaseError } from "@qlever-llc/result";
import { UnexpectedError } from "@qlever-llc/trellis";
import type { OperationHandler } from "@qlever-llc/trellis/service";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contracts/demo_inspection_operation_service.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";
import chalk from "chalk";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-operation")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-operation-service",
    sessionKeySeed,
  });

  const generateReport: OperationHandler<
    typeof contract,
    "Inspection.Report.Generate"
  > = async ({ input, op }) => {
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

    try {
      await op.started().orThrow();
      await new Promise((resolve) => setTimeout(resolve, 250));

      for (const progress of progressUpdates) {
        await op.progress(progress).orThrow();
        await new Promise((resolve) => setTimeout(resolve, 300));

        if ((await service.operations.get(op.id).orThrow()).state === "cancelled") {
          return;
        }
      }

      return await op.complete({
        reportId,
        inspectionId: input.inspectionId,
        status: "published",
      }).orThrow();
    } catch (cause) {
      const error = cause instanceof BaseError
        ? cause
        : new UnexpectedError({ cause });

      if ((await service.operations.get(op.id).orThrow()).state !== "cancelled") {
        try {
          await service.operations.fail(op.id, error).orThrow();
        } catch (failError) {
          if ((await service.operations.get(op.id).orThrow()).state !== "cancelled") {
            throw failError;
          }
        }
      }

      throw error;
    }
  };

  await service.operation("Inspection.Report.Generate").handle(generateReport);

  console.log(chalk.green.bold("== Inspection operation service"));
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
