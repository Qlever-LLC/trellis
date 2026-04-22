import { Result } from "@qlever-llc/trellis";
import type { RpcArgs, RpcResult } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import contract from "../contract.ts";
import {
  ASSIGNED_INSPECTIONS,
  getSiteSummary,
} from "../../../shared/field_data.ts";
import { Command } from "@cliffy/command";

type ListAssignmentsArgs = RpcArgs<
  typeof contract,
  "Inspection.Assignments.List"
>;
type ListAssignmentsReturn = RpcResult<
  typeof contract,
  "Inspection.Assignments.List"
>;
type GetSummaryArgs = RpcArgs<typeof contract, "Inspection.Sites.GetSummary">;
type GetSummaryReturn = RpcResult<
  typeof contract,
  "Inspection.Sites.GetSummary"
>;

async function listAssignments(
  _args: ListAssignmentsArgs,
): Promise<ListAssignmentsReturn> {
  return Result.ok({ assignments: ASSIGNED_INSPECTIONS });
}

async function getSummary(
  { input }: GetSummaryArgs,
): Promise<GetSummaryReturn> {
  return Result.ok({ summary: getSiteSummary(input.siteId) });
}

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
  }).orThrow();

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
