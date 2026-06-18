import { assert, assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createRpcFixture } from "./_fixture.ts";

const CASE_ID = "rpc.service-receives-caller-context" as const;
const fixture = createRpcFixture(CASE_ID);

liveTrellisTest({
  name:
    "rpc.service-receives-caller-context observes caller metadata in the service handler",
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
      await service.handle.rpc.entity.get(({ input, context }) =>
        Result.ok({
          id: input.id,
          found: true,
          caller: context.caller,
          sessionKey: context.sessionKey,
          requestId: context.requestId,
          traceId: context.traceId,
        })
      );

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.entity.get({ id: fixture.entityId })
        .orThrow();
      assertEquals(result.id, fixture.entityId);
      assertEquals(result.found, true);
      assert(result.caller !== undefined);
      assert(
        result.sessionKey !== undefined && result.sessionKey.length > 0,
      );
      assert(
        result.requestId !== undefined && result.requestId.length > 0,
      );
      // traceId is populated when telemetry is active; check only when present
      if (result.traceId !== undefined) {
        assert(result.traceId.length > 0);
      }
    } finally {
      await service.stop();
    }
  },
});
