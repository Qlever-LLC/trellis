import { assert, assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import type { SqlExecutor, SqlRow } from "@qlever-llc/trellis/service";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { assertEventCaptured } from "@qlever-llc/trellis-test";
import { Type } from "typebox";
import {
  liveTrellisTest,
  runtimeScopeForFixture,
} from "../_support/runtime.ts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const schemas = {
  DocInput: Type.Object({ documentId: Type.String() }),
  DocOutput: Type.Object({
    documentId: Type.String(),
    processedBy: Type.String(),
  }),
  DocProcessed: Type.Object({ documentId: Type.String() }),
  DocAudited: Type.Object({ documentId: Type.String(), action: Type.String() }),
  SyncInput: Type.Object({ customerId: Type.String() }),
  SyncOutput: Type.Object({ ok: Type.Boolean() }),
} as const;

const serviceContract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.integration.outbox-service@v1",
    displayName: "Trellis Integration Outbox Service",
    description: "Exercises the SQL outbox with real SQLite and NATS.",
    capabilities: {
      readEvents: {
        displayName: "Read events",
        description: "Subscribe to outbox fixture events.",
      },
    },
    rpc: {
      "Documents.Process": {
        version: "v1",
        subject: "rpc.v1.Documents.Process",
        input: ref.schema("DocInput"),
        output: ref.schema("DocOutput"),
        capabilities: { call: [] },
        errors: [],
      },
      "Documents.ProcessWithRollback": {
        version: "v1",
        subject: "rpc.v1.Documents.ProcessWithRollback",
        input: ref.schema("DocInput"),
        output: ref.schema("DocOutput"),
        capabilities: { call: [] },
        errors: [],
      },
      "Documents.ProcessMultiEvent": {
        version: "v1",
        subject: "rpc.v1.Documents.ProcessMultiEvent",
        input: ref.schema("DocInput"),
        output: ref.schema("DocOutput"),
        capabilities: { call: [] },
        errors: [],
      },
      "Documents.SyncCustomer": {
        version: "v1",
        subject: "rpc.v1.Documents.SyncCustomer",
        input: ref.schema("SyncInput"),
        output: ref.schema("SyncOutput"),
        capabilities: { call: [] },
        errors: [],
      },
    },
    jobs: {
      syncCustomer: {
        payload: ref.schema("SyncInput"),
        result: ref.schema("SyncOutput"),
      },
    },
    events: {
      "Document.Processed": {
        version: "v1",
        event: ref.schema("DocProcessed"),
        capabilities: { subscribe: ["readEvents"] },
      },
      "Document.Audited": {
        version: "v1",
        event: ref.schema("DocAudited"),
        capabilities: { subscribe: ["readEvents"] },
      },
    },
  }),
);

const clientContract = defineAppContract(() => ({
  id: "trellis.integration.outbox-client@v1",
  displayName: "Trellis Integration Outbox Client",
  description: "App/client participant for the outbox integration fixture.",
  uses: {
    required: {
      outboxService: serviceContract.use({
        rpc: {
          call: [
            "Documents.Process",
            "Documents.ProcessWithRollback",
            "Documents.ProcessMultiEvent",
            "Documents.SyncCustomer",
          ],
        },
        events: {
          subscribe: [
            "Document.Processed",
            "Document.Audited",
          ],
        },
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Real SQLite executor via sql.js (pure WASM, no native compilation)
// ---------------------------------------------------------------------------

let initSqlJsPromise: Promise<SqlJsStatic> | undefined;
type SqlJsStatic = {
  Database: new () => SqlJsDatabase;
};
type SqlJsDatabase = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string): SqlJsStatement;
  close(): void;
};
type SqlJsStatement = {
  bind(params: unknown[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
};

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!initSqlJsPromise) {
    initSqlJsPromise = (async () => {
      const mod: { default: () => Promise<SqlJsStatic> } = await import(
        "npm:sql.js"
      );
      return await mod.default();
    })();
  }
  return await initSqlJsPromise;
}

function createSqlJsExecutor(db: SqlJsDatabase): SqlExecutor {
  return {
    async query(sql, params) {
      if (params.length === 0) {
        const results = db.exec(sql);
        if (results.length === 0) return [];
        const { columns, values } = results[0];
        return values.map((row) => {
          const obj: SqlRow = {};
          for (let i = 0; i < columns.length; i++) {
            obj[columns[i]] = row[i];
          }
          return obj;
        });
      }
      const stmt = db.prepare(sql);
      stmt.bind(params as unknown[]);
      const rows: SqlRow[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as SqlRow);
      }
      stmt.free();
      return rows;
    },
    async execute(sql, params) {
      if (params.length === 0) {
        db.run(sql);
      } else {
        db.run(sql, params as unknown[]);
      }
    },
  };
}

function createSqliteOutboxSchema(
  dialect: "sqlite",
  tables: { outbox: string; inbox: string },
): readonly string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${tables.outbox} (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL, headers TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT, last_error TEXT, outcome TEXT)`,
    `CREATE INDEX IF NOT EXISTS ${tables.outbox}_due_idx ON ${tables.outbox} (state, next_attempt_at)`,
    `CREATE TABLE IF NOT EXISTS ${tables.inbox} (message_id TEXT PRIMARY KEY, received_at TEXT NOT NULL)`,
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

liveTrellisTest({
  name:
    "outbox.commits-event-through-sql-outbox publishes event after SQL commit",
  scope: runtimeScopeForFixture("outbox"),
  async fn(runtime) {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    for (
      const ddl of createSqliteOutboxSchema("sqlite", {
        outbox: "trellis_outbox",
        inbox: "trellis_inbox",
      })
    ) {
      db.run(ddl);
    }

    const serviceKey = await runtime.registerService({
      name: "outbox-fixture-service",
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: "outbox-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    let serviceWait: Promise<void> | undefined;

    try {
      const executor = createSqlJsExecutor(db);
      const sqlOutbox = service.createSqlOutbox({
        dialect: "sqlite",
        executor,
        transaction: async (work) => {
          db.run("BEGIN");
          const result = await work({ tx: db, executor });
          db.run("COMMIT");
          return result;
        },
      });

      await service.handle.rpc.documents.process(
        async ({ input }) => {
          await sqlOutbox.transaction(
            async ({ event }) => {
              await event.document.processed.enqueue({
                documentId: input.documentId,
              }).orThrow();
            },
          ).orThrow();
          return Result.ok({
            documentId: input.documentId,
            processedBy: "outbox-commit",
          });
        },
      );
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: "outbox-fixture-capture",
        contract: serviceContract,
        events: ["Document.Processed"],
      });

      try {
        const client = await runtime.connectClient({
          name: "outbox-fixture-client",
          contract: clientContract,
        });

        const rpcResult = await client.rpc.documents.process({
          documentId: "doc-1",
        }).orThrow();
        assertEquals(rpcResult.documentId, "doc-1");

        const captured = await assertEventCaptured(
          capture,
          "Document.Processed",
          (record) => record.payload.documentId === "doc-1",
        );
        assertEquals(captured.payload, { documentId: "doc-1" });
      } finally {
        await capture.stop();
      }
    } finally {
      await service.stop();
      await serviceWait;
      db.close();
    }
  },
});

liveTrellisTest({
  name:
    "outbox.rollback-does-not-publish suppresses event on transaction rollback",
  scope: runtimeScopeForFixture("outbox"),
  async fn(runtime) {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    for (
      const ddl of createSqliteOutboxSchema("sqlite", {
        outbox: "trellis_outbox",
        inbox: "trellis_inbox",
      })
    ) {
      db.run(ddl);
    }

    const serviceKey = await runtime.registerService({
      name: "outbox-fixture-service",
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: "outbox-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    let serviceWait: Promise<void> | undefined;

    try {
      const executor = createSqlJsExecutor(db);
      const sqlOutbox = service.createSqlOutbox({
        dialect: "sqlite",
        executor,
        transaction: async (work) => {
          db.run("BEGIN");
          try {
            const result = await work({ tx: db, executor });
            db.run("COMMIT");
            return result;
          } catch (error) {
            db.run("ROLLBACK");
            throw error;
          }
        },
      });

      await service.handle.rpc.documents.processWithRollback(
        async ({ input }) => {
          const result = await sqlOutbox.transaction(
            async ({ event }) => {
              await event.document.processed.enqueue({
                documentId: input.documentId,
              }).orThrow();
              throw new Error("rollback");
            },
          ).orThrow();
          return Result.ok({
            documentId: input.documentId,
            processedBy: "should-not-reach",
          });
        },
      );
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: "outbox-fixture-capture-rollback",
        contract: serviceContract,
        events: ["Document.Processed"],
      });

      try {
        const client = await runtime.connectClient({
          name: "outbox-fixture-client-rollback",
          contract: clientContract,
        });

        // The RPC should throw because the handler threw inside the outbox
        const result = await client.rpc.documents.processWithRollback({
          documentId: "doc-rollback",
        });
        assert(result.error !== undefined);

        // Give the dispatcher time in case an event was incorrectly published
        await new Promise((resolve) => setTimeout(resolve, 500));

        assertEquals(capture.all().length, 0);
      } finally {
        await capture.stop();
      }
    } finally {
      await service.stop();
      await serviceWait;
      db.close();
    }
  },
});

liveTrellisTest({
  name: "outbox.multiple-events-in-one-transaction publishes all after commit",
  scope: runtimeScopeForFixture("outbox"),
  async fn(runtime) {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    for (
      const ddl of createSqliteOutboxSchema("sqlite", {
        outbox: "trellis_outbox",
        inbox: "trellis_inbox",
      })
    ) {
      db.run(ddl);
    }

    const serviceKey = await runtime.registerService({
      name: "outbox-fixture-service",
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: "outbox-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    let serviceWait: Promise<void> | undefined;

    try {
      const executor = createSqlJsExecutor(db);
      const sqlOutbox = service.createSqlOutbox({
        dialect: "sqlite",
        executor,
        transaction: async (work) => {
          db.run("BEGIN");
          const result = await work({ tx: db, executor });
          db.run("COMMIT");
          return result;
        },
      });

      await service.handle.rpc.documents.processMultiEvent(
        async ({ input }) => {
          await sqlOutbox.transaction(
            async ({ event }) => {
              await event.document.processed.enqueue({
                documentId: input.documentId,
              }).orThrow();
              await event.document.audited.enqueue({
                documentId: input.documentId,
                action: "process",
              }).orThrow();
            },
          ).orThrow();
          return Result.ok({
            documentId: input.documentId,
            processedBy: "outbox-multi",
          });
        },
      );
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: "outbox-fixture-capture-multi",
        contract: serviceContract,
        events: ["Document.Processed", "Document.Audited"],
      });

      try {
        const client = await runtime.connectClient({
          name: "outbox-fixture-client-multi",
          contract: clientContract,
        });

        const rpcResult = await client.rpc.documents.processMultiEvent({
          documentId: "doc-multi",
        }).orThrow();
        assertEquals(rpcResult.documentId, "doc-multi");

        const processed = await assertEventCaptured(
          capture,
          "Document.Processed",
          (record) => record.payload.documentId === "doc-multi",
        );
        assertEquals(processed.payload, { documentId: "doc-multi" });

        const audited = await assertEventCaptured(
          capture,
          "Document.Audited",
          (record) =>
            record.payload.documentId === "doc-multi" &&
            record.payload.action === "process",
        );
        assertEquals(audited.payload, {
          documentId: "doc-multi",
          action: "process",
        });
      } finally {
        await capture.stop();
      }
    } finally {
      await service.stop();
      await serviceWait;
      db.close();
    }
  },
});

liveTrellisTest({
  name:
    "outbox.listener-derives-event through SQL outbox and publishes to NATS",
  scope: runtimeScopeForFixture("outbox"),
  async fn(runtime) {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    for (
      const ddl of createSqliteOutboxSchema("sqlite", {
        outbox: "trellis_outbox",
        inbox: "trellis_inbox",
      })
    ) {
      db.run(ddl);
    }

    const serviceKey = await runtime.registerService({
      name: "outbox-fixture-service",
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: "outbox-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    let serviceWait: Promise<void> | undefined;

    try {
      const executor = createSqlJsExecutor(db);
      const sqlOutbox = service.createSqlOutbox({
        dialect: "sqlite",
        executor,
        transaction: async (work) => {
          db.run("BEGIN");
          const result = await work({ tx: db, executor });
          db.run("COMMIT");
          return result;
        },
      });

      await service.event.document.processed.listen(
        async (event, _context) => {
          await sqlOutbox.transaction(
            async ({ event: out }) => {
              await out.document.audited.enqueue({
                documentId: event.documentId,
                action: "listener-derived",
              }).orThrow();
            },
          ).orThrow();
        },
        {},
        { mode: "ephemeral" },
      ).orThrow();

      await service.handle.rpc.documents.process(
        async ({ input }) => {
          await sqlOutbox.transaction(
            async ({ event }) => {
              await event.document.processed.enqueue({
                documentId: input.documentId,
              }).orThrow();
            },
          ).orThrow();
          return Result.ok({
            documentId: input.documentId,
            processedBy: "outbox-listener",
          });
        },
      );
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: "outbox-fixture-capture-listener",
        contract: serviceContract,
        events: ["Document.Processed", "Document.Audited"],
      });

      try {
        const client = await runtime.connectClient({
          name: "outbox-fixture-client-listener",
          contract: clientContract,
        });

        await client.rpc.documents.process({
          documentId: "doc-listener",
        }).orThrow();

        const processed = await assertEventCaptured(
          capture,
          "Document.Processed",
          (record) => record.payload.documentId === "doc-listener",
        );
        assertEquals(processed.payload, { documentId: "doc-listener" });

        const audited = await assertEventCaptured(
          capture,
          "Document.Audited",
          (record) =>
            record.payload.documentId === "doc-listener" &&
            record.payload.action === "listener-derived",
        );
        assertEquals(audited.payload, {
          documentId: "doc-listener",
          action: "listener-derived",
        });
      } finally {
        await capture.stop();
      }
    } finally {
      await service.stop();
      await serviceWait;
      db.close();
    }
  },
});

liveTrellisTest({
  name: "outbox.sql-row-state-is-dispatched after successful commit",
  scope: runtimeScopeForFixture("outbox"),
  async fn(runtime) {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    for (
      const ddl of createSqliteOutboxSchema("sqlite", {
        outbox: "trellis_outbox",
        inbox: "trellis_inbox",
      })
    ) {
      db.run(ddl);
    }

    const serviceKey = await runtime.registerService({
      name: "outbox-fixture-service",
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: "outbox-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    let serviceWait: Promise<void> | undefined;

    try {
      const executor = createSqlJsExecutor(db);
      await service.createSqlOutbox({
        dialect: "sqlite",
        executor,
        transaction: async (work) => {
          db.run("BEGIN");
          const result = await work({ tx: db, executor });
          db.run("COMMIT");
          return result;
        },
      });

      await service.handle.rpc.documents.process(
        async ({ input }) => {
          await service.createSqlOutbox({
            dialect: "sqlite",
            executor,
            transaction: async (work) => {
              db.run("BEGIN");
              const result = await work({ tx: db, executor });
              db.run("COMMIT");
              return result;
            },
          }).transaction(
            async ({ event }) => {
              await event.document.processed.enqueue({
                documentId: input.documentId,
              }).orThrow();
            },
          ).orThrow();
          return Result.ok({
            documentId: input.documentId,
            processedBy: "outbox-row-state",
          });
        },
      );
      serviceWait = service.wait();

      const client = await runtime.connectClient({
        name: "outbox-fixture-client-row-state",
        contract: clientContract,
      });

      await client.rpc.documents.process({
        documentId: "doc-row-state",
      }).orThrow();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const results = db.exec("SELECT state, kind, name FROM trellis_outbox");
      if (results.length > 0) {
        const row = results[0];
        assertEquals(row.values[0][0], "dispatched");
        assertEquals(row.values[0][1], "event.publish");
        assertEquals(row.values[0][2], "Document.Processed");
      }
    } finally {
      await service.stop();
      await serviceWait;
      db.close();
    }
  },
});

liveTrellisTest({
  name: "outbox.job.create-creates-outbox-row with kind=job.create",
  scope: runtimeScopeForFixture("outbox"),
  async fn(runtime) {
    const SQL = await getSqlJs();
    const db = new SQL.Database();
    for (
      const ddl of createSqliteOutboxSchema("sqlite", {
        outbox: "trellis_outbox",
        inbox: "trellis_inbox",
      })
    ) {
      db.run(ddl);
    }

    const serviceKey = await runtime.registerService({
      name: "outbox-fixture-service",
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: "outbox-fixture-service",
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    let serviceWait: Promise<void> | undefined;

    try {
      const executor = createSqlJsExecutor(db);
      const sqlOutbox = service.createSqlOutbox({
        dialect: "sqlite",
        executor,
        transaction: async (work) => {
          db.run("BEGIN");
          const result = await work({ tx: db, executor });
          db.run("COMMIT");
          return result;
        },
      });

      await service.handle.rpc.documents.syncCustomer(
        async ({ input }) => {
          await sqlOutbox.transaction(
            async ({ job }) => {
              await job.syncCustomer.create({
                customerId: input.customerId,
              }).orThrow();
            },
          ).orThrow();
          return Result.ok({ ok: true });
        },
      );
      serviceWait = service.wait();

      const client = await runtime.connectClient({
        name: "outbox-fixture-client-job",
        contract: clientContract,
      });

      await client.rpc.documents.syncCustomer({
        customerId: "cust-1",
      }).orThrow();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const results = db.exec("SELECT kind, name, state FROM trellis_outbox");
      if (results.length > 0) {
        const row = results[0];
        assertEquals(row.values[0][0], "job.create");
        assertEquals(row.values[0][1], "syncCustomer");
      }
    } finally {
      await service.stop();
      await serviceWait;
      db.close();
    }
  },
});
