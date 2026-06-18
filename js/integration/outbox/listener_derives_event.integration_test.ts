import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { assertEventCaptured } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createOutboxFixture } from "./_fixture.ts";

const CASE_ID = "outbox.listener-derives-event" as const;
const fixture = createOutboxFixture(CASE_ID);

liveTrellisTest({
  name:
    "outbox.listener-derives-event through SQL outbox and publishes to NATS",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const db = await fixture.createDb();
    const service = await fixture.connectService(runtime);
    let serviceWait: Promise<void> | undefined;

    try {
      const sqlOutbox = fixture.createOutbox(service, db);
      await service.event.document.processed.listen(
        async (event) => {
          await sqlOutbox.transaction(async ({ event: out }) => {
            await out.document.audited.enqueue({
              documentId: event.documentId,
              action: "listener-derived",
            }).orThrow();
          }).orThrow();
          return Result.ok(undefined);
        },
        {},
        { mode: "ephemeral" },
      ).orThrow();

      await service.handle.rpc.documents.process(async ({ input }) => {
        await sqlOutbox.transaction(async ({ event }) => {
          await event.document.processed.enqueue({
            documentId: input.documentId,
          })
            .orThrow();
        }).orThrow();
        return Result.ok({
          documentId: input.documentId,
          processedBy: "outbox-listener",
        });
      });
      serviceWait = service.wait();

      const capture = await runtime.captureEvents({
        name: fixture.listenerCaptureName,
        contract: fixture.serviceContract,
        events: ["Document.Processed", "Document.Audited"],
      });

      try {
        const client = await runtime.connectClient({
          name: fixture.listenerClientName,
          contract: fixture.clientContract,
        });

        await client.rpc.documents.process({
          documentId: fixture.listenerDocumentId,
        }).orThrow();

        const processed = await assertEventCaptured(
          capture,
          "Document.Processed",
          (record) => record.payload.documentId === fixture.listenerDocumentId,
        );
        assertEquals(processed.payload, {
          documentId: fixture.listenerDocumentId,
        });

        const audited = await assertEventCaptured(
          capture,
          "Document.Audited",
          (record) =>
            record.payload.documentId === fixture.listenerDocumentId &&
            record.payload.action === "listener-derived",
        );
        assertEquals(audited.payload, {
          documentId: fixture.listenerDocumentId,
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
