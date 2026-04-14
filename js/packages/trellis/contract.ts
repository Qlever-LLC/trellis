import type { TrellisAPI } from "../contracts/mod.ts";
import {
  type DefinedContract as BaseDefinedContract,
  type ContractApiViews,
  type ContractDependencyUse,
  type ContractModule,
  type ContractUseFn,
  type DefineContractInput,
  defineContract as defineContractBase,
  type EmptyApi,
  type MergeApis,
  type OwnedApiFromSource,
  type SdkContractModule,
  type TrellisApiLike,
  type TrellisContractV1,
  type UsedApiFromUses,
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

export function defineContract<
  const T extends DefineContractInput<any, any, any, any, any, any, any>,
>(
  source: T,
): DefinedContract<
  OwnedApiFromSource<T>,
  UsedApiFromUses<T["uses"]>,
  MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>,
  T["id"]
> {
  return defineContractBase(source) as DefinedContract<
    OwnedApiFromSource<T>,
    UsedApiFromUses<T["uses"]>,
    MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>,
    T["id"]
  >;
}

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
