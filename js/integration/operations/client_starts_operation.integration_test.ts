import { assert, assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.client-starts-operation" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.client-starts-operation starts an operation and receives an operation ref",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      let receivedInput: string | undefined;
      await service.handle.operation.entity.process(async ({ input, op }) => {
        receivedInput = input.message;
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

      assert(ref.id.length > 0, "operation ref id should be non-empty");
      assertEquals(receivedInput, fixture.message);
    } finally {
      await service.stop();
    }
  },
});
