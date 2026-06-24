import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { type EventListenerContext, isErr, Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createEventConsumersFixture } from "./_fixture.ts";

const CASE_ID =
  "event-consumers.ambiguous-group-without-opts-group-returns-err-and-specifying-group-works" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await runtime.contracts.approve({ contract: fixture.sourceContract });
    const publisher = await runtime.connectClient({
      name: fixture.publisherName,
      contract: fixture.sourcePublisherContract,
    });
    const consumerKey = await runtime.registerService({
      name: fixture.consumerName,
      contract: fixture.ambiguousGroupConsumerContract,
    });
    const consumer = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.ambiguousGroupConsumerContract,
      name: fixture.consumerName,
      sessionKeySeed: consumerKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const controller = new AbortController();
    let observed: { id: string; context: EventListenerContext } | undefined;

    try {
      const ambiguous = await consumer.event.source.pinged.listen(() =>
        Result.ok(undefined)
      );
      const ambiguousValue = ambiguous.take();
      assert(isErr(ambiguousValue));
      assertStringIncludes(
        ambiguousValue.error.cause instanceof Error
          ? ambiguousValue.error.cause.message
          : "",
        "is declared in multiple event consumer groups",
      );

      await consumer.event.source.pinged.listen(
        (event, context) => {
          observed = { id: event.id, context };
          return Result.ok(undefined);
        },
        {},
        { group: "primary", signal: controller.signal },
      ).orThrow();
      await publisher.event.source.pinged.publish({
        id: fixture.eventId,
        value: "primary",
      }).orThrow();

      await runtime.waitFor(() => observed?.id === fixture.eventId);
      assertEquals(observed?.context.mode, "durable");
      assertEquals(observed?.context.group, "primary");
    } finally {
      controller.abort();
      await consumer.stop();
    }
  },
});
