// Generated from rust/crates/integration-harness/fixtures/rpc/contract.ts
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
} from "@qlever-llc/trellis";
import type { API, Api } from "./api.ts";
import type * as Types from "./types.ts";
import type * as AuthSdk from "@qlever-llc/trellis/sdk/auth";
import type * as HealthSdk from "@qlever-llc/trellis/sdk/health";

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

export type TrellisIntegrationHarnessRpcState = {};

export interface TrellisIntegrationHarnessRpcClient {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: Api;
  readonly state: TrellisIntegrationHarnessRpcState;
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
    readonly harness: {
      rustCallerContext(
        input: Types.HarnessRustCallerContextInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.HarnessRustCallerContextOutput, BaseError>;
      rustPing(
        input: Types.HarnessRustPingInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.HarnessRustPingOutput, BaseError>;
      rustTraceContext(
        input: Types.HarnessRustTraceContextInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.HarnessRustTraceContextOutput, BaseError>;
      tsCallerContext(
        input: Types.HarnessTsCallerContextInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.HarnessTsCallerContextOutput, BaseError>;
      tsPing(
        input: Types.HarnessTsPingInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.HarnessTsPingOutput, BaseError>;
      tsTraceContext(
        input: Types.HarnessTsTraceContextInput,
        opts?: RequestOpts,
      ): AsyncResult<Types.HarnessTsTraceContextOutput, BaseError>;
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

export interface Service extends TrellisIntegrationHarnessRpcClient {
  readonly handle: ServiceHandle;
  with<TDeps>(deps: TDeps): ServiceWithDeps<TDeps>;
}

export type ServiceWithDeps<TDeps> =
  & Omit<TrellisIntegrationHarnessRpcClient, "event">
  & {
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
    readonly harness: {
      rustCallerContext(
        handler: Types.HarnessRustCallerContextHandler<TDeps>,
      ): Promise<void>;
      rustPing(handler: Types.HarnessRustPingHandler<TDeps>): Promise<void>;
      rustTraceContext(
        handler: Types.HarnessRustTraceContextHandler<TDeps>,
      ): Promise<void>;
      tsCallerContext(
        handler: Types.HarnessTsCallerContextHandler<TDeps>,
      ): Promise<void>;
      tsPing(handler: Types.HarnessTsPingHandler<TDeps>): Promise<void>;
      tsTraceContext(
        handler: Types.HarnessTsTraceContextHandler<TDeps>,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisIntegrationHarnessRpcClient;
