import { connect } from "@nats-io/transport-deno";
import { assertEquals } from "@std/assert";
import { Type } from "typebox";
import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { err, ok, UnexpectedError } from "../index.ts";
import { NatsTest } from "../testing/nats.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

async function waitFor(
  condition: () => boolean,
  opts: { description: string; timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 25;
  const start = Date.now();

  while (true) {
    if (condition()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${opts.description}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

Deno.test({
  name: "NATS Events Integration",
  ignore: !RUN_NATS_TESTS,
  async fn(t) {
    await using nats = await NatsTest.start();

    const info = nats.nc.info!;
    const pubNc = await connect({ servers: `localhost:${info.port}` });

    try {
      const eventSchema = Type.Object({
        header: Type.Object({
          id: Type.String(),
          time: Type.String(),
        }),
        foo: Type.String(),
      });
      const schemas = {
        EventPayload: eventSchema,
      } as const;

      const contract = defineServiceContract(
        { schemas },
        (ref) => ({
          id: "trellis.events.test@v1",
          displayName: "Events Integration Test",
          description:
            "Exercise event publishing and subscription flows in tests.",
          events: {
            "Test.Ack": {
              version: "v1",
              params: ["/foo"] as const,
              event: ref.schema("EventPayload"),
            },
            "Test.Retry": {
              version: "v1",
              params: ["/foo"] as const,
              event: ref.schema("EventPayload"),
            },
            "Test.Invalid": {
              version: "v1",
              event: ref.schema("EventPayload"),
            },
          },
        }),
      );

      const publisher = createClient(
        contract,
        pubNc,
        { sessionKey: "publisher", sign: () => new Uint8Array(64) },
        { name: "publisher" },
      );

      await t.step("consumer already exists path works", async () => {
        const subNc1 = await connect({ servers: `localhost:${info.port}` });
        const subscriber1 = createClient(
          contract,
          subNc1,
          { sessionKey: "subscriber", sign: () => new Uint8Array(64) },
          { name: "sub-exists" },
        );
        const r1 = await subscriber1.event("Test.Ack", {}, () => ok(undefined));
        assertEquals(r1.isOk(), true);
        await subNc1.drain();

        const subNc2 = await connect({ servers: `localhost:${info.port}` });
        const subscriber2 = createClient(
          contract,
          subNc2,
          { sessionKey: "subscriber", sign: () => new Uint8Array(64) },
          { name: "sub-exists" },
        );
        const r2 = await subscriber2.event("Test.Ack", {}, () => ok(undefined));
        assertEquals(r2.isOk(), true);
        await subNc2.drain();
      });

      await t.step("publish() -> event() receives and acks", async () => {
        const subNc = await connect({ servers: `localhost:${info.port}` });
        const subscriber = createClient(
          contract,
          subNc,
          { sessionKey: "subscriber", sign: () => new Uint8Array(64) },
          { name: "sub-ack" },
        );

        const received: Array<
          { header: { id: string; time: string }; foo: string }
        > = [];

        const subResult = await subscriber.event("Test.Ack", {}, (m) => {
          received.push(m as typeof received[number]);
          return ok(undefined);
        });
        assertEquals(subResult.isOk(), true);

        const pubResult = await publisher.publish("Test.Ack", { foo: "a.b" });
        assertEquals(pubResult.isOk(), true);

        await waitFor(() => received.length === 1, {
          description: "event delivery",
        });
        assertEquals(received[0].foo, "a.b");
        assertEquals(typeof received[0].header.id, "string");
        assertEquals(typeof received[0].header.time, "string");

        await subNc.drain();
      });

      await t.step("handler error naks and redelivers", async () => {
        const subNc = await connect({ servers: `localhost:${info.port}` });
        const subscriber = createClient(
          contract,
          subNc,
          { sessionKey: "subscriber", sign: () => new Uint8Array(64) },
          { name: "sub-retry" },
        );

        let attempts = 0;

        const subResult = await subscriber.event("Test.Retry", {}, (m) => {
          void m;
          attempts += 1;
          if (attempts === 1) {
            return err(new UnexpectedError({ cause: new Error("fail once") }));
          }
          return ok(undefined);
        });
        assertEquals(subResult.isOk(), true);

        const pubResult = await publisher.publish("Test.Retry", {
          foo: "retry",
        });
        assertEquals(pubResult.isOk(), true);

        await waitFor(() => attempts >= 2, {
          description: "event redelivery after nak",
        });
        assertEquals(attempts >= 2, true);

        await subNc.drain();
      });

      await t.step(
        "invalid payload is terminated (no handler call)",
        async () => {
          const subNc = await connect({ servers: `localhost:${info.port}` });
          const subscriber = createClient(
            contract,
            subNc,
            { sessionKey: "subscriber", sign: () => new Uint8Array(64) },
            { name: "sub-invalid" },
          );

          let called = 0;

          const subResult = await subscriber.event("Test.Invalid", {}, () => {
            called += 1;
            return ok(undefined);
          });
          assertEquals(subResult.isOk(), true);

          // Publish an invalid payload directly (bypassing schema encode), ensuring:
          // - JSON parsing succeeds
          // - schema validation fails (missing "foo")
          await pubNc.publish(
            "events.v1.Test.Invalid",
            JSON.stringify({
              header: { id: "x", time: "2026-01-01T00:00:00.000Z" },
            }),
          );

          await new Promise((r) => setTimeout(r, 250));
          assertEquals(called, 0);

          await subNc.drain();
        },
      );
    } finally {
      await pubNc.drain();
    }
  },
});
