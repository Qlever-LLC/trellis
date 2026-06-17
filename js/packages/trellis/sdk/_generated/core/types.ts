// Generated from ./generated/contracts/manifests/trellis.core@v1.json
import type {
  HandlerTrellis,
  Result,
  RpcHandlerContext,
  TrellisErrorInstance,
} from "../../../index.ts";

import type { Api } from "./api.ts";

export type HandlerClient = HandlerTrellis<Api>;

export const CONTRACT_ID = "trellis.core@v1" as const;
export const CONTRACT_DIGEST =
  "1vbZgyhBkgKDSkzqvkwItxObBfaLNdysxFBeTT-Ng2c" as const;

export type TrellisBindingsGetInput = { contractId?: string; digest?: string };
export type TrellisBindingsGetOutput = {
  binding?: {
    contractId: string;
    digest: string;
    resources: {
      eventConsumers?: {
        [k: string]: {
          ackWaitMs: number;
          backoffMs: Array<number>;
          concurrency: number;
          consumerName: string;
          filterSubjects: Array<string>;
          maxDeliver: number;
          ordering: "strict";
          replay: "new" | "all";
          stream: string;
        };
      };
      jobs?: {
        namespace: string;
        queues: {
          [k: string]: {
            ackWaitMs: number;
            backoffMs: Array<number>;
            concurrency: number;
            consumerName: string;
            defaultDeadlineMs?: number;
            dlq: boolean;
            keyConcurrency?: {
              heartbeatIntervalMs: number;
              heartbeatTtlMs: number;
              key: Array<string>;
              maxActive: number;
              stalePolicy: "fail-stale" | "block";
            };
            logs: boolean;
            maxDeliver: number;
            payload: { schema: string };
            progress: boolean;
            publishPrefix: string;
            queue?: {
              maxQueuedPerKey: number;
              whenFull: "reject" | "coalesce" | "replace-oldest";
            };
            queueType: string;
            result?: { schema: string };
            workSubject: string;
          };
        };
        workStream?: string;
      };
      kv?: {
        [k: string]: {
          bucket: string;
          history: number;
          maxValueBytes?: number;
          ttlMs: number;
        };
      };
      store?: {
        [k: string]: {
          maxObjectBytes?: number;
          maxTotalBytes?: number;
          name: string;
          ttlMs: number;
        };
      };
    };
  };
  eventConsumers?: {
    [k: string]: {
      ackWaitMs: number;
      backoffMs: Array<number>;
      concurrency: number;
      consumerName: string;
      filterSubjects: Array<string>;
      maxDeliver: number;
      ordering: "strict";
      replay: "new" | "all";
      stream: string;
    };
  };
};

export type TrellisCatalogInput = {};
export type TrellisCatalogOutput = {
  catalog: {
    contracts: Array<
      { description: string; digest: string; displayName: string; id: string }
    >;
    format: "trellis.catalog.v1";
    issues?: Array<
      {
        actions: Array<
          {
            action: "keep-current" | "force-replace";
            deploymentIds: Array<string>;
            description: string;
            digests: Array<string>;
            label: string;
            risk: "recommended" | "dangerous";
          }
        >;
        conflictingDeploymentIds?: Array<string>;
        conflictingDigest?: string;
        conflictingDigests?: Array<string>;
        contractId?: string;
        deploymentIds: Array<string>;
        digest?: string;
        effectiveDeploymentIds?: Array<string>;
        effectiveDigests?: Array<string>;
        issueId: string;
        kind:
          | "missing-active-contract"
          | "invalid-active-contract"
          | "incompatible-active-contract"
          | "invalid-active-contract-uses";
        message: string;
      }
    >;
  };
};

export type TrellisContractGetInput = { digest: string };
export type TrellisContractGetOutput = {
  contract: {
    description: string;
    displayName: string;
    docs?: { markdown: string; summary?: string };
    errors?: { [k: string]: {} };
    events?: { [k: string]: {} };
    exports?: { schemas?: Array<string> };
    format: "trellis.contract.v1";
    id: string;
    jobs?: {
      [k: string]: {
        ackWaitMs?: number;
        backoffMs?: Array<number>;
        concurrency?: number;
        defaultDeadlineMs?: number;
        dlq?: boolean;
        docs?: { markdown: string; summary?: string };
        keyConcurrency?: {
          heartbeatIntervalMs?: number;
          heartbeatTtlMs?: number;
          key: Array<string>;
          maxActive?: number;
          stalePolicy?: "fail-stale" | "block";
        };
        logs?: boolean;
        maxDeliver?: number;
        payload: { schema: string };
        progress?: boolean;
        queue?: {
          maxQueuedPerKey?: number;
          whenFull?: "reject" | "coalesce" | "replace-oldest";
        };
        result?: { schema: string };
      };
    };
    kind: "service" | "app" | "device" | "agent";
    operations?: { [k: string]: {} };
    resources?: {
      kv?: {
        [k: string]: {
          docs?: { markdown: string; summary?: string };
          history?: number;
          maxValueBytes?: number;
          purpose: string;
          required?: boolean;
          schema: { schema: string };
          ttlMs?: number;
        };
      };
      store?: {
        [k: string]: {
          docs?: { markdown: string; summary?: string };
          maxObjectBytes?: number;
          maxTotalBytes?: number;
          purpose: string;
          required?: boolean;
          ttlMs?: number;
        };
      };
    };
    rpc?: { [k: string]: {} };
    schemas?: { [k: string]: {} | boolean };
    state?: {
      [k: string]: {
        acceptedVersions?: { [k: string]: { schema: string } };
        docs?: { markdown: string; summary?: string };
        kind: "value" | "map";
        schema: { schema: string };
        stateVersion?: string;
      };
    };
    uses?: { [k: string]: {} };
  };
};

export type TrellisSurfaceStatusInput = {
  action?: "call" | "publish" | "subscribe" | "observe";
  contractId: string;
  kind: "rpc" | "operation" | "event" | "feed";
  surface: string;
};
export type TrellisSurfaceStatusOutput = {
  status:
    | {
      liveImplementer: boolean;
      runtime: "live" | "no_live_implementer" | "disabled";
      state: "available";
    }
    | { reason: "authority_unavailable"; state: "unavailable" }
    | { missingCapabilities: Array<string>; state: "unauthorized" }
    | { contractId: string; state: "unknown_contract" }
    | {
      contractId: string;
      kind: string;
      state: "unknown_surface";
      surface: string;
    };
};

export interface RpcMap {
  "Trellis.Bindings.Get": {
    input: TrellisBindingsGetInput;
    output: TrellisBindingsGetOutput;
  };
  "Trellis.Catalog": {
    input: TrellisCatalogInput;
    output: TrellisCatalogOutput;
  };
  "Trellis.Contract.Get": {
    input: TrellisContractGetInput;
    output: TrellisContractGetOutput;
  };
  "Trellis.Surface.Status": {
    input: TrellisSurfaceStatusInput;
    output: TrellisSurfaceStatusOutput;
  };
}

export type TrellisBindingsGetHandlerError = TrellisErrorInstance;
export type TrellisBindingsGetHandlerResult = Result<
  TrellisBindingsGetOutput,
  TrellisBindingsGetHandlerError
>;
export type TrellisBindingsGetHandler = (
  args: {
    input: TrellisBindingsGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  },
) => TrellisBindingsGetHandlerResult | Promise<TrellisBindingsGetHandlerResult>;
export type TrellisCatalogHandlerError = TrellisErrorInstance;
export type TrellisCatalogHandlerResult = Result<
  TrellisCatalogOutput,
  TrellisCatalogHandlerError
>;
export type TrellisCatalogHandler = (
  args: {
    input: TrellisCatalogInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  },
) => TrellisCatalogHandlerResult | Promise<TrellisCatalogHandlerResult>;
export type TrellisContractGetHandlerError = TrellisErrorInstance;
export type TrellisContractGetHandlerResult = Result<
  TrellisContractGetOutput,
  TrellisContractGetHandlerError
>;
export type TrellisContractGetHandler = (
  args: {
    input: TrellisContractGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  },
) => TrellisContractGetHandlerResult | Promise<TrellisContractGetHandlerResult>;
export type TrellisSurfaceStatusHandlerError = TrellisErrorInstance;
export type TrellisSurfaceStatusHandlerResult = Result<
  TrellisSurfaceStatusOutput,
  TrellisSurfaceStatusHandlerError
>;
export type TrellisSurfaceStatusHandler = (
  args: {
    input: TrellisSurfaceStatusInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  },
) =>
  | TrellisSurfaceStatusHandlerResult
  | Promise<TrellisSurfaceStatusHandlerResult>;

export interface EventMap {
}

export interface FeedMap {
}

export interface SubjectMap {
}
