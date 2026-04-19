import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract from "../contracts/demo_inspection_rpc_service.ts";
import {
  ASSIGNED_INSPECTIONS,
  getSiteSummary,
} from "../../../shared/field_data.ts";
import { printJson, printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

async function main(): Promise<void> {
  if (!trellisUrl || !sessionKeySeed) {
    throw new Error("Usage: deno task start -- <trellisUrl> <sessionKeySeed>");
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-rpc-service",
    sessionKeySeed,
  });

  await service.trellis.mount("Inspection.Assignments.List", () =>
    Result.ok({ assignments: ASSIGNED_INSPECTIONS }),
  );
  await service.trellis.mount("Inspection.Sites.GetSummary", (input) =>
    Result.ok({ summary: getSiteSummary(input.siteId) }),
  );

  printScenarioHeading("Inspection RPC service");
  printJson("Assigned inspections", ASSIGNED_INSPECTIONS);

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
