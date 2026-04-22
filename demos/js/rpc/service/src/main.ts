import { Result } from "@qlever-llc/trellis";
import type { RpcHandler } from "@qlever-llc/trellis/service";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contracts/demo_inspection_rpc_service.ts";
import {
  ASSIGNED_INSPECTIONS,
  getSiteSummary,
} from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";

interface ICliArgs {
  trellisUrl: string;
  sessionKeySeed: string;
}
const ARGS = {
  trellisUrl: {
    type: String,
    description: "URL of Trellis instance to connect to",
  },
  sessionKeySeed: {
    type: String,
    description: "Trellis service rootKey",
  },
};

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-rpc")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    sessionKeySeed,
    name: "demo-rpc-service",
  });

  const listAssignments: RpcHandler<
    typeof contract,
    "Inspection.Assignments.List"
  > = ({}) => Result.ok({ assignments: ASSIGNED_INSPECTIONS });
  const getSummary: RpcHandler<typeof contract, "Inspection.Sites.GetSummary"> =
    ({ input }) => Result.ok({ summary: getSiteSummary(input.siteId) });

  await service.trellis.mount("Inspection.Assignments.List", listAssignments);
  await service.trellis.mount("Inspection.Sites.GetSummary", getSummary);

  const shutdown = async () => {
    await service.stop();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  await new Promise<void>(() => {});
}

if (import.meta.main) {
  await main();
}
