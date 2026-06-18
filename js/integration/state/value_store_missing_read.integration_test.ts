import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createStateFixture } from "./_fixture.ts";

const CASE_ID = "state.value-store-missing-read" as const;
const fixture = createStateFixture(CASE_ID);

liveTrellisTest({
  name: "state.value-store-missing-read returns found false for empty store",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const client = await runtime.connectClient({
      name: fixture.clientName,
      contract: fixture.clientContract,
    });

    const missingPreferences = await client.state.preferences.get().orThrow();
    assertEquals(missingPreferences, { found: false });
  },
});
