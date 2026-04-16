import { TrellisService } from "@qlever-llc/trellis/host/deno";
import * as rpc from "./rpc/index.ts";
import contract from "../contracts/demo_service.ts";
import config from "../deno.json" with { type: "json" };

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

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

if (import.meta.main) {
  await main();
}
