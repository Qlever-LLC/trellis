import type { NatsConnection } from "@nats-io/nats-core";
import type { TrellisAPI } from "@qlever-llc/trellis-contracts";
import {
  type DefinedContract as BaseDefinedContract,
  type ContractApiViews,
  type ContractDependencyUse,
  type ContractModule,
  type ContractUseFn,
  type DefineContractInput,
  defineContract as defineContractBase,
  type EmptyApi,
  type SdkContractModule,
  type TrellisApiLike,
  type TrellisContractV1,
  type UseSpec,
} from "@qlever-llc/trellis-contracts";
import type { ClientOpts } from "./client.ts";
import { createClient } from "./client.ts";
import type { Trellis, TrellisAuth } from "./trellis.ts";

// Keep this module browser-safe.
//
// `js/apps/*` and other callers build contracts from `@qlever-llc/trellis-contracts`, and those
// apps need to build inside a clean OCI build stage. If this file reaches into
// `../server/*`, Vite pulls Deno-only NATS transports into browser bundles and the
// container build stops being reproducible. Server-specific helpers therefore live
// in `@qlever-llc/trellis-server` and are wired explicitly by server code.
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

  runtimeContract.createClient = (nats, auth, opts) =>
    createClient(runtimeContract as any, nats, auth, opts) as any;

  return runtimeContract;
}

export function defineContract<const T extends DefineContractInput<any, any, any, any>>(
  source: T,
) {
  return withRuntimeHelpers(defineContractBase(source));
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
