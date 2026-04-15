import { assert, assertEquals } from "@std/assert";
import { Result, UnexpectedError } from "@qlever-llc/result";

import { createAuthRemoveServiceHandler } from "./remove_service.ts";
import type {
  Connection,
  ContractRecord,
  ServiceRegistryEntry,
  Session,
} from "../state/schemas.ts";

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

  getValue(key: string): V | undefined {
    return this.#store.get(key);
  }

  async get(key: string) {
    const value = this.#store.get(key);
    if (value === undefined) {
      return Result.err(new UnexpectedError({ context: { key } }));
    }
    return Result.ok({ value });
  }

  async put(key: string, value: V) {
    this.#store.set(key, value);
    return Result.ok(undefined);
  }

  async create(key: string, value: V) {
    if (this.#store.has(key)) {
      return Result.err(new UnexpectedError({ context: { key, reason: "exists" } }));
    }
    this.#store.set(key, value);
    return Result.ok(undefined);
  }

  async delete(key: string) {
    this.#store.delete(key);
    return Result.ok(undefined);
  }

  async keys(filter: string) {
    const entries = [...this.#store.keys()].filter((key) => matchFilter(filter, key));
    async function* iter() {
      for (const key of entries) {
        yield key;
      }
    }
    return Result.ok(iter());
  }
}

function serviceEntry(overrides: Partial<ServiceRegistryEntry> = {}): ServiceRegistryEntry {
  return {
    displayName: "Billing",
    active: true,
    capabilities: ["service"],
    namespaces: ["billing"],
    description: "Billing service",
    contractId: "acme.billing@v1",
    contractDigest: "digest-a",
    createdAt: new Date("2026-04-15T00:00:00.000Z"),
    ...overrides,
  };
}

function serviceSession(sessionKey: string): Session {
  return {
    type: "service",
    trellisId: `tid_${sessionKey}`,
    origin: "service",
    id: sessionKey,
    email: `${sessionKey}@trellis.internal`,
    name: `Service ${sessionKey}`,
    createdAt: new Date("2026-04-15T00:00:00.000Z"),
    lastAuth: new Date("2026-04-15T00:00:00.000Z"),
  };
}

function contractRecord(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return {
    digest: "digest-a",
    id: "acme.billing@v1",
    displayName: "Billing",
    description: "Billing service",
    sessionKey: "old-key",
    installedAt: new Date("2026-04-15T00:00:00.000Z"),
    contract: JSON.stringify({
      format: "trellis.contract.v1",
      id: "acme.billing@v1",
      kind: "service",
      displayName: "Billing",
      description: "Billing service",
    }),
    ...overrides,
  };
}

Deno.test("Auth.RemoveService revokes runtime access and reassigns contract linkage", async () => {
  const servicesKV = new InMemoryKV<ServiceRegistryEntry>();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();
  const contractsKV = new InMemoryKV<ContractRecord>();
  const kicked: Array<{ serverId: string; clientId: number }> = [];
  const revoked: Array<{ origin: string; id: string; sessionKey: string; revokedBy: string }> = [];
  let refreshCalls = 0;

  servicesKV.seed("old-key", serviceEntry());
  servicesKV.seed("new-key", serviceEntry({ displayName: "Billing v2" }));
  sessionKV.seed("old-key.tid_old", serviceSession("old-key"));
  connectionsKV.seed("old-key.tid_old.user_nkey", {
    serverId: "srv-a",
    clientId: 42,
    connectedAt: new Date("2026-04-15T00:00:00.000Z"),
  });
  contractsKV.seed("digest-a", contractRecord());

  const handler = createAuthRemoveServiceHandler({
    refreshActiveContracts: async () => {
      refreshCalls += 1;
    },
    kick: async (serverId, clientId) => {
      kicked.push({ serverId, clientId });
    },
    servicesKV,
    sessionKV,
    connectionsKV,
    contractsKV,
    publishSessionRevoked: async (session, sessionKey, revokedBy) => {
      if (session.type === "device") {
        throw new Error("device sessions should not be revoked here");
      }
      revoked.push({
        origin: session.origin,
        id: session.id,
        sessionKey,
        revokedBy,
      });
    },
  });

  const result = await handler(
    { sessionKey: "old-key" },
    { caller: { type: "user", origin: "github", id: "123" } },
  );
  const value = result.take();
  if (Result.isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  assertEquals(servicesKV.getValue("old-key"), undefined);
  assert(sessionKV.getValue("old-key.tid_old") === undefined);
  assert(connectionsKV.getValue("old-key.tid_old.user_nkey") === undefined);
  assertEquals(kicked, [{ serverId: "srv-a", clientId: 42 }]);
  assertEquals(revoked, [{
    origin: "service",
    id: "old-key",
    sessionKey: "old-key",
    revokedBy: "github.123",
  }]);
  assertEquals(contractsKV.getValue("digest-a")?.sessionKey, "new-key");
  assertEquals(refreshCalls, 1);
});

Deno.test("Auth.RemoveService preserves contract history when removing the last service", async () => {
  const servicesKV = new InMemoryKV<ServiceRegistryEntry>();
  const sessionKV = new InMemoryKV<Session>();
  const connectionsKV = new InMemoryKV<Connection>();
  const contractsKV = new InMemoryKV<ContractRecord>();

  servicesKV.seed("old-key", serviceEntry());
  contractsKV.seed("digest-a", contractRecord());

  const handler = createAuthRemoveServiceHandler({
    refreshActiveContracts: async () => {},
    kick: async () => {},
    servicesKV,
    sessionKV,
    connectionsKV,
    contractsKV,
    publishSessionRevoked: async () => {},
  });

  const result = await handler(
    { sessionKey: "old-key" },
    { caller: { type: "user", origin: "github", id: "123" } },
  );
  const value = result.take();
  if (Result.isErr(value)) throw value.error;

  assertEquals(value, { success: true });
  const persisted = contractsKV.getValue("digest-a");
  assert(persisted !== undefined);
  assertEquals(persisted.sessionKey, undefined);
  assertEquals(persisted.digest, "digest-a");
});
