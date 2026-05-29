// Generated from ./generated/contracts/manifests/trellis.core@v1.json
import type {
  AcceptedOperation,
  AsyncResult,
  BaseError,
  EventOpts,
  FeedSubscribeOpts,
  FeedSubscription,
  HandlerTrellis,
  MapStateStoreClient,
  MaybeAsync,
  OperationInputBuilder,
  OperationObserverCallbacks,
  OperationRef,
  OperationRefData,
  OperationRuntimeHandle,
  PreparedTrellisEvent,
  ReceiveTransferGrant,
  ReceiveTransferHandle,
  RequestOpts,
  Result,
  RpcHandlerContext,
  SendTransferGrant,
  SendTransferHandle,
  TerminalOperation,
  TransferCapableOperationInputBuilder,
  TrellisConnection,
  UnexpectedError,
  ValidationError,
  ValueStateStoreClient,
} from "@qlever-llc/trellis";
import type { API, Api } from "./api.ts";
import type * as Types from "./types.ts";
import type * as HealthSdk from "@qlever-llc/trellis/sdk/health";

type EventCallback<TMessage> = {
  bivarianceHack(message: TMessage): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type RpcHandler<TInput, TOutput> = (
  args: { input: TInput; context: RpcHandlerContext; client: HandlerClient },
) => MaybeAsync<TOutput, BaseError>;

export type TrellisCoreState = {};

export interface TrellisCoreClient {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: Api;
  readonly state: TrellisCoreState;
  readonly connection: TrellisConnection;
  transfer(grant: SendTransferGrant): SendTransferHandle;
  transfer(grant: ReceiveTransferGrant): ReceiveTransferHandle;
  readonly rpc: {
    readonly trellis: {
      catalog(
        input: Types.TrellisCatalogInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.TrellisCatalogOutput, BaseError>;
      contractGet(
        input: Types.TrellisContractGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.TrellisContractGetOutput, BaseError>;
      surfaceStatus(
        input: Types.TrellisSurfaceStatusInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.TrellisSurfaceStatusOutput, BaseError>;
    };
  };
  readonly event: {
    readonly health: {
      heartbeat: {
        publish(
          event: Omit<HealthSdk.HealthHeartbeatEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<HealthSdk.HealthHeartbeatEvent, "header">,
        ): Result<
          PreparedTrellisEvent<Omit<HealthSdk.HealthHeartbeatEvent, "header">>,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<HealthSdk.HealthHeartbeatEvent>,
          subjectData?: Record<string, unknown>,
          opts?: EventOpts,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
      };
    };
  };
  readonly feed: {};
  readonly operation: {};
  wait(): AsyncResult<void, BaseError>;
}

export interface Service extends Client {
  readonly handle: ServiceHandle;
}

export interface ServiceHandle {
  readonly rpc: {
    readonly trellis: {
      catalog(
        handler: RpcHandler<
          Types.TrellisCatalogInput,
          Types.TrellisCatalogOutput
        >,
      ): Promise<void>;
      contractGet(
        handler: RpcHandler<
          Types.TrellisContractGetInput,
          Types.TrellisContractGetOutput
        >,
      ): Promise<void>;
      surfaceStatus(
        handler: RpcHandler<
          Types.TrellisSurfaceStatusInput,
          Types.TrellisSurfaceStatusOutput
        >,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisCoreClient;
