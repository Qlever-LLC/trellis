import { assert, assertEquals } from "@std/assert";
import { isErr } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.cancel-uses-cancel-capability" as const;
const fixture = createOperationsFixture(CASE_ID, {
  cancelable: true,
  signals: true,
  distinctControlCapabilities: true,
  clientControlsOperation: false,
});

liveTrellisTest({
  name:
    "operations.cancel-uses-cancel-capability cancels with cancel authority but not control authority",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.operation.entity.process(async ({ op }) => {
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

      await runtime.waitFor(async () => {
        const snapshot = await ref.get().orThrow();
        return snapshot.state === "running" ? snapshot : undefined;
      });

      const signalWithoutControl = await ref.signal("updateMessage", {
        suffix: "not-authorized",
      });
      assert(
        isErr(signalWithoutControl.take()),
        "client should not have operation control authority",
      );

      const cancelled = await ref.cancel().orThrow();
      assertEquals(cancelled.state, "cancelled");
    } finally {
      await service.stop();
    }
  },
});
