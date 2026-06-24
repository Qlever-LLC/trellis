import { assert, assertStringIncludes } from "@std/assert";
import { isErr, Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createEventConsumersFixture } from "./_fixture.ts";

const CASE_ID =
  "event-consumers.durable-listen-without-declared-group-returns-err" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({ contract: fixture.sourceContract });
    const key = await runtime.registerService({
      name: fixture.consumerName,
      contract: fixture.missingGroupConsumerContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.missingGroupConsumerContract,
      name: fixture.consumerName,
      sessionKeySeed: key.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();

    try {
      const result = await service.event.source.pinged.listen(() =>
        Result.ok(undefined)
      );
      const value = result.take();

      assert(isErr(value));
      assertStringIncludes(
        value.error.cause instanceof Error ? value.error.cause.message : "",
        "is not declared in any event consumer group",
      );
    } finally {
      await service.stop();
    }
  },
});
