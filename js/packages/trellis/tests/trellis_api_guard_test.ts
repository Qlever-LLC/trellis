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
  return {
    options: {
      inboxPrefix: "_INBOX",
    },
  } as unknown as NatsConnection;
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
