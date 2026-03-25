import { defineContract } from "@trellis/contracts";
import {
  TrellisBindingsGetRequestSchema,
  TrellisBindingsGetResponseSchema,
} from "../../../packages/trellis/models/trellis/rpc/TrellisBindingsGet.ts";
import {
  TrellisCatalogRequestSchema,
  TrellisCatalogResponseSchema,
} from "../../../packages/trellis/models/trellis/rpc/TrellisCatalog.ts";
import {
  TrellisContractGetRequestSchema,
  TrellisContractGetResponseSchema,
} from "../../../packages/trellis/models/trellis/rpc/TrellisContractGet.ts";

export const trellisCore = defineContract({
  id: "trellis.core@v1",
  displayName: "Trellis Core",
  description: "Trellis runtime RPCs available to all connected participants.",
  kind: "service",
  rpc: {
    "Trellis.Catalog": {
      version: "v1",
      inputSchema: TrellisCatalogRequestSchema,
      outputSchema: TrellisCatalogResponseSchema,
      capabilities: { call: ["trellis.catalog.read"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Trellis.Contract.Get": {
      version: "v1",
      inputSchema: TrellisContractGetRequestSchema,
      outputSchema: TrellisContractGetResponseSchema,
      capabilities: { call: ["trellis.contract.read"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Trellis.Bindings.Get": {
      version: "v1",
      inputSchema: TrellisBindingsGetRequestSchema,
      outputSchema: TrellisBindingsGetResponseSchema,
      capabilities: { call: ["service"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisCore;
