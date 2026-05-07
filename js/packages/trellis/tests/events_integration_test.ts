import { connect } from "@nats-io/transport-deno";
import { assertEquals } from "@std/assert";
import { Type } from "typebox";
import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { err, ok, UnexpectedError } from "../index.ts";
import { NatsTest } from "../testing/nats.ts";
import type { TrellisAuth } from "../trellis.ts";

const RUN_NATS_TESTS = Deno.env.get("TRELLIS_TEST_NATS") === "1";

function base64urlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = data.buffer;
  if (buffer instanceof ArrayBuffer) {
    return buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function createTestAuth(): Promise<TrellisAuth> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const rawPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  return {
    sessionKey: base64urlEncode(rawPublicKey),
    sign: async (data: Uint8Array) => {
      const signature = await crypto.subtle.sign(
        { name: "Ed25519" },
        keyPair.privateKey,
        toArrayBuffer(data),
      );
      return new Uint8Array(signature);
    },
  };
}

function startPermissiveAuthResponder(
  nc: Awaited<ReturnType<typeof NatsTest.start>>["nc"],
): void {
  const sub = nc.subscribe("rpc.v1.Auth.ValidateRequest");
  void (async () => {
    for await (const msg of sub) {
      const input = msg.json() as { sessionKey: string };
      msg.respond(JSON.stringify({
        allowed: true,
        inboxPrefix: `_INBOX.${input.sessionKey.slice(0, 16)}`,
        caller: {
          type: "user",
          participantKind: "app",
          id: "auth0|feed-user",
          trellisId: "tid_feed_user",
          origin: "test",
          active: true,
          name: "Feed User",
          email: "feed@example.com",
          capabilities: ["devices:read"],
        },
      }));
    }
  })();
}

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

async function firstAsyncIterableValue<T>(
  stream: AsyncIterable<T>,
): Promise<T> {
  for await (const value of stream) return value;
  throw new Error("Expected async iterable to yield a value");
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
        FeedInput: Type.Object({ deviceId: Type.String() }),
      } as const;

      const contract = defineServiceContract(
        { schemas },
        (ref) => ({
          id: "trellis.events.test@v1",
          displayName: "Events Integration Test",
          description:
            "Exercise event publishing and subscription flows in tests.",
          uses: {
            auth: auth.use({ rpc: { call: ["Auth.ValidateRequest"] } }),
          },
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
          feeds: {
            "Device.Events": {
              version: "v1",
              input: ref.schema("FeedInput"),
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

      await t.step(
        "ephemeral event subscription receives new events and stops on abort",
        async () => {
          const subNc = await connect({ servers: `localhost:${info.port}` });
          const subscriber = createClient(
            contract,
            subNc,
            { sessionKey: "subscriber", sign: () => new Uint8Array(64) },
            { name: "sub-ephemeral" },
          );

          const controller = new AbortController();
          const received: string[] = [];

          const subResult = await subscriber.event(
            "Test.Ack",
            {},
            (m) => {
              received.push((m as { foo: string }).foo);
              return ok(undefined);
            },
            { mode: "ephemeral", replay: "new", signal: controller.signal },
          );
          assertEquals(subResult.isOk(), true);

          const firstPublish = await publisher.publish("Test.Ack", {
            foo: "first",
          });
          assertEquals(firstPublish.isOk(), true);
          await waitFor(() => received.length === 1, {
            description: "ephemeral event delivery",
          });

          controller.abort();
          await new Promise((r) => setTimeout(r, 100));

          const secondPublish = await publisher.publish("Test.Ack", {
            foo: "second",
          });
          assertEquals(secondPublish.isOk(), true);
          await new Promise((r) => setTimeout(r, 250));
          assertEquals(received, ["first"]);

          await subNc.drain();
        },
      );

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

      await t.step(
        "feed subscribe receives service-emitted frames",
        async () => {
          startPermissiveAuthResponder(nats.nc);
          const serviceNc = await connect({
            servers: `localhost:${info.port}`,
          });
          const clientNc = await connect({ servers: `localhost:${info.port}` });
          const serviceAuth = await createTestAuth();
          const clientAuth = await createTestAuth();
          const service = createClient(
            contract,
            serviceNc,
            serviceAuth,
            { name: "feed-service" },
          );
          const client = createClient(
            contract,
            clientNc,
            clientAuth,
            { name: "feed-client" },
          );

          await service.feed("Device.Events").handle(
            async ({ input, emit }) => {
              await emit({
                header: { id: "feed-1", time: "2026-01-01T00:00:00.000Z" },
                foo: input.deviceId,
              }).orThrow();
            },
          );

          const stream = await client.feed("Device.Events")
            .input({ deviceId: "device-1" })
            .subscribe()
            .orThrow();

          for await (const event of stream) {
            assertEquals(event.foo, "device-1");
            break;
          }

          await serviceNc.drain();
          await clientNc.drain();
        },
      );

      await t.step(
        "feed handler accepts another request while first stream is active",
        async () => {
          startPermissiveAuthResponder(nats.nc);
          const serviceNc = await connect({
            servers: `localhost:${info.port}`,
          });
          const clientNc1 = await connect({
            servers: `localhost:${info.port}`,
          });
          const clientNc2 = await connect({
            servers: `localhost:${info.port}`,
          });
          const serviceAuth = await createTestAuth();
          const clientAuth1 = await createTestAuth();
          const clientAuth2 = await createTestAuth();
          const service = createClient(
            contract,
            serviceNc,
            serviceAuth,
            { name: "feed-service-concurrent" },
          );
          const client1 = createClient(
            contract,
            clientNc1,
            clientAuth1,
            { name: "feed-client-concurrent-1", timeout: 500 },
          );
          const client2 = createClient(
            contract,
            clientNc2,
            clientAuth2,
            { name: "feed-client-concurrent-2", timeout: 500 },
          );

          let releaseFirst: (() => void) | undefined;
          const firstRequestHeld = new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });

          await service.feed("Device.Events").handle(
            async ({ input, emit }) => {
              await emit({
                header: {
                  id: `feed-${input.deviceId}`,
                  time: "2026-01-01T00:00:00.000Z",
                },
                foo: input.deviceId,
              }).orThrow();
              if (input.deviceId === "device-1") await firstRequestHeld;
            },
          );

          const stream1 = await client1.feed("Device.Events")
            .input({ deviceId: "device-1" })
            .subscribe()
            .orThrow();
          const first = await firstAsyncIterableValue(stream1);
          assertEquals(first.foo, "device-1");

          const stream2 = await client2.feed("Device.Events")
            .input({ deviceId: "device-2" })
            .subscribe()
            .orThrow();
          const second = await firstAsyncIterableValue(stream2);
          assertEquals(second.foo, "device-2");

          releaseFirst?.();
          await serviceNc.drain();
          await clientNc1.drain();
          await clientNc2.drain();
        },
      );
    } finally {
      await pubNc.drain();
    }
  },
});
