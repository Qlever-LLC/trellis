import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contract.ts";
import { Command } from "@cliffy/command";
import * as rpcs from "./rpcs/index.ts";

async function main(): Promise<void> {
  const { args } = await new Command()
    .name("demo-rpc")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    contract,
    trellisUrl: args[0],
    sessionKeySeed: args[1],
    name: "demo-rpc-service",
  }).orThrow();

  await service.trellis.mount(
    "Inspection.Assignments.List",
    rpcs.listAssignments,
  );
  await service.trellis.mount("Inspection.Sites.GetSummary", rpcs.getSummary);

  const shutdown = async () => {
    await service.stop();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());
}

if (import.meta.main) {
  await main();
}
