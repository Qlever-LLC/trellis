import { assert, assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.client-watches-progress" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.client-watches-progress observes progress events on an operation stream",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await op.progress({ message: input.message, step: 1 }).orThrow();
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

      let sawProgress = false;
      for await (const event of events) {
        if (event.type === "progress") {
          assertEquals(event.progress, { message: fixture.message, step: 1 });
          sawProgress = true;
          break;
        }
      }

      assert(sawProgress, "operation watch should observe progress");
    } finally {
      await service.stop();
    }
  },
});
