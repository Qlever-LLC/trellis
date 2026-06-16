// Generated from ./generated/contracts/manifests/trellis.state@v1.json
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
import type * as HealthSdk from "../health/mod.ts";

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };

type EventCallback<TMessage> = {
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type DependencyServiceEventHandler<TEvent, TDeps = undefined> = (
  args:
    & { event: TEvent; context: EventListenerContext; client: HandlerClient }
    & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

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
          event: HealthSdk.HealthHeartbeatEvent,
        ): AsyncResult<void, ValidationError | UnexpectedError>;
        prepare(
          event: HealthSdk.HealthHeartbeatEvent,
        ): Result<
          PreparedTrellisEvent<HealthSdk.HealthHeartbeatEvent>,
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

export interface Service extends TrellisStateClient {
  readonly handle: ServiceHandle;
  with<TDeps>(deps: TDeps): ServiceWithDeps<TDeps>;
}

export type ServiceWithDeps<TDeps> = Omit<TrellisStateClient, "event"> & {
  readonly event: ServiceEventSurface<TDeps>;
  readonly handle: ServiceHandle<TDeps>;
  with<TNextDeps>(deps: TNextDeps): ServiceWithDeps<TNextDeps>;
};

export interface ServiceEventSurface<TDeps> {
  readonly health: {
    heartbeat: {
      publish(
        event: HealthSdk.HealthHeartbeatEvent,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      prepare(
        event: HealthSdk.HealthHeartbeatEvent,
      ): Result<
        PreparedTrellisEvent<HealthSdk.HealthHeartbeatEvent>,
        ValidationError | UnexpectedError
      >;
      listen(
        handler: DependencyServiceEventHandler<
          HealthSdk.HealthHeartbeatEvent,
          TDeps
        >,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
}

export interface ServiceHandle<TDeps = undefined> {
  readonly rpc: {
    readonly state: {
      adminDelete(handler: Types.StateAdminDeleteHandler<TDeps>): Promise<void>;
      adminGet(handler: Types.StateAdminGetHandler<TDeps>): Promise<void>;
      adminList(handler: Types.StateAdminListHandler<TDeps>): Promise<void>;
      delete(handler: Types.StateDeleteHandler<TDeps>): Promise<void>;
      get(handler: Types.StateGetHandler<TDeps>): Promise<void>;
      list(handler: Types.StateListHandler<TDeps>): Promise<void>;
      put(handler: Types.StatePutHandler<TDeps>): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisStateClient;
