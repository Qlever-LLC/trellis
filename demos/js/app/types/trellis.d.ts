declare module "@qlever-llc/trellis" {
  export type RpcHandlerFn<TApi = unknown, TMethod extends string = string> = unknown;
  export type TrellisContractV1 = Record<string, unknown>;
  export type UseSpec<TApi = unknown> = {
    rpc?: { call?: string[] };
    operations?: { call?: string[] };
    events?: { publish?: string[]; subscribe?: string[] };
    subjects?: { publish?: string[]; subscribe?: string[] };
  };
  export type SdkContractModule<TId extends string = string, TApi = unknown> = {
    CONTRACT_ID: TId;
    CONTRACT_DIGEST: string;
    CONTRACT: TrellisContractV1;
    API: {
      owned: TApi;
    };
    use(spec: UseSpec<TApi>): unknown;
  };
}
