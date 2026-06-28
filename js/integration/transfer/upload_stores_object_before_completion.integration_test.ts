import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createTransferFixture } from "./_fixture.ts";

const CASE_ID = "transfer.upload-stores-object-before-completion" as const;
const uploadBody = "stored callback";
let resolveStored!: (
  object: { key: string; body: Uint8Array; size: number },
) => void;
const stored = new Promise<{ key: string; body: Uint8Array; size: number }>(
  (resolve) => {
    resolveStored = resolve;
  },
);
const fixture = createTransferFixture(CASE_ID, { onStored: resolveStored });

liveTrellisTest({
  name:
    "transfer.upload-stores-object-before-completion observes stored bytes before completion",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    await fixture.withTransferFixture(runtime, async ({ runtime: rt }) => {
      const client = await rt.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const uploadBytes = new TextEncoder().encode(uploadBody);
      const upload = await client.operation.files.upload.input({
        key: fixture.uploadKey,
        contentType: "text/plain",
      }).transfer(uploadBytes).start().orThrow();
      const completed = await upload.wait().orThrow();
      const observed = await stored;

      assertEquals(completed.terminal.state, "completed");
      assertEquals(observed.key, fixture.uploadKey);
      assertEquals(new TextDecoder().decode(observed.body), uploadBody);
      assertEquals(observed.size, uploadBytes.length);
    });
  },
});
