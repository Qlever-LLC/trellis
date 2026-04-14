import type { Rpc } from "../../contracts/demo_service.ts";

export const initiateUploadRpc: Rpc<"Demo.Files.InitiateUpload"> = async (
  input,
  context,
  service,
) => {
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
    await waitForUploadAndLog(service, input.key);
  });

  return Result.ok(
    grant.unwrapOrElse(() => {
      throw new Error("upload grant unexpectedly missing");
    }),
  );
};
