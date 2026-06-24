import { assert, assertEquals } from "@std/assert";
import { isErr } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.client-cancels-operation" as const;
const fixture = createOperationsFixture(CASE_ID, { cancelable: true });

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withTimeout(
  promise: Promise<void>,
  message: string,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), 5_000);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

liveTrellisTest({
  name:
    "operations.client-cancels-operation cancels a running operation through the public ref",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    const afterClientCancel = deferred();
    const serviceObservedCancel = deferred();
    let serviceSawTerminalCancel = false;

    try {
      await service.handle.operation.entity.process(async ({ input, op }) => {
        await op.started().orThrow();
        await afterClientCancel.promise;

        const progressAfterCancel = await op.progress({
          message: input.message,
          step: 2,
        });
        serviceSawTerminalCancel = isErr(progressAfterCancel.take());
        serviceObservedCancel.resolve();
        return op.defer();
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();
      const events = await ref.watch().orThrow();

      const cancelSnapshot = await ref.cancel().orThrow();
      assertEquals(cancelSnapshot.state, "cancelled");

      afterClientCancel.resolve();
      await withTimeout(
        serviceObservedCancel.promise,
        "service did not observe terminal operation cancellation",
      );
      assert(
        serviceSawTerminalCancel,
        "service-side operation handle should observe cancellation as terminal",
      );

      const waited = await ref.wait().orThrow();
      assertEquals(waited.state, "cancelled");

      let sawCancelledEvent = false;
      for await (const event of events) {
        if (event.type === "cancelled") {
          assertEquals(event.snapshot.state, "cancelled");
          sawCancelledEvent = true;
          break;
        }
      }
      assert(
        sawCancelledEvent,
        "watch should observe cancelled terminal event",
      );
    } finally {
      await service.stop();
    }
  },
});
