import { assert, assertStringIncludes } from "@std/assert";
import { isErr } from "@qlever-llc/result";
import type { NatsConnection } from "@nats-io/nats-core";

import { Trellis, type TrellisAuth } from "../trellis.ts";

function createMockAuth(token = "test-token"): TrellisAuth {
  return {
    sessionKey: token,
    sign: () => new Uint8Array(64),
  };
}

function createMockNatsConnection(): NatsConnection {
  const closed: NatsConnection["closed"] = async () => undefined;
  const close: NatsConnection["close"] = async () => {};
  const publish: NatsConnection["publish"] = () => {};
  const publishMessage: NatsConnection["publishMessage"] = () => {};
  const respondMessage: NatsConnection["respondMessage"] = () => false;
  const subscribe: NatsConnection["subscribe"] = () => {
    throw new Error("subscribe should not be called in this test");
  };
  const request: NatsConnection["request"] = async () => {
    throw new Error("request should not be called in this test");
  };
  const requestMany: NatsConnection["requestMany"] = async () => {
    throw new Error("requestMany should not be called in this test");
  };
  const flush: NatsConnection["flush"] = async () => {};
  const drain: NatsConnection["drain"] = async () => {};
  const isClosed: NatsConnection["isClosed"] = () => false;
  const isDraining: NatsConnection["isDraining"] = () => false;
  const getServer: NatsConnection["getServer"] = () => "nats://127.0.0.1:4222";
  const status: NatsConnection["status"] = () => ({
    async *[Symbol.asyncIterator]() {},
  });
  const stats: NatsConnection["stats"] = () => ({
    inBytes: 0,
    outBytes: 0,
    inMsgs: 0,
    outMsgs: 0,
  });
  const rtt: NatsConnection["rtt"] = async () => 0;
  const reconnect: NatsConnection["reconnect"] = async () => {};

  const connection: NatsConnection & { options: { inboxPrefix: string } } = {
    options: {
      inboxPrefix: "_INBOX",
    },
    closed,
    close,
    publish,
    publishMessage,
    respondMessage,
    subscribe,
    request,
    requestMany,
    flush,
    drain,
    isClosed,
    isDraining,
    getServer,
    status,
    stats,
    rtt,
    reconnect,
  };

  return connection;
}

Deno.test("Trellis explains how to provide an API surface when none was configured", async () => {
  const trellis = new Trellis("test-client", createMockNatsConnection(), createMockAuth());
  const result = await trellis.request("Auth.Me", {});
  const value = result.take();

  assert(isErr(value));
  assert(value.error.cause instanceof Error);
  assertStringIncludes(value.error.cause.message, "No API surface was provided");
  assertStringIncludes(value.error.cause.message, "createCoreClient(...)");
});
