import {
  type ContractApiViews,
  type ContractDependencyUse,
  type ContractModule,
  type ContractUseFn,
  type DefineContractInput,
  type DefinedContract as BaseDefinedContract,
  type EmptyApi,
  type SdkContractModule,
  type TrellisApiLike,
  type TrellisContractV1,
  type UseSpec,
} from "../contracts/mod.ts";

// Keep this module browser-safe.
//
// `js/apps/*` and other callers build contracts from `@qlever-llc/trellis/contracts`, and those
// apps need to build inside a clean OCI build stage. If this file reaches into
// `../server/*`, Vite pulls Deno-only NATS transports into browser bundles and the
// container build stops being reproducible. Server-specific helpers therefore live
// in `@qlever-llc/trellis/server` and are wired explicitly by server code.
export type DefinedContract<
  TOwnedApi extends {
    rpc: Record<string, unknown>;
    operations: Record<string, unknown>;
    events: Record<string, unknown>;
    subjects: Record<string, unknown>;
  },
  TUsedApi extends {
    rpc: Record<string, unknown>;
    operations: Record<string, unknown>;
    events: Record<string, unknown>;
    subjects: Record<string, unknown>;
  },
  TTrellisApi extends {
    rpc: Record<string, unknown>;
    operations: Record<string, unknown>;
    events: Record<string, unknown>;
    subjects: Record<string, unknown>;
  },
  TContractId extends string = string,
> = BaseDefinedContract<TOwnedApi, TUsedApi, TTrellisApi, TContractId>;

export {
  defineAppContract,
  defineCliContract,
  defineDeviceContract,
  definePortalContract,
  defineServiceContract,
} from "../contracts/mod.ts";

export type {
  ContractApiViews,
  ContractDependencyUse,
  ContractModule,
  ContractUseFn,
  DefineContractInput,
  EmptyApi,
  SdkContractModule,
  TrellisApiLike,
  TrellisContractV1,
  UseSpec,
};
