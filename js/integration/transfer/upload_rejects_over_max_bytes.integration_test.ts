import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createTransferFixture } from "./_fixture.ts";

const CASE_ID = "transfer.upload-rejects-over-max-bytes" as const;
const fixture = createTransferFixture(CASE_ID, { maxObjectBytes: 1024 });

liveTrellisTest({
  name:
    "transfer.upload-rejects-over-max-bytes rejects uploads over the store-derived limit",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await fixture.withTransferFixture(runtime, async ({ runtime: rt }) => {
      const client = await rt.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const upload = await client.operation.files.upload.input({
        key: fixture.uploadKey,
        contentType: "application/octet-stream",
      }).transfer(new Uint8Array(2048)).start().orThrow();

      const result = await upload.wait();
      assertEquals(result.isErr(), true);
      const error = result.match({
        ok: () => {
          throw new Error("oversized upload unexpectedly succeeded");
        },
        err: (value) => value,
      });
      assertEquals(error.getContext().reason, "max_bytes_exceeded");
      assertEquals(error.getContext().maxBytes, 1024);
      assertEquals(error.getContext().attemptedBytes, 2048);
    });
  },
});
