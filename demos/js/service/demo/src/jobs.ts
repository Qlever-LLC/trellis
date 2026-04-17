import { Result, isErr, ok } from "@qlever-llc/result";
import {
  JobManager,
  startNatsWorkerHostFromBinding,
  type JobsRuntimeBinding,
} from "@qlever-llc/trellis-jobs";
import {
  JobRef,
  JobQueue,
  type JobWorkerHost,
} from "@qlever-llc/trellis-jobs/api";
import { UnexpectedError } from "@qlever-llc/trellis";
import type { TrellisService } from "@qlever-llc/trellis/host";
import { Value } from "typebox/value";
import { FilesProcessJobPayload, FilesProcessResult } from "../schemas/files.ts";

export type FileProcessJobPayload = {
  operationId: string;
  key: string;
};

export type FileProcessJobResult = {
  key: string;
  size: number;
  tempFilePath: string;
};

export type DemoJobs = {
  fileProcess: JobQueue<FileProcessJobPayload, FileProcessJobResult>;
  startWorkers(): Promise<JobWorkerHost>;
};

const FILE_PROCESS_QUEUE = "file-process";
const DEFAULT_UPLOAD_FILE_NAME = "upload.bin";

function toTempFileSuffix(key: string): string {
  const fileName = key.split(/[\\/]/).at(-1) || DEFAULT_UPLOAD_FILE_NAME;
  const sanitized = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : DEFAULT_UPLOAD_FILE_NAME;
}

async function writeStreamToFile(
  path: string,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const file = await Deno.open(path, {
    create: true,
    truncate: true,
    write: true,
  });
  const reader = stream.getReader();

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        return;
      }

      let offset = 0;
      while (offset < next.value.length) {
        offset += await file.write(next.value.subarray(offset));
      }
    }
  } finally {
    reader.releaseLock();
    file.close();
  }
}

function getJobsRuntimeBinding(
  service: TrellisService,
): JobsRuntimeBinding {
  if (!service.jobs) {
    throw new Error("demo service is missing jobs bindings");
  }
  const jobsWork = service.streams.jobsWork;
  if (!jobsWork) {
    throw new Error("demo service is missing the jobsWork stream binding");
  }

  return {
    jobs: service.jobs,
    workStream: jobsWork.name,
  };
}

function parseFileProcessPayload(payload: unknown): FileProcessJobPayload {
  return Value.Parse(FilesProcessJobPayload, payload);
}

function parseFileProcessResult(result: unknown): FileProcessJobResult {
  return Value.Parse(FilesProcessResult, result);
}

export function createDemoJobs(
  service: TrellisService,
): DemoJobs {
  const binding = getJobsRuntimeBinding(service);
  const manager = new JobManager<FileProcessJobPayload, FileProcessJobResult>({
    nc: service.nc,
    jobs: binding.jobs,
  });

  return {
    fileProcess: new JobQueue({
      create: async (payload) => {
        const created = await manager.create(FILE_PROCESS_QUEUE, payload);
        return ok(new JobRef<FileProcessJobPayload, FileProcessJobResult>({
          id: created.id,
          service: created.service,
          jobType: created.type,
        }, {
          get: async () => {
            return ok({
              id: created.id,
              service: created.service,
              type: created.type,
              state: created.state,
              payload,
              createdAt: created.createdAt,
              updatedAt: created.updatedAt,
              tries: created.tries,
              maxTries: created.maxTries,
            });
          },
          wait: async () => {
            return Result.err(new UnexpectedError({
              cause: new Error("demo job refs do not implement wait()"),
            }));
          },
          cancel: async () => {
            return Result.err(new UnexpectedError({
              cause: new Error("demo job refs do not implement cancel()"),
            }));
          },
        }));
      },
      handle: async () => {
        throw new Error("demo fileProcess.handle() is owned by startWorkers()");
      },
    }),
    startWorkers: async () => {
      const host = await startNatsWorkerHostFromBinding(binding, {
        instanceId: `${service.name.toLowerCase().replace(/\s+/g, "-")}-worker`,
        nats: service.nc,
        manager,
        queueTypes: [FILE_PROCESS_QUEUE],
        validatePayload: async ({ job }) => {
          parseFileProcessPayload(job.payload);
        },
        validateResult: async ({ result }) => {
          parseFileProcessResult(result);
        },
        handler: async (job) => {
          const payload = parseFileProcessPayload(job.job().payload);
          const started = await service.operations.started(payload.operationId);
          if (started.isErr()) {
            throw started.error;
          }

          const reading = await service.operations.progress(payload.operationId, {
            stage: "reading",
            message: `Reading staged file ${payload.key}`,
          });
          if (reading.isErr()) {
            throw reading.error;
          }

          const opened = await service.store.uploads.open();
          const store = opened.take();
          if (isErr(store)) {
            throw store.error;
          }

          const entry = await store.get(payload.key);
          const entryValue = entry.take();
          if (isErr(entryValue)) {
            throw entryValue.error;
          }

          const body = await entryValue.stream();
          const bodyValue = body.take();
          if (isErr(bodyValue)) {
            throw bodyValue.error;
          }

          const writing = await service.operations.progress(payload.operationId, {
            stage: "writing",
            message: "Writing the staged file to /tmp from the worker",
          });
          if (writing.isErr()) {
            throw writing.error;
          }

          const tempFilePath = await Deno.makeTempFile({
            dir: "/tmp",
            prefix: "demo-upload-",
            suffix: `-${toTempFileSuffix(payload.key)}`,
          });
          await writeStreamToFile(tempFilePath, bodyValue);

          await job.updateProgress({
            step: "cleanup",
            message: "Deleting staged object from upload store",
          });
          const cleanup = await service.operations.progress(payload.operationId, {
            stage: "cleanup",
            message: "Deleting staged object from the upload store",
          });
          if (cleanup.isErr()) {
            throw cleanup.error;
          }

          const deleted = await store.delete(payload.key);
          if (deleted.isErr()) {
            console.warn("demo upload cleanup failed", deleted.error);
          }

          const result: FileProcessJobResult = {
            key: payload.key,
            size: entryValue.info.size,
            tempFilePath,
          };
          const completed = await service.operations.complete(payload.operationId, result);
          if (completed.isErr()) {
            throw completed.error;
          }

          console.info(`demo processed file path: ${tempFilePath}`);
          return result;
        },
      });

      return {
        async stop() {
          await host.stop();
          return ok(undefined);
        },
        async join() {
          return ok(undefined);
        },
      } satisfies JobWorkerHost;
    },
  };
}
