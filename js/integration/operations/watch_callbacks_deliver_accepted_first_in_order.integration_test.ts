import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.watch-callbacks-deliver-accepted-first-in-order" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.watch-callbacks-deliver-accepted-first-in-order observes accepted before fast completion callbacks",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    const orderedMessage = `${fixture.message}:ordered`;
    const fastMessage = `${fixture.message}:fast`;
    let startOrderedWork = () => {};
    const orderedWorkGate = new Promise<void>((resolve) => {
      startOrderedWork = resolve;
    });

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        if (input.message === orderedMessage) {
          await orderedWorkGate;
        }
        await op.started().orThrow();
        if (input.message === orderedMessage) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await op.progress({ message: input.message, step: 1 }).orThrow();
        if (input.message === orderedMessage) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return Result.ok({ message: `${input.message}:fast`, done: true });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const callbacks: string[] = [];
      const ref = await client.operation.entity.process.input({
        message: orderedMessage,
      })
        .onAccepted((event) => {
          assertEquals(event.snapshot.state, "pending");
          callbacks.push(event.type);
        })
        .onStarted((event) => {
          callbacks.push(event.type);
        })
        .onProgress((event) => {
          assertEquals(event.progress, { message: orderedMessage, step: 1 });
          callbacks.push(event.type);
        })
        .onCompleted((event) => {
          assertEquals(event.snapshot.output, {
            message: `${orderedMessage}:fast`,
            done: true,
          });
          callbacks.push(event.type);
        })
        .start().orThrow();

      assertEquals(callbacks, ["accepted"]);
      startOrderedWork();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${orderedMessage}:fast`,
        done: true,
      });
      assertEquals(callbacks[0], "accepted");
      assertEquals(callbacks.includes("started"), true);
      assertEquals(callbacks.includes("progress"), true);
      assertEquals(callbacks.at(-1), "completed");

      const fastCallbacks: string[] = [];
      const fastRef = await client.operation.entity.process.input({
        message: fastMessage,
      })
        .onAccepted((event) => {
          fastCallbacks.push(event.type);
        })
        .onCompleted((event) => {
          fastCallbacks.push(event.type);
        })
        .start().orThrow();
      const fastTerminal = await fastRef.wait().orThrow();

      assertEquals(fastTerminal.output, {
        message: `${fastMessage}:fast`,
        done: true,
      });
      assertEquals(fastCallbacks, ["accepted", "completed"]);
    } finally {
      await service.stop();
    }
  },
});
