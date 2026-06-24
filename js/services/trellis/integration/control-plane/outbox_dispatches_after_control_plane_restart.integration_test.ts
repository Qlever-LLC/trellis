import { assertEquals } from "@std/assert";
import {
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import type { SqlExecutor, SqlRow } from "@qlever-llc/trellis/service/mod.ts";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { assertEventCaptured } from "@qlever-llc/trellis-test";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
} from "@qlever-llc/trellis-test/integration";
import { Type } from "typebox";
import {
  liveTrellisTest,
  restartTrellisControlPlane,
  runtimeScopeForCase,
} from "../_support/runtime.ts";

const CASE_ID = "control-plane.outbox-dispatches-after-control-plane-restart";

const schemas = {
  QueueInput: Type.Object({ documentId: Type.String() }),
  QueueOutput: Type.Object({ documentId: Type.String() }),
  DocumentQueued: Type.Object({ documentId: Type.String() }),
} as const;

const serviceContract = defineServiceContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.outbox-restart-service",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Outbox Restart Service",
  description:
    "Queues SQL outbox events and verifies dispatch after control-plane restart.",
  capabilities: {
    readEvents: {
      displayName: "Read outbox restart events",
      description: "Subscribe to outbox restart fixture events.",
    },
  },
  rpc: {
    "Documents.Queue": {
      version: "v1",
      subject: caseScopedSubject(
        "rpc.v1.integration.control-plane.outbox-restart",
        CASE_ID,
        "Documents.Queue",
      ),
      input: ref.schema("QueueInput"),
      output: ref.schema("QueueOutput"),
      capabilities: { call: [] },
      errors: [],
    },
  },
  events: {
    "Document.Queued": {
      version: "v1",
      subject: caseScopedSubject(
        "events.v1.integration.control-plane.outbox-restart",
        CASE_ID,
        "Document.Queued",
      ),
      event: ref.schema("DocumentQueued"),
      capabilities: { subscribe: ["readEvents"] },
    },
  },
}));

const clientContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.outbox-restart-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Outbox Restart Client",
  description: "Queues outbox restart fixture events through generated RPC.",
  uses: {
    required: {
      outboxRestartService: serviceContract.use({
        rpc: { call: ["Documents.Queue"] },
      }),
    },
  },
}));

const serviceName = caseScopedName("outbox-restart-service", CASE_ID);
const clientName = caseScopedName("outbox-restart-client", CASE_ID);
const captureName = caseScopedName("outbox-restart-capture", CASE_ID);
const documentId = caseScopedName("document", CASE_ID);

liveTrellisTest({
  name:
    "control-plane.outbox-dispatches-after-control-plane-restart dispatches a queued event after restart",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const db = await createDb();
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    let service = await connectService(runtime.trellisUrl, serviceKey.seed);
    let serviceWait: Promise<void> | undefined;

    try {
      const firstOutbox = createOutbox(service, db, { debounceMs: 60_000 });
      await service.handle.rpc.documents.queue(async ({ input }) => {
        await firstOutbox.transaction(async ({ event }) => {
          await event.document.queued.enqueue({
            documentId: input.documentId,
          }).orThrow();
        }).orThrow();
        return Result.ok({ documentId: input.documentId });
      });
      serviceWait = service.wait();

      const client = await runtime.connectClient({
        name: clientName,
        contract: clientContract,
      });
      assertEquals(
        await client.rpc.documents.queue({ documentId }).orThrow(),
        { documentId },
      );

      await service.stop();
      await serviceWait;
      serviceWait = undefined;

      await restartTrellisControlPlane(runtime);

      const capture = await runtime.captureEvents({
        name: captureName,
        contract: serviceContract,
        events: ["Document.Queued"],
      });

      try {
        service = await connectService(runtime.trellisUrl, serviceKey.seed);
        serviceWait = service.wait();
        createOutbox(service, db, { idleRetryMs: 10 });

        const captured = await assertEventCaptured(
          capture,
          "Document.Queued",
          (record) => record.payload.documentId === documentId,
        );
        assertEquals(captured.payload, { documentId });
      } finally {
        await capture.stop();
      }
    } finally {
      await service.stop().catch(() => undefined);
      await serviceWait?.catch(() => undefined);
      db.close();
    }
  },
});

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

async function connectService(trellisUrl: string, sessionKeySeed: string) {
  return await TrellisService.connect({
    trellisUrl,
    contract: serviceContract,
    name: serviceName,
    sessionKeySeed,
    telemetry: false,
    server: { log: false },
  }).orThrow();
}

async function createDb(): Promise<SqlJsDatabase> {
  const mod: { default: () => Promise<SqlJsStatic> } = await import(
    "npm:sql.js"
  );
  const SQL = await mod.default();
  const db = new SQL.Database();
  db.run(
    "CREATE TABLE IF NOT EXISTS trellis_outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL, headers TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT, last_error TEXT, outcome TEXT)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS trellis_outbox_due_idx ON trellis_outbox (state, next_attempt_at)",
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS trellis_inbox (message_id TEXT PRIMARY KEY, received_at TEXT NOT NULL)",
  );
  return db;
}

function createOutbox(
  service: Awaited<ReturnType<typeof connectService>>,
  db: SqlJsDatabase,
  dispatcher: { debounceMs?: number; idleRetryMs?: number },
) {
  const executor = createSqlJsExecutor(db);
  return service.createSqlOutbox({
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
    dispatcher,
  });
}

function createSqlJsExecutor(db: SqlJsDatabase): SqlExecutor {
  return {
    async query(sql: string, params: readonly unknown[]) {
      if (params.length === 0) {
        const results = db.exec(sql);
        if (results.length === 0) return [];
        const { columns, values } = results[0];
        return values.map((row) => {
          const out: SqlRow = {};
          for (let i = 0; i < columns.length; i++) out[columns[i]] = row[i];
          return out;
        });
      }
      const statement = db.prepare(sql);
      statement.bind(params as unknown[]);
      const rows: SqlRow[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as SqlRow);
      statement.free();
      return rows;
    },
    async execute(sql: string, params: readonly unknown[]) {
      if (params.length === 0) {
        db.run(sql);
      } else {
        db.run(sql, params as unknown[]);
      }
    },
  };
}
