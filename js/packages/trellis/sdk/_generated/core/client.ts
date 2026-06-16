// Generated from ./generated/contracts/manifests/trellis.core@v1.json
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

export interface Service extends TrellisCoreClient {
  readonly handle: ServiceHandle;
  with<TDeps>(deps: TDeps): ServiceWithDeps<TDeps>;
}

export type ServiceWithDeps<TDeps> = Omit<TrellisCoreClient, "event"> & {
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
    readonly trellis: {
      catalog(handler: Types.TrellisCatalogHandler<TDeps>): Promise<void>;
      contractGet(
        handler: Types.TrellisContractGetHandler<TDeps>,
      ): Promise<void>;
      surfaceStatus(
        handler: Types.TrellisSurfaceStatusHandler<TDeps>,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisCoreClient;
