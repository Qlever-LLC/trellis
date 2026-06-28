import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.service-control-resumes-deferred-operation" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.service-control-resumes-deferred-operation completes by id without rerunning the handler",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    let handlerRuns = 0;

    try {
      await service.handle.operation.entity.process(async ({ op }) => {
        handlerRuns += 1;
        await op.started().orThrow();
        return op.defer();
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();

      await runtime.waitFor(() => handlerRuns === 1);
      const controlled = await service.handle.operation.entity.process.control(
        ref.id,
      ).orThrow();
      await controlled.progress({ message: "approved", step: 2 }).orThrow();
      await controlled.complete({
        message: `${fixture.message}:done`,
        done: true,
      })
        .orThrow();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:done`,
        done: true,
      });
      assertEquals(handlerRuns, 1);
    } finally {
      await service.stop();
    }
  },
});
