import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createResourcesFixture } from "./_fixture.ts";

const CASE_ID = "resources.service-store-create-read-list-delete" as const;
const fixture = createResourcesFixture(CASE_ID);

liveTrellisTest({
  name:
    "resources.service-store-create-read-list-delete uses store resources during a client RPC",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.rpc.resources.exercise(async ({ input, client }) => {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const store = await client.store.blobs.open().orThrow();
        const storeKey = `${input.key}.store`;
        const storeText = `store:${input.message}`;

        await store.create(storeKey, encoder.encode(storeText), {
          contentType: "text/plain",
          metadata: { source: "resources-integration" },
        }).orThrow();
        const storeEntry = await store.waitFor(storeKey, {
          timeoutMs: 5000,
          pollIntervalMs: 25,
        }).orThrow();
        assertEquals(storeEntry.info.contentType, "text/plain");
        assertEquals(storeEntry.info.metadata.source, "resources-integration");
        const readText = decoder.decode(await storeEntry.bytes().orThrow());

        const status = await store.status().orThrow();
        assertEquals(status.ttlMs, 0);
        assertEquals(status.maxTotalBytes, 4194304);
        const listed = await store.list({ prefix: input.key, limit: 10 })
          .orThrow();
        if (!listed.entries.some((entry) => entry.key === storeKey)) {
          throw new Error(`store list did not include ${storeKey}`);
        }

        await store.delete(storeKey).orThrow();

        return Result.ok({
          provider: "ts",
          storeText: readText,
          kvMessage: "",
        });
      });

      const client = await runtime.connectClient({
        name: fixture.clientName,
        contract: fixture.clientContract,
      });

      const result = await client.rpc.resources.exercise({
        key: fixture.resourceKey,
        message: "client to resources",
      }).orThrow();
      assertEquals(result, {
        provider: "ts",
        storeText: "store:client to resources",
        kvMessage: "",
      });
    } finally {
      await service.stop();
    }
  },
});
