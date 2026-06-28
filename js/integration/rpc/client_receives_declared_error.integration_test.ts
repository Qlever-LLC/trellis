import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createRpcFixture } from "./_fixture.ts";

const CASE_ID = "rpc.client-receives-declared-error" as const;
const fixture = createRpcFixture(CASE_ID);

liveTrellisTest({
  name: "rpc.client-receives-declared-error from a service RPC handler",
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
        Result.err(new fixture.NotFoundError({ entityId: input.id }))
      );

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.entity.get({ id: fixture.entityId });
      assert(result.isErr());
      assertInstanceOf(result.error, fixture.NotFoundError);
      const serialized = result.error.toSerializable();
      assertEquals(serialized.type, "NOT_FOUND");
      assertEquals(serialized.entityId, fixture.entityId);
      assertEquals(serialized.context?.method, "Entity.Get");
      assertEquals(serialized.context?.service, fixture.serviceName);
      assertEquals(
        serialized.context?.contractId,
        fixture.serviceContract.CONTRACT_ID,
      );
      assertEquals(
        serialized.context?.contractDigest,
        fixture.serviceContract.CONTRACT_DIGEST,
      );
      assert(typeof serialized.context?.requestId === "string");
      assert(!Object.hasOwn(serialized.context ?? {}, "subject"));
    } finally {
      await service.stop();
    }
  },
});
