import { assert, assertEquals, assertExists } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID = "operations.service-handler-receives-client-context" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.service-handler-receives-client-context passes caller metadata and service client to the handler",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.operation.entity.process(
        ({ input, caller, client }) => {
          assertExists(client);
          assertExists(caller);
          assertEquals(input.message, fixture.message);
          assert(caller.active, "operation caller should be active");
          return Result.ok({ message: caller.type, done: true });
        },
      );

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const ref = await client.operation.entity.process.input({
        message: fixture.message,
      }).start().orThrow();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output?.done, true);
    } finally {
      await service.stop();
    }
  },
});
