import { assert, assertEquals, assertExists } from "@std/assert";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createStateFixture } from "./_fixture.ts";

const CASE_ID = "state.admin-inspect-and-delete-state" as const;
const fixture = createStateFixture(CASE_ID);

liveTrellisTest({
  name:
    "state.admin-inspect-and-delete-state inspects and deletes user app state through admin RPCs",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const client = await runtime.connectClient({
      name: fixture.clientName,
      contract: fixture.clientContract,
    });
    const admin = await runtime.connectClient({
      name: fixture.adminName,
      contract: fixture.adminContract,
    });

    const preferences = await client.state.preferences.put(
      { theme: "dark", density: "comfortable" },
      { expectedRevision: null },
    ).orThrow();
    assert(preferences.applied, "expected preferences write to apply");

    const drafts = client.state.drafts.prefix(fixture.draftPrefix);
    const draft = await drafts.put(
      fixture.draftKey,
      { title: "Admin Inspection", body: "from integration test" },
      { expectedRevision: null },
    ).orThrow();
    assert(draft.applied, "expected draft write to apply");

    const sessions = await admin.rpc.auth.sessionsList({ limit: 500 })
      .orThrow();
    const session = sessions.entries.find((entry) =>
      entry.participantKind === "app" &&
      entry.contractId === fixture.clientContract.CONTRACT_ID
    );
    assertExists(
      session,
      "expected Auth.Sessions.List to include state client",
    );
    const principal = session.principal;
    if (principal.type !== "user") {
      throw new Error("expected state client session to have a user principal");
    }

    const stateTarget = {
      scope: "userApp" as const,
      contractId: fixture.clientContract.CONTRACT_ID,
      contractDigest: fixture.clientContract.CONTRACT_DIGEST,
      user: {
        origin: principal.identity.provider,
        id: principal.identity.subject,
        userId: principal.userId,
      },
    };

    const adminPreferences = await admin.rpc.state.adminGet({
      ...stateTarget,
      store: "preferences",
    }).orThrow();
    if ("migrationRequired" in adminPreferences || !adminPreferences.found) {
      throw new Error("expected admin get to find current preferences");
    }
    assertEquals(adminPreferences.entry.value, {
      theme: "dark",
      density: "comfortable",
    });
    assertEquals(adminPreferences.entry.revision, preferences.entry.revision);
    assertExists(adminPreferences.entry.updatedAt);

    const listedDrafts = await admin.rpc.state.adminList({
      ...stateTarget,
      store: "drafts",
      prefix: fixture.draftPrefix,
      offset: 0,
      limit: 10,
    }).orThrow();
    const listedDraft = listedDrafts.entries.find((entry) =>
      !("migrationRequired" in entry) &&
      entry.key === `${fixture.draftPrefix}/${fixture.draftKey}`
    );
    assertExists(listedDraft, "expected admin list to include draft state");
    assert(!("migrationRequired" in listedDraft));
    assertEquals(listedDraft.value, {
      title: "Admin Inspection",
      body: "from integration test",
    });
    assertEquals(listedDraft.revision, draft.entry.revision);

    const deletedPreferences = await admin.rpc.state.adminDelete({
      ...stateTarget,
      store: "preferences",
      expectedRevision: preferences.entry.revision,
    }).orThrow();
    assertEquals(deletedPreferences.deleted, true);

    const deletedDraft = await admin.rpc.state.adminDelete({
      ...stateTarget,
      store: "drafts",
      key: `${fixture.draftPrefix}/${fixture.draftKey}`,
      expectedRevision: draft.entry.revision,
    }).orThrow();
    assertEquals(deletedDraft.deleted, true);

    assertEquals(await client.state.preferences.get().orThrow(), {
      found: false,
    });
    assertEquals(await drafts.get(fixture.draftKey).orThrow(), {
      found: false,
    });
  },
});
