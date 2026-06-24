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
  "event-consumers.self-owned-grouped-consumer-waits-for-all-handlers-before-consuming-queued-event" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const jsRuntime = requireJetStreamConsumerRuntime(runtime);
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
    let observedPing: string | undefined;

    try {
      await service.event.self.pinged.listen(
        (event) => {
          observedPing = event.id;
          return Result.ok(undefined);
        },
        {},
        { group: "paired", signal: controller.signal },
      ).orThrow();
      await service.event.self.pinged.publish({
        id: fixture.eventId,
        value: "queued",
      }).orThrow();
      await runtime.waitFor(async () => {
        const consumer = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return consumer === undefined
          ? false
          : consumerPendingCount(consumer) > 0;
      });
      assertEquals(observedPing, undefined);

      await service.event.self.ponged.listen(
        () => Result.ok(undefined),
        {},
        { group: "paired", signal: controller.signal },
      ).orThrow();

      await runtime.waitFor(() => observedPing === fixture.eventId);
    } finally {
      controller.abort();
      await service.stop();
    }
  },
});

function matchingConsumers(consumers: readonly ConsumerInfo[]): ConsumerInfo[] {
  return consumers.filter((consumer) => {
    const subjects = consumerFilterSubjects(consumer);
    return subjects.includes(fixture.selfPingedFilterSubject) &&
      subjects.includes(fixture.selfPongedFilterSubject);
  });
}

function consumerFilterSubjects(consumer: ConsumerInfo): string[] {
  return [
    ...((consumer.config.filter_subjects as string[] | undefined) ?? []),
    ...(consumer.config.filter_subject ? [consumer.config.filter_subject] : []),
  ];
}

function consumerPendingCount(consumer: ConsumerInfo): number {
  const record = consumer as ConsumerInfo & { num_pending?: number };
  return record.num_pending ?? 0;
}
