import { assertEquals } from "@std/assert";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOperationsFixture } from "./_fixture.ts";

const CASE_ID =
  "operations.service-control-loads-durable-record-after-restart" as const;
const fixture = createOperationsFixture(CASE_ID);

liveTrellisTest({
  name:
    "operations.service-control-loads-durable-record-after-restart completes a deferred operation after service reconnect",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const serviceKey = await runtime.registerService({
      name: fixture.serviceName,
      contract: fixture.serviceContract,
    });
    let service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.serviceContract,
      name: fixture.serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

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

      await service.stop();
      service = await TrellisService.connect({
        trellisUrl: runtime.trellisUrl,
        contract: fixture.serviceContract,
        name: fixture.serviceName,
        sessionKeySeed: serviceKey.seed,
        telemetry: false,
        server: {},
      }).orThrow();

      const controlled = await service.handle.operation.entity.process.control(
        ref.id,
      ).orThrow();
      await controlled.complete({
        message: `${fixture.message}:restart`,
        done: true,
      })
        .orThrow();

      const terminal = await ref.wait().orThrow();
      assertEquals(terminal.state, "completed");
      assertEquals(terminal.output, {
        message: `${fixture.message}:restart`,
        done: true,
      });
    } finally {
      await service.stop().catch(() => undefined);
    }
  },
});
