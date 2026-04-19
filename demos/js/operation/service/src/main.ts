import { AsyncResult, BaseError } from "@qlever-llc/result";
import {
  err,
  isErr,
  ok,
  type Result,
  UnexpectedError,
} from "@qlever-llc/trellis";
import { JobManager, startNatsWorkerHostFromBinding } from "@qlever-llc/trellis-jobs";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract from "../contracts/demo_inspection_operation_service.ts";
import { ASSIGNED_INSPECTIONS } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();
const REPORT_PUBLISH_QUEUE = "publishInspectionReport";

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

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

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

  const jobs = service.jobs;
  const jobsWork = service.streams.jobsWork;
  if (!jobs || !jobsWork) {
    throw new Error("operation demo service is missing jobs bindings");
  }

  const publishJobs = new JobManager<PublishJobPayload, PublishJobResult>({
    nc: service.nc,
    jobs,
  });
  const publishJobWaiters = new Map<string, Deferred<Result<unknown, BaseError>>>();
  const completedPublishJobs = new Map<string, Result<unknown, BaseError>>();

  const attachPublishJob = (jobId: string) => {
    const waiting = deferred<Result<unknown, BaseError>>();
    const completed = completedPublishJobs.get(jobId);
    if (completed) {
      completedPublishJobs.delete(jobId);
      waiting.resolve(completed);
      return {
        wait: () => AsyncResult.from(waiting.promise),
      };
    }

    publishJobWaiters.set(jobId, waiting);
    return {
      wait: () => AsyncResult.from(waiting.promise),
    };
  };

  const settlePublishJob = (
    jobId: string,
    result: Result<unknown, BaseError>,
  ): void => {
    const waiting = publishJobWaiters.get(jobId);
    if (!waiting) {
      completedPublishJobs.set(jobId, result);
      return;
    }

    publishJobWaiters.delete(jobId);
    waiting.resolve(result);
  };

  const operationIsCancelled = async (operationId: string): Promise<boolean> => {
    const snapshot = (await service.operations.get(operationId)).take();
    if (isErr(snapshot)) {
      throw snapshot.error;
    }

    return snapshot.state === "cancelled";
  };

  const workerHost = await startNatsWorkerHostFromBinding<PublishJobResult>(
    {
      jobs,
      workStream: jobsWork.name,
    },
    {
      nats: service.nc,
      instanceId: "demo-operation-service-worker",
      queueTypes: [REPORT_PUBLISH_QUEUE],
      manager: publishJobs,
      handler: async (job) => {
        const payload = asPublishJobPayload(job.job().payload);
        const finishCancelled = (): PublishJobResult => {
          settlePublishJob(job.job().id, ok(undefined));
          return {
            reportId: payload.reportId,
            inspectionId: payload.inspectionId,
            status: "cancelled",
          };
        };

        try {
          if (await operationIsCancelled(payload.operationId)) {
            return finishCancelled();
          }

          const publishing = (await service.operations.progress(payload.operationId, {
            stage: "publishing",
            message: `Publishing ${payload.reportId} for ${inspectionLabel(payload.inspectionId)}`,
          })).take();
          if (isErr(publishing)) {
            if (await operationIsCancelled(payload.operationId)) {
              return finishCancelled();
            }
            throw publishing.error;
          }

          await sleep(900);

          if (await operationIsCancelled(payload.operationId)) {
            return finishCancelled();
          }

          const completed = (await service.operations.complete(payload.operationId, {
            reportId: payload.reportId,
            inspectionId: payload.inspectionId,
            status: "published",
          })).take();
          if (isErr(completed)) {
            if (await operationIsCancelled(payload.operationId)) {
              return finishCancelled();
            }
            throw completed.error;
          }

          settlePublishJob(job.job().id, ok(undefined));
          return {
            reportId: payload.reportId,
            inspectionId: payload.inspectionId,
            status: "published",
          };
        } catch (cause) {
          settlePublishJob(job.job().id, err(asBaseError(cause)));
          throw cause;
        }
      },
    },
  );

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

    const publishJob = await publishJobs.create(REPORT_PUBLISH_QUEUE, {
      operationId: op.id,
      inspectionId: input.inspectionId,
      reportId,
    });

    return await op.attach(attachPublishJob(publishJob.id));
  });

  printScenarioHeading("Inspection operation service");
  const shutdown = async () => {
    await workerHost.stop();
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
