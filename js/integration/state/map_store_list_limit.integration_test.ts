import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createStateFixture } from "./_fixture.ts";

const CASE_ID = "state.map-store-list-limit" as const;
const fixture = createStateFixture(CASE_ID);

liveTrellisTest({
  name: "state.map-store-list-limit returns no more than the requested limit",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const client = await runtime.connectClient({
      name: fixture.clientName,
      contract: fixture.clientContract,
    });

    const drafts = client.state.drafts.prefix(fixture.limitPrefix);

    for (let i = 1; i <= 5; i++) {
      const result = await drafts.put(
        `entry-${i}`,
        { title: `Entry ${i}`, body: "body" },
        { expectedRevision: null },
      ).orThrow();
      assertEquals(result.applied, true);
    }

    const listed = await drafts.list({ limit: 2 }).orThrow();
    assertEquals(listed.entries.length <= 2, true);
  },
});
