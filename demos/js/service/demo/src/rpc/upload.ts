import { BaseError, type Result } from "@qlever-llc/result";
import {
  UnexpectedError,
  err,
  ok,
} from "@qlever-llc/trellis";
import { ReservedUploadKeyError } from "../../errors/upload.ts";
import type { Rpc } from "../../contracts/demo_service.ts";
import type { DemoJobs } from "../jobs.ts";

const RESERVED_UPLOAD_KEY_PREFIX = "system/";

type FilesProcessProgress = {
  stage: string;
  message: string;
};

type StartProcessRpc = Rpc<"Demo.Files.Process.Start">;
type StartProcessInput = Parameters<StartProcessRpc>[0];
type StartProcessContext = Parameters<StartProcessRpc>[1];
type StartProcessRuntime = Parameters<StartProcessRpc>[2];

type ProcessOperation = {
  ref: {
    id: string;
    service: string;
    operation: string;
  };
  snapshot: {
    id: string;
    service: string;
    operation: string;
    revision: number;
    state: "pending" | "running" | "completed" | "failed" | "cancelled";
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
  };
  started(): Promise<Result<unknown, UnexpectedError>>;
  progress(value: FilesProcessProgress): Promise<Result<unknown, UnexpectedError>>;
  fail(error: BaseError): Promise<Result<unknown, UnexpectedError>>;
};
type OperationOwner = {
  operation(name: "Demo.Files.Process"): {
    accept(args: {
      sessionKey: string;
    }): Promise<Result<ProcessOperation, UnexpectedError>>;
  };
};

function asBaseError(error: unknown): BaseError {
  return error instanceof BaseError ? error : new UnexpectedError({ cause: error });
}

function progress(stage: string, message: string): FilesProcessProgress {
  return { stage, message };
}

export function createStartFileProcessingRpc(
  owner: OperationOwner,
  jobs: DemoJobs,
): StartProcessRpc {
  return async (
    input: StartProcessInput,
    context: StartProcessContext,
    service: StartProcessRuntime,
  ) => {
    if (input.key.startsWith(RESERVED_UPLOAD_KEY_PREFIX)) {
      return err(
        new ReservedUploadKeyError({
          key: input.key,
          reservedPrefix: RESERVED_UPLOAD_KEY_PREFIX,
        }),
      );
    }

    let acceptedOperation: ProcessOperation | undefined;
    const grant = await service.transfer.initiateUpload({
      sessionKey: context.sessionKey,
      store: "uploads",
      key: input.key,
      expiresInMs: 60_000,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      onStored: async ({ entry, info, store }) => {
        const op = acceptedOperation;
        if (!op) {
          throw new Error("process operation was not accepted before transfer completed");
        }

        try {
          const started = await op.started();
          if (started.isErr()) {
            throw started.error;
          }

          const storedProgress = await op.progress(
            progress("stored", `Stored ${info.size} bytes for ${info.key}`),
          );
          if (storedProgress.isErr()) {
            throw storedProgress.error;
          }

          const queuedProgress = await op.progress(
            progress("queued", "Queueing file processing job"),
          );
          if (queuedProgress.isErr()) {
            throw queuedProgress.error;
          }

          const created = await jobs.fileProcess.create({
            operationId: op.ref.id,
            key: info.key,
          });
          if (created.isErr()) {
            throw created.error;
          }
        } catch (error) {
          await op.fail(asBaseError(error));
        }
      },
    });

    if (grant.isErr()) {
      return err(grant.error);
    }

    const accepted = await owner.operation("Demo.Files.Process").accept({
      sessionKey: context.sessionKey,
    });
    if (accepted.isErr()) {
      return err(accepted.error);
    }
    acceptedOperation = accepted.unwrapOrElse(() => {
      throw new Error("accepted operation unexpectedly missing");
    });

    return ok({
      transfer: grant.unwrapOrElse(() => {
        throw new Error("upload grant unexpectedly missing");
      }),
      operation: {
        ref: acceptedOperation.ref,
        snapshot: {
          id: acceptedOperation.snapshot.id,
          service: acceptedOperation.snapshot.service,
          operation: acceptedOperation.snapshot.operation,
          revision: acceptedOperation.snapshot.revision,
          state: acceptedOperation.snapshot.state,
          createdAt: acceptedOperation.snapshot.createdAt,
          updatedAt: acceptedOperation.snapshot.updatedAt,
          ...(acceptedOperation.snapshot.completedAt
            ? { completedAt: acceptedOperation.snapshot.completedAt }
            : {}),
        },
      },
    });
  };
}
