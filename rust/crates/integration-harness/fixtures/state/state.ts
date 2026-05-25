import { defineAgentContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as state } from "@qlever-llc/trellis/sdk/state";
import { Type } from "typebox";

const schemas = {
  Preferences: Type.Object({ theme: Type.String(), density: Type.String() }),
  Draft: Type.Object({ title: Type.String(), body: Type.String() }),
} as const;

const contract = defineAgentContract({ schemas }, (ref) => ({
  id: "trellis.integration-state-agent@v1",
  displayName: "Trellis Integration State Agent",
  description:
    "Verify Rust and TypeScript state facade parity against Trellis runtime state stores.",
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
  uses: {
    required: {
      auth: auth.use({
        rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
      }),
      state: state.use({
        rpc: {
          call: [
            "State.Get",
            "State.Put",
            "State.Delete",
            "State.List",
            "State.Admin.Get",
            "State.Admin.List",
            "State.Admin.Delete",
          ],
        },
      }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(
    `state contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`,
  );
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: undefined,
}).orThrow();

const missing = await client.state.preferences.get().orThrow();
if (!("found" in missing) || missing.found !== false) {
  throw new Error(
    `expected missing TS preferences: ${JSON.stringify(missing)}`,
  );
}

const created = await client.state.preferences.put({
  theme: "ts-dark",
  density: "comfortable",
}, { expectedRevision: null }).orThrow();
if (
  !created.applied || !created.entry || created.entry.value.theme !== "ts-dark"
) {
  throw new Error(`expected TS preferences create: ${JSON.stringify(created)}`);
}

const found = await client.state.preferences.get().orThrow();
if (
  !("found" in found) || !found.found ||
  found.entry.value.density !== "comfortable"
) {
  throw new Error(`expected TS preferences get: ${JSON.stringify(found)}`);
}

const deleted = await client.state.preferences.delete({
  expectedRevision: created.entry.revision,
}).orThrow();
if (!deleted.deleted) {
  throw new Error(`expected TS preferences delete: ${JSON.stringify(deleted)}`);
}

const drafts = client.state.drafts.prefix("inspection");
const draft = await drafts.put("ts-draft", {
  title: "TS Draft",
  body: "from TypeScript",
}, { expectedRevision: null }).orThrow();
if (
  !draft.applied || !draft.entry || draft.entry.key !== "inspection/ts-draft"
) {
  throw new Error(`expected TS draft create: ${JSON.stringify(draft)}`);
}

const gotDraft = await drafts.get("ts-draft").orThrow();
if (
  !("found" in gotDraft) || !gotDraft.found ||
  gotDraft.entry.value.title !== "TS Draft"
) {
  throw new Error(`expected TS draft get: ${JSON.stringify(gotDraft)}`);
}

const listed = await drafts.list().orThrow();
const listedDraft = listed.entries.find((entry) =>
  !("migrationRequired" in entry) && entry.key === "inspection/ts-draft"
);
if (!listedDraft) {
  throw new Error(`expected TS draft in list: ${JSON.stringify(listed)}`);
}

const deletedDraft = await drafts.delete("ts-draft", {
  expectedRevision: draft.entry.revision,
}).orThrow();
if (!deletedDraft.deleted) {
  throw new Error(`expected TS draft delete: ${JSON.stringify(deletedDraft)}`);
}

const finalDraft = await drafts.get("ts-draft").orThrow();
if (!("found" in finalDraft) || finalDraft.found !== false) {
  throw new Error(`expected missing TS draft: ${JSON.stringify(finalDraft)}`);
}

await client.connection.close();
console.log("TS_STATE_OK");
