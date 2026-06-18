import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createJobsFixture, requireJobsWorkflowOutput } from "./_fixture.ts";

const CASE_ID = "jobs.service-creates-local-job-from-client-rpc" as const;
const fixture = createJobsFixture(CASE_ID);

liveTrellisTest({
  name:
    "jobs.service-creates-local-job-from-client-rpc creates a job with non-empty id",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    let serviceWait: Promise<void> | undefined;

    try {
      await fixture.mountWorkflow(service);
      serviceWait = service.wait();
      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = requireJobsWorkflowOutput(
        await client.rpc.documents.process({
          documentId: fixture.documentId,
        }).orThrow(),
      );
      assertEquals(result.documentId, fixture.documentId);
      assertEquals(result.jobId.length > 0, true);
    } finally {
      await service.stop();
      await serviceWait;
    }
  },
});
