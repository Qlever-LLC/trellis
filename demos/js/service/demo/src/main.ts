import { TrellisService } from "@qlever-llc/trellis/host/deno";
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

  await service.trellis.mount("Demo.Groups.List", rpc.listGroupsRpc);
  await service.operation("Demo.Files.Upload").handle(async ({ input, op, transfer }) => {
    const providerUpdates = (async () => {
      for await (const update of transfer.updates()) {
        console.info("provider transfer update", update);
      }
    })();

    const transferred = await transfer.completed();
    const transferredValue = transferred.take();
    if (isErr(transferredValue)) {
      await providerUpdates;
      return err(transferredValue.error);
    }

    await providerUpdates;

    const stored = await op.progress({
      stage: "stored",
      message: `Stored ${transferredValue.size} bytes for ${transferredValue.key}`,
    });
    if (stored.isErr()) {
      return err(stored.error);
    }

    const opened = await service.store.uploads.open();
    const store = opened.take();
    if (isErr(store)) {
      return err(store.error);
    }

    const entry = await store.get(input.key);
    const entryValue = entry.take();
    if (isErr(entryValue)) {
      return err(entryValue.error);
    }

    const body = await entryValue.stream();
    const bodyValue = body.take();
    if (isErr(bodyValue)) {
      return err(bodyValue.error);
    }

    const writing = await op.progress({
      stage: "writing",
      message: "Writing the staged file to /tmp from the operation handler",
    });
    if (writing.isErr()) {
      return err(writing.error);
    }

    const tempFilePath = await Deno.makeTempFile({
      dir: "/tmp",
      prefix: "demo-upload-",
      suffix: `-${toTempFileSuffix(input.key)}`,
    });
    await writeStreamToFile(tempFilePath, bodyValue);

    const cleanup = await op.progress({
      stage: "cleanup",
      message: "Deleting staged object from the upload store",
    });
    if (cleanup.isErr()) {
      return err(cleanup.error);
    }

    const deleted = await store.delete(input.key);
    if (deleted.isErr()) {
      console.warn("demo upload cleanup failed", deleted.error);
    }

    console.info(`demo processed file path: ${tempFilePath}`);
    return {
      key: input.key,
      size: entryValue.info.size,
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
