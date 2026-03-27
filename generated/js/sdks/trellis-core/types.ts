// Generated from ./generated/contracts/manifests/trellis.core@v1.json
export const CONTRACT_ID = "trellis.core@v1" as const;
export const CONTRACT_DIGEST = "bY-N9o-_RtOSw5tr21rnI9FD8DDBj4gOXnGQLtyrQng" as const;

export type TrellisBindingsGetInput = { contractId?: string; digest?: string; };
export type TrellisBindingsGetOutput = { binding?: { contractId: string; digest: string; resources: { jobs?: { namespace: string; queues: {  }; registry?: { bucket: string; }; }; kv?: {  }; }; }; };

export type TrellisCatalogInput = {  };
export type TrellisCatalogOutput = { catalog: { contracts: Array<{ description: string; digest: string; displayName: string; id: string; kind: string; }>; format: "trellis.catalog.v1"; }; };

export type TrellisContractGetInput = { digest: string; };
export type TrellisContractGetOutput = { contract: { description: string; displayName: string; errors?: {  }; events?: {  }; format: "trellis.contract.v1"; id: string; kind: string; resources?: { jobs?: { queues: {  }; }; kv?: {  }; }; rpc?: {  }; schemas?: {  }; subjects?: {  }; uses?: {  }; }; };

export interface RpcMap {
  "Trellis.Bindings.Get": { input: TrellisBindingsGetInput; output: TrellisBindingsGetOutput; };
  "Trellis.Catalog": { input: TrellisCatalogInput; output: TrellisCatalogOutput; };
  "Trellis.Contract.Get": { input: TrellisContractGetInput; output: TrellisContractGetOutput; };
}

export interface EventMap {
}

export interface SubjectMap {
}

