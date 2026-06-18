import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createJobsFixture, requireJobsWorkflowOutput } from "./_fixture.ts";

const CASE_ID = "jobs.job-wait-returns-typed-result" as const;
const fixture = createJobsFixture(CASE_ID);

liveTrellisTest({
  name: "jobs.job-wait-returns-typed-result returns typed result on completion",
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
      assertEquals(result.processedBy, "ts-service-job");
    } finally {
      await service.stop();
      await serviceWait;
    }
  },
});
