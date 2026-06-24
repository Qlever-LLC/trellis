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
  "event-consumers.bound-dependency-consumer-uses-trellis-provisioned-consumer-only" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const jsRuntime = requireJetStreamConsumerRuntime(runtime);
    await runtime.contracts.approve({ contract: fixture.sourceContract });
    const consumerKey = await runtime.registerService({
      name: fixture.consumerName,
      contract: fixture.dependencyConsumerContract,
    });
    const before = matchingConsumers(
      await jsRuntime.listTrellisJetStreamConsumers(),
    );
    assertEquals(before.length, 1);

    const publisher = await runtime.connectClient({
      name: fixture.publisherName,
      contract: fixture.sourcePublisherContract,
    });
    const consumer = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.dependencyConsumerContract,
      name: fixture.consumerName,
      sessionKeySeed: consumerKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const controller = new AbortController();
    let observed: { id: string; context: EventListenerContext } | undefined;

    try {
      await consumer.event.source.pinged.listen(
        (event, context) => {
          observed = { id: event.id, context };
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: controller.signal },
      ).orThrow();
      const after = matchingConsumers(
        await jsRuntime.listTrellisJetStreamConsumers(),
      );
      assertEquals(after.length, 1);
      assertEquals(consumerName(after[0]), consumerName(before[0]));

      await publisher.event.source.pinged.publish({
        id: fixture.eventId,
        value: "bound",
      }).orThrow();
      await runtime.waitFor(() => observed?.id === fixture.eventId);
      assertEquals(observed?.context.mode, "durable");
      assertEquals(observed?.context.group, "ingest");
    } finally {
      controller.abort();
      await consumer.stop();
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

function consumerName(consumer: ConsumerInfo): string {
  return consumer.config.durable_name ?? consumer.name;
}
