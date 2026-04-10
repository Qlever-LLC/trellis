import type { NatsConnection } from "@nats-io/nats-core";
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
import type { ClientOpts } from "./client.ts";
import { createClient } from "./client.ts";
import type { Trellis, TrellisAuth } from "./trellis.ts";

// Keep this module browser-safe.
//
// `js/apps/*` and other callers build contracts from `@qlever-llc/trellis/contracts`, and those
// apps need to build inside a clean OCI build stage. If this file reaches into
// `../server/*`, Vite pulls Deno-only NATS transports into browser bundles and the
// container build stops being reproducible. Server-specific helpers therefore live
// in `@qlever-llc/trellis/server` and are wired explicitly by server code.
type RuntimeContractMethods<
  TOwnedApi extends TrellisApiLike,
  TTrellisApi extends TrellisApiLike,
> = {
  createClient(
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: ClientOpts,
  ): Trellis<TTrellisApi>;
};

type AnyBaseContract = BaseDefinedContract<any, any, any, string>;
type WithRuntimeHelpers<TContract extends AnyBaseContract> =
  & TContract
  & RuntimeContractMethods<TContract["API"]["owned"], TContract["API"]["trellis"]>;

export type DefinedContract<
  TOwnedApi extends TrellisApiLike,
  TUsedApi extends TrellisApiLike,
  TTrellisApi extends TrellisApiLike,
  TContractId extends string = string,
> = BaseDefinedContract<TOwnedApi, TUsedApi, TTrellisApi, TContractId> & RuntimeContractMethods<
  TOwnedApi,
  TTrellisApi
>;

function withRuntimeHelpers<TContract extends AnyBaseContract>(
  contract: TContract,
): WithRuntimeHelpers<TContract> {
  const runtimeContract = contract as WithRuntimeHelpers<TContract>;
  const createRuntimeClient = createClient as (
    contract: AnyBaseContract,
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: ClientOpts,
  ) => unknown;

  runtimeContract.createClient = (
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: ClientOpts,
  ) => createRuntimeClient(runtimeContract as AnyBaseContract, nats, auth, opts) as ReturnType<
    RuntimeContractMethods<TContract["API"]["owned"], TContract["API"]["trellis"]>["createClient"]
  >;

  return runtimeContract;
}

export function defineContract<const T extends DefineContractInput<any, any, any, any, any, any>>(
  source: T,
): DefinedContract<
  OwnedApiFromSource<T> & TrellisApiLike,
  UsedApiFromUses<T["uses"]> & TrellisApiLike,
  MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>> & TrellisApiLike,
  T["id"]
> {
  const contract = defineContractBase(source);
  // TypeScript's recursion limit trips over this cast in Svelte/tsserver, but
  // the runtime helper augmentation preserves the underlying contract shape.
  // @ts-ignore TS2589
  return withRuntimeHelpers(contract) as DefinedContract<
    OwnedApiFromSource<T> & TrellisApiLike,
    UsedApiFromUses<T["uses"]> & TrellisApiLike,
    MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>> & TrellisApiLike,
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
