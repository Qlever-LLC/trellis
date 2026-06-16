// Generated from ./generated/contracts/manifests/trellis.health@v1.json
import { OWNED_API } from "./owned_api.ts";

export { OWNED_API };

type __TrellisGeneratedOptionalOperationProgress<TDesc> = TDesc extends
  { progress: infer TProgress } ? { progress?: TProgress }
  : { progress?: undefined };
type __TrellisGeneratedOptionalOperationOutput<TDesc> = TDesc extends
  { output: infer TOutput } ? { output?: TOutput }
  : { output?: undefined };
type __TrellisGeneratedOptionalOperationIO<TDesc> = TDesc extends
  { input: infer TInput } ?
    & Omit<TDesc, "input" | "progress" | "output">
    & {
      input: TInput;
    }
    & __TrellisGeneratedOptionalOperationProgress<TDesc>
    & __TrellisGeneratedOptionalOperationOutput<TDesc>
  : TDesc;
type __TrellisGeneratedOperationApi<TApi> = {
  readonly [K in keyof TApi]: __TrellisGeneratedOptionalOperationIO<TApi[K]>;
};

export type UsedApi = {
  rpc: {};
  operations: {};
  events: {};
  feeds: {};
  subjects: {};
};

export const USED_API: UsedApi = {
  rpc: {},
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
};

export type OwnedApi = Omit<typeof OWNED_API, "operations"> & {
  operations: __TrellisGeneratedOperationApi<typeof OWNED_API["operations"]>;
};
export type Api = {
  rpc: OwnedApi["rpc"] & UsedApi["rpc"];
  operations: OwnedApi["operations"] & UsedApi["operations"];
  events: OwnedApi["events"] & UsedApi["events"];
  feeds: OwnedApi["feeds"] & UsedApi["feeds"];
  subjects: OwnedApi["subjects"] & UsedApi["subjects"];
};

export type ApiViews = {
  owned: OwnedApi;
  used: UsedApi;
};

export const API: ApiViews = {
  owned: OWNED_API,
  used: USED_API,
};
