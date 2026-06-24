import { assertEquals } from "@std/assert";
import type { ConsumerInfo } from "@nats-io/jetstream";
import { type EventListenerContext, Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import {
  liveTrellisTest,
  requireJetStreamConsumerRuntime,
  runtimeScopeForCase,
} from "../_support/runtime.ts";
import { createEventConsumersFixture } from "./_fixture.ts";

const CASE_ID =
  "event-consumers.ephemeral-listener-avoids-durable-metadata-and-jetstream-consumer" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const jsRuntime = requireJetStreamConsumerRuntime(runtime);
    await runtime.contracts.approve({ contract: fixture.sourceContract });
    const key = await runtime.registerService({
      name: fixture.consumerName,
      contract: fixture.missingGroupConsumerContract,
    });
    const publisher = await runtime.connectClient({
      name: fixture.publisherName,
      contract: fixture.sourcePublisherContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.missingGroupConsumerContract,
      name: fixture.consumerName,
      sessionKeySeed: key.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const controller = new AbortController();
    let observed: { id: string; context: EventListenerContext } | undefined;

    try {
      assertEquals(
        matchingConsumers(await jsRuntime.listTrellisJetStreamConsumers())
          .length,
        0,
      );
      await service.event.source.pinged.listen(
        (event, context) => {
          observed = { id: event.id, context };
          return Result.ok(undefined);
        },
        {},
        { mode: "ephemeral", signal: controller.signal },
      ).orThrow();
      assertEquals(
        matchingConsumers(await jsRuntime.listTrellisJetStreamConsumers())
          .length,
        0,
      );

      await publisher.event.source.pinged.publish({
        id: fixture.eventId,
        value: "ephemeral",
      }).orThrow();
      await runtime.waitFor(() => observed?.id === fixture.eventId);

      assertEquals(observed?.context.mode, "ephemeral");
      assertEquals(observed?.context.group, undefined);
      assertEquals(
        matchingConsumers(await jsRuntime.listTrellisJetStreamConsumers())
          .length,
        0,
      );
    } finally {
      controller.abort();
      await service.stop();
    }
  },
});

function matchingConsumers(consumers: readonly ConsumerInfo[]): ConsumerInfo[] {
  return consumers.filter((consumer) =>
    consumerFilterSubjects(consumer).includes(fixture.sourcePingedFilterSubject)
  );
}

function consumerFilterSubjects(consumer: ConsumerInfo): string[] {
  return [
    ...((consumer.config.filter_subjects as string[] | undefined) ?? []),
    ...(consumer.config.filter_subject ? [consumer.config.filter_subject] : []),
  ];
}
