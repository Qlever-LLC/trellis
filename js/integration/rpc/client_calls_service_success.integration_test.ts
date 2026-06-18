import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createRpcFixture } from "./_fixture.ts";

const CASE_ID = "rpc.client-calls-service-success" as const;
const fixture = createRpcFixture(CASE_ID);

liveTrellisTest({
  name:
    "rpc.client-calls-service-success reaches a service RPC through generated surfaces",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const serviceKey = await runtime.registerService({
      name: fixture.serviceName,
      contract: fixture.serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.serviceContract,
      name: fixture.serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();

    try {
      await service.handle.rpc.entity.get(({ input }) =>
        Result.ok({ id: input.id, found: true })
      );

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.entity.get({ id: fixture.entityId })
        .orThrow();
      assertEquals(result.id, fixture.entityId);
      assertEquals(result.found, true);
    } finally {
      await service.stop();
    }
  },
});
