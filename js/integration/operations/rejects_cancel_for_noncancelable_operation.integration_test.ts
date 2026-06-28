import { assert, assertEquals } from "@std/assert";
import { isErr } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.rejects-cancel-for-noncancelable-operation" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.rejects-cancel-for-noncancelable-operation returns a Result error and preserves state",
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
      const before = await runtime.waitFor(async () => {
        const snapshot = await ref.get().orThrow();
        return snapshot.state === "running" ? snapshot : undefined;
      });

      const cancelled = await ref.cancel();
      const cancelValue = cancelled.take();
      assert(isErr(cancelValue), "cancel should return a Result error");
      assertEquals(
        Reflect.get(cancelValue.error, "code"),
        "trellis.operation.control_error",
      );

      const after = await ref.get().orThrow();
      assertEquals(after.state, before.state);
      assertEquals(after.revision, before.revision);
    } finally {
      await service.stop();
    }
  },
});
