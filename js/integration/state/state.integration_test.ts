import { assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";
import { Type } from "typebox";
import { withTrellisRuntime } from "../_support/runtime.ts";

const stateSchemas = {
  Preferences: Type.Object({
    theme: Type.String(),
    density: Type.String(),
  }),
  Draft: Type.Object({
    title: Type.String(),
    body: Type.String(),
  }),
} as const;

const stateClientContract = defineAppContract(
  { schemas: stateSchemas },
  (ref) => ({
    id: "trellis.integration.state-client@v1",
    displayName: "Trellis Integration State Client",
    description: "Exercises generated contract-owned state store surfaces.",
    state: {
      preferences: {
        kind: "value",
        schema: ref.schema("Preferences"),
        stateVersion: "preferences.v1",
      },
      drafts: {
        kind: "map",
        schema: ref.schema("Draft"),
        stateVersion: "drafts.v1",
      },
    },
  }),
);

Deno.test("state.client-reads-and-updates-shared-state reads and updates value and map stores", async () => {
  await withTrellisRuntime(async (runtime) => {
    const client = await runtime.connectClient({
      name: "state-fixture-client",
      contract: stateClientContract,
    });

    const missingPreferences = await client.state.preferences.get().orThrow();
    assertEquals(missingPreferences, { found: false });

    const createdPreferences = await client.state.preferences.put({
      theme: "dark",
      density: "comfortable",
    }, { expectedRevision: null }).orThrow();
    assertEquals(createdPreferences.applied, true);
    if (!createdPreferences.applied || createdPreferences.entry === undefined) {
      throw new Error("expected preferences create to return an entry");
    }
    assertEquals(createdPreferences.entry.value, {
      theme: "dark",
      density: "comfortable",
    });

    const foundPreferences = await client.state.preferences.get().orThrow();
    if (
      "migrationRequired" in foundPreferences ||
      !foundPreferences.found
    ) {
      throw new Error("expected current preferences entry");
    }
    assertEquals(foundPreferences.entry.value, {
      theme: "dark",
      density: "comfortable",
    });

    const deletedPreferences = await client.state.preferences.delete({
      expectedRevision: createdPreferences.entry.revision,
    }).orThrow();
    assertEquals(deletedPreferences.deleted, true);
    assertEquals(await client.state.preferences.get().orThrow(), {
      found: false,
    });

    const drafts = client.state.drafts.prefix("inspection");
    const createdDraft = await drafts.put("state-draft", {
      title: "State Draft",
      body: "from integration test",
    }, { expectedRevision: null }).orThrow();
    assertEquals(createdDraft.applied, true);
    if (!createdDraft.applied || createdDraft.entry === undefined) {
      throw new Error("expected draft create to return an entry");
    }
    assertEquals(createdDraft.entry.key, "inspection/state-draft");

    const foundDraft = await drafts.get("state-draft").orThrow();
    if ("migrationRequired" in foundDraft || !foundDraft.found) {
      throw new Error("expected current draft entry");
    }
    assertEquals(foundDraft.entry.value, {
      title: "State Draft",
      body: "from integration test",
    });

    const listed = await drafts.list({ limit: 10 }).orThrow();
    const listedDraft = listed.entries.find((entry) =>
      !("migrationRequired" in entry) &&
      entry.key === "inspection/state-draft"
    );
    if (listedDraft === undefined || "migrationRequired" in listedDraft) {
      throw new Error("expected state draft in prefixed list");
    }
    assertEquals(listedDraft.value, {
      title: "State Draft",
      body: "from integration test",
    });

    const deletedDraft = await drafts.delete("state-draft", {
      expectedRevision: createdDraft.entry.revision,
    }).orThrow();
    assertEquals(deletedDraft.deleted, true);
    assertEquals(await drafts.get("state-draft").orThrow(), { found: false });
  });
});
