// Generated from ./generated/contracts/manifests/trellis.jobs@v1.json
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
import type * as AuthSdk from "../auth/mod.ts";
import type * as CoreSdk from "../core/mod.ts";
import type * as HealthSdk from "../health/mod.ts";

type EventCallback<TMessage> = {
  bivarianceHack(message: TMessage): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

type RpcHandler<TInput, TOutput> = (
  args: { input: TInput; context: RpcHandlerContext; client: HandlerClient },
) => MaybeAsync<TOutput, BaseError>;

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
    readonly jobs: {
      cancel(
        handler: RpcHandler<Types.JobsCancelInput, Types.JobsCancelOutput>,
      ): Promise<void>;
      dismissDLQ(
        handler: RpcHandler<
          Types.JobsDismissDLQInput,
          Types.JobsDismissDLQOutput
        >,
      ): Promise<void>;
      get(
        handler: RpcHandler<Types.JobsGetInput, Types.JobsGetOutput>,
      ): Promise<void>;
      health(
        handler: RpcHandler<Types.JobsHealthInput, Types.JobsHealthOutput>,
      ): Promise<void>;
      list(
        handler: RpcHandler<Types.JobsListInput, Types.JobsListOutput>,
      ): Promise<void>;
      listDLQ(
        handler: RpcHandler<Types.JobsListDLQInput, Types.JobsListDLQOutput>,
      ): Promise<void>;
      listServices(
        handler: RpcHandler<
          Types.JobsListServicesInput,
          Types.JobsListServicesOutput
        >,
      ): Promise<void>;
      replayDLQ(
        handler: RpcHandler<
          Types.JobsReplayDLQInput,
          Types.JobsReplayDLQOutput
        >,
      ): Promise<void>;
      retry(
        handler: RpcHandler<Types.JobsRetryInput, Types.JobsRetryOutput>,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisJobsClient;
