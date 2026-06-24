import { assertEquals } from "@std/assert";
import { type EventListenerContext, Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createEventConsumersFixture } from "./_fixture.ts";

const CASE_ID =
  "event-consumers.self-owned-durable-consumer-receives-self-published-event" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const key = await runtime.registerService({
      name: fixture.consumerName,
      contract: fixture.selfConsumerContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.selfConsumerContract,
      name: fixture.consumerName,
      sessionKeySeed: key.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const controller = new AbortController();
    let observed: { id: string; context: EventListenerContext } | undefined;

    try {
      await service.event.self.pinged.listen(
        (event, context) => {
          observed = { id: event.id, context };
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: controller.signal },
      ).orThrow();
      await service.event.self.pinged.publish({
        id: fixture.eventId,
        value: "self",
      }).orThrow();

      await runtime.waitFor(() => observed?.id === fixture.eventId);
      assertEquals(observed?.context.mode, "durable");
      assertEquals(observed?.context.group, "ingest");
    } finally {
      controller.abort();
      await service.stop();
    }
  },
});
