// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
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
import type * as AuthSdk from "../auth/mod.ts";
import type * as CoreSdk from "../core/mod.ts";
import type * as HealthSdk from "../health/mod.ts";

type EventCallback<TMessage> = {
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type DependencyServiceEventHandler<TEvent> = (
  args: { event: TEvent; context: EventListenerContext; client: HandlerClient },
) => MaybeAsync<void, BaseError>;

export type TrellisJobsState = {};

export interface TrellisJobsClient {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: Api;
  readonly state: TrellisJobsState;
  readonly connection: TrellisConnection;
  transfer(grant: SendTransferGrant): SendTransferHandle;
  transfer(grant: ReceiveTransferGrant): ReceiveTransferHandle;
  readonly rpc: {
    readonly auth: {
      requestsValidate(
        input: AuthSdk.AuthRequestsValidateInput,
        opts?: RequestOpts,
      ): AsyncResult<AuthSdk.AuthRequestsValidateOutput, BaseError>;
    };
    readonly jobs: {
      cancel(
        input: Types.JobsCancelInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsCancelOutput, BaseError>;
      dismissDLQ(
        input: Types.JobsDismissDLQInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsDismissDLQOutput, BaseError>;
      get(
        input: Types.JobsGetInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsGetOutput, BaseError>;
      getKey(
        input: Types.JobsGetKeyInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsGetKeyOutput, BaseError>;
      health(
        input: Types.JobsHealthInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsHealthOutput, BaseError>;
      list(
        input: Types.JobsListInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsListOutput, BaseError>;
      listDLQ(
        input: Types.JobsListDLQInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsListDLQOutput, BaseError>;
      listServices(
        input: Types.JobsListServicesInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsListServicesOutput, BaseError>;
      replayDLQ(
        input: Types.JobsReplayDLQInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsReplayDLQOutput, BaseError>;
      retry(
        input: Types.JobsRetryInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.JobsRetryOutput, BaseError>;
    };
    readonly trellis: {
      catalog(
        input: CoreSdk.TrellisCatalogInput,
        opts?: RequestOpts,
      ): AsyncResult<CoreSdk.TrellisCatalogOutput, BaseError>;
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

export interface Service extends TrellisJobsClient {
  readonly handle: ServiceHandle;
}

export interface ServiceEventSurface {
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
        handler: DependencyServiceEventHandler<HealthSdk.HealthHeartbeatEvent>,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
}

export interface ServiceHandle {
  readonly rpc: {
    readonly jobs: {
      cancel(handler: Types.JobsCancelHandler): Promise<void>;
      dismissDLQ(handler: Types.JobsDismissDLQHandler): Promise<void>;
      get(handler: Types.JobsGetHandler): Promise<void>;
      getKey(handler: Types.JobsGetKeyHandler): Promise<void>;
      health(handler: Types.JobsHealthHandler): Promise<void>;
      list(handler: Types.JobsListHandler): Promise<void>;
      listDLQ(handler: Types.JobsListDLQHandler): Promise<void>;
      listServices(handler: Types.JobsListServicesHandler): Promise<void>;
      replayDLQ(handler: Types.JobsReplayDLQHandler): Promise<void>;
      retry(handler: Types.JobsRetryHandler): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisJobsClient;
