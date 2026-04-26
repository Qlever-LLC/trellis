import { assertEquals, assertInstanceOf, assertMatch } from "@std/assert";

import {
  initializeTrellisStorageSchema,
  openTrellisStorageDb,
} from "../storage/db.ts";
import type { TrellisStorage } from "../storage/db.ts";
import { contracts } from "../storage/schema.ts";
import type { ContractRecord } from "../state/schemas/catalog_state.ts";
import { SqlContractStorageRepository } from "./storage.ts";

async function withRepository(
  test: (
    repo: SqlContractStorageRepository,
    storage: TrellisStorage,
  ) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-contract-storage-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);
    await test(new SqlContractStorageRepository(storage.db), storage);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
}

function makeRecord(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return {
    digest: "sha256-test",
    id: "graph@v1",
    displayName: "Graph",
    description: "Graph test contract",
    sessionKey: "service-session",
    installedAt: new Date("2026-04-26T00:00:00.000Z"),
    contract: JSON.stringify({
      id: "graph@v1",
      displayName: "Graph",
      description: "Graph test contract",
      namespaces: ["graph"],
    }),
    resources: {
      kv: {
        cache: {
          purpose: "Cache graph query results",
          schema: { schema: "GraphCacheEntry" },
          required: true,
          history: 1,
          ttlMs: 86_400_000,
        },
      },
    },
    analysisSummary: {
      namespaces: ["graph"],
      rpcMethods: 1,
      events: 1,
      natsPublish: 1,
      natsSubscribe: 1,
      kvResources: 1,
      streamResources: 0,
      jobsQueues: 0,
    },
    analysis: {
      namespaces: ["graph"],
      rpc: {
        methods: [{
          key: "Graph.Query",
          subject: "rpc.v1.Graph.Query",
          wildcardSubject: "rpc.v1.Graph.Query",
          callerCapabilities: ["graph.query"],
        }],
      },
      events: {
        events: [{
          key: "Graph.Updated",
          subject: "events.v1.Graph.Updated",
          wildcardSubject: "events.v1.Graph.Updated",
          publishCapabilities: ["graph.publish"],
          subscribeCapabilities: ["graph.subscribe"],
        }],
      },
      nats: {
        publish: [{
          kind: "event",
          subject: "events.v1.Graph.Updated",
          wildcardSubject: "events.v1.Graph.Updated",
          requiredCapabilities: ["graph.publish"],
        }],
        subscribe: [{
          kind: "rpc",
          subject: "rpc.v1.Graph.Query",
          wildcardSubject: "rpc.v1.Graph.Query",
          requiredCapabilities: ["graph.query"],
        }],
      },
      resources: {
        kv: [{
          alias: "cache",
          purpose: "Cache graph query results",
          required: true,
          history: 1,
          ttlMs: 86_400_000,
        }],
        store: [],
        streams: [],
        jobs: [],
      },
    },
    ...overrides,
  };
}

Deno.test("contract storage upserts and gets records by digest", async () => {
  await withRepository(async (repo, storage) => {
    const first = makeRecord();
    await repo.put(first);

    const stored = await repo.get(first.digest);
    assertEquals(stored, first);
    assertInstanceOf(stored?.installedAt, Date);
    assertEquals(await repo.has(first.digest), true);
    assertEquals(await repo.has("missing"), false);

    const [row] = await storage.db.select().from(contracts);
    assertMatch(row.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(row.contractId, first.id);

    const updated = makeRecord({
      displayName: "Graph API",
      description: "Updated graph test contract",
      sessionKey: undefined,
      installedAt: new Date("2026-04-26T01:00:00.000Z"),
    });
    await repo.put(updated);

    assertEquals(await repo.get(updated.digest), updated);
  });
});

Deno.test("contract storage lists all records in digest order", async () => {
  await withRepository(async (repo) => {
    const second = makeRecord({ digest: "sha256-b", id: "b@v1" });
    const first = makeRecord({ digest: "sha256-a", id: "a@v1" });
    await repo.put(second);
    await repo.put(first);

    assertEquals(await repo.list(), [first, second]);
  });
});

Deno.test("contract storage round-trips absent optional JSON fields", async () => {
  await withRepository(async (repo) => {
    const record = makeRecord({
      digest: "sha256-minimal",
      resources: undefined,
      analysisSummary: undefined,
      analysis: undefined,
    });
    await repo.put(record);

    assertEquals(await repo.get(record.digest), record);
  });
});
