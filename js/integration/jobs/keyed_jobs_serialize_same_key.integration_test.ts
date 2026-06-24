import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createJobsFixture,
  requireKeyedJobsWorkflowOutput,
} from "./_fixture.ts";

const CASE_ID = "jobs.keyed-jobs-serialize-same-key" as const;
const fixture = createJobsFixture(CASE_ID);

liveTrellisTest({
  name:
    "jobs.keyed-jobs-serialize-same-key serializes same-key jobs until release",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    let serviceWait: Promise<void> | undefined;

    try {
      const controls = await fixture.mountKeyedSerializationWorkflow(service);
      serviceWait = service.wait();
      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const groupKey = `${fixture.documentId}-same-key`;
      const first = client.rpc.documents.keyedProcess({
        documentId: `${fixture.documentId}-1`,
        groupKey,
        sequence: 1,
      }).orThrow();
      await controls.firstStarted;

      const second = client.rpc.documents.keyedProcess({
        documentId: `${fixture.documentId}-2`,
        groupKey,
        sequence: 2,
      }).orThrow();

      controls.releaseFirst();
      const [firstResult, secondResult] = [
        requireKeyedJobsWorkflowOutput(await first),
        requireKeyedJobsWorkflowOutput(await second),
      ];

      assertEquals(firstResult.sequence, 1);
      assertEquals(secondResult.sequence, 2);
      assertEquals(firstResult.groupKey, groupKey);
      assertEquals(secondResult.groupKey, groupKey);
      assertEquals(controls.secondStartedBeforeRelease(), false);
      assertEquals(controls.started(), [1, 2]);
      assertEquals(controls.completed(), [1, 2]);
    } finally {
      await service.stop();
      await serviceWait;
    }
  },
});
