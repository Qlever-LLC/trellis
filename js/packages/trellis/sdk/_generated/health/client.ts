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
  OperationTransferHandle,
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

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };

type EventCallback<TMessage> = {
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type ServiceEventHandler<TEvent, TDeps = undefined> = (
  args:
    & { event: TEvent; context: EventListenerContext; client: HandlerClient }
    & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

type RpcHandler<TInput, TOutput, TDeps = undefined> = (
  args:
    & { input: TInput; context: RpcHandlerContext; client: HandlerClient }
    & WithDeps<TDeps>,
) => MaybeAsync<TOutput, BaseError>;

type FeedHandler<TInput, TEvent, TDeps = undefined> = (
  context: {
    input: TInput;
    caller: unknown;
    signal: AbortSignal;
    emit(event: TEvent): AsyncResult<void, ValidationError | UnexpectedError>;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => unknown | Promise<unknown>;

type OperationHandler<
  TInput,
  TProgress,
  TOutput,
  TTransfer,
  TDeps = undefined,
> = (
  context:
    & {
      input: TInput;
      op: OperationRuntimeHandle<TProgress, TOutput>;
      caller: unknown;
      client: HandlerClient;
    }
    & TTransfer
    & WithDeps<TDeps>,
) => unknown | Promise<unknown>;

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

export interface Service extends TrellisHealthClient {
  readonly handle: ServiceHandle;
  with<TDeps>(deps: TDeps): ServiceWithDeps<TDeps>;
}

export type ServiceWithDeps<TDeps> = Omit<TrellisHealthClient, "event"> & {
  readonly event: ServiceEventSurface<TDeps>;
  readonly handle: ServiceHandle<TDeps>;
  with<TNextDeps>(deps: TNextDeps): ServiceWithDeps<TNextDeps>;
};

export interface ServiceEventSurface<TDeps> {
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
        handler: ServiceEventHandler<Types.HealthHeartbeatEvent, TDeps>,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
}

export interface ServiceHandle<TDeps = undefined> {
  readonly rpc: {};
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisHealthClient;
