// Generated from ./generated/contracts/manifests/trellis.core@v1.json
import type { TrellisAPI } from "@qlever-llc/trellis/contracts";
import { schema } from "@qlever-llc/trellis/contracts";
import type * as Types from "./types.ts";
import {
  TrellisBindingsGetRequestSchema,
  TrellisBindingsGetResponseSchema,
  TrellisCatalogRequestSchema,
  TrellisCatalogResponseSchema,
  TrellisContractGetRequestSchema,
  TrellisContractGetResponseSchema,
  TrellisSurfaceStatusRequestSchema,
  TrellisSurfaceStatusResponseSchema,
} from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Trellis.Bindings.Get": {
      subject: "rpc.v1.Trellis.Bindings.Get",
      input: schema<Types.TrellisBindingsGetInput>(
        TrellisBindingsGetRequestSchema,
      ),
      output: schema<Types.TrellisBindingsGetOutput>(
        TrellisBindingsGetResponseSchema,
      ),
      callerCapabilities: ["service"],
      errors: ["UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: ["UnexpectedError", "ValidationError"] as const,
    },
    "Trellis.Catalog": {
      subject: "rpc.v1.Trellis.Catalog",
      input: schema<Types.TrellisCatalogInput>(TrellisCatalogRequestSchema),
      output: schema<Types.TrellisCatalogOutput>(TrellisCatalogResponseSchema),
      callerCapabilities: ["trellis.core::catalog.read"],
      errors: ["UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: ["UnexpectedError", "ValidationError"] as const,
    },
    "Trellis.Contract.Get": {
      subject: "rpc.v1.Trellis.Contract.Get",
      input: schema<Types.TrellisContractGetInput>(
        TrellisContractGetRequestSchema,
      ),
      output: schema<Types.TrellisContractGetOutput>(
        TrellisContractGetResponseSchema,
      ),
      callerCapabilities: ["trellis.core::contract.read"],
      errors: ["UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: ["UnexpectedError", "ValidationError"] as const,
    },
    "Trellis.Surface.Status": {
      subject: "rpc.v1.Trellis.Surface.Status",
      input: schema<Types.TrellisSurfaceStatusInput>(
        TrellisSurfaceStatusRequestSchema,
      ),
      output: schema<Types.TrellisSurfaceStatusOutput>(
        TrellisSurfaceStatusResponseSchema,
      ),
      callerCapabilities: ["trellis.core::catalog.read"],
      errors: ["UnexpectedError", "ValidationError"] as const,
      declaredErrorTypes: ["UnexpectedError", "ValidationError"] as const,
    },
  },
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
} satisfies TrellisAPI;
