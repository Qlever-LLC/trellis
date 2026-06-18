import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createResourcesFixture } from "./_fixture.ts";

const CASE_ID = "resources.service-kv-stale-revision-rejected" as const;
const fixture = createResourcesFixture(CASE_ID);

liveTrellisTest({
  name:
    "resources.service-kv-stale-revision-rejected fails on stale revision KV operations",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.rpc.resources.exercise(async ({ input, client }) => {
        const kvKey = `${input.key}.kv`;

        await client.kv.records.create(kvKey, { message: "initial" })
          .orThrow();

        const entry = await client.kv.records.get(kvKey).orThrow();
        assertEquals(entry.value.message, "initial");

        await client.kv.records.put(kvKey, { message: "updated" }).orThrow();

        const stalePutResult = await entry.put({ message: "stale" }, true);
        assertEquals(stalePutResult.isErr(), true);

        const staleDeleteResult = await entry.delete(true);
        assertEquals(staleDeleteResult.isErr(), true);

        await client.kv.records.delete(kvKey).orThrow();

        return Result.ok({
          provider: "ts",
          storeText: "",
          kvMessage: "stale-test-passed",
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
        storeText: "",
        kvMessage: "stale-test-passed",
      });
    } finally {
      await service.stop();
    }
  },
});
