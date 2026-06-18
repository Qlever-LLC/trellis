import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { assertEventCaptured } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOutboxFixture, requireOutboxDocOutput } from "./_fixture.ts";

const CASE_ID = "outbox.multiple-events-in-one-transaction" as const;
const fixture = createOutboxFixture(CASE_ID);

liveTrellisTest({
  name: "outbox.multiple-events-in-one-transaction publishes all after commit",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const db = await fixture.createDb();
    const service = await fixture.connectService(runtime);
    let serviceWait: Promise<void> | undefined;

    try {
      const sqlOutbox = fixture.createOutbox(service, db);
      await service.handle.rpc.documents.processMultiEvent(
        async ({ input }) => {
          await sqlOutbox.transaction(async ({ event }) => {
            await event.document.processed.enqueue({
              documentId: input.documentId,
            })
              .orThrow();
            await event.document.audited.enqueue({
              documentId: input.documentId,
              action: "process",
            }).orThrow();
          }).orThrow();
          return Result.ok({
            documentId: input.documentId,
            processedBy: "outbox-multi",
          });
        },
      );
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: fixture.multiCaptureName,
        contract: fixture.serviceContract,
        events: ["Document.Processed", "Document.Audited"],
      });

      try {
        const client = await runtime.connectClient({
          name: fixture.multiClientName,
          contract: fixture.clientContract,
        });

        const rpcResult = requireOutboxDocOutput(
          await client.rpc.documents.processMultiEvent({
            documentId: fixture.multiDocumentId,
          }).orThrow(),
        );
        assertEquals(rpcResult.documentId, fixture.multiDocumentId);

        const processed = await assertEventCaptured(
          capture,
          "Document.Processed",
          (record) => record.payload.documentId === fixture.multiDocumentId,
        );
        assertEquals(processed.payload, {
          documentId: fixture.multiDocumentId,
        });

        const audited = await assertEventCaptured(
          capture,
          "Document.Audited",
          (record) =>
            record.payload.documentId === fixture.multiDocumentId &&
            record.payload.action === "process",
        );
        assertEquals(audited.payload, {
          documentId: fixture.multiDocumentId,
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
