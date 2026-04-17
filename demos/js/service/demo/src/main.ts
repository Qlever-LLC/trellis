import { TrellisService } from "@qlever-llc/trellis/host/deno";
import type { Result } from "@qlever-llc/trellis";
import type { BaseError } from "@qlever-llc/result";
import { err, isErr } from "@qlever-llc/trellis";
import * as rpc from "./rpc/index.ts";
import contract from "../contracts/demo_service.ts";
import config from "../deno.json" with { type: "json" };

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

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
    throw uploads;
  }

  await service.trellis.mount("Demo.Groups.List", rpc.listGroupsRpc);
  await service
    .operation("Demo.Files.Upload")
    .handle(async ({ input, op, transfer }) => {
      const drainTransferUpdates = (async () => {
        for await (const _update of transfer.updates()) {
          // Drain provider-side transfer updates so caller watch events stay ordered.
        }
      })();

      const transferred = (await transfer.completed()).take();
      if (isErr(transferred)) {
        await drainTransferUpdates;
        return err(transferred.error);
      }

      await drainTransferUpdates;

      const updateStage = async (
        stage: string,
        message: string,
      ): Promise<Result<null, BaseError> | null> => {
        const updated = (await op.progress({ stage, message })).take();
        if (isErr(updated)) {
          return err(updated.error);
        }

        return null;
      };

      const stored = await updateStage(
        "stored",
        `Stored ${transferred.size} bytes for ${transferred.key}`,
      );
      if (stored) {
        return stored;
      }

      const entry = (await uploads.get(input.key)).take();
      if (isErr(entry)) {
        return err(entry.error);
      }

      const body = (await entry.stream()).take();
      if (isErr(body)) {
        return err(body.error);
      }

      const writing = await updateStage(
        "writing",
        "Writing the staged file to /tmp",
      );
      if (writing) {
        return writing;
      }

      const tempFilePath = await Deno.makeTempFile({
        dir: "/tmp",
        prefix: "demo-upload-",
        suffix: `-${toTempFileSuffix(input.key)}`,
      });
      await writeStreamToFile(tempFilePath, body);

      const cleanup = await updateStage(
        "cleanup",
        "Deleting the staged object from the upload store",
      );
      if (cleanup) {
        return cleanup;
      }

      const deleted = await uploads.delete(input.key);
      if (deleted.isErr()) {
        console.warn("demo upload cleanup failed", deleted.error);
      }

      console.info(`demo processed file path: ${tempFilePath}`);
      return {
        key: input.key,
        size: entry.info.size,
        tempFilePath,
      };
    });

  console.info(`demo service started`);

  const stop = () => service.stop().finally(() => Deno.exit(0));
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);

  await new Promise(() => {});
}

if (import.meta.main) {
  await main();
}
