import { assert, assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.signals-persist-and-consume-in-acceptance-order" as const;
const fixture = createOperationsFixture(CASE_ID, { signals: true });

liveTrellisTest({
  name:
    "operations.signals-persist-and-consume-in-acceptance-order acknowledges and consumes signals in order",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    const consumed: string[] = [];

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();

        for await (const signal of op.signals()) {
          assert(
            typeof signal.input === "object" && signal.input !== null,
            "signal input should be an object",
          );
          const suffix = Reflect.get(signal.input, "suffix");
          assertEquals(typeof suffix, "string");
          consumed.push(`${signal.signal}:${suffix}`);

          if (consumed.length === 2) {
            assertEquals(consumed, ["updateMessage:one", "appendMessage:two"]);
            return Result.ok({
              message: `${input.message}:one:two`,
              done: true,
            });
          }
        }

        throw new Error("signal stream ended before two accepted signals");
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();

      const running = await runtime.waitFor(async () => {
        const snapshot = await ref.get().orThrow();
        return snapshot.state === "running" ? snapshot : undefined;
      });

      const first = await ref.signal("updateMessage", { suffix: "one" })
        .orThrow();
      assertEquals(first.kind, "signal-accepted");
      assertEquals(first.signalSequence, 1);
      assertEquals(first.snapshot.revision, running.revision);

      const second = await ref.signal("appendMessage", { suffix: "two" })
        .orThrow();
      assertEquals(second.kind, "signal-accepted");
      assertEquals(second.signalSequence, 2);
      assertEquals(second.snapshot.revision, running.revision);

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:one:two`,
        done: true,
      });
      assertEquals(consumed, ["updateMessage:one", "appendMessage:two"]);
    } finally {
      await service.stop();
    }
  },
});
