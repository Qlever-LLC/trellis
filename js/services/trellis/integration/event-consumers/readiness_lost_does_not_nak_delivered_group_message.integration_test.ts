import { assertEquals } from "@std/assert";
import type { ConsumerInfo } from "@nats-io/jetstream";
import { Result } from "@qlever-llc/trellis";
import type { TrellisDurableEventConsumerBeforeReadinessCheckHook } from "../../../../packages/trellis/trellis.ts";
import { connectTrellisServiceWithRuntimeDeps } from "../../../../packages/trellis/server/service.ts";
import {
  liveTrellisTest,
  requireJetStreamConsumerRuntime,
  runtimeScopeForCase,
} from "../_support/runtime.ts";
import { createEventConsumersFixture } from "./_fixture.ts";

const CASE_ID =
  "event-consumers.readiness-lost-does-not-nak-delivered-group-message" as const;
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
    const key = await runtime.registerService({
      name: fixture.consumerName,
      contract: fixture.groupedDependencyConsumerContract,
    });
    const pingController = new AbortController();
    const pongController = new AbortController();
    let observedPing: string | undefined;
    let observedPong: string | undefined;
    let hookObserved = false;
    let ackObserver:
      | Awaited<ReturnType<typeof jsRuntime.startJetStreamAckObserver>>
      | undefined;
    const readinessHook: TrellisDurableEventConsumerBeforeReadinessCheckHook = (
      { group, subject },
    ) => {
      if (group !== "paired" || subject !== fixture.sourcePongedFilterSubject) {
        return;
      }
      hookObserved = true;
      pongController.abort();
    };
    const service = await connectTrellisServiceWithRuntimeDeps({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.groupedDependencyConsumerContract,
      name: fixture.consumerName,
      sessionKeySeed: key.seed,
      telemetry: false,
      server: { log: false },
    }, {
      durableEventConsumerBeforeReadinessCheck: readinessHook,
    }).orThrow();

    try {
      ackObserver = await jsRuntime.startJetStreamAckObserver();
      await service.event.source.pinged.listen(
        (event) => {
          observedPing = event.id;
          return Result.ok(undefined);
        },
        {},
        { group: "paired", signal: pingController.signal },
      ).orThrow();
      await service.event.source.ponged.listen(
        (event) => {
          observedPong = event.id;
          return Result.ok(undefined);
        },
        {},
        { group: "paired", signal: pongController.signal },
      ).orThrow();

      const consumer = await runtime.waitFor(async () => {
        const current = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return current !== undefined && consumerWaitingCount(current) > 0
          ? current
          : false;
      });

      await publisher.event.source.ponged.publish({
        id: fixture.eventId,
        value: "readiness-lost",
      }).orThrow();
      await runtime.waitFor(() => hookObserved);

      await runtime.waitFor(async () => {
        const current = matchingConsumers(
          await jsRuntime.listTrellisJetStreamConsumers(),
        )[0];
        return current !== undefined &&
            current.name === consumer.name &&
            consumerAckPendingCount(current) === 1 &&
            consumerWaitingCount(current) === 0
          ? current
          : false;
      });

      const ackFrames = ackObserver.frames().filter((frame) =>
        frame.subject.includes(consumer.name)
      );
      assertEquals(ackObserver.errors(), []);
      assertEquals(ackFrames.some((frame) => frame.payload === "-NAK"), false);
      assertEquals(observedPing, undefined);
      assertEquals(observedPong, undefined);
    } finally {
      pingController.abort();
      pongController.abort();
      try {
        await ackObserver?.stop();
      } finally {
        await service.stop();
      }
    }
  },
});

function matchingConsumers(consumers: readonly ConsumerInfo[]): ConsumerInfo[] {
  return consumers.filter((consumer) => {
    const subjects = consumerFilterSubjects(consumer);
    return subjects.includes(fixture.sourcePingedFilterSubject) &&
      subjects.includes(fixture.sourcePongedFilterSubject);
  });
}

function consumerFilterSubjects(consumer: ConsumerInfo): string[] {
  return [
    ...((consumer.config.filter_subjects as string[] | undefined) ?? []),
    ...(consumer.config.filter_subject ? [consumer.config.filter_subject] : []),
  ];
}

function consumerAckPendingCount(consumer: ConsumerInfo): number {
  const record = consumer as ConsumerInfo & { num_ack_pending?: number };
  return record.num_ack_pending ?? 0;
}

function consumerWaitingCount(consumer: ConsumerInfo): number {
  const record = consumer as ConsumerInfo & { num_waiting?: number };
  return record.num_waiting ?? 0;
}
