import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createTransferFixture } from "./_fixture.ts";

const CASE_ID = "transfer.client-uploads-file-via-operation" as const;
const fixture = createTransferFixture(CASE_ID);

liveTrellisTest({
  name:
    "transfer.client-uploads-file-via-operation uploads bytes through a transfer operation",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await fixture.withTransferFixture(runtime, async ({ runtime: rt }) => {
      const client = await rt.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const uploadBytes = new TextEncoder().encode("uploaded through transfer");
      const upload = await client.operation.files.upload.input({
        key: fixture.uploadKey,
        contentType: "text/plain",
      }).transfer(uploadBytes).start().orThrow();
      const completed = await upload.wait().orThrow();

      assertEquals(completed.transferred.size, uploadBytes.length);
      assertEquals(completed.transferred.key, fixture.uploadKey);
      assertEquals(completed.transferred.contentType, "text/plain");
      assertEquals(completed.terminal.state, "completed");
      assertEquals(completed.terminal.output, {
        key: fixture.uploadKey,
        size: uploadBytes.length,
        contentType: "text/plain",
      });
    });
  },
});
