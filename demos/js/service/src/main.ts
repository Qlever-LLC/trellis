import { isErr } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Command } from "@cliffy/command";
import chalk from "chalk";
import { SITE_SUMMARIES } from "../../shared/field_data.ts";
import contract from "../contract.ts";
import * as features from "./features/index.ts";

async function main(): Promise<void> {
  console.log("[Activity.Live feed] demo service debug build loaded");
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

  await service.trellis.mount(
    "Assignments.List",
    features.assignments.listAssignments,
  );
  await service.trellis.mount("Sites.List", features.sites.listSites);
  await service.trellis.mount("Sites.Get", features.sites.getSite);
  await service.trellis.mount("Evidence.List", features.evidence.listEvidence);
  await service.trellis.mount(
    "Evidence.Download",
    features.evidence.downloadEvidence(service),
  );
  await service.trellis.mount(
    "Evidence.Delete",
    features.evidence.deleteEvidence,
  );
  await service.trellis.mount("Reports.List", features.reports.listReports);
  await service.operation("Sites.Refresh").handle(features.sites.refreshSite);
  await service.operation("Reports.Generate").handle(
    features.reports.generateReport,
  );
  await service.operation("Evidence.Upload").handle(
    features.evidence.uploadEvidence,
  );
  await service.feed("Activity.Live").handle(
    async ({ emit, input, signal }) => {
      console.info("[Activity.Live feed] handler started", { input });
      const controller = new AbortController();
      const stop = () => {
        console.info("[Activity.Live feed] handler abort requested");
        controller.abort();
      };
      signal.addEventListener("abort", stop, { once: true });

      try {
        await service.trellis.event(
          "Activity.Recorded",
          {},
          (event) => {
            console.info("[Activity.Live feed] source event received", {
              name: "Activity.Recorded",
              event,
            });
            return emit({ name: "Activity.Recorded", event })
              .inspect(() => {
                console.info("[Activity.Live feed] emit ok", {
                  name: "Activity.Recorded",
                });
              })
              .inspectErr((error) => {
                console.error("[Activity.Live feed] emit failed", error);
              });
          },
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();
        console.info("[Activity.Live feed] source subscription registered", {
          name: "Activity.Recorded",
        });
        await service.trellis.event(
          "Reports.Published",
          {},
          (event) => {
            console.info("[Activity.Live feed] source event received", {
              name: "Reports.Published",
              event,
            });
            return emit({ name: "Reports.Published", event })
              .inspect(() => {
                console.info("[Activity.Live feed] emit ok", {
                  name: "Reports.Published",
                });
              })
              .inspectErr((error) => {
                console.error("[Activity.Live feed] emit failed", error);
              });
          },
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();
        console.info("[Activity.Live feed] source subscription registered", {
          name: "Reports.Published",
        });
        await service.trellis.event(
          "Evidence.Uploaded",
          {},
          (event) => {
            console.info("[Activity.Live feed] source event received", {
              name: "Evidence.Uploaded",
              event,
            });
            return emit({ name: "Evidence.Uploaded", event })
              .inspect(() => {
                console.info("[Activity.Live feed] emit ok", {
                  name: "Evidence.Uploaded",
                });
              })
              .inspectErr((error) => {
                console.error("[Activity.Live feed] emit failed", error);
              });
          },
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();
        console.info("[Activity.Live feed] source subscription registered", {
          name: "Evidence.Uploaded",
        });
        await service.trellis.event(
          "Sites.Refreshed",
          {},
          (event) => {
            console.info("[Activity.Live feed] source event received", {
              name: "Sites.Refreshed",
              event,
            });
            return emit({ name: "Sites.Refreshed", event })
              .inspect(() => {
                console.info("[Activity.Live feed] emit ok", {
                  name: "Sites.Refreshed",
                });
              })
              .inspectErr((error) => {
                console.error("[Activity.Live feed] emit failed", error);
              });
          },
          { mode: "ephemeral", replay: "new", signal: controller.signal },
        ).orThrow();
        console.info("[Activity.Live feed] source subscription registered", {
          name: "Sites.Refreshed",
        });
        console.info(
          "[Activity.Live feed] all source subscriptions registered",
        );

        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      } catch (error) {
        console.error("[Activity.Live feed] handler failed", error);
        throw error;
      } finally {
        signal.removeEventListener("abort", stop);
        controller.abort();
        console.info("[Activity.Live feed] handler stopped");
      }
    },
  );
  console.log("[Activity.Live feed] Activity.Live handler registered");

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
