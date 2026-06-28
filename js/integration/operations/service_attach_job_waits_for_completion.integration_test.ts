import { assertEquals } from "@std/assert";
import { AsyncResult, type BaseError, Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.service-attach-job-waits-for-completion" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.service-attach-job-waits-for-completion keeps operation running until attached task completes",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    let releaseTask = () => {};
    const releaseGate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    let markTaskWaiting = () => {};
    const taskWaiting = new Promise<void>((resolve) => {
      markTaskWaiting = resolve;
    });

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        const task = {
          wait(): AsyncResult<unknown, BaseError> {
            return AsyncResult.from((async () => {
              await op.started().orThrow();
              await op.progress({ message: "attached task waiting", step: 1 })
                .orThrow();
              markTaskWaiting();
              await releaseGate;
              await op.complete({
                message: `${input.message}:attached`,
                done: true,
              }).orThrow();
              return Result.ok<unknown, BaseError>(undefined);
            })());
          },
        };

        return await op.attach(task);
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();

      await taskWaiting;
      const running = await ref.get().orThrow();
      assertEquals(running.state, "running");
      assertEquals(running.progress, {
        message: "attached task waiting",
        step: 1,
      });

      releaseTask();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:attached`,
        done: true,
      });
    } finally {
      await service.stop();
    }
  },
});
