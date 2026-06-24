import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { SchemaValidationError } from "@qlever-llc/trellis/errors";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createRpcFixture } from "./_fixture.ts";

const CASE_ID = "rpc.invalid-annotated-input-schema-validation" as const;
const fixture = createRpcFixture(CASE_ID);

liveTrellisTest({
  name:
    "rpc.invalid-annotated-input-schema-validation returns SchemaValidationError before handler dispatch",
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

    let handlerCalled = false;

    try {
      await service.handle.rpc.validation.annotated(() => {
        handlerCalled = true;
        return Result.ok({ success: true });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.validation.annotated({ items: [] });
      assert(result.isErr());
      assertInstanceOf(result.error, SchemaValidationError);
      assertEquals(result.error.issues.length, 1);
      assertEquals(result.error.issues[0].code, "rpc.items.required");
      assertEquals(handlerCalled, false);
    } finally {
      await service.stop();
    }
  },
});
