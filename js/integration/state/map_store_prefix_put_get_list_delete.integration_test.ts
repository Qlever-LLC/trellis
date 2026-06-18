import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createStateFixture } from "./_fixture.ts";

const CASE_ID = "state.map-store-prefix-put-get-list-delete" as const;
const fixture = createStateFixture(CASE_ID);

liveTrellisTest({
  name:
    "state.map-store-prefix-put-get-list-delete writes, reads, lists, and deletes prefixed map entries",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const client = await runtime.connectClient({
      name: fixture.clientName,
      contract: fixture.clientContract,
    });

    const drafts = client.state.drafts.prefix(fixture.draftPrefix);

    const created = await drafts.put(
      fixture.draftKey,
      { title: "State Draft", body: "from integration test" },
      { expectedRevision: null },
    ).orThrow();
    assertEquals(created.applied, true);
    if (!created.applied || created.entry === undefined) {
      throw new Error("expected draft create to return an entry");
    }
    assertEquals(
      created.entry.key,
      `${fixture.draftPrefix}/${fixture.draftKey}`,
    );

    const found = await drafts.get(fixture.draftKey).orThrow();
    if ("migrationRequired" in found || !found.found) {
      throw new Error("expected current draft entry");
    }
    assertEquals(found.entry.value, {
      title: "State Draft",
      body: "from integration test",
    });

    const listed = await drafts.list({ limit: 10 }).orThrow();
    let listedEntry;
    for (const entry of listed.entries) {
      if (
        !("migrationRequired" in entry) &&
        entry.key === `${fixture.draftPrefix}/${fixture.draftKey}`
      ) {
        listedEntry = entry;
        break;
      }
    }
    if (listedEntry === undefined || "migrationRequired" in listedEntry) {
      throw new Error("expected state draft in prefixed list");
    }
    assertEquals(listedEntry.value, {
      title: "State Draft",
      body: "from integration test",
    });

    const deleted = await drafts.delete(fixture.draftKey, {
      expectedRevision: created.entry.revision,
    }).orThrow();
    assertEquals(deleted.deleted, true);

    assertEquals(await drafts.get(fixture.draftKey).orThrow(), {
      found: false,
    });
  },
});
