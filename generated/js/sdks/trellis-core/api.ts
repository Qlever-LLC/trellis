// Generated from ./generated/contracts/manifests/trellis.core@v1.json
import type { TrellisAPI } from "@qlever-llc/trellis-contracts";
import { schema } from "@qlever-llc/trellis-contracts";
import * as Types from "./types.ts";
import { SCHEMAS } from "./schemas.ts";

export const OWNED_API = {
  rpc: {
    "Trellis.Bindings.Get": {
      subject: "rpc.v1.Trellis.Bindings.Get",
      input: schema<Types.TrellisBindingsGetInput>(SCHEMAS.rpc["Trellis.Bindings.Get"].input),
      output: schema<Types.TrellisBindingsGetOutput>(SCHEMAS.rpc["Trellis.Bindings.Get"].output),
      callerCapabilities: ["service"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
    "Trellis.Catalog": {
      subject: "rpc.v1.Trellis.Catalog",
      input: schema<Types.TrellisCatalogInput>(SCHEMAS.rpc["Trellis.Catalog"].input),
      output: schema<Types.TrellisCatalogOutput>(SCHEMAS.rpc["Trellis.Catalog"].output),
      callerCapabilities: ["trellis.catalog.read"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
    "Trellis.Contract.Get": {
      subject: "rpc.v1.Trellis.Contract.Get",
      input: schema<Types.TrellisContractGetInput>(SCHEMAS.rpc["Trellis.Contract.Get"].input),
      output: schema<Types.TrellisContractGetOutput>(SCHEMAS.rpc["Trellis.Contract.Get"].output),
      callerCapabilities: ["trellis.contract.read"],
      errors: ["ValidationError","UnexpectedError"] as const,
    },
  },
  events: {
  },
  subjects: {
  },
} satisfies TrellisAPI;

const EMPTY_API = { rpc: {}, events: {}, subjects: {} } as const satisfies TrellisAPI;

export const API = {
  owned: OWNED_API,
  used: EMPTY_API,
  trellis: OWNED_API,
} as const;

export type OwnedApi = typeof API.owned;
export type Api = typeof API.trellis;
export type ApiViews = typeof API;

