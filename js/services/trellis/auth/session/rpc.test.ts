import { assertEquals } from "@std/assert";
import { AsyncResult, isErr, UnexpectedError } from "@qlever-llc/result";
import {
  createAuthHealthHandler,
  createAuthSessionsListHandler,
} from "./rpc.ts";
import type { Session } from "../schemas.ts";

// Retained unit coverage: pure health response shaping and injected logger use.
function matchFilter(filter: string, key: string): boolean {
  const filterParts = filter.split(".");
  const keyParts = key.split(".");

  if (filterParts.length === 1 && filterParts[0] === ">") return true;

  for (let i = 0; i < filterParts.length; i += 1) {
    const part = filterParts[i];
    if (part === ">") return true;
    if (keyParts[i] === undefined) return false;
    if (part !== "*" && part !== keyParts[i]) return false;
  }

  return keyParts.length === filterParts.length;
}

class InMemoryKV<V> {
  #store = new Map<string, V>();

  seed(key: string, value: V): void {
    this.#store.set(key, value);
  }

  keys(filter: string): AsyncResult<AsyncIterable<string>, UnexpectedError> {
    async function* iter(store: Map<string, V>) {
      for (const key of store.keys()) {
        if (matchFilter(filter, key)) yield key;
      }
    }

    return AsyncResult.ok(iter(this.#store));
  }

  get(key: string): AsyncResult<{ value: V }, UnexpectedError> {
    const value = this.#store.get(key);
    if (value === undefined) {
      return AsyncResult.err(new UnexpectedError({ context: { key } }));
    }
    return AsyncResult.ok({ value });
  }

  put(key: string, value: V): AsyncResult<void, UnexpectedError> {
    this.#store.set(key, value);
    return AsyncResult.ok(undefined);
  }

  delete(key: string): AsyncResult<void, UnexpectedError> {
    this.#store.delete(key);
    return AsyncResult.ok(undefined);
  }
}

type CapturedLog = {
  level: "trace" | "warn";
  fields: Record<string, unknown>;
  message: string;
};

function createTestLogger(logs: CapturedLog[] = []) {
  return {
    trace: (fields: Record<string, unknown>, message: string) => {
      logs.push({ level: "trace", fields, message });
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      logs.push({ level: "warn", fields, message });
    },
  };
}

Deno.test("Auth.Health returns the auth control-plane health response", async () => {
  const handler = createAuthHealthHandler({
    logger: createTestLogger(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  const value = (await handler({ context: { sessionKey: "sk_health" } }))
    .take();

  assertEquals(value, {
    status: "healthy",
    service: "trellis",
    timestamp: "2026-01-01T00:00:00.000Z",
    checks: [
      {
        name: "auth-rpc",
        status: "ok",
        summary: "Auth RPC handlers are mounted.",
        latencyMs: 0,
      },
    ],
  });
});

function sessionStorageFromKV(kv: InMemoryKV<Session>) {
  async function entries(filter: string) {
    const iter = await kv.keys(filter).take();
    const result = [] as Array<{
      sessionKey: string;
      principalId: string;
      session: Session;
    }>;
    if (isErr(iter)) return result;
    for await (const key of iter) {
      const entry = await kv.get(key).take();
      if (isErr(entry)) continue;
      const sessionKey = key;
      const session = entry.value;
      const principalId = session.type === "device"
        ? session.instanceId
        : session.type === "user"
        ? session.userId
        : session.trellisId;
      result.push({ sessionKey, principalId, session: entry.value });
    }
    return result;
  }
  return {
    getOneBySessionKey: async (sessionKey: string) => {
      const entry = await kv.get(sessionKey).take();
      return isErr(entry) ? undefined : entry.value;
    },
    listEntries: () => entries(">"),
    listEntriesByUser: async (userId: string) =>
      (await entries(">")).filter((entry) => entry.principalId === userId),
    deleteBySessionKey: async (sessionKey: string) => {
      await kv.delete(sessionKey).take();
    },
  };
}

const TEST_USER_ID = "usr_github_123";

Deno.test("session RPC handlers log through the injected logger", async () => {
  const logs: CapturedLog[] = [];
  const handler = createAuthSessionsListHandler({
    logger: createTestLogger(logs),
    sessionStorage: sessionStorageFromKV(new InMemoryKV<Session>()),
  });

  const result = await handler({ input: { user: TEST_USER_ID } });
  const value = result.take();
  if (isErr(value)) throw value.error;

  assertEquals(logs, [{
    level: "trace",
    fields: { rpc: "Auth.Sessions.List", user: TEST_USER_ID },
    message: "RPC request",
  }]);
});
