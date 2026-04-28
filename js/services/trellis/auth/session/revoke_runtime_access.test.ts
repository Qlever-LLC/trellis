import { assertEquals } from "@std/assert";
import { AsyncResult, UnexpectedError } from "@qlever-llc/result";

import { connectionKey } from "./connections.ts";
import { revokeRuntimeAccessForSession } from "./revoke_runtime_access.ts";

class InMemoryConnectionsKV {
  #store = new Map<string, unknown>();

  seed(key: string, value: unknown): void {
    this.#store.set(key, value);
  }

  has(key: string): boolean {
    return this.#store.has(key);
  }

  keys(filter: string): AsyncResult<AsyncIterable<string>, UnexpectedError> {
    async function* iter(store: Map<string, unknown>) {
      const prefix = filter.endsWith(">") ? filter.slice(0, -1) : filter;
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) yield key;
      }
    }
    return AsyncResult.ok(iter(this.#store));
  }

  get(key: string): AsyncResult<unknown, UnexpectedError> {
    if (!this.#store.has(key)) {
      return AsyncResult.err(new UnexpectedError({ context: { key } }));
    }
    return AsyncResult.ok({ value: this.#store.get(key) });
  }

  delete(key: string): AsyncResult<void, UnexpectedError> {
    this.#store.delete(key);
    return AsyncResult.ok(undefined);
  }
}

Deno.test("revokeRuntimeAccessForSession kicks matching connections and deletes the session", async () => {
  const kv = new InMemoryConnectionsKV();
  const matchingKey = connectionKey("sk_1", "scope_1", "user_1");
  const malformedKey = connectionKey("sk_1", "scope_1", "user_2");
  const otherKey = connectionKey("sk_2", "scope_1", "user_3");
  kv.seed(matchingKey, { serverId: "server-1", clientId: 1 });
  kv.seed(malformedKey, { serverId: "server-2" });
  kv.seed(otherKey, { serverId: "server-3", clientId: 3 });
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  let sessionDeleted = false;

  await revokeRuntimeAccessForSession({
    sessionKey: "sk_1",
    connectionsKV: kv,
    kick: (serverId, clientId) => {
      kicked.push({ serverId, clientId });
      return Promise.resolve();
    },
    deleteSession: () => {
      sessionDeleted = true;
      return Promise.resolve();
    },
  });

  assertEquals(kicked, [{ serverId: "server-1", clientId: 1 }]);
  assertEquals(kv.has(matchingKey), false);
  assertEquals(kv.has(malformedKey), false);
  assertEquals(kv.has(otherKey), true);
  assertEquals(sessionDeleted, true);
});
