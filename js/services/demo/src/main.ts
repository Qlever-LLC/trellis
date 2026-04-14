import { isErr } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/server/deno";
import * as rpc from "./rpc/index.ts";

import demoService from "../contracts/demo_service.ts";

const trellisUrl = Deno.args[0]?.trim();
const serviceName = Deno.args[1]?.trim() || "demo-service";
const sessionKeySeed = Deno.args[2]?.trim();

const textDecoder = new TextDecoder();

async function main(): Promise<void> {
  if (!trellisUrl || !sessionKeySeed) {
    throw new Error(
      "Usage: deno task start -- <trellisUrl> <serviceName> <sessionKeySeed>",
    );
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract: demoService,
    name: serviceName,
    sessionKeySeed,
    server: {},
  });

  await service.trellis.mount("Demo.Groups.List", rpc.listGroupsRpc);
  await service.trellis.mount(
    "Demo.Files.InitiateUpload",
    rpc.initiateUploadRpc,
  );

  console.info(`demo service started`);

  const stop = () => service.stop().finally(() => Deno.exit(0));
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);

  await new Promise(() => {});
}

async function waitForUploadAndLog(
  service: Awaited<ReturnType<typeof TrellisService.connect>>,
  key: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const stored = await service.store.uploads.open();
    const store = stored.take();
    if (isErr(store)) {
      console.error("demo upload store open failed", store.error);
      return;
    }

    const entry = await store.get(key);
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

      console.info(`demo uploaded file ${key}:`);
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

  console.error(`demo upload did not appear before timeout: ${key}`);
}

if (import.meta.main) {
  await main();
}
