import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.service-defer-keeps-operation-running" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.service-defer-keeps-operation-running leaves a deferred operation non-terminal",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    let handlerSettled = false;

    try {
      await service.handle.operation.entity.process(async ({ op }) => {
        await op.started().orThrow();
        await op.progress({ message: "waiting for external control", step: 1 })
          .orThrow();
        handlerSettled = true;
        return op.defer();
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();

      await runtime.waitFor(() => handlerSettled);
      const snapshot = await ref.get().orThrow();
      assertEquals(snapshot.state, "running");
      assertEquals(snapshot.progress, {
        message: "waiting for external control",
        step: 1,
      });
      assertEquals(snapshot.output, undefined);
    } finally {
      await service.stop();
    }
  },
});
