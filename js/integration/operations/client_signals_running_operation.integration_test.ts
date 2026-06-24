import { assert, assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.client-signals-running-operation" as const;
const fixture = createOperationsFixture(CASE_ID, { signals: true });

liveTrellisTest({
  name:
    "operations.client-signals-running-operation sends a typed signal to a running operation",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    const signalSuffix = "from-signal";
    let serviceObservedSignal = false;

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();

        const signal = await op.nextSignal("updateMessage").orThrow();
        assertEquals(signal.signal, "updateMessage");

        const signalInput = signal.input;
        assert(
          typeof signalInput === "object" && signalInput !== null &&
            "suffix" in signalInput &&
            typeof signalInput.suffix === "string",
          "service should receive typed signal input",
        );
        assertEquals(signalInput.suffix, signalSuffix);
        serviceObservedSignal = true;

        await op.progress({
          message: `${input.message}:${signalInput.suffix}`,
          step: 2,
        }).orThrow();

        return Result.ok({
          message: `${input.message}:${signalInput.suffix}`,
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
      const events = await ref.watch().orThrow();

      const running = await runtime.waitFor(async () => {
        const snapshot = await ref.get().orThrow();
        return snapshot.state === "running" ? snapshot : undefined;
      }, { timeoutMs: 10_000, intervalMs: 25 });

      const ack = await ref.signal("updateMessage", {
        suffix: signalSuffix,
      }).orThrow();
      assertEquals(ack.kind, "signal-accepted");
      assertEquals(ack.signal, "updateMessage");
      assertEquals(ack.signalSequence, 1);
      assertEquals(ack.snapshot.revision, running.revision);

      let sawSignalProgress = false;
      for await (const event of events) {
        if (event.type === "progress") {
          assertEquals(event.progress, {
            message: `${fixture.message}:${signalSuffix}`,
            step: 2,
          });
          sawSignalProgress = true;
        }
        if (event.type === "completed") {
          assertEquals(event.snapshot.output, {
            message: `${fixture.message}:${signalSuffix}`,
            done: true,
          });
          break;
        }
      }

      assert(serviceObservedSignal, "service should observe the client signal");
      assert(sawSignalProgress, "watch should observe signal-derived progress");

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:${signalSuffix}`,
        done: true,
      });
    } finally {
      await service.stop();
    }
  },
});
