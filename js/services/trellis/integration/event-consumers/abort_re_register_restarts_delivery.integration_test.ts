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

const CASE_ID = "event-consumers.abort-re-register-restarts-delivery" as const;
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
    const firstController = new AbortController();
    const secondController = new AbortController();
    const observed: string[] = [];

    try {
      await service.event.self.pinged.listen(
        (event) => {
          observed.push(`first:${event.id}`);
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: firstController.signal },
      ).orThrow();
      await runtime.waitFor(async () => {
        const consumer = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return consumer !== undefined && consumerWaitingCount(consumer) > 0;
      });
      await service.event.self.pinged.publish({
        id: fixture.eventId,
        value: "first",
      }).orThrow();
      await runtime.waitFor(() =>
        observed.includes(`first:${fixture.eventId}`)
      );

      firstController.abort();
      await runtime.waitFor(async () => {
        const consumer = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return consumer === undefined || consumerWaitingCount(consumer) === 0;
      });

      await service.event.self.pinged.publish({
        id: fixture.secondEventId,
        value: "second",
      }).orThrow();
      await runtime.waitFor(async () => {
        const consumer = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return consumer !== undefined && consumerPendingCount(consumer) > 0;
      });
      assertEquals(observed.includes(`first:${fixture.secondEventId}`), false);

      await service.event.self.pinged.listen(
        (event) => {
          observed.push(`second:${event.id}`);
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: secondController.signal },
      ).orThrow();

      await runtime.waitFor(() =>
        observed.includes(`second:${fixture.secondEventId}`)
      );
      assertEquals(observed.includes(`first:${fixture.secondEventId}`), false);
    } finally {
      firstController.abort();
      secondController.abort();
      await service.stop();
    }
  },
});

function matchingConsumers(consumers: readonly ConsumerInfo[]): ConsumerInfo[] {
  return consumers.filter((consumer) => {
    const subjects = consumerFilterSubjects(consumer);
    return subjects.includes(fixture.selfPingedFilterSubject) &&
      !subjects.includes(fixture.selfPongedFilterSubject);
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

function consumerWaitingCount(consumer: ConsumerInfo): number {
  const record = consumer as ConsumerInfo & { num_waiting?: number };
  return record.num_waiting ?? 0;
}
