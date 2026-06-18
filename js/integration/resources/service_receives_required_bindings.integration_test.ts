import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createResourcesFixture } from "./_fixture.ts";

const CASE_ID = "resources.service-receives-required-bindings" as const;
const fixture = createResourcesFixture(CASE_ID);

liveTrellisTest({
  name:
    "resources.service-receives-required-bindings has required KV and store handles materialized",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    try {
      assertEquals(typeof service.kv.records, "object");
      assertEquals(typeof service.store.blobs, "object");
    } finally {
      await service.stop();
    }
  },
});
