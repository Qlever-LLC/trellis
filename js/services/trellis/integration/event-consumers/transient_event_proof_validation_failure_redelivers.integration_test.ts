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
  "event-consumers.transient-event-proof-validation-failure-redelivers" as const;
const fixture = createEventConsumersFixture(CASE_ID);

liveTrellisTest({
  name: CASE_ID,
  scope: runtimeScopeForCase(CASE_ID),
  runtime: { failOnceHooks: ["auth.events.validate"] },
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
    const ackObserver = await jsRuntime.startJetStreamAckObserver();
    let observed: string | undefined;

    try {
      await consumer.onSourcePinged(
        ({ event }) => {
          observed = event.id;
          return Result.ok(undefined);
        },
        {},
        { group: "ingest", signal: controller.signal },
      ).orThrow();
      const provisionedConsumer = matchingConsumers(
        await jsRuntime.listTrellisJetStreamConsumers(),
      )[0];

      await publisher.publishSourcePinged({
        id: fixture.eventId,
        value: "retry-proof-validation",
      }).orThrow();
      await runtime.waitFor(() => observed === fixture.eventId);
      await runtime.waitFor(() =>
        ackObserver.frames().some((frame) =>
          frame.subject.includes(provisionedConsumer.name) &&
          frame.payload === "+ACK"
        )
      );

      const frames = ackObserver.frames().filter((frame) =>
        frame.subject.includes(provisionedConsumer.name)
      );
      assertEquals(ackObserver.errors(), []);
      assertEquals(frames.some((frame) => frame.payload === "+TERM"), false);
      assertEquals(frames.some((frame) => frame.payload === "-NAK"), false);
      assertEquals(
        frames.filter((frame) => frame.payload === "+ACK").length,
        1,
      );
    } finally {
      controller.abort();
      try {
        await ackObserver.stop();
      } finally {
        await consumer.stop();
      }
    }
  },
});

function matchingConsumers(consumers: readonly ConsumerInfo[]): ConsumerInfo[] {
  return consumers.filter((consumer) => {
    const subjects = [
      ...((consumer.config.filter_subjects as string[] | undefined) ?? []),
      ...(consumer.config.filter_subject
        ? [consumer.config.filter_subject]
        : []),
    ];
    return subjects.includes(fixture.sourcePingedFilterSubject);
  });
}
