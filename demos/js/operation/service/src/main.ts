import { BaseError } from "@qlever-llc/result";
import {
  err,
  isErr,
  ok,
  type Result,
  UnexpectedError,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract from "../contracts/demo_inspection_operation_service.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

type PublishJobPayload = {
  operationId: string;
  inspectionId: string;
  reportId: string;
};

type PublishJobResult = {
  reportId: string;
  inspectionId: string;
  status: "published" | "cancelled";
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asPublishJobPayload(value: unknown): PublishJobPayload {
  if (!value || typeof value !== "object") {
    throw new UnexpectedError({
      cause: new Error("publish job payload must be an object"),
    });
  }

  const payload = value as Record<string, unknown>;
  const operationId = payload.operationId;
  const inspectionId = payload.inspectionId;
  const reportId = payload.reportId;
  if (typeof operationId !== "string" || operationId.length === 0) {
    throw new UnexpectedError({
      cause: new Error("publish job payload is missing operationId"),
    });
  }
  if (typeof inspectionId !== "string" || inspectionId.length === 0) {
    throw new UnexpectedError({
      cause: new Error("publish job payload is missing inspectionId"),
    });
  }
  if (typeof reportId !== "string" || reportId.length === 0) {
    throw new UnexpectedError({
      cause: new Error("publish job payload is missing reportId"),
    });
  }

  return { operationId, inspectionId, reportId };
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
    throw new Error("Usage: deno task start -- <trellisUrl> <sessionKeySeed>");
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-operation-service",
    sessionKeySeed,
  });

  const operationIsCancelled = async (operationId: string): Promise<boolean> => {
    const snapshot = (await service.operations.get(operationId)).take();
    if (isErr(snapshot)) {
      throw snapshot.error;
    }

    return snapshot.state === "cancelled";
  };

  const registered = await service.jobs.publishInspectionReport.handle(async (job) => {
    const payload = asPublishJobPayload(job.payload);
    const finishCancelled = (): PublishJobResult => ({
      reportId: payload.reportId,
      inspectionId: payload.inspectionId,
      status: "cancelled",
    });

    try {
      if (await operationIsCancelled(payload.operationId)) {
        return ok(finishCancelled());
      }

      const publishing = (await service.operations.progress(payload.operationId, {
        stage: "publishing",
        message: `Publishing ${payload.reportId} for ${inspectionLabel(payload.inspectionId)}`,
      })).take();
      if (isErr(publishing)) {
        if (await operationIsCancelled(payload.operationId)) {
          return ok(finishCancelled());
        }
        throw publishing.error;
      }

      await sleep(900);

      if (await operationIsCancelled(payload.operationId)) {
        return ok(finishCancelled());
      }

      const output: PublishJobResult = {
        reportId: payload.reportId,
        inspectionId: payload.inspectionId,
        status: "published",
      };
      const completed = (await service.operations.complete(payload.operationId, output)).take();
      if (isErr(completed)) {
        if (await operationIsCancelled(payload.operationId)) {
          return ok(finishCancelled());
        }
        throw completed.error;
      }

      return ok(output);
    } catch (cause) {
      const error = asBaseError(cause);
      const failed = (await service.operations.fail(payload.operationId, error)).take();
      if (isErr(failed) && !(await operationIsCancelled(payload.operationId))) {
        return err(failed.error);
      }
      return err(error);
    }
  }).take();
  if (isErr(registered)) {
    throw registered.error;
  }

  const workerHost = await service.jobs.startWorkers({
    instanceId: "demo-operation-service-worker",
  }).take();
  if (isErr(workerHost)) {
    throw workerHost.error;
  }

  await service.operation("Inspection.Report.Generate").handle(async ({ input, op }) => {
    const reportId = `report-${input.inspectionId}`;

    await op.started().orThrow();
    await sleep(250);
    await op.progress({
      stage: "drafting",
      message: `Collecting field notes for ${inspectionLabel(input.inspectionId)}`,
    }).orThrow();
    await sleep(300);
    await op.progress({
      stage: "rendering",
      message: `Rendering ${reportId}`,
    }).orThrow();
    await sleep(300);

    if (await operationIsCancelled(op.id)) {
      return;
    }

    await op.progress({
      stage: "handoff",
      message: `Handing off ${reportId} for final publish`,
    }).orThrow();

    const publishJob = await service.jobs.publishInspectionReport.create({
      operationId: op.id,
      inspectionId: input.inspectionId,
      reportId,
    }).take();
    if (isErr(publishJob)) {
      throw publishJob.error;
    }

    return await op.attach(publishJob);
  });

  printScenarioHeading("Inspection operation service");
  const shutdown = async () => {
    const stopped = await workerHost.stop().take();
    if (isErr(stopped)) {
      console.warn("failed to stop jobs worker host", stopped.error);
    }
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
