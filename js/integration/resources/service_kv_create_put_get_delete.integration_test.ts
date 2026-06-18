import { assertEquals } from "@std/assert";
import { Result } from "@qlever-llc/trellis";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createResourcesFixture } from "./_fixture.ts";

const CASE_ID = "resources.service-kv-create-put-get-delete" as const;
const fixture = createResourcesFixture(CASE_ID);

liveTrellisTest({
  name:
    "resources.service-kv-create-put-get-delete uses KV resources during a client RPC",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);

    try {
      await service.handle.rpc.resources.exercise(async ({ input, client }) => {
        const kvKey = `${input.key}.kv`;
        await client.kv.records.create(kvKey, { message: input.message })
          .orThrow();
        await client.kv.records.put(kvKey, { message: `kv:${input.message}` })
          .orThrow();
        const kvEntry = await client.kv.records.get(kvKey).orThrow();
        const kvMessage = kvEntry.value.message;

        await kvEntry.delete(true).orThrow();

        return Result.ok({ provider: "ts", storeText: "", kvMessage });
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
        kvMessage: "kv:client to resources",
      });
    } finally {
      await service.stop();
    }
  },
});
