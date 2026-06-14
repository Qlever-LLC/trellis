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
  readonly event: {};
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

export type ServiceEventSurface<TDeps> = {};

export interface ServiceHandle<TDeps = undefined> {
  readonly rpc: {
    readonly trellis: {
      catalog(
        handler: RpcHandler<
          Types.TrellisCatalogInput,
          Types.TrellisCatalogOutput,
          TDeps
        >,
      ): Promise<void>;
      contractGet(
        handler: RpcHandler<
          Types.TrellisContractGetInput,
          Types.TrellisContractGetOutput,
          TDeps
        >,
      ): Promise<void>;
      surfaceStatus(
        handler: RpcHandler<
          Types.TrellisSurfaceStatusInput,
          Types.TrellisSurfaceStatusOutput,
          TDeps
        >,
      ): Promise<void>;
    };
  };
  readonly feed: {};
  readonly operation: {};
}

export type HandlerClient = HandlerTrellis<Api>;
export type Client = TrellisCoreClient;
