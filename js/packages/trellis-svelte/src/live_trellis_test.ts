import { assertEquals, assertStrictEquals } from "@std/assert";
import { AsyncResult } from "@qlever-llc/result";
import { createLiveObjectProxy } from "./live_trellis.ts";

Deno.test("createLiveObjectProxy resolves properties from the current object", async () => {
  const firstConnection = { id: "first" };
  const secondConnection = { id: "second" };
  let current = {
    natsConnection: firstConnection,
    request(method: string) {
      return AsyncResult.ok(`${method}:first`);
    },
  };

  const proxy = createLiveObjectProxy(() => current);

  assertStrictEquals(proxy.natsConnection, firstConnection);
  assertEquals(await proxy.request("Auth.Me").orThrow(), "Auth.Me:first");

  current = {
    natsConnection: secondConnection,
    request(method: string) {
      return AsyncResult.ok(`${method}:second`);
    },
  };

  assertStrictEquals(proxy.natsConnection, secondConnection);
  assertEquals(await proxy.request("Auth.Me").orThrow(), "Auth.Me:second");
});
