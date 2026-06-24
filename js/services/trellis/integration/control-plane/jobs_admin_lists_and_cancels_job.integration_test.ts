import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { sdk as trellisJobs } from "@qlever-llc/trellis/sdk/jobs";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID = "control-plane.jobs-admin-lists-and-cancels-job" as const;

const schemas = {
  HoldPayload: Type.Object({ marker: Type.String() }),
  HoldResult: Type.Object({ cancelled: Type.Boolean() }),
} as const;

const serviceContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.jobs-admin-service",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Jobs Admin Probe Service",
  description:
    "Creates a long-running service-local job for Jobs admin integration coverage.",
  jobs: {
    holdOpen: {
      payload: ref.schema("HoldPayload"),
      result: ref.schema("HoldResult"),
    },
  },
}));

const adminClientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.jobs-admin-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Jobs Admin Probe Client",
  description: "Uses the generated Jobs admin SDK surface.",
  uses: {
    required: {
      jobs: trellisJobs.use({
        rpc: {
          call: [
            "Jobs.Health",
            "Jobs.List",
            "Jobs.Get",
            "Jobs.Cancel",
            "Jobs.ListServices",
          ],
        },
      }),
    },
  },
}));

const serviceName = caseScopedName("jobs-admin-probe-service", CASE_ID);
const adminClientName = caseScopedName("jobs-admin-probe-client", CASE_ID);
const marker = caseScopedName("jobs-admin-probe-marker", CASE_ID);

liveTrellisTest({
  name:
    "control-plane.jobs-admin-lists-and-cancels-job observes and cancels a service-local job",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const adminClient = await runtime.connectClient({
      name: adminClientName,
      contract: adminClientContract,
    });

    let serviceWait: Promise<void> | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    try {
      service.jobs.holdOpen.handle(async ({ job }) => {
        resolveStarted?.();
        while (!job.cancelled) {
          await job.heartbeat().orThrow();
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return Result.ok({ cancelled: true });
      });
      serviceWait = service.wait();

      const ref = await service.jobs.holdOpen.create({ marker }).orThrow();
      await started;
      const activeJob = await runtime.waitFor(async () => {
        const current = await ref.get().orThrow();
        return current.state === "active" ? current : false;
      }, { timeoutMs: 15_000, intervalMs: 50 });
      assertEquals(activeJob.id, ref.id);
      assertEquals(activeJob.payload.marker, marker);

      await adminClient.rpc.jobs.health({}).orThrow();
      const listedJob = await runtime.waitFor(async () => {
        const page = await adminClient.rpc.jobs.list({
          service: ref.service,
          type: ref.type,
          limit: 20,
        }).orThrow();
        return page.entries.find((entry) => entry.id === ref.id) ?? false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(listedJob.service, ref.service);
      assertEquals(listedJob.type, ref.type);

      const listedService = await runtime.waitFor(async () => {
        const page = await adminClient.rpc.jobs.listServices({ limit: 20 })
          .orThrow();
        return page.entries.find((entry) => entry.name === ref.service) ??
          false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(listedService.workers[0]?.jobType, ref.type);

      const detail = await adminClient.rpc.jobs.get({ id: ref.id }).orThrow();
      assertEquals(detail.job.id, ref.id);
      assertEquals(detail.job.service, ref.service);
      assertEquals(detail.job.type, ref.type);

      const cancelled = await adminClient.rpc.jobs.cancel({ id: ref.id })
        .orThrow();
      assertEquals(cancelled.job.id, ref.id);
      const terminal = await runtime.waitFor(async () => {
        const current = await adminClient.rpc.jobs.get({ id: ref.id })
          .orThrow();
        return current.job.state === "cancelled" ? current.job : false;
      }, { timeoutMs: 15_000, intervalMs: 100 });
      assertEquals(terminal.state, "cancelled");
      assertEquals((await ref.wait().orThrow()).state, "cancelled");
    } finally {
      await adminClient.connection.close().catch(() => undefined);
      await service.stop().catch(() => undefined);
      await serviceWait?.catch(() => undefined);
    }
  },
});
