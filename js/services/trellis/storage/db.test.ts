import { assertEquals, assertMatch } from "@std/assert";

import { contracts } from "./schema.ts";
import { initializeTrellisStorageSchema, openTrellisStorageDb } from "./db.ts";

Deno.test("trellis storage opens file-backed SQLite and persists contracts", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-storage-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);

    const contract = {
      id: "graph@v1",
      displayName: "Graph",
      description: "Graph test contract",
      namespaces: ["graph"],
    };
    const analysisSummary = {
      namespaces: ["graph"],
      rpcMethods: 1,
      events: 1,
      natsPublish: 1,
      natsSubscribe: 1,
      kvResources: 1,
      storeResources: 0,
      jobsQueues: 0,
    };
    const analysis = {
      namespaces: ["graph"],
      rpc: {
        methods: [{
          key: "Graph.query",
          subject: "rpc.v1.Graph.query",
          wildcardSubject: "rpc.v1.Graph.query",
          callerCapabilities: ["graph.query"],
        }],
      },
      events: {
        events: [{
          key: "Graph.updated",
          subject: "events.v1.Graph.updated",
          wildcardSubject: "events.v1.Graph.updated",
          publishCapabilities: ["graph.publish"],
          subscribeCapabilities: ["graph.subscribe"],
        }],
      },
      nats: {
        publish: [{
          kind: "event",
          subject: "events.v1.Graph.updated",
          wildcardSubject: "events.v1.Graph.updated",
          requiredCapabilities: ["graph.publish"],
        }],
        subscribe: [{
          kind: "rpc",
          subject: "rpc.v1.Graph.query",
          wildcardSubject: "rpc.v1.Graph.query",
          requiredCapabilities: ["graph.query"],
        }],
      },
      resources: {
        kv: [{
          alias: "graph-cache",
          purpose: "Cache graph query results",
          required: true,
          history: 1,
          ttlMs: 86_400_000,
        }],
        store: [],
        jobs: [],
      },
    };
    const resources = {
      kv: {
        "graph-cache": {
          bucket: "graph-cache",
        },
      },
    };

    await storage.db.transaction(async (tx) => {
      await tx.insert(contracts).values({
        digest: "sha256-test",
        contractId: contract.id,
        displayName: contract.displayName,
        description: contract.description,
        installedAt: "2026-04-26T00:00:00.000Z",
        contract: JSON.stringify(contract),
        analysisSummary: JSON.stringify(analysisSummary),
        analysis: JSON.stringify(analysis),
        resources: JSON.stringify(resources),
      });
    });

    const rows = await storage.db.select().from(contracts);

    assertEquals(rows.length, 1);
    assertMatch(rows[0].id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assertEquals(rows[0], {
      id: rows[0].id,
      digest: "sha256-test",
      contractId: "graph@v1",
      displayName: "Graph",
      description: "Graph test contract",
      installedAt: "2026-04-26T00:00:00.000Z",
      contract: JSON.stringify(contract),
      resources: JSON.stringify(resources),
      analysisSummary: JSON.stringify(analysisSummary),
      analysis: JSON.stringify(analysis),
    });
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});
