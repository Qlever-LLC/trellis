import { assert, assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.queued-signal-delivered-before-live-signal" as const;
const fixture = createOperationsFixture(CASE_ID, { signals: true });

liveTrellisTest({
  name:
    "operations.queued-signal-delivered-before-live-signal consumes queued signal before live signal",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    let releaseConsumption = () => {};
    const consumptionGate = new Promise<void>((resolve) => {
      releaseConsumption = resolve;
    });
    const consumed: string[] = [];

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        await consumptionGate;

        const queued = await op.nextSignal().orThrow();
        assertEquals(queued.signal, "updateMessage");
        assert(
          typeof queued.input === "object" && queued.input !== null,
          "queued signal input should be an object",
        );
        consumed.push(String(Reflect.get(queued.input, "suffix")));

        const live = await op.nextSignal("appendMessage").orThrow();
        assertEquals(live.signal, "appendMessage");
        assert(
          typeof live.input === "object" && live.input !== null,
          "live signal input should be an object",
        );
        consumed.push(String(Reflect.get(live.input, "suffix")));
        assertEquals(consumed, ["queued", "live"]);

        return Result.ok({
          message: `${input.message}:${consumed.join(":")}`,
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

      await runtime.waitFor(async () => {
        const snapshot = await ref.get().orThrow();
        return snapshot.state === "running" ? snapshot : undefined;
      });

      const queued = await ref.signal("updateMessage", { suffix: "queued" })
        .orThrow();
      assertEquals(queued.signalSequence, 1);

      releaseConsumption();

      const live = await ref.signal("appendMessage", { suffix: "live" })
        .orThrow();
      assertEquals(live.signalSequence, 2);

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:queued:live`,
        done: true,
      });
      assertEquals(consumed, ["queued", "live"]);
    } finally {
      await service.stop();
    }
  },
});
