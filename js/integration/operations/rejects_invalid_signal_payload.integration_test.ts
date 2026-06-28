import { assert, assertEquals } from "@std/assert";
import { isErr, Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.rejects-invalid-signal-payload" as const;
const fixture = createOperationsFixture(CASE_ID, { signals: true });

liveTrellisTest({
  name:
    "operations.rejects-invalid-signal-payload returns a Result error and skips service consumption",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    let markWaitingForSignal = () => {};
    const waitingForSignal = new Promise<void>((resolve) => {
      markWaitingForSignal = resolve;
    });
    const consumed: unknown[] = [];

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        markWaitingForSignal();

        const signal = await op.nextSignal("updateMessage").orThrow();
        consumed.push(signal.input);
        assertEquals(signal.input, { suffix: "valid" });

        return Result.ok({
          message: `${input.message}:valid`,
          done: true,
        });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();

      await waitingForSignal;

      const invalid = await ref.signal("updateMessage", { suffix: 123 });
      const invalidValue = invalid.take();
      assert(isErr(invalidValue), "invalid signal payload should fail");
      assertEquals(
        Reflect.get(invalidValue.error, "code"),
        "trellis.operation.control_error",
      );

      await ref.signal("updateMessage", { suffix: "valid" }).orThrow();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:valid`,
        done: true,
      });
      assertEquals(consumed, [{ suffix: "valid" }]);
    } finally {
      await service.stop();
    }
  },
});
