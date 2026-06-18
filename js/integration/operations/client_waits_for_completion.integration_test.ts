import { assert, assertEquals } from "@std/assert";
import { assertOperationCompleted } from "@qlever-llc/trellis-test";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.client-waits-for-completion" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.client-waits-for-completion observes completion on an operation watch",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Result.ok({ message: input.message, done: true });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();
      const events = await ref.watch().orThrow();

      let sawCompleted = false;
      for await (const event of events) {
        if (event.type === "completed") {
          sawCompleted = true;
          assertEquals(event.snapshot.output, {
            message: fixture.message,
            done: true,
          });
          break;
        }
      }

      assert(sawCompleted, "operation watch should observe completion");
      await assertOperationCompleted(ref, {
        message: fixture.message,
        done: true,
      });
    } finally {
      await service.stop();
    }
  },
});
