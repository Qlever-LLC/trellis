import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { assertEventCaptured } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOutboxFixture, requireOutboxDocOutput } from "./_fixture.ts";

const CASE_ID = "outbox.commits-event-through-sql-outbox" as const;
const fixture = createOutboxFixture(CASE_ID);

liveTrellisTest({
  name:
    "outbox.commits-event-through-sql-outbox publishes event after SQL commit",
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
          processedBy: "outbox-commit",
        });
      });
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: fixture.captureName,
        contract: fixture.serviceContract,
        events: ["Document.Processed"],
      });

      try {
        const client = await runtime.connectClient({
          name: fixture.clientName,
          contract: fixture.clientContract,
        });

        const rpcResult = requireOutboxDocOutput(
          await client.rpc.documents.process({
            documentId: fixture.documentId,
          }).orThrow(),
        );
        assertEquals(rpcResult.documentId, fixture.documentId);

        const captured = await assertEventCaptured(
          capture,
          "Document.Processed",
          (record) => record.payload.documentId === fixture.documentId,
        );
        assertEquals(captured.payload, { documentId: fixture.documentId });
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
