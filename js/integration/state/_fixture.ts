import { defineAppContract } from "@qlever-llc/trellis";
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

  return {
    slug,
    clientContract,
    clientName: caseScopedName("state-fixture-client", caseId),
    draftPrefix: caseScopedName("inspection", caseId),
    draftKey: caseScopedName("state-draft", caseId),
    limitPrefix: caseScopedName("limit-test", caseId),
  };
}
