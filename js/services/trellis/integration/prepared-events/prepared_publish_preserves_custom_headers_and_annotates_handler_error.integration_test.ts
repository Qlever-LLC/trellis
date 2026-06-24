import { assertEquals } from "@std/assert";
import { AuthError, type EventListenerContext } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import {
  liveTrellisTest,
  requireJetStreamConsumerRuntime,
  runtimeScopeForCase,
} from "../_support/runtime.ts";
import { createEventsFixture } from "../../../../integration/events/_fixture.ts";

const CASE_ID =
  "prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error" as const;
const fixture = createEventsFixture(CASE_ID);
const TRACEPARENT = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
const STATUS = "prepared-status";

liveTrellisTest({
  name:
    "prepared-events.prepared-publish-preserves-custom-headers-and-annotates-handler-error publishes prepared headers into handler error annotation",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const jsRuntime = requireJetStreamConsumerRuntime(runtime);
    const rawObserver = await jsRuntime.startNatsMessageObserver(
      fixture.sourceSubject,
      ["status", "traceparent", "Nats-Msg-Id", "Trellis-Event-Time"],
    );
    const key = await runtime.registerService({
      name: fixture.publisherName,
      contract: fixture.serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.serviceContract,
      name: fixture.publisherName,
      sessionKeySeed: key.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    const controller = new AbortController();
    const thrown = new AuthError({
      reason: "forbidden",
      context: { subject: "events.v1.should-not-leak" },
    });
    let observed:
      | {
        readonly event: {
          readonly id: string;
          readonly value: string;
          readonly header?: string;
        };
        readonly context: EventListenerContext;
      }
      | undefined;

    try {
      await service.event.entity.changed.listen(
        (event, context) => {
          observed = { event, context };
          throw thrown;
        },
        {},
        { mode: "ephemeral", signal: controller.signal },
      ).orThrow();

      const payload = {
        id: fixture.publishedEntityId,
        value: "prepared",
        header: "payload-header-value",
      };
      const prepared = service.event.entity.changed.prepare(payload).orThrow();
      await service.publishPrepared(Object.freeze({
        ...prepared,
        headers: Object.freeze({
          ...prepared.headers,
          status: STATUS,
          traceparent: TRACEPARENT,
        }),
      })).orThrow();

      await runtime.waitFor(() =>
        thrown.toSerializable().context?.event === "Entity.Changed"
      );
      const rawFrame = await runtime.waitFor(() =>
        rawObserver.frames().find((frame) =>
          frame.headers["Nats-Msg-Id"] === prepared.header.id
        )
      );

      assertEquals(rawObserver.errors(), []);
      assertEquals(rawFrame.headers.status, STATUS);
      assertEquals(rawFrame.headers.traceparent, TRACEPARENT);
      assertEquals(
        rawFrame.headers["Trellis-Event-Time"],
        prepared.header.time,
      );
      assertEquals(rawFrame.payload, prepared.encodedPayload);
      assertEquals(observed?.event, payload);
      assertEquals(observed?.context.id, prepared.header.id);
      assertEquals(observed?.context.time.toISOString(), prepared.header.time);
      assertEquals(observed?.context.mode, "ephemeral");

      const serialized = thrown.toSerializable();
      assertEquals(serialized.type, "AuthError");
      assertEquals(serialized.context?.event, "Entity.Changed");
      assertEquals(serialized.context?.service, fixture.publisherName);
      assertEquals(
        serialized.context?.contractId,
        fixture.serviceContract.CONTRACT_ID,
      );
      assertEquals(
        serialized.context?.contractDigest,
        fixture.serviceContract.CONTRACT_DIGEST,
      );
      assertEquals(serialized.traceId, TRACEPARENT.slice(3, 35));
      assertEquals(Object.hasOwn(serialized.context ?? {}, "subject"), false);
    } finally {
      controller.abort();
      try {
        await rawObserver.stop();
      } finally {
        await service.stop();
      }
    }
  },
});
