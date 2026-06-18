import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOutboxFixture } from "./_fixture.ts";

const CASE_ID = "outbox.sql-row-state-is-dispatched" as const;
const fixture = createOutboxFixture(CASE_ID);

liveTrellisTest({
  name: "outbox.sql-row-state-is-dispatched after successful commit",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const db = await fixture.createDb();
    const service = await fixture.connectService(runtime);
    let serviceWait: Promise<void> | undefined;

    try {
      const sqlOutbox = fixture.createOutbox(service, db);
      await service.handle.rpc.documents.process(async ({ input }) => {
        await sqlOutbox.transaction(async ({ event }) => {
          await event.document.processed.enqueue({
            documentId: input.documentId,
          })
            .orThrow();
        }).orThrow();
        return Result.ok({
          documentId: input.documentId,
          processedBy: "outbox-row-state",
        });
      });
      serviceWait = service.wait();

      const client = await runtime.connectClient({
        name: fixture.rowStateClientName,
        contract: fixture.clientContract,
      });

      await client.rpc.documents.process({
        documentId: fixture.rowStateDocumentId,
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
