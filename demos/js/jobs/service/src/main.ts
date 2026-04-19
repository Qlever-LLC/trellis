import { isErr, Result, UnexpectedError } from "@qlever-llc/trellis";
import {
  JobManager,
  JobProcessError,
  startNatsWorkerHostFromBinding,
} from "@qlever-llc/trellis-jobs";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
import contract, {
  InspectionSummariesRefreshStatusSchema,
  type Rpc,
} from "../contracts/demo_inspection_jobs_service.ts";
import { getSiteSummary } from "../../../shared/field_data.ts";
import { printScenarioHeading } from "../../../shared/logging.ts";

const trellisUrl = Deno.args[0]?.trim();
const sessionKeySeed = Deno.args[1]?.trim();

type RefreshStatus = {
  refreshId: string;
  siteId: string;
  status: "queued" | "running" | "completed" | "failed";
  updatedAt: string;
  message?: string;
};

type RefreshJobPayload = {
  siteId: string;
};

type RefreshJobResult = {
  refreshId: string;
  status: "completed";
};

function asRefreshJobPayload(value: unknown): RefreshJobPayload {
  if (!value || typeof value !== "object") {
    throw new UnexpectedError({
      cause: new Error("refresh job payload must be an object"),
    });
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.siteId !== "string" || payload.siteId.length === 0) {
    throw new UnexpectedError({
      cause: new Error("refresh job payload is missing siteId"),
    });
  }

  return { siteId: payload.siteId };
}

async function main(): Promise<void> {
  if (!trellisUrl || !sessionKeySeed) {
    throw new Error("Usage: deno task start -- <trellisUrl> <sessionKeySeed>");
  }

  const service = await TrellisService.connect({
    trellisUrl,
    contract,
    name: "demo-jobs-service",
    sessionKeySeed,
  });

  const refreshStatuses = await service.kv.refreshStatuses
    .open(InspectionSummariesRefreshStatusSchema)
    .take();
  if (isErr(refreshStatuses)) {
    throw refreshStatuses.error;
  }

  const jobs = service.jobs;
  const jobsWork = service.streams.jobsWork;
  if (!jobs || !jobsWork) {
    throw new Error("demo jobs service is missing jobs bindings");
  }

  const refreshJobs = new JobManager<RefreshJobPayload, RefreshJobResult>({
    nc: service.nc,
    jobs,
  });

  const putRefreshStatus = async (refresh: RefreshStatus): Promise<void> => {
    const stored = (
      await refreshStatuses.put(refresh.refreshId, refresh)
    ).take();
    if (isErr(stored)) {
      throw stored.error;
    }
  };

  const workerHost = await startNatsWorkerHostFromBinding<RefreshJobResult>(
    {
      jobs,
      workStream: jobsWork.name,
    },
    {
      nats: service.nc,
      instanceId: "demo-jobs-service-worker",
      queueTypes: ["refreshSummaries"],
      manager: refreshJobs,
      handler: async (job) => {
        const payload = asRefreshJobPayload(job.job().payload);
        const siteSummary = getSiteSummary(payload.siteId);

        await putRefreshStatus({
          refreshId: job.job().id,
          siteId: payload.siteId,
          status: "running",
          updatedAt: new Date().toISOString(),
          message: siteSummary
            ? `Refreshing summary for ${siteSummary.siteName}`
            : `Refreshing summary for ${payload.siteId}`,
        });

        await job.updateProgress({
          step: "refreshing-summary",
          message: "Loading latest inspection summary",
          current: 1,
          total: 2,
        });
        await new Promise((resolve) => setTimeout(resolve, 250));

        if (!siteSummary) {
          const message = `Unknown site '${payload.siteId}'`;
          await putRefreshStatus({
            refreshId: job.job().id,
            siteId: payload.siteId,
            status: "failed",
            updatedAt: new Date().toISOString(),
            message,
          });
          throw JobProcessError.failed(message);
        }

        await job.updateProgress({
          step: "refreshing-summary",
          message: "Stored refreshed inspection summary",
          current: 2,
          total: 2,
        });

        await putRefreshStatus({
          refreshId: job.job().id,
          siteId: payload.siteId,
          status: "completed",
          updatedAt: new Date().toISOString(),
          message: `Refresh completed for ${siteSummary.siteName}`,
        });

        return {
          refreshId: job.job().id,
          status: "completed",
        };
      },
    },
  );

  const refresh: Rpc<"Inspection.Summaries.Refresh"> = async (input) => {
    const created = await refreshJobs.create("refreshSummaries", {
      siteId: input.siteId,
    });

    try {
      await putRefreshStatus({
        refreshId: created.id,
        siteId: input.siteId,
        status: "queued",
        updatedAt: new Date().toISOString(),
        message: `Queued summary refresh for ${input.siteId}`,
      });
    } catch (error) {
      console.warn("failed to persist queued refresh status", {
        refreshId: created.id,
        siteId: input.siteId,
        error,
      });
    }

    return Result.ok({
      refreshId: created.id,
      status: "queued",
    });
  };

  const getRefreshStatus: Rpc<
    "Inspection.Summaries.RefreshStatus.Get"
  > = async (input) => {
    const refreshEntry = (await refreshStatuses.get(input.refreshId)).take();
    const refresh = isErr(refreshEntry) ? undefined : refreshEntry.value;

    return Result.ok({
      refresh,
    });
  };

  await service.trellis.mount("Inspection.Summaries.Refresh", refresh);
  await service.trellis.mount(
    "Inspection.Summaries.RefreshStatus.Get",
    getRefreshStatus,
  );

  printScenarioHeading("Inspection jobs service");
  const shutdown = async () => {
    await workerHost.stop();
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
