import { isErr, Result } from "@qlever-llc/trellis";
import type { TrellisService } from "@qlever-llc/trellis/server/deno";
import type { Rpc } from "../../contracts/demo_service.ts";

type ConnectedDemoService = Awaited<ReturnType<typeof TrellisService.connect>>;

export function createInitiateUploadRpc(
  connectedService: ConnectedDemoService,
): Rpc<"Demo.Files.InitiateUpload"> {
  return async (input, context, service) => {
    const grant = await service.transfer.initiateUpload({
      sessionKey: context.sessionKey,
      store: "uploads",
      key: input.key,
      expiresInMs: 60_000,
      ...(input.contentType ? { contentType: input.contentType } : {}),
    });

    if (grant.isErr()) {
      return Result.err(grant.error);
    }

    queueMicrotask(async () => {
      const textDecoder = new TextDecoder();

      for (let attempt = 0; attempt < 40; attempt += 1) {
        const stored = await connectedService.store.uploads.open();
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

    return Result.ok(
      grant.unwrapOrElse(() => {
        throw new Error("upload grant unexpectedly missing");
      }),
    );
  };
}
