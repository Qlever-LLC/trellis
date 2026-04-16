import { err, isErr, ok } from "@qlever-llc/trellis";
import { ReservedUploadKeyError } from "../../errors/upload.ts";
import type { Rpc } from "../../contracts/demo_service.ts";

const RESERVED_UPLOAD_KEY_PREFIX = "system/";

export const initiateUploadRpc: Rpc<"Demo.Files.InitiateUpload"> = async (
  input,
  context,
  service,
) => {
  if (input.key.startsWith(RESERVED_UPLOAD_KEY_PREFIX)) {
    return err(
      new ReservedUploadKeyError({
        key: input.key,
        reservedPrefix: RESERVED_UPLOAD_KEY_PREFIX,
      }),
    );
  }

  const grant = await service.transfer.initiateUpload({
    sessionKey: context.sessionKey,
    store: "uploads",
    key: input.key,
    expiresInMs: 60_000,
    ...(input.contentType ? { contentType: input.contentType } : {}),
  });

  if (grant.isErr()) {
    return err(grant.error);
  }

  queueMicrotask(async () => {
    const textDecoder = new TextDecoder();

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const stored = await service.store.uploads.open();
      const store = stored.take();
      if (isErr(store)) {
        console.error("demo upload store open failed", store.error);
        return;
      }

      const entry = await store.get(input.key);
      if (!entry.isErr()) {
        const bytes = await entry
          .unwrapOrElse(() => {
            throw new Error("uploaded store entry unexpectedly missing");
          })
          .bytes();
        if (bytes.isErr()) {
          console.error("demo upload read failed", bytes.error);
          return;
        }

        console.info(`demo uploaded file ${input.key}:`);
        console.info(
          textDecoder.decode(
            bytes.unwrapOrElse(() => {
              throw new Error("uploaded bytes unexpectedly missing");
            }),
          ),
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    console.error(`demo upload did not appear before timeout: ${input.key}`);
  });

  return ok(
    grant.unwrapOrElse(() => {
      throw new Error("upload grant unexpectedly missing");
    }),
  );
};
