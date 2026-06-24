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
  "event-consumers.transient-missing-consumer-retries-after-reconcile" as const;
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
    const before = matchingConsumers(
      await jsRuntime.listTrellisJetStreamConsumers(),
    );
    assertEquals(before.length, 1);
    const durableName = consumerName(before[0]);
    assertEquals(
      await jsRuntime.deleteJetStreamConsumer("trellis", durableName),
      true,
    );
    await runtime.waitFor(async () =>
      matchingConsumers(await jsRuntime.listTrellisJetStreamConsumers())
        .length === 0
    );

    const consumer = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.dependencyConsumerContract,
      name: fixture.consumerName,
      sessionKeySeed: consumerKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const controller = new AbortController();
    let observed: string | undefined;

    try {
      await consumer.event.source.pinged.listen(
        (event) => {
          observed = event.id;
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: controller.signal },
      ).orThrow();

      await runtime.deployments.reconcile("test");
      await runtime.deployments.waitReady("test");
      await runtime.waitFor(async () =>
        matchingConsumers(await jsRuntime.listTrellisJetStreamConsumers())
          .length === 1
      );

      await publisher.event.source.pinged.publish({
        id: fixture.eventId,
        value: "recovered",
      }).orThrow();
      await runtime.waitFor(() => observed === fixture.eventId);
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
