import { assert } from "@std/assert";
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
      await service.handle.rpc.entity.get(({ input }) => {
        throw Object.assign(new Error("NOT_FOUND"), {
          code: "NOT_FOUND",
          data: { id: input.id },
        });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.entity.get({ id: fixture.entityId });
      assert(result.isErr());
    } finally {
      await service.stop();
    }
  },
});
