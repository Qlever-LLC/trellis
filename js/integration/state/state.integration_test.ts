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

Deno.test(
  "state.value-store-missing-read returns found false for empty store",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const client = await runtime.connectClient({
        name: "state-fixture-client",
        contract: stateClientContract,
      });

      const missingPreferences = await client.state.preferences.get().orThrow();
      assertEquals(missingPreferences, { found: false });
    });
  },
);

Deno.test(
  "state.value-store-create-read-delete creates, reads, and deletes a value state entry",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const client = await runtime.connectClient({
        name: "state-fixture-client",
        contract: stateClientContract,
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
    });
  },
);

Deno.test(
  "state.value-store-stale-revision-rejected rejects write with stale revision",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const client = await runtime.connectClient({
        name: "state-fixture-client",
        contract: stateClientContract,
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
    });
  },
);

Deno.test(
  "state.map-store-prefix-put-get-list-delete writes, reads, lists, and deletes prefixed map entries",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const client = await runtime.connectClient({
        name: "state-fixture-client",
        contract: stateClientContract,
      });

      const drafts = client.state.drafts.prefix("inspection");

      const created = await drafts.put(
        "state-draft",
        { title: "State Draft", body: "from integration test" },
        { expectedRevision: null },
      ).orThrow();
      assertEquals(created.applied, true);
      if (!created.applied || created.entry === undefined) {
        throw new Error("expected draft create to return an entry");
      }
      assertEquals(created.entry.key, "inspection/state-draft");

      const found = await drafts.get("state-draft").orThrow();
      if ("migrationRequired" in found || !found.found) {
        throw new Error("expected current draft entry");
      }
      assertEquals(found.entry.value, {
        title: "State Draft",
        body: "from integration test",
      });

      const listed = await drafts.list({ limit: 10 }).orThrow();
      const listedEntry = listed.entries.find((entry) =>
        !("migrationRequired" in entry) &&
        entry.key === "inspection/state-draft"
      );
      if (listedEntry === undefined || "migrationRequired" in listedEntry) {
        throw new Error("expected state draft in prefixed list");
      }
      assertEquals(listedEntry.value, {
        title: "State Draft",
        body: "from integration test",
      });

      const deleted = await drafts.delete("state-draft", {
        expectedRevision: created.entry.revision,
      }).orThrow();
      assertEquals(deleted.deleted, true);

      assertEquals(await drafts.get("state-draft").orThrow(), { found: false });
    });
  },
);

Deno.test(
  "state.map-store-list-limit returns no more than the requested limit",
  async () => {
    await withTrellisRuntime(async (runtime) => {
      const client = await runtime.connectClient({
        name: "state-fixture-client",
        contract: stateClientContract,
      });

      const drafts = client.state.drafts.prefix("limit-test");

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
    });
  },
);
