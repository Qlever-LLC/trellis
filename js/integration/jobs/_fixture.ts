import { assertJobCompleted } from "@qlever-llc/trellis-test";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export type JobsWorkflowOutput = {
  readonly documentId: string;
  readonly jobId: string;
  readonly processedBy: string;
  readonly requestId: string;
  readonly traceId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireJobsWorkflowOutput(value: unknown): JobsWorkflowOutput {
  if (!isRecord(value)) {
    throw new Error("expected jobs workflow output");
  }
  if (
    typeof value.documentId !== "string" || typeof value.jobId !== "string" ||
    typeof value.processedBy !== "string" ||
    typeof value.requestId !== "string" || typeof value.traceId !== "string"
  ) {
    throw new Error("expected jobs workflow output fields");
  }
  return {
    documentId: value.documentId,
    jobId: value.jobId,
    processedBy: value.processedBy,
    requestId: value.requestId,
    traceId: value.traceId,
  };
}

export function createJobsFixture(caseId: string) {
  const slug = integrationSlug(caseId);
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

  const serviceContract = defineServiceContract(
    { schemas: jobsSchemas },
    (ref) => ({
      id: caseScopedContractId("trellis.integration.jobs-service", caseId),
      displayName: `Trellis Integration Jobs Service (${slug})`,
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
          subject: caseScopedSubject(
            "rpc.v1.Integration.Jobs",
            caseId,
            "Documents.Process",
          ),
          input: ref.schema("WorkflowInput"),
          output: ref.schema("WorkflowOutput"),
          capabilities: { call: [] },
          errors: [],
        },
      },
    }),
  );

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.jobs-client", caseId),
    displayName: `Trellis Integration Jobs Client (${slug})`,
    description: "App/client participant for the jobs integration fixture.",
    uses: {
      required: {
        jobsService: serviceContract.use({
          rpc: { call: ["Documents.Process"] },
        }),
      },
    },
  }));

  const serviceName = caseScopedName("jobs-fixture-service", caseId);

  async function connectService(runtime: LiveTrellisRuntime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    return await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
  }

  async function mountWorkflow(
    service: Awaited<ReturnType<typeof connectService>>,
  ) {
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
  }

  return {
    slug,
    serviceContract,
    clientContract,
    serviceName,
    clientName: caseScopedName("jobs-fixture-client", caseId),
    documentId: caseScopedName("doc", caseId),
    connectService,
    mountWorkflow,
  };
}
