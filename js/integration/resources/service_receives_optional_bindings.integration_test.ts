import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createResourcesFixture } from "./_fixture.ts";

const CASE_ID = "resources.service-receives-optional-bindings" as const;
const fixture = createResourcesFixture(CASE_ID);

liveTrellisTest({
  name:
    "resources.service-receives-optional-bindings has optional KV and store handles when declared",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.connectService(runtime);
    try {
      assertEquals(typeof service.kv.optionalRecords, "object");
      assertEquals(typeof service.store.optionalBlobs, "object");
    } finally {
      await service.stop();
    }
  },
});
