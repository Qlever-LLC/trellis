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
import {
  TrellisSurfaceStatusRequestSchema,
  TrellisSurfaceStatusResponseSchema,
} from "../../../packages/trellis/models/trellis/rpc/TrellisSurfaceStatus.ts";

const schemas = {
  TrellisCatalogRequest: TrellisCatalogRequestSchema,
  TrellisCatalogResponse: TrellisCatalogResponseSchema,
  TrellisContractGetRequest: TrellisContractGetRequestSchema,
  TrellisContractGetResponse: TrellisContractGetResponseSchema,
  TrellisBindingsGetRequest: TrellisBindingsGetRequestSchema,
  TrellisBindingsGetResponse: TrellisBindingsGetResponseSchema,
  TrellisSurfaceStatusRequest: TrellisSurfaceStatusRequestSchema,
  TrellisSurfaceStatusResponse: TrellisSurfaceStatusResponseSchema,
} as const;

export const trellisCore = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.core@v1",
    displayName: "Trellis Core",
    description:
      "Trellis runtime RPCs available to all connected participants.",
    capabilities: {
      "trellis.catalog.read": {
        displayName: "Read contract catalog",
        description: "List the installed Trellis contract catalog.",
      },
      "trellis.contract.read": {
        displayName: "Read installed contracts",
        description: "Read installed contract manifests and metadata.",
      },
    },
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
      "Trellis.Surface.Status": {
        version: "v1",
        input: ref.schema("TrellisSurfaceStatusRequest"),
        output: ref.schema("TrellisSurfaceStatusResponse"),
        capabilities: { call: ["trellis.catalog.read"] },
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
