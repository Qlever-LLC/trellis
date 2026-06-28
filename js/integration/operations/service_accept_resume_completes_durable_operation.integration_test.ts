import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.service-accept-resume-completes-durable-operation" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.service-accept-resume-completes-durable-operation lets a client resume and wait on service-accepted work",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      const clientKey = await runtime.registerClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });
      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
        sessionKeySeed: clientKey.seed,
      });
      const accepted = await service.handle.operation.entity.process.accept({
        sessionKey: clientKey.sessionKey,
      }).orThrow();
      const resumed = client.operation.entity.process.resume(accepted.ref);

      await accepted.started().orThrow();
      await accepted.progress({ message: "working", step: 1 }).orThrow();
      await accepted.complete({
        message: `${fixture.message}:accepted`,
        done: true,
      })
        .orThrow();

      const terminal = await resumed.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:accepted`,
        done: true,
      });
    } finally {
      await service.stop();
    }
  },
});
