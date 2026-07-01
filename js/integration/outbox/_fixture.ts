import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
import {
  getSqlOutboxMigrations,
  type SqlExecutor,
  type SqlRow,
} from "@qlever-llc/trellis/service";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export type OutboxDocOutput = {
  readonly documentId: string;
  readonly processedBy: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireOutboxDocOutput(value: unknown): OutboxDocOutput {
  if (!isRecord(value)) {
    throw new Error("expected outbox doc output");
  }
  if (
    typeof value.documentId !== "string" ||
    typeof value.processedBy !== "string"
  ) {
    throw new Error("expected outbox doc output fields");
  }
  return { documentId: value.documentId, processedBy: value.processedBy };
}

let initSqlJsPromise: Promise<SqlJsStatic> | undefined;

type SqlJsStatic = {
  Database: new () => SqlJsDatabase;
};

export type SqlJsDatabase = {
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

export function createOutboxFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const schemas = {
    DocInput: Type.Object({ documentId: Type.String() }),
    DocOutput: Type.Object({
      documentId: Type.String(),
      processedBy: Type.String(),
    }),
    DocProcessed: Type.Object({ documentId: Type.String() }),
    DocAudited: Type.Object({
      documentId: Type.String(),
      action: Type.String(),
    }),
    SyncInput: Type.Object({ customerId: Type.String() }),
    SyncOutput: Type.Object({ ok: Type.Boolean() }),
  } as const;

  const serviceContract = defineServiceContract({ schemas }, (ref) => ({
    id: caseScopedContractId("trellis.integration.outbox-service", caseId),
    displayName: `Trellis Integration Outbox Service (${slug})`,
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
        subject: caseScopedSubject(
          "rpc.v1.Integration.Outbox",
          caseId,
          "Documents.Process",
        ),
        input: ref.schema("DocInput"),
        output: ref.schema("DocOutput"),
        capabilities: { call: [] },
        errors: [],
      },
      "Documents.ProcessWithRollback": {
        version: "v1",
        subject: caseScopedSubject(
          "rpc.v1.Integration.Outbox",
          caseId,
          "Documents.ProcessWithRollback",
        ),
        input: ref.schema("DocInput"),
        output: ref.schema("DocOutput"),
        capabilities: { call: [] },
        errors: [],
      },
      "Documents.ProcessMultiEvent": {
        version: "v1",
        subject: caseScopedSubject(
          "rpc.v1.Integration.Outbox",
          caseId,
          "Documents.ProcessMultiEvent",
        ),
        input: ref.schema("DocInput"),
        output: ref.schema("DocOutput"),
        capabilities: { call: [] },
        errors: [],
      },
      "Documents.SyncCustomer": {
        version: "v1",
        subject: caseScopedSubject(
          "rpc.v1.Integration.Outbox",
          caseId,
          "Documents.SyncCustomer",
        ),
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
        subject: caseScopedSubject(
          "events.v1.Integration.Outbox",
          caseId,
          "Document.Processed",
        ),
        event: ref.schema("DocProcessed"),
        capabilities: { subscribe: ["readEvents"] },
      },
      "Document.Audited": {
        version: "v1",
        subject: caseScopedSubject(
          "events.v1.Integration.Outbox",
          caseId,
          "Document.Audited",
        ),
        event: ref.schema("DocAudited"),
        capabilities: { subscribe: ["readEvents"] },
      },
    },
  }));

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.outbox-client", caseId),
    displayName: `Trellis Integration Outbox Client (${slug})`,
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
          events: { subscribe: ["Document.Processed", "Document.Audited"] },
        }),
      },
    },
  }));

  async function createEmptyDb() {
    const SQL = await getSqlJs();
    return new SQL.Database();
  }

  async function createDb() {
    const db = await createEmptyDb();
    for (
      const migration of getSqlOutboxMigrations({
        dialect: "sqlite",
        tables: {
          outbox: "trellis_outbox",
          inbox: "trellis_inbox",
        },
      })
    ) {
      for (const ddl of migration.up) db.run(ddl);
    }
    return db;
  }

  async function connectService(runtime: LiveTrellisRuntime) {
    const serviceName = caseScopedName("outbox-fixture-service", caseId);
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    return await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
  }

  function createOutbox(service: TrellisService, db: SqlJsDatabase) {
    const executor = createSqlJsExecutor(db);
    return service.createSqlOutbox({
      dialect: "sqlite",
      executor,
      transaction: async (work) => {
        db.run("BEGIN");
        const result = await work({ tx: db, executor });
        db.run("COMMIT");
        return result;
      },
    });
  }

  function createRollbackOutbox(service: TrellisService, db: SqlJsDatabase) {
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
    });
  }

  return {
    slug,
    serviceContract,
    clientContract,
    serviceName: caseScopedName("outbox-fixture-service", caseId),
    clientName: caseScopedName("outbox-fixture-client", caseId),
    captureName: caseScopedName("outbox-fixture-capture", caseId),
    rollbackClientName: caseScopedName(
      "outbox-fixture-client-rollback",
      caseId,
    ),
    rollbackCaptureName: caseScopedName(
      "outbox-fixture-capture-rollback",
      caseId,
    ),
    multiClientName: caseScopedName("outbox-fixture-client-multi", caseId),
    multiCaptureName: caseScopedName("outbox-fixture-capture-multi", caseId),
    listenerClientName: caseScopedName(
      "outbox-fixture-client-listener",
      caseId,
    ),
    listenerCaptureName: caseScopedName(
      "outbox-fixture-capture-listener",
      caseId,
    ),
    rowStateClientName: caseScopedName(
      "outbox-fixture-client-row-state",
      caseId,
    ),
    documentId: caseScopedName("doc", caseId),
    rollbackDocumentId: caseScopedName("doc-rollback", caseId),
    multiDocumentId: caseScopedName("doc-multi", caseId),
    listenerDocumentId: caseScopedName("doc-listener", caseId),
    rowStateDocumentId: caseScopedName("doc-row-state", caseId),
    createEmptyDb,
    createDb,
    connectService,
    createOutbox,
    createRollbackOutbox,
  };
}
