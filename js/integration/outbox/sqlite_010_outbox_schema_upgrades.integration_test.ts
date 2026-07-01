import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { isErr } from "@qlever-llc/result";
import { getSqlOutboxMigrations } from "@qlever-llc/trellis/service";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOutboxFixture, type SqlJsDatabase } from "./_fixture.ts";

const CASE_ID = "outbox.sqlite-010-schema-upgrades" as const;
const fixture = createOutboxFixture(CASE_ID);

liveTrellisTest({
  name: "outbox.sqlite-010-schema-upgrades migrates legacy event rows",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const db = await fixture.createEmptyDb();
    const service = await fixture.connectService(runtime);
    let serviceWait: Promise<void> | undefined;

    try {
      createLegacyOutboxSchema(db);
      insertLegacyPendingRow(db);

      const sqlOutbox = fixture.createRollbackOutbox(service, db);
      serviceWait = service.wait();

      const failed = await sqlOutbox.transaction(async ({ event }) => {
        await event.document.processed.enqueue({
          documentId: `${fixture.documentId}-before-migration`,
        }).orThrow();
      }).take();

      assert(
        isErr(failed),
        "legacy 0.10 outbox schema should reject 0.11 inserts",
      );
      assertStringIncludes(
        String(failed.error.toSerializable().context?.causeMessage),
        "kind",
      );

      applySqliteOutboxMigrations(db);
      applySqliteOutboxMigrations(db);

      await sqlOutbox.transaction(async ({ event }) => {
        await event.document.processed.enqueue({
          documentId: fixture.documentId,
        }).orThrow();
      }).orThrow();

      const rows = db.exec(
        "SELECT id, kind, name, state, next_attempt_at, outcome FROM trellis_outbox ORDER BY id",
      );
      assertEquals(rows.length, 1);

      const legacy = rows[0].values.find((row) => row[0] === "legacy-1");
      assert(legacy, "legacy pending outbox row should be preserved");
      assertEquals(legacy[1], "event.publish");
      assertEquals(legacy[2], "Document.Processed");
      assertEquals(legacy[3], "pending");
      assertEquals(legacy[4], "2999-01-01T00:00:00.000Z");
      assertEquals(legacy[5], null);

      const inserted = rows[0].values.find((row) => row[0] !== "legacy-1");
      assert(inserted, "0.11 outbox insert should succeed after migration");
      assertEquals(inserted[1], "event.publish");
      assertEquals(inserted[2], "Document.Processed");
    } finally {
      await service.stop();
      await serviceWait;
      db.close();
    }
  },
});

function createLegacyOutboxSchema(db: SqlJsDatabase): void {
  db.run(
    "CREATE TABLE trellis_outbox (id TEXT PRIMARY KEY, event TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL, headers TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT, last_error TEXT)",
  );
}

function insertLegacyPendingRow(db: SqlJsDatabase): void {
  db.run(
    "INSERT INTO trellis_outbox (id, event, subject, payload, headers, state, attempts, created_at, updated_at, next_attempt_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      "legacy-1",
      "Document.Processed",
      "events.v1.Integration.Outbox.Document.Processed.legacy",
      JSON.stringify({ documentId: "legacy-doc" }),
      "{}",
      "pending",
      0,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2999-01-01T00:00:00.000Z",
      null,
    ],
  );
}

function applySqliteOutboxMigrations(db: SqlJsDatabase): void {
  for (const migration of getSqlOutboxMigrations({ dialect: "sqlite" })) {
    for (const ddl of migration.up) db.run(ddl);
  }
}
