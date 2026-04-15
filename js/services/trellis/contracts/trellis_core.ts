import { defineServiceContract } from "@qlever-llc/trellis/contracts";
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

const schemas = {
  TrellisCatalogRequest: TrellisCatalogRequestSchema,
  TrellisCatalogResponse: TrellisCatalogResponseSchema,
  TrellisContractGetRequest: TrellisContractGetRequestSchema,
  TrellisContractGetResponse: TrellisContractGetResponseSchema,
  TrellisBindingsGetRequest: TrellisBindingsGetRequestSchema,
  TrellisBindingsGetResponse: TrellisBindingsGetResponseSchema,
} as const;

export const trellisCore = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.core@v1",
    displayName: "Trellis Core",
    description: "Trellis runtime RPCs available to all connected participants.",
    rpc: {
      "Trellis.Catalog": {
        version: "v1",
        input: ref.schema("TrellisCatalogRequest"),
        output: ref.schema("TrellisCatalogResponse"),
        capabilities: { call: ["trellis.catalog.read"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Trellis.Contract.Get": {
        version: "v1",
        input: ref.schema("TrellisContractGetRequest"),
        output: ref.schema("TrellisContractGetResponse"),
        capabilities: { call: ["trellis.contract.read"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
      "Trellis.Bindings.Get": {
        version: "v1",
        input: ref.schema("TrellisBindingsGetRequest"),
        output: ref.schema("TrellisBindingsGetResponse"),
        capabilities: { call: ["service"] },
        errors: [ref.error("ValidationError"), ref.error("UnexpectedError")],
      },
    },
  }),
);

export const CONTRACT_ID = trellisCore.CONTRACT_ID;
export const CONTRACT = trellisCore.CONTRACT;
export const CONTRACT_DIGEST = trellisCore.CONTRACT_DIGEST;
export const API: typeof trellisCore.API = trellisCore.API;
export const use: typeof trellisCore.use = trellisCore.use;
export default trellisCore;
