import { TrellisService } from "@qlever-llc/trellis/host/deno";
import type { Result } from "@qlever-llc/trellis";
import { BaseError } from "@qlever-llc/result";
import { err, isErr, ok, UnexpectedError } from "@qlever-llc/trellis";
import * as rpc from "./rpc/index.ts";
import contract from "../contracts/demo_service.ts";
import config from "../deno.json" with { type: "json" };

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

const DEFAULT_UPLOAD_FILE_NAME = "upload.bin";

type UploadJobPayload = {
  operationId: string;
  key: string;
};

type UploadResult = {
  key: string;
  size: number;
  tempFilePath: string;
};

function toTempFileSuffix(key: string): string {
  const fileName = key.split(/[\\/]/).at(-1) || DEFAULT_UPLOAD_FILE_NAME;
  const sanitized = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : DEFAULT_UPLOAD_FILE_NAME;
}

function asUploadJobPayload(value: unknown): UploadJobPayload {
  if (!value || typeof value !== "object") {
    throw new UnexpectedError({
      cause: new Error("upload job payload must be an object"),
    });
  }

  const payload = value as Record<string, unknown>;
  const operationId = payload.operationId;
  const key = payload.key;
  if (typeof operationId !== "string" || operationId.length === 0) {
    throw new UnexpectedError({
      cause: new Error("upload job payload is missing operationId"),
    });
  }
  if (typeof key !== "string" || key.length === 0) {
    throw new UnexpectedError({
      cause: new Error("upload job payload is missing key"),
    });
  }

  return { operationId, key };
}

function asBaseError(cause: unknown): BaseError {
  return cause instanceof BaseError
    ? cause
    : new UnexpectedError({ cause });
}

function maybeOperationId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const operationId = (value as Record<string, unknown>).operationId;
  return typeof operationId === "string" && operationId.length > 0
    ? operationId
    : undefined;
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

async function main(): Promise<void> {
  if (!trellisUrl || !sessionKeySeed) {
    throw new Error("Usage: deno task start -- <trellisUrl> <sessionKeySeed>");
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "Demo service",
    sessionKeySeed,
  });
  service.health.setInfo({
    info: {
      name: config.name,
      version: config.version,
      location: "us-east-1",
      demo: true,
    },
  });
  const uploads = (await service.store.uploads.open()).take();
  if (isErr(uploads)) {
    throw uploads.error;
  }

  const updateOperationStage = async (
    operationId: string,
    stage: string,
    message: string,
  ): Promise<void> => {
    const updated = (await service.operations.progress(operationId, {
      stage,
      message,
    })).take();
    if (isErr(updated)) {
      throw updated.error;
    }
  };

  await service.trellis.mount("Demo.Groups.List", rpc.listGroupsRpc);
  await service
    .operation("Demo.Files.Upload")
    .handle(async ({ input, op, transfer }) => {
      const transferred = (await transfer.completed()).take();
      if (isErr(transferred)) {
        return err(transferred.error);
      }

      const job = await service.jobs.processUpload.create({
        operationId: op.id,
        key: input.key,
      }).take();
      if (isErr(job)) {
        throw job.error;
      }

      console.info("demo upload staged", {
        operationId: op.id,
        jobId: job.id,
        key: transferred.key,
        size: transferred.size,
      });

      return await op.attach(job);
    });

  const registered = await service.jobs.processUpload.handle(async (job) => {
    try {
      const payload = asUploadJobPayload(job.payload);
      const started = (await service.operations.started(payload.operationId)).take();
      if (isErr(started)) {
        throw started.error;
      }

      const entry = (await uploads.get(payload.key)).take();
      if (isErr(entry)) {
        throw entry.error;
      }
      await updateOperationStage(
        payload.operationId,
        "stored",
        `Stored ${entry.info.size} bytes for ${payload.key}`,
      );

      const body = (await entry.stream()).take();
      if (isErr(body)) {
        throw body.error;
      }
      await updateOperationStage(
        payload.operationId,
        "writing",
        "Writing the staged file to /tmp",
      );

      const tempFilePath = await Deno.makeTempFile({
        dir: "/tmp",
        prefix: "demo-upload-",
        suffix: `-${toTempFileSuffix(payload.key)}`,
      });
      await writeStreamToFile(tempFilePath, body);

      await updateOperationStage(
        payload.operationId,
        "cleanup",
        "Deleting the staged object from the upload store",
      );

      const deleted = await uploads.delete(payload.key);
      if (deleted.isErr()) {
        console.warn("demo upload cleanup failed", deleted.error);
      }

      const output: UploadResult = {
        key: payload.key,
        size: entry.info.size,
        tempFilePath,
      };
      const completed = (await service.operations.complete(
        payload.operationId,
        output,
      )).take();
      if (isErr(completed)) {
        throw completed.error;
      }

      console.info(`demo processed file path: ${tempFilePath}`);
      return ok(output);
    } catch (cause) {
      const error = asBaseError(cause);
      const operationId = maybeOperationId(job.payload);
      if (operationId) {
        const failed = await service.operations.fail(operationId, error);
        if (failed.isErr()) {
          return err(failed.error);
        }
      }
      return err(error);
    }
  }).take();
  if (isErr(registered)) {
    throw registered.error;
  }

  const workerHost = await service.jobs.startWorkers({
    instanceId: `${config.name}-worker`,
  }).take();
  if (isErr(workerHost)) {
    throw workerHost.error;
  }

  console.info(`demo service started`);

  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    await Promise.allSettled([
      workerHost.stop().take(),
      service.stop(),
    ]);
    Deno.exit(0);
  };
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);

  await new Promise(() => {});
}

if (import.meta.main) {
  await main();
}
