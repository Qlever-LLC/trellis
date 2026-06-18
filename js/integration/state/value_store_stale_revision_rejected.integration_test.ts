import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createStateFixture } from "./_fixture.ts";

const CASE_ID = "state.value-store-stale-revision-rejected" as const;
const fixture = createStateFixture(CASE_ID);

liveTrellisTest({
  name:
    "state.value-store-stale-revision-rejected rejects write with stale revision",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const client = await runtime.connectClient({
      name: fixture.clientName,
      contract: fixture.clientContract,
    });

    const created = await client.state.preferences.put(
      { theme: "dark", density: "comfortable" },
      { expectedRevision: null },
    ).orThrow();
    assertEquals(created.applied, true);

    const staleWrite = await client.state.preferences.put(
      { theme: "light", density: "compact" },
      { expectedRevision: "stale-revision" },
    ).orThrow();
    assertEquals(staleWrite.applied, false);

    if (!created.applied || created.entry === undefined) {
      throw new Error("expected entry from create");
    }

    const staleDelete = await client.state.preferences.delete({
      expectedRevision: "stale-revision",
    }).orThrow();
    assertEquals(staleDelete.deleted, false);
  },
});
