import { defineContract } from "@qlever-llc/trellis-contracts";
import {
  TrellisBindingsGetRequestSchema,
  TrellisBindingsGetResponseSchema,
} from "../../../../packages/trellis/models/trellis/rpc/TrellisBindingsGet.ts";
import {
  TrellisCatalogRequestSchema,
  TrellisCatalogResponseSchema,
} from "../../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import {
  TrellisContractGetRequestSchema,
  TrellisContractGetResponseSchema,
} from "../../../../packages/trellis/models/trellis/rpc/TrellisContractGet.ts";

const schemas = {
  TrellisCatalogRequest: TrellisCatalogRequestSchema,
  TrellisCatalogResponse: TrellisCatalogResponseSchema,
  TrellisContractGetRequest: TrellisContractGetRequestSchema,
  TrellisContractGetResponse: TrellisContractGetResponseSchema,
  TrellisBindingsGetRequest: TrellisBindingsGetRequestSchema,
  TrellisBindingsGetResponse: TrellisBindingsGetResponseSchema,
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(schema: TName) {
  return { schema } as const;
}

export const trellisCore = defineContract({
  id: "trellis.core@v1",
  displayName: "Trellis Core",
  description: "Trellis runtime RPCs available to all connected participants.",
  kind: "service",
  schemas,
  rpc: {
    "Trellis.Catalog": {
      version: "v1",
      input: schemaRef("TrellisCatalogRequest"),
      output: schemaRef("TrellisCatalogResponse"),
      capabilities: { call: ["trellis.catalog.read"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Trellis.Contract.Get": {
      version: "v1",
      input: schemaRef("TrellisContractGetRequest"),
      output: schemaRef("TrellisContractGetResponse"),
      capabilities: { call: ["trellis.contract.read"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Trellis.Bindings.Get": {
      version: "v1",
      input: schemaRef("TrellisBindingsGetRequest"),
      output: schemaRef("TrellisBindingsGetResponse"),
      capabilities: { call: ["service"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisCore;
