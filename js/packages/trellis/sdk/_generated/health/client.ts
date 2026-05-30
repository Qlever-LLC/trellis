// Generated from ./generated/contracts/manifests/trellis.health@v1.json
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

type EventCallback<TMessage> = {
  bivarianceHack(message: TMessage): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type RpcHandler<TInput, TOutput> = (
  args: { input: TInput; context: RpcHandlerContext; client: HandlerClient },
) => MaybeAsync<TOutput, BaseError>;

export type TrellisHealthState = {};

export interface TrellisHealthClient {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: Api;
  readonly state: TrellisHealthState;
  readonly connection: TrellisConnection;
  transfer(grant: SendTransferGrant): SendTransferHandle;
  transfer(grant: ReceiveTransferGrant): ReceiveTransferHandle;
  readonly rpc: {};
  readonly event: {
    readonly health: {
      heartbeat: {
        publish(
          event: Omit<Types.HealthHeartbeatEvent, "header">,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Omit<Types.HealthHeartbeatEvent, "header">,
        ): Result<
          PreparedTrellisEvent<Omit<Types.HealthHeartbeatEvent, "header">>,
          ValidationError | UnexpectedError
        >;
        listen(
          handler: EventCallback<Types.HealthHeartbeatEvent>,
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
  readonly rpc: {};
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisHealthClient;
