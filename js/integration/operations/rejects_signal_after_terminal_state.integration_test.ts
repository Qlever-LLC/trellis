import { assert, assertEquals } from "@std/assert";
import {
  isErr,
  OperationAlreadyTerminalError,
  Result,
} from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.rejects-signal-after-terminal-state" as const;
const fixture = createOperationsFixture(CASE_ID, { signals: true });

liveTrellisTest({
  name:
    "operations.rejects-signal-after-terminal-state returns a Result error after completion",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        return Result.ok({ message: input.message, done: true });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");

      const rejected = await ref.signal("updateMessage", {
        suffix: "too-late",
      });
      const rejectedValue = rejected.take();
      assert(isErr(rejectedValue), "terminal operation signal should fail");
      assert(rejectedValue.error instanceof OperationAlreadyTerminalError);
    } finally {
      await service.stop();
    }
  },
});
