import { assertEquals, assertExists } from "@std/assert";
import { defineAppContract, TrellisClient } from "@qlever-llc/trellis";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import {
  liveTrellisTest,
  restartTrellisControlPlane,
  runtimeScopeForCase,
} from "../_support/runtime.ts";

const CASE_ID =
  "control-plane.state-persists-across-control-plane-restart" as const;

const schemas = {
  Preferences: Type.Object({
    theme: Type.String(),
    density: Type.String(),
  }),
  Draft: Type.Object({
    title: Type.String(),
    body: Type.String(),
  }),
} as const;

const clientContract = defineAppContract({ schemas }, (ref) => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.state-restart-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane State Restart Client",
  description:
    "Verifies contract-owned state remains readable after control-plane restart.",
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
}));

const clientName = caseScopedName("state-restart-client", CASE_ID);
const draftPrefix = caseScopedName("restart", CASE_ID);
const draftKey = caseScopedName("state-draft", CASE_ID);

liveTrellisTest({
  name:
    "control-plane.state-persists-across-control-plane-restart reads state written before restart",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);

    let client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: clientName,
      contract: clientContract,
      auth: clientAuth.auth,
      onAuthRequired: clientAuth.onAuthRequired,
    }).orThrow();

    try {
      const preferences = await client.state.preferences.put(
        { theme: "dark", density: "comfortable" },
        { expectedRevision: null },
      ).orThrow();
      assertEquals(preferences.applied, true);
      if (!preferences.applied || preferences.entry === undefined) {
        throw new Error("expected preferences write to return an entry");
      }
      assertExists(preferences.entry.updatedAt);

      const drafts = client.state.drafts.prefix(draftPrefix);
      const draft = await drafts.put(
        draftKey,
        { title: "Restart Draft", body: "from before restart" },
        { expectedRevision: null },
      ).orThrow();
      assertEquals(draft.applied, true);
      if (!draft.applied || draft.entry === undefined) {
        throw new Error("expected draft write to return an entry");
      }
      assertExists(draft.entry.updatedAt);

      await client.connection.close();

      await restartTrellisControlPlane(runtime);

      client = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: clientName,
        contract: clientContract,
        auth: clientAuth.auth,
      }).orThrow();

      const foundPreferences = await client.state.preferences.get().orThrow();
      if ("migrationRequired" in foundPreferences || !foundPreferences.found) {
        throw new Error("expected current preferences entry after restart");
      }
      assertEquals(foundPreferences.entry.value, {
        theme: "dark",
        density: "comfortable",
      });
      assertEquals(
        foundPreferences.entry.revision,
        preferences.entry.revision,
      );
      assertEquals(
        foundPreferences.entry.updatedAt,
        preferences.entry.updatedAt,
      );

      const foundDraft = await client.state.drafts.prefix(draftPrefix).get(
        draftKey,
      ).orThrow();
      if ("migrationRequired" in foundDraft || !foundDraft.found) {
        throw new Error("expected current draft entry after restart");
      }
      assertEquals(foundDraft.entry.key, `${draftPrefix}/${draftKey}`);
      assertEquals(foundDraft.entry.value, {
        title: "Restart Draft",
        body: "from before restart",
      });
      assertEquals(foundDraft.entry.revision, draft.entry.revision);
      assertEquals(foundDraft.entry.updatedAt, draft.entry.updatedAt);
    } finally {
      await client.connection.close().catch(() => undefined);
    }
  },
});
