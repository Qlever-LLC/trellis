// Generated from ./generated/contracts/manifests/trellis.state@v1.json
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
} from "../../../index.ts";
import type { API, Api } from "./api.ts";
import type * as Types from "./types.ts";
import type * as HealthSdk from "../health/mod.ts";

type EventCallback<TMessage> = {
  bivarianceHack(message: TMessage): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type RpcHandler<TInput, TOutput> = (
  args: { input: TInput; context: RpcHandlerContext; client: HandlerClient },
) => MaybeAsync<TOutput, BaseError>;

export type TrellisStateState = {};

export interface TrellisStateClient {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: Api;
  readonly state: TrellisStateState;
  readonly connection: TrellisConnection;
  transfer(grant: SendTransferGrant): SendTransferHandle;
  transfer(grant: ReceiveTransferGrant): ReceiveTransferHandle;
  readonly rpc: {
    readonly state: {
      adminDelete(
        input: Types.StateAdminDeleteInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.StateAdminDeleteOutput, BaseError>;
      adminGet(
        input: Types.StateAdminGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.StateAdminGetOutput, BaseError>;
      adminList(
        input: Types.StateAdminListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.StateAdminListOutput, BaseError>;
      delete(
        input: Types.StateDeleteInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.StateDeleteOutput, BaseError>;
      get(
        input: Types.StateGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.StateGetOutput, BaseError>;
      list(
        input: Types.StateListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.StateListOutput, BaseError>;
      put(
        input: Types.StatePutInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.StatePutOutput, BaseError>;
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
    readonly state: {
      adminDelete(
        handler: RpcHandler<
          Types.StateAdminDeleteInput,
          Types.StateAdminDeleteOutput
        >,
      ): Promise<void>;
      adminGet(
        handler: RpcHandler<
          Types.StateAdminGetInput,
          Types.StateAdminGetOutput
        >,
      ): Promise<void>;
      adminList(
        handler: RpcHandler<
          Types.StateAdminListInput,
          Types.StateAdminListOutput
        >,
      ): Promise<void>;
      delete(
        handler: RpcHandler<Types.StateDeleteInput, Types.StateDeleteOutput>,
      ): Promise<void>;
      get(
        handler: RpcHandler<Types.StateGetInput, Types.StateGetOutput>,
      ): Promise<void>;
      list(
        handler: RpcHandler<Types.StateListInput, Types.StateListOutput>,
      ): Promise<void>;
      put(
        handler: RpcHandler<Types.StatePutInput, Types.StatePutOutput>,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisStateClient;
