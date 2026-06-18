import { assert, assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOutboxFixture } from "./_fixture.ts";

const CASE_ID = "outbox.rollback-does-not-publish" as const;
const fixture = createOutboxFixture(CASE_ID);

liveTrellisTest({
  name:
    "outbox.rollback-does-not-publish suppresses event on transaction rollback",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const db = await fixture.createDb();
    const service = await fixture.connectService(runtime);
    let serviceWait: Promise<void> | undefined;

    try {
      const sqlOutbox = fixture.createRollbackOutbox(service, db);
      await service.handle.rpc.documents.processWithRollback(
        async ({ input }) => {
          await sqlOutbox.transaction(async ({ event }) => {
            await event.document.processed.enqueue({
              documentId: input.documentId,
            })
              .orThrow();
            throw new Error("rollback");
          }).orThrow();
          return Result.ok({
            documentId: input.documentId,
            processedBy: "should-not-reach",
          });
        },
      );
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: fixture.rollbackCaptureName,
        contract: fixture.serviceContract,
        events: ["Document.Processed"],
      });

      try {
        const client = await runtime.connectClient({
          name: fixture.rollbackClientName,
          contract: fixture.clientContract,
        });

        const result = await client.rpc.documents.processWithRollback({
          documentId: fixture.rollbackDocumentId,
        });
        assert(result.error !== undefined);
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
