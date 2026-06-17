// Generated from ./generated/contracts/manifests/trellis.health@v1.json
import type {
  AcceptedOperation,
  AsyncResult,
  BaseError,
  EventListenerContext,
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
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type DependencyServiceEventHandler<TEvent> = (
  args: { event: TEvent; context: EventListenerContext; client: HandlerClient },
) => MaybeAsync<void, BaseError>;

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
          event: Types.HealthHeartbeatEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: Types.HealthHeartbeatEvent,
        ): Result<
          PreparedTrellisEvent<Types.HealthHeartbeatEvent>,
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

export interface Service extends TrellisHealthClient {
  readonly handle: ServiceHandle;
}

export interface ServiceEventSurface {
  readonly health: {
    heartbeat: {
      publish(
        event: Types.HealthHeartbeatEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: Types.HealthHeartbeatEvent,
      ): Result<
        PreparedTrellisEvent<Types.HealthHeartbeatEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: Types.HealthHeartbeatEventHandler,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
}

export interface ServiceHandle {
  readonly rpc: {};
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisHealthClient;
