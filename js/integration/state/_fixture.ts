import { defineAppContract } from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as trellisState } from "@qlever-llc/trellis/sdk/state";
import { Type } from "typebox";
import {
  caseScopedContractId,
  caseScopedName,
  integrationSlug,
} from "../_support/names.ts";

export function createStateFixture(caseId: string) {
  const slug = integrationSlug(caseId);
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

  const clientContract = defineAppContract(
    { schemas: stateSchemas },
    (ref) => ({
      id: caseScopedContractId("trellis.integration.state-client", caseId),
      displayName: `Trellis Integration State Client (${slug})`,
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

  const adminContract = defineAppContract(() => ({
    id: caseScopedContractId("trellis.integration.state-admin", caseId),
    displayName: `Trellis Integration State Admin (${slug})`,
    description:
      "Admin participant for inspecting and deleting state through public generated RPCs.",
    uses: {
      required: {
        auth: trellisAuth.use({ rpc: { call: ["Auth.Sessions.List"] } }),
        state: trellisState.use({
          rpc: {
            call: [
              "State.Admin.Delete",
              "State.Admin.Get",
              "State.Admin.List",
            ],
          },
        }),
      },
    },
  }));

  return {
    slug,
    adminContract,
    adminName: caseScopedName("state-fixture-admin", caseId),
    clientContract,
    clientName: caseScopedName("state-fixture-client", caseId),
    draftPrefix: caseScopedName("inspection", caseId),
    draftKey: caseScopedName("state-draft", caseId),
    limitPrefix: caseScopedName("limit-test", caseId),
  };
}
