import { isErr } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { SITE_SUMMARIES } from "../../shared/field_data.ts";
import contract from "../contract.ts";
import * as features from "./features/index.ts";

async function main(): Promise<void> {
  const {
    args: [trellisUrl, sessionKeySeed],
  } = await new Command()
    .name("demo-service")
    .arguments("<trellisUrl:string> <sessionKeySeed:string>", [
      "URL of Trellis instance to connect to",
      "Trellis service root key",
    ])
    .parse(Deno.args);

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "field-ops-demo-service",
    sessionKeySeed,
  }).orThrow();

  service.health.setInfo({
    version: "0.0.0",
    info: { demo: "field-ops" },
  });

  for (const summary of SITE_SUMMARIES) {
    if (isErr(await service.kv.siteSummaries.get(summary.siteId).take())) {
      await service.kv.siteSummaries.create(summary.siteId, summary).orThrow();
    }
  }

  service.health.add("field-data", async () => {
    const checks = await Promise.all(
      SITE_SUMMARIES.map((summary) =>
        service.kv.siteSummaries.get(summary.siteId).take()
      ),
    );
    const loadedSites = checks.filter((result) => !isErr(result)).length;

    return {
      status: loadedSites === SITE_SUMMARIES.length ? "ok" : "failed",
      summary: `${loadedSites}/${SITE_SUMMARIES.length} demo sites loaded`,
      info: {
        expectedSites: SITE_SUMMARIES.length,
        loadedSites,
      },
    };
  });

  service.jobs.refreshSiteSummary.handle(features.sites.refreshSiteSummary);

  await service.handle.rpc.assignments.list(
    features.assignments.listAssignments,
  );
  await service.handle.rpc.sites.list(features.sites.listSites);
  await service.handle.rpc.sites.get(features.sites.getSite);
  await service.handle.rpc.evidence.list(features.evidence.listEvidence);
  await service.handle.rpc.evidence.download(
    features.evidence.downloadEvidence(service),
  );
  await service.handle.rpc.evidence.delete(features.evidence.deleteEvidence);
  await service.handle.rpc.reports.list(features.reports.listReports);
  await service.handle.operation.sites.refresh(features.sites.refreshSite);
  await service.handle.operation.reports.generate(
    features.reports.generateReport,
  );
  await service.handle.operation.evidence.upload(
    features.evidence.uploadEvidence,
  );
  await service.handle.feed.audit.feed(
    async ({ emit, signal, client }) => {
      const controller = new AbortController();
      const stop = () => {
        controller.abort();
      };
      signal.addEventListener("abort", stop, { once: true });

      try {
        await client.event.audit.recorded.listen(
          (event) => {
            return emit({ name: "Audit.Recorded", event });
          },
          {},
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();
        await client.event.reports.published.listen(
          (event) => {
            return emit({ name: "Reports.Published", event });
          },
          {},
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();
        await client.event.evidence.uploaded.listen(
          (event) => {
            return emit({ name: "Evidence.Uploaded", event });
          },
          {},
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();
        await client.event.sites.refreshed.listen(
          (event) => {
            return emit({ name: "Sites.Refreshed", event });
          },
          {},
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();

        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        signal.removeEventListener("abort", stop);
        controller.abort();
      }
    },
  );

  console.log(chalk.green.bold("== Field Ops demo service"));
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      await service.stop();
      Deno.exit(0);
    } catch (error) {
      console.error(chalk.red.bold("Failed to stop Field Ops demo service"));
      console.error(error);
      Deno.exit(1);
    }
  };

  Deno.addSignalListener("SIGINT", () => void shutdown());
  Deno.addSignalListener("SIGTERM", () => void shutdown());

  try {
    await service.wait();
  } catch (error) {
    console.error(
      chalk.red.bold("Field Ops demo service stopped unexpectedly"),
    );
    console.error(error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
