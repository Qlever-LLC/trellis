import { assertEquals, assertMatch } from "@std/assert";
import { eq, lt } from "drizzle-orm";

import {
  contracts,
  deploymentEnvelopeSurfaces,
  envelopeExpansionRequestSurfaces,
  sessions,
} from "./schema.ts";
import { initializeTrellisStorageSchema, openTrellisStorageDb } from "./db.ts";

async function runSqlMigration(
  storage: Awaited<ReturnType<typeof openTrellisStorageDb>>,
  fileName: string,
): Promise<void> {
  const sql = await Deno.readTextFile(
    new URL(`./migrations/${fileName}`, import.meta.url),
  );
  for (
    const statement of sql.split("--> statement-breakpoint").map((part) =>
      part.trim()
    ).filter(Boolean)
  ) {
    await storage.client.execute(statement);
  }
}

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
      operations: 1,
      operationControls: 3,
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
      operations: {
        operations: [{
          key: "Graph.rebuild",
          subject: "operations.v1.Graph.rebuild",
          wildcardSubject: "operations.v1.Graph.rebuild",
          controlSubject: "operations.v1.Graph.rebuild.control",
          wildcardControlSubject: "operations.v1.Graph.rebuild.control",
          callCapabilities: ["graph.rebuild"],
          observeCapabilities: ["graph.rebuild"],
          cancelCapabilities: [],
          cancel: false,
        }],
        control: [{
          key: "Graph.rebuild",
          action: "get",
          subject: "operations.v1.Graph.rebuild.control",
          wildcardSubject: "operations.v1.Graph.rebuild.control",
          requiredCapabilities: ["graph.rebuild"],
        }, {
          key: "Graph.rebuild",
          action: "wait",
          subject: "operations.v1.Graph.rebuild.control",
          wildcardSubject: "operations.v1.Graph.rebuild.control",
          requiredCapabilities: ["graph.rebuild"],
        }, {
          key: "Graph.rebuild",
          action: "watch",
          subject: "operations.v1.Graph.rebuild.control",
          wildcardSubject: "operations.v1.Graph.rebuild.control",
          requiredCapabilities: ["graph.rebuild"],
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

Deno.test("trellis storage serializes concurrent local SQLite transactions", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-storage-concurrent-",
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
      rpcMethods: 0,
      operations: 0,
      operationControls: 0,
      events: 0,
      natsPublish: 0,
      natsSubscribe: 0,
      kvResources: 0,
      storeResources: 0,
      jobsQueues: 0,
    };
    const analysis = {
      namespaces: ["graph"],
      rpc: { methods: [] },
      operations: { operations: [], control: [] },
      events: { events: [] },
      nats: { publish: [], subscribe: [] },
      resources: { kv: [], store: [], jobs: [] },
    };
    const resources = { kv: {} };

    await Promise.all(
      Array.from(
        { length: 20 },
        (_, index) =>
          storage.db.transaction(async (tx) => {
            await tx.insert(contracts).values({
              digest: `sha256-concurrent-${index}`,
              contractId: contract.id,
              displayName: contract.displayName,
              description: contract.description,
              installedAt: "2026-04-26T00:00:00.000Z",
              contract: JSON.stringify(contract),
              analysisSummary: JSON.stringify(analysisSummary),
              analysis: JSON.stringify(analysis),
              resources: JSON.stringify(resources),
            });
            await tx.delete(sessions).where(
              lt(sessions.lastAuth, "2026-01-01T00:00:00.000Z"),
            );
          }),
      ),
    );

    const rows = await storage.db.select().from(contracts);
    assertEquals(rows.length, 20);
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});

Deno.test("observe/subscribe migration rewrites stale envelope surface actions", async () => {
  const dbPath = await Deno.makeTempFile({
    dir: "/tmp",
    prefix: "trellis-storage-observe-subscribe-",
    suffix: ".sqlite",
  });
  const storage = await openTrellisStorageDb(dbPath);

  try {
    await initializeTrellisStorageSchema(storage);

    await storage.db.insert(deploymentEnvelopeSurfaces).values([
      {
        deploymentId: "billing.default",
        contractId: "billing@v1",
        surfaceKind: "operation",
        surfaceName: "Billing.Start",
        action: "read",
        required: true,
      },
      {
        deploymentId: "billing.default",
        contractId: "billing@v1",
        surfaceKind: "operation",
        surfaceName: "Billing.AlreadyUpdated",
        action: "read",
        required: true,
      },
      {
        deploymentId: "billing.default",
        contractId: "billing@v1",
        surfaceKind: "operation",
        surfaceName: "Billing.AlreadyUpdated",
        action: "observe",
        required: true,
      },
      {
        deploymentId: "billing.default",
        contractId: "billing@v1",
        surfaceKind: "feed",
        surfaceName: "Billing.Stream",
        action: "read",
        required: true,
      },
    ]);
    await storage.db.insert(envelopeExpansionRequestSurfaces).values([
      {
        requestId: "request-1",
        contractId: "billing@v1",
        surfaceKind: "operation",
        surfaceName: "Billing.Start",
        action: "read",
        required: true,
      },
      {
        requestId: "request-1",
        contractId: "billing@v1",
        surfaceKind: "feed",
        surfaceName: "Billing.Stream",
        action: "read",
        required: true,
      },
    ]);
    await storage.db.insert(contracts).values({
      digest: "sha256-legacy-analysis",
      contractId: "billing@v1",
      displayName: "Billing",
      description: "Billing test contract",
      installedAt: "2026-04-26T00:00:00.000Z",
      contract: JSON.stringify({ id: "billing@v1" }),
      analysisSummary: null,
      analysis: JSON.stringify({
        operations: { operations: [{ readCapabilities: ["billing.read"] }] },
      }),
      resources: null,
    });

    await runSqlMigration(storage, "00001_observe_subscribe_actions.sql");

    const deploymentSurfaces = await storage.db.select().from(
      deploymentEnvelopeSurfaces,
    ).where(
      eq(deploymentEnvelopeSurfaces.deploymentId, "billing.default"),
    ).orderBy(
      deploymentEnvelopeSurfaces.surfaceKind,
      deploymentEnvelopeSurfaces.surfaceName,
      deploymentEnvelopeSurfaces.action,
    );
    assertEquals(
      deploymentSurfaces.map((surface) => ({
        kind: surface.surfaceKind,
        name: surface.surfaceName,
        action: surface.action,
      })),
      [
        { kind: "feed", name: "Billing.Stream", action: "subscribe" },
        {
          kind: "operation",
          name: "Billing.AlreadyUpdated",
          action: "observe",
        },
        { kind: "operation", name: "Billing.Start", action: "observe" },
      ],
    );

    const expansionSurfaces = await storage.db.select().from(
      envelopeExpansionRequestSurfaces,
    ).where(
      eq(envelopeExpansionRequestSurfaces.requestId, "request-1"),
    ).orderBy(
      envelopeExpansionRequestSurfaces.surfaceKind,
      envelopeExpansionRequestSurfaces.surfaceName,
    );
    assertEquals(
      expansionSurfaces.map((surface) => ({
        kind: surface.surfaceKind,
        name: surface.surfaceName,
        action: surface.action,
      })),
      [
        { kind: "feed", name: "Billing.Stream", action: "subscribe" },
        { kind: "operation", name: "Billing.Start", action: "observe" },
      ],
    );

    const [contract] = await storage.db.select().from(contracts).where(
      eq(contracts.digest, "sha256-legacy-analysis"),
    );
    assertEquals(
      contract?.analysis,
      JSON.stringify({
        operations: { operations: [{ observeCapabilities: ["billing.read"] }] },
      }),
    );
  } finally {
    storage.client.close();
    await Deno.remove(dbPath).catch(() => undefined);
  }
});
