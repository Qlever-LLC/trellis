import { assertEquals } from "@std/assert";
import { assertJobCompleted } from "@qlever-llc/trellis-test";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const jobsSchemas = {
  WorkflowInput: Type.Object({ documentId: Type.String() }),
  WorkflowOutput: Type.Object({
    documentId: Type.String(),
    jobId: Type.String(),
    processedBy: Type.String(),
    requestId: Type.String(),
    traceId: Type.String(),
  }),
  JobPayload: Type.Object({ documentId: Type.String() }),
  JobResult: Type.Object({
    documentId: Type.String(),
    processedBy: Type.String(),
    requestId: Type.String(),
    traceId: Type.String(),
  }),
} as const;

const jobsServiceContract = defineServiceContract(
  { schemas: jobsSchemas },
  (ref) => ({
    id: "trellis.integration.jobs-service@v1",
    displayName: "Trellis Integration Jobs Service",
    description: "Exercises service-local jobs behind a client-visible RPC.",
    jobs: {
      processDocument: {
        payload: ref.schema("JobPayload"),
        result: ref.schema("JobResult"),
      },
    },
    rpc: {
      "Documents.Process": {
        version: "v1",
        subject: "rpc.v1.Documents.Process",
        input: ref.schema("WorkflowInput"),
        output: ref.schema("WorkflowOutput"),
        capabilities: { call: [] },
        errors: [],
      },
    },
  }),
);

const jobsClientContract = defineAppContract(() => ({
  id: "trellis.integration.jobs-client@v1",
  displayName: "Trellis Integration Jobs Client",
  description: "App/client participant for the jobs integration fixture.",
  uses: {
    required: {
      jobsService: jobsServiceContract.use({
        rpc: { call: ["Documents.Process"] },
      }),
    },
  },
}));

Deno.test("jobs.service-runs-local-job-for-client-visible-workflow runs a service-local job", async () => {
  await withTrellisRuntime(async (runtime) => {
    const serviceKey = await runtime.registerService({
      name: "jobs-fixture-service",
      contract: jobsServiceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: jobsServiceContract,
      name: "jobs-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    let serviceWait: Promise<void> | undefined;

    try {
      service.jobs.processDocument.handle(async ({ job }) => {
        await job.progress({
          step: "process",
          current: 1,
          total: 1,
          message: `processed ${job.payload.documentId}`,
        }).orThrow();
        await job.log({
          timestamp: new Date().toISOString(),
          level: "info",
          message: `processed ${job.payload.documentId}`,
        }).orThrow();
        return Result.ok({
          documentId: job.payload.documentId,
          processedBy: "ts-service-job",
          requestId: job.context.requestId,
          traceId: job.context.traceId,
        });
      });

      await service.handle.rpc.documents.process(async ({ input, client }) => {
        const ref = await client.jobs.processDocument.create({
          documentId: input.documentId,
        }).orThrow();
        const terminal = await assertJobCompleted(ref, {
          documentId: input.documentId,
          processedBy: "ts-service-job",
        });
        if (terminal.result === undefined) {
          throw new Error(`job ${ref.id} completed without a result`);
        }
        return Result.ok({
          documentId: terminal.result.documentId,
          jobId: ref.id,
          processedBy: terminal.result.processedBy,
          requestId: terminal.result.requestId,
          traceId: terminal.result.traceId,
        });
      });
      serviceWait = service.wait();

      const client = await runtime.connectClient({
        name: "jobs-fixture-client",
        contract: jobsClientContract,
      });

      const result = await client.rpc.documents.process({
        documentId: "doc-1",
      }).orThrow();
      assertEquals(result.documentId, "doc-1");
      assertEquals(result.processedBy, "ts-service-job");
      assertEquals(result.jobId.length > 0, true);
      assertEquals(result.requestId.length > 0, true);
      assertEquals(result.traceId.length, 32);
    } finally {
      await service.stop();
      await serviceWait;
    }
  });
});
