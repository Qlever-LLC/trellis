import type {
  ContractDependencyUse,
  UseSpec,
} from "@qlever-llc/trellis/contracts";
import {
  API,
  CONTRACT,
  CONTRACT_DIGEST,
  CONTRACT_ID,
  state as baseState,
  use,
} from "#trellis-generated-sdk/state";

export * from "#trellis-generated-sdk/state";

const DEFAULT_STATE_RPC_CALL = [
  "State.Get",
  "State.Put",
  "State.Delete",
  "State.List",
] as const;

type StateOwnedApi = typeof API.owned;
type StateUseSpec = UseSpec<StateOwnedApi>;
type DefaultStateRpcCall = typeof DEFAULT_STATE_RPC_CALL;

type WithDefaultStateRpcCall<TSpec extends StateUseSpec | undefined> =
  TSpec extends { rpc?: { call?: infer TCall extends readonly string[] } }
    ? readonly [...DefaultStateRpcCall, ...TCall]
    : DefaultStateRpcCall;

type WithDefaultStateUseSpec<TSpec extends StateUseSpec | undefined> =
  & (TSpec extends StateUseSpec ? Omit<TSpec, "rpc"> : {})
  & {
    rpc: {
      call: WithDefaultStateRpcCall<TSpec>;
    };
  };

type StateUseDefaultsFn = <
  const TSpec extends StateUseSpec | undefined = undefined,
>(
  spec?: TSpec,
) => ContractDependencyUse<
  typeof CONTRACT_ID,
  StateOwnedApi,
  WithDefaultStateUseSpec<TSpec>
>;

function mergeStateUseDefaults(spec?: StateUseSpec): StateUseSpec {
  const rpcCall = [...DEFAULT_STATE_RPC_CALL];
  for (const key of spec?.rpc?.call ?? []) {
    if (!rpcCall.includes(key as (typeof rpcCall)[number])) {
      rpcCall.push(key as (typeof rpcCall)[number]);
    }
  }

  return {
    ...spec,
    rpc: {
      ...spec?.rpc,
      call: rpcCall,
    },
  };
}

export const useDefaults: StateUseDefaultsFn = ((spec?: StateUseSpec) => {
  return use(mergeStateUseDefaults(spec));
}) as StateUseDefaultsFn;

export const state = Object.assign(baseState, { useDefaults });
export { API, CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use };
