import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract, { type Rpc } from "../contracts/demo_inspection_kv_service.ts";
import { SITE_SUMMARIES } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";
import {
  getSiteSummary,
  listSiteSummaries,
  openSiteSummaryStore,
  seedSiteSummaries,
} from "./site_summary_store.ts";

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

async function main(): Promise<void> {
  if (!trellisUrl || !sessionKeySeed) {
    throw new Error("Usage: deno task start -- <trellisUrl> <sessionKeySeed>");
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-kv-service",
    sessionKeySeed,
  });

  const siteSummaryStore = await openSiteSummaryStore(service);
  await seedSiteSummaries(siteSummaryStore, SITE_SUMMARIES);

  const listSummaries: Rpc<"Inspection.Summaries.List"> = async () => {
    return Result.ok({ summaries: await listSiteSummaries(siteSummaryStore) });
  };

  const getSummary: Rpc<"Inspection.Summaries.Get"> = async (input) => {
    return Result.ok({
      summary: await getSiteSummary(siteSummaryStore, input.siteId),
    });
  };

  await service.trellis.mount("Inspection.Summaries.List", listSummaries);
  await service.trellis.mount("Inspection.Summaries.Get", getSummary);

  printScenarioHeading("Inspection KV service");
  const shutdown = async () => {
    await service.stop();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());
  await new Promise<void>(() => {});
}

if (import.meta.main) {
  await main();
}
