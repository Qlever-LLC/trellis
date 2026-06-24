import { assertEquals } from "@std/assert";
import type { ConsumerInfo } from "@nats-io/jetstream";
import { Result } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import {
  type JetStreamConsumerRuntime,
  liveTrellisTest,
  requireJetStreamConsumerRuntime,
  runtimeScopeForCase,
} from "../_support/runtime.ts";
import { createEventConsumersFixture } from "./_fixture.ts";

const CASE_ID = "event-consumers.stop-teardown-stops-durable-delivery" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const jsRuntime = requireJetStreamConsumerRuntime(runtime);
    await runtime.contracts.approve({ contract: fixture.sourceContract });
    const publisher = await runtime.connectClient({
      name: fixture.publisherName,
      contract: fixture.sourcePublisherContract,
    });
    const consumerKey = await runtime.registerService({
      name: fixture.consumerName,
      contract: fixture.dependencyConsumerContract,
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
          observed.push(event.id);
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: controller.signal },
      ).orThrow();
      await publisher.event.source.pinged.publish({
        id: fixture.eventId,
        value: "before-stop",
      }).orThrow();
      await runtime.waitFor(() => observed.includes(fixture.eventId));

      controller.abort();
      await consumer.stop();
      await runtime.waitFor(async () => {
        const consumerInfo = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return consumerInfo === undefined ||
          consumerWaitingCount(consumerInfo) === 0;
      });

      await publisher.event.source.pinged.publish({
        id: fixture.secondEventId,
        value: "after-stop",
      }).orThrow();
      await assertNoPostStopDelivery(jsRuntime, observed);
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

async function assertNoPostStopDelivery(
  runtime: JetStreamConsumerRuntime,
  observed: readonly string[],
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    assertEquals(observed, [fixture.eventId]);
    const afterStop = matchingConsumers(
      await runtime.listTrellisJetStreamConsumers(),
    )[0];
    assertEquals(
      afterStop === undefined ? 0 : consumerWaitingCount(afterStop),
      0,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
