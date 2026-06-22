/**
 * Browser-safe Trellis client entrypoint.
 */

export {
  bindFlow,
  classifyBrowserAuthError,
  clearSessionKey,
  createAuth,
  createRpcProof,
  generateSessionKey,
  getOrCreateSessionKey,
  getPublicSessionKey,
  hasSessionKey,
  isBindSuccessResponse,
  isRecoverableBrowserAuthError,
  loadSessionKey,
  signBytes,
} from "./auth.ts";
export type {
  BindResponse,
  BindSuccessResponse,
  BrowserAuthRecoveryClassification,
  BrowserAuthRecoveryKind,
  NatsConnectOptions,
  SessionKeyHandle,
} from "./auth.ts";
export {
  canonicalizeJson,
  CATALOG_FORMAT_V1,
  CONTRACT_FORMAT_V1,
  digestJson,
  isJsonValue,
  schema,
  unwrapSchema,
} from "./contracts.ts";
export type { InferSchemaType, JsonValue, TrellisAPI } from "./contracts.ts";
export { TrellisConnection } from "./connection.ts";
export type { TrellisConnectionStatus } from "./connection.ts";
export { defineError } from "./contract_support/mod.ts";
export {
  buildCursorPage,
  buildPageResponse,
  CursorPageInfoSchema,
  CursorPageSchema,
  CursorQuerySchema,
  normalizeCursorQuery,
  normalizePageQuery,
  PageRequestSchema,
  PageResponseSchema,
} from "./contract_support/mod.ts";
export type {
  CursorPage,
  CursorPageInfo,
  CursorQuery,
  CursorQueryOptions,
  ErrorClass,
  InferRuntimeRpcError,
  NormalizedCursorQuery,
  PageRequest,
  PageResponse,
  RpcErrorClass,
  RuntimeRpcErrorDesc,
  SerializableErrorData,
} from "./contract_support/mod.ts";
export {
  defineAgentContract,
  defineAppContract,
  defineDeviceContract,
  defineServiceContract,
} from "./contract.ts";
export type {
  ContractApiViews,
  ContractDependencyUse,
  ContractModule,
  ContractUseFn,
  DefineContractInput,
  EmptyApi,
  SdkContractModule,
  TrellisApiLike,
  TrellisContractV1,
  UseSpec,
} from "./contract.ts";
export {
  AsyncResult,
  BaseError,
  err,
  isErr,
  isOk,
  ok,
  Result,
} from "@qlever-llc/result";
export type { MaybeAsync } from "@qlever-llc/result";
export type { ClientOpts } from "./client.ts";
export type {
  ClientAuthContinuation,
  ClientAuthOptions,
  ClientAuthRequiredContext,
  TrellisClientConnectArgs,
} from "./client_connect.ts";
export { ClientAuthHandledError, TrellisClient } from "./client_connect.ts";
export type { TrellisErrorInstance } from "./errors/index.ts";
export {
  AuthError,
  KVError,
  OperationAlreadyTerminalError,
  OperationMismatchError,
  OperationNotFoundError,
  RemoteError,
  StoreError,
  TransferError,
  TransportError,
  TrellisError,
  UnexpectedError,
  ValidationError,
} from "./errors/index.ts";
export { TypedKVEntry } from "./kv.ts";
export type { WatchEvent, WatchOptions } from "./kv.ts";
export { TypedStoreEntry } from "./store.ts";
export type {
  StoreBody,
  StoreInfo,
  StoreOpenOptions,
  StorePutOptions,
  StoreStatus,
  StoreWaitOptions,
} from "./store.ts";
export { FileInfoSchema } from "./transfer.ts";
export type {
  FileInfo,
  ReceiveTransferGrant,
  ReceiveTransferHandle,
  SendTransferGrant,
  SendTransferHandle,
  TransferBody,
  TransferGrant,
} from "./transfer.ts";
export type {
  AcceptedOperationEvent,
  CancelledOperationEvent,
  CompletedOperationEvent,
  CompletedTransfer,
  FailedOperationEvent,
  OperationControlError,
  OperationEvent,
  OperationInputBuilder,
  OperationLifecycleError,
  OperationObserverCallbacks,
  OperationRef,
  OperationRefData,
  OperationSignalAck,
  OperationSnapshot,
  OperationState,
  OperationTransferProgress,
  ProgressOperationEvent,
  ProgressOperationSnapshot,
  StartedOperationEvent,
  StartedTransfer,
  TerminalOperation,
  TransferCapableOperationInputBuilder,
  TransferOperationBuilder,
  TransferOperationEvent,
  TransferOperationSnapshot,
} from "./operations.ts";
export { controlSubject, OperationInvoker } from "./operations.ts";
export type {
  AcceptedOperation,
  ClientTrellis,
  ConnectedTrellisClient,
  EventHandler,
  EventListenerContext,
  EventName,
  EventOpts,
  EventPayload,
  EventType,
  FeedInputBuilder,
  FeedSubscribeOpts,
  FeedSubscription,
  HandlerJobQueue,
  HandlerJobsFacade,
  HandlerKvFacade,
  HandlerStoreHandle,
  HandlerTrellis,
  HandlerTrellisForContract,
  MapStateStoreClient,
  OperationHandlerContext,
  OperationRegistration,
  OperationRuntimeHandle,
  OperationTransferContextOf,
  OperationTransferHandle,
  PreparedTrellisEvent,
  RequestOpts,
  RpcArgs,
  RpcHandlerContext,
  RpcHandlerErrorOf,
  RpcHandlerFn,
  RpcInputOf,
  RpcMethodNameOf,
  RpcOutputOf,
  RpcRequestErrorOf,
  RpcResult,
  RuntimeStateStoresForContract,
  RuntimeStateStoreShape,
  StateFacade,
  TrellisFor,
  ValueStateStoreClient,
} from "./trellis.ts";
export type { TrellisAuth } from "./trellis.ts";
