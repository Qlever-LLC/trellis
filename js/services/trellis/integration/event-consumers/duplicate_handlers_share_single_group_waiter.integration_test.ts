import { assertEquals } from "@std/assert";
import type { ConsumerInfo } from "@nats-io/jetstream";
import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import {
  liveTrellisTest,
  requireJetStreamConsumerRuntime,
  runtimeScopeForCase,
} from "../_support/runtime.ts";
import { createEventConsumersFixture } from "./_fixture.ts";

const CASE_ID =
  "event-consumers.duplicate-handlers-share-single-group-waiter" as const;
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
    const observed: string[] = [];

    try {
      await consumer.event.source.pinged.listen(
        (event) => {
          observed.push(`first:${event.id}`);
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: controller.signal },
      ).orThrow();
      await consumer.event.source.pinged.listen(
        (event) => {
          observed.push(`second:${event.id}`);
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: controller.signal },
      ).orThrow();

      await runtime.waitFor(async () => {
        const info = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return info !== undefined && consumerWaitingCount(info) === 1;
      });

      await publisher.event.source.pinged.publish({
        id: fixture.eventId,
        value: "duplicate",
      }).orThrow();
      await runtime.waitFor(() =>
        observed.includes(`first:${fixture.eventId}`) &&
        observed.includes(`second:${fixture.eventId}`)
      );
      assertEquals(observed.toSorted(), [
        `first:${fixture.eventId}`,
        `second:${fixture.eventId}`,
      ]);
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

function consumerWaitingCount(consumer: ConsumerInfo): number {
  const record = consumer as ConsumerInfo & { num_waiting?: number };
  return record.num_waiting ?? 0;
}
