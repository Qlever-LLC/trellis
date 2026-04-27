import { assertEquals } from "@std/assert";
import {
  AsyncResult,
  isErr,
  Result,
  UnexpectedError,
} from "@qlever-llc/result";
import { ensureBoundUserSession } from "./bind.ts";
import type { Connection, Session } from "../../state/schemas.ts";

function matchFilter(filter: string, key: string): boolean {
  const f = filter.split(".");
  const k = key.split(".");

  if (f.length === 1 && f[0] === ">") return true;

  for (let i = 0; i < f.length; i++) {
    const ft = f[i];
    if (ft === ">") {
      if (i === f.length - 1) return true;
      continue;
    }
    if (ft === "*") continue;
    if (k[i] !== ft) return false;
  }

  return k.length === f.length;
}

class InMemoryKV<V> {
  #store = new Map<string, V>();

  seed(key: string, value: V): void {
    this.#store.set(key, value);
  }

  has(key: string): boolean {
    return this.#store.has(key);
  }

  getValue(key: string): V | undefined {
    return this.#store.get(key);
  }

  entries(): Array<[string, V]> {
    return [...this.#store.entries()];
  }

  keys(filter: string | string[]) {
    const filters = Array.isArray(filter) ? filter : [filter];
    async function* iter(store: Map<string, V>) {
      for (const key of store.keys()) {
        if (filters.some((f) => matchFilter(f, key))) yield key;
      }
    }
    return AsyncResult.lift(Result.ok(iter(this.#store)));
  }

  get(key: string) {
    const v = this.#store.get(key);
    if (v === undefined) {
      return AsyncResult.lift(
        Result.err(new UnexpectedError({ context: { key } })),
      );
    }
    return AsyncResult.lift(Result.ok({ value: v }));
  }

  create(key: string, value: V) {
    if (this.#store.has(key)) {
      return AsyncResult.lift(
        Result.err(new UnexpectedError({ context: { key, reason: "exists" } })),
      );
    }
    this.#store.set(key, value);
    return AsyncResult.lift(Result.ok(undefined));
  }

  put(key: string, value: V) {
    this.#store.set(key, value);
    return AsyncResult.lift(Result.ok(undefined));
  }

  delete(key: string) {
    this.#store.delete(key);
    return AsyncResult.lift(Result.ok(undefined));
  }
}

function sessionStorageFromKV(kv: InMemoryKV<Session>) {
  return {
    async listEntriesBySessionKey(sessionKey: string) {
      const prefix = `${sessionKey}.`;
      return [...kv.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, session]) => ({
          sessionKey,
          trellisId: key.slice(prefix.length),
          session,
        }));
    },
    async get(sessionKey: string, trellisId: string) {
      const entries = await this.listEntriesBySessionKey(sessionKey);
      return entries.find((entry) => entry.trellisId === trellisId)?.session;
    },
    async put(sessionKey: string, session: Session) {
      for (const entry of await this.listEntriesBySessionKey(sessionKey)) {
        kv.delete(`${entry.sessionKey}.${entry.trellisId}`);
      }
      const trellisId = session.type === "device"
        ? session.instanceId
        : session.trellisId;
      kv.seed(`${sessionKey}.${trellisId}`, session);
    },
    async delete(sessionKey: string, trellisId: string) {
      kv.delete(`${sessionKey}.${trellisId}`);
    },
  };
}

function userSessionFields() {
  return {
    participantKind: "app" as const,
    contractDigest: "digest",
    contractId: "trellis.console@v1",
    contractDisplayName: "Trellis Console",
    contractDescription: "Admin app",
    app: {
      contractId: "trellis.console@v1",
      origin: "https://app.example.com",
    },
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: ["rpc.v1.Auth.ListServices"],
    delegatedSubscribeSubjects: ["events.v1.Auth.Connect"],
  };
}

Deno.test("ensureBoundUserSession creates a new session when none exists", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();

  const now = new Date("2026-01-01T00:00:00.000Z");
  const res = await ensureBoundUserSession({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    kick: async () => {},
    now,
    sessionKey: "sk",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "a@example.com",
    name: "Alice",
    ...userSessionFields(),
  });

  const v = res.take();
  if (isErr(v)) throw v.error;

  assertEquals(v.createdAt.toISOString(), now.toISOString());
  assertEquals(sessionKV.has("sk.tid"), true);
});

Deno.test("ensureBoundUserSession recovers when the session already exists for the same identity", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();

  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  sessionKV.seed("sk.tid", {
    type: "user",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "old@example.com",
    name: "Old",
    ...userSessionFields(),
    createdAt,
    lastAuth: createdAt,
  });

  const now = new Date("2026-01-02T00:00:00.000Z");
  const res = await ensureBoundUserSession({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    kick: async () => {},
    now,
    sessionKey: "sk",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "new@example.com",
    name: "Alice",
    ...userSessionFields(),
  });

  const v = res.take();
  if (isErr(v)) throw v.error;

  assertEquals(v.createdAt.toISOString(), createdAt.toISOString());
  const updated = sessionKV.getValue("sk.tid");
  if (!updated || updated.type !== "user") {
    throw new Error("expected updated session");
  }
  assertEquals(updated.createdAt.toISOString(), createdAt.toISOString());
  assertEquals(updated.lastAuth.toISOString(), now.toISOString());
  assertEquals(updated.email, "new@example.com");
  assertEquals(updated.name, "Alice");
  assertEquals(updated.app, {
    contractId: "trellis.console@v1",
    origin: "https://app.example.com",
  });
});

Deno.test("ensureBoundUserSession kicks connections and replaces session when bound to a different identity", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();

  sessionKV.seed("sk.other", {
    type: "user",
    trellisId: "other",
    origin: "github",
    id: "999",
    email: "x@example.com",
    name: "X",
    ...userSessionFields(),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:00:00.000Z"),
  });
  connectionsKV.seed("sk.other.nk1", {
    serverId: "srv1",
    clientId: 1,
    connectedAt: new Date(),
  });
  connectionsKV.seed("sk.other.nk2", {
    serverId: "srv2",
    clientId: 2,
    connectedAt: new Date(),
  });
  connectionsKV.seed("sk2.unrelated.nk3", {
    serverId: "srv3",
    clientId: 3,
    connectedAt: new Date(),
  });

  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const now = new Date("2026-01-02T00:00:00.000Z");

  const res = await ensureBoundUserSession({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    now,
    sessionKey: "sk",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "a@example.com",
    name: "Alice",
    ...userSessionFields(),
  });

  const v = res.take();
  if (isErr(v)) throw v.error;

  assertEquals(kicked, [
    { serverId: "srv1", clientId: 1 },
    { serverId: "srv2", clientId: 2 },
  ]);
  assertEquals(sessionKV.has("sk.other"), false);
  assertEquals(sessionKV.has("sk.tid"), true);
  assertEquals(connectionsKV.has("sk.other.nk1"), false);
  assertEquals(connectionsKV.has("sk.other.nk2"), false);
  assertEquals(connectionsKV.has("sk2.unrelated.nk3"), true);
});

Deno.test("ensureBoundUserSession replaces an existing session key with a mismatched identity", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();

  sessionKV.seed("sk.tid", {
    type: "user",
    trellisId: "tid",
    origin: "github",
    id: "999",
    email: "x@example.com",
    name: "X",
    ...userSessionFields(),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastAuth: new Date("2026-01-01T00:00:00.000Z"),
  });

  const res = await ensureBoundUserSession({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    kick: async () => {},
    now: new Date("2026-01-02T00:00:00.000Z"),
    sessionKey: "sk",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "a@example.com",
    name: "Alice",
    ...userSessionFields(),
  });

  const v = res.take();
  if (isErr(v)) throw v.error;
  const rebound = sessionKV.getValue("sk.tid");
  if (!rebound || rebound.type !== "user") {
    throw new Error("expected rebound session");
  }
  assertEquals(rebound.id, "123");
});

Deno.test("ensureBoundUserSession clears stale app identity when the rebound session omits it", async () => {
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();

  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  sessionKV.seed("sk.tid", {
    type: "user",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "old@example.com",
    name: "Old",
    ...userSessionFields(),
    createdAt,
    lastAuth: createdAt,
  });

  const now = new Date("2026-01-02T00:00:00.000Z");
  const res = await ensureBoundUserSession({
    sessionStorage: sessionStorageFromKV(sessionKV),
    connectionsKV,
    kick: async () => {},
    now,
    sessionKey: "sk",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "new@example.com",
    name: "Alice",
    participantKind: "app",
    contractDigest: "digest",
    contractId: "trellis.console@v1",
    contractDisplayName: "Trellis Console",
    contractDescription: "Admin app",
    delegatedCapabilities: ["admin"],
    delegatedPublishSubjects: ["rpc.v1.Auth.ListServices"],
    delegatedSubscribeSubjects: ["events.v1.Auth.Connect"],
  });

  const v = res.take();
  if (isErr(v)) throw v.error;

  const updated = sessionKV.getValue("sk.tid");
  if (!updated || updated.type !== "user") {
    throw new Error("expected updated session");
  }
  assertEquals("app" in updated, false);
});

Deno.test("ensureBoundUserSession returns storage_error when listing existing sessions fails", async () => {
  const sessionStorage = {
    listEntriesBySessionKey: () => {
      throw new UnexpectedError({ context: { op: "list" } });
    },
    get: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
  const connectionsKV = new InMemoryKV<Connection>();

  const res = await ensureBoundUserSession({
    sessionStorage,
    connectionsKV,
    kick: async () => {},
    now: new Date("2026-01-02T00:00:00.000Z"),
    sessionKey: "sk",
    trellisId: "tid",
    origin: "github",
    id: "123",
    email: "a@example.com",
    name: "Alice",
    ...userSessionFields(),
  });

  const v = res.take();
  assertEquals(isErr(v), true);
  if (!isErr(v)) return;
  assertEquals(v.error.reason, "storage_error");
});
