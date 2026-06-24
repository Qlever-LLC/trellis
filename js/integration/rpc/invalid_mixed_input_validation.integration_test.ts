import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import {
  SchemaValidationError,
  ValidationError,
} from "@qlever-llc/trellis/errors";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createRpcFixture } from "./_fixture.ts";

const CASE_ID = "rpc.invalid-mixed-input-validation" as const;
const fixture = createRpcFixture(CASE_ID);

liveTrellisTest({
  name:
    "rpc.invalid-mixed-input-validation returns ValidationError before handler dispatch",
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
      await service.handle.rpc.validation.mixed(() => {
        handlerCalled = true;
        return Result.ok({ success: true });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.validation.mixed({
        items: [],
        name: "ab",
      });
      assert(result.isErr());
      assertInstanceOf(result.error, ValidationError);
      assert(
        !(result.error instanceof SchemaValidationError),
        "expected ValidationError, not SchemaValidationError",
      );
      assertEquals(handlerCalled, false);
    } finally {
      await service.stop();
    }
  },
});
