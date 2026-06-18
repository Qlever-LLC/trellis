import { assertEquals } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createStateFixture } from "./_fixture.ts";

const CASE_ID = "state.value-store-create-read-delete" as const;
const fixture = createStateFixture(CASE_ID);

liveTrellisTest({
  name:
    "state.value-store-create-read-delete creates, reads, and deletes a value state entry",
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
    if (!created.applied || created.entry === undefined) {
      throw new Error("expected preferences create to return an entry");
    }
    assertEquals(created.entry.value, {
      theme: "dark",
      density: "comfortable",
    });

    const found = await client.state.preferences.get().orThrow();
    if ("migrationRequired" in found || !found.found) {
      throw new Error("expected current preferences entry");
    }
    assertEquals(found.entry.value, {
      theme: "dark",
      density: "comfortable",
    });

    const deleted = await client.state.preferences.delete({
      expectedRevision: created.entry.revision,
    }).orThrow();
    assertEquals(deleted.deleted, true);

    assertEquals(await client.state.preferences.get().orThrow(), {
      found: false,
    });
  },
});
