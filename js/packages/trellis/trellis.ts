import {
  type ConsumerMessages,
  jetstream,
  type JetStreamClient,
  jetstreamManager,
} from "@nats-io/jetstream";
import {
  createInbox,
  headers as natsHeaders,
  type Msg,
  type MsgHdrs,
  type NatsConnection,
} from "@nats-io/nats-core";
import type {
  EventDesc,
  FeedDesc,
  InferSchemaType,
  RPCDesc,
  TrellisAPI,
} from "./contracts.ts";
import {
  CONTRACT_JOBS_METADATA,
  CONTRACT_KV_METADATA,
  CONTRACT_STATE_METADATA,
  type ContractEventConsumers,
  type ContractJobsMetadata,
  type ContractKvMetadata,
  type EventConsumerResourceBinding,
} from "./contract_support/mod.ts";
import type { StaticDecode } from "typebox";
import {
  AuthRequestsValidateResponseSchema,
  AuthRequestsValidateSchema,
} from "./auth/protocol.ts";
import {
  AsyncResult,
  BaseError,
  err,
  type InferErr,
  isErr,
  type MaybeAsync,
  ok,
  Result,
} from "@qlever-llc/result";
import {
  context,
  createNatsHeaderCarrier,
  extractTraceContext,
  injectTraceContext,
  SpanStatusCode,
  startClientSpan,
  startServerSpan,
  trace,
  withSpanAsync,
} from "./tracing.ts";
import { Type } from "typebox";
import { AssertError, Pointer } from "typebox/value";
import { ulid } from "ulid";
import {
  encodeSchema,
  type JsonValue,
  parse,
  parseSchema,
  parseUnknownSchema,
} from "./codec.ts";
import {
  AuthError,
  BUILTIN_RPC_ERRORS,
  getBuiltinRpcError,
  type StoreError,
  TransferError,
  TransportError,
  type TrellisErrorInstance,
  type TrellisErrorMap,
  type TrellisErrorName,
  UnexpectedError,
  ValidationError,
} from "./errors/index.ts";
import { RemoteError } from "./errors/RemoteError.ts";
import { logger, type LoggerLike } from "./globals.ts";
import { TypedKV } from "./kv.ts";
import { TrellisErrorDataSchema } from "./models/trellis/TrellisError.ts";
import type { ActiveJob, JobRef, JobTypeMetadata } from "./jobs.ts";
import type { StoreWaitOptions, TypedStore, TypedStoreEntry } from "./store.ts";
import {
  OperationInvoker,
  type OperationRefData,
  type OperationTransport,
} from "./operations.ts";
import type { Span } from "./telemetry/mod.ts";
import type { StateDeleteResponse } from "./models/trellis/rpc/StateDelete.ts";
import {
  StateDeleteResponseSchema,
  StateDeleteSchema,
} from "./models/trellis/rpc/StateDelete.ts";
import type { StateGetResponse } from "./models/trellis/rpc/StateGet.ts";
import {
  StateGetResponseSchema,
  StateGetSchema,
} from "./models/trellis/rpc/StateGet.ts";
import type { StateListResponse } from "./models/trellis/rpc/StateList.ts";
import {
  StateListResponseSchema,
  StateListSchema,
} from "./models/trellis/rpc/StateList.ts";
import type { StatePutResponse } from "./models/trellis/rpc/StatePut.ts";
import {
  StatePutResponseSchema,
  StatePutSchema,
} from "./models/trellis/rpc/StatePut.ts";
import {
  createTransferHandle,
  type FileInfo,
  type ReceiveTransferGrant,
  type ReceiveTransferHandle,
  type SendTransferGrant,
  type SendTransferHandle,
  type TransferBody,
  type TransferGrant,
} from "./transfer.ts";
import { TrellisTasks } from "./tasks.ts";
import { TrellisConnection } from "./connection.ts";

export type { NatsConnection } from "@nats-io/nats-core";

type RuntimeRpcErrorDesc = {
  type: string;
  schema?: unknown;
  fromSerializable(data: unknown): Error;
};

type InferRuntimeRpcError<T> = T extends {
  fromSerializable(data: unknown): infer TError;
} ? TError
  : never;

export type AuthRequestsValidateResponse = StaticDecode<
  typeof AuthRequestsValidateResponseSchema
>;
export type AuthRequestsValidateInput = StaticDecode<
  typeof AuthRequestsValidateSchema
>;

export type SessionCaller = AuthRequestsValidateResponse["caller"];

/**
 * Safely extract JSON from a NATS message.
 * The .json() method can throw if the message data is not valid JSON.
 */
export function safeJson(msg: Msg): Result<JsonValue, UnexpectedError> {
  return Result.try(() => msg.json() as JsonValue);
}

function transportCauseContext(cause: unknown): Record<string, unknown> {
  if (cause instanceof Error) {
    return {
      causeName: cause.name,
      causeMessage: cause.message,
    };
  }

  return { cause: String(cause) };
}

function createTransportError(args: {
  code: string;
  message: string;
  hint: string;
  context?: Record<string, unknown>;
  cause?: unknown;
}): TransportError {
  return new TransportError({
    code: args.code,
    message: args.message,
    hint: args.hint,
    cause: args.cause,
    context: {
      ...(args.context ?? {}),
      ...(args.cause === undefined ? {} : transportCauseContext(args.cause)),
    },
  });
}

function requestFailedTransportError(args: {
  code: string;
  method?: string;
  subject: string;
  hint: string;
  message: string;
  cause?: unknown;
  context?: Record<string, unknown>;
}): TransportError {
  return createTransportError({
    code: args.code,
    message: args.message,
    hint: args.hint,
    cause: args.cause,
    context: {
      subject: args.subject,
      ...(args.method === undefined ? {} : { method: args.method }),
      ...(args.context ?? {}),
    },
  });
}

function classifyRequestTransportFailure(args: {
  method?: string;
  subject: string;
  callerCapabilities?: readonly string[];
  cause: unknown;
}): TransportError {
  const message = args.cause instanceof Error
    ? args.cause.message
    : String(args.cause);
  const isNoResponders = message.includes("no responders");
  const isNatsPermission = message.includes("Permissions Violation");

  return requestFailedTransportError({
    code: isNoResponders
      ? "trellis.request.unavailable"
      : isNatsPermission
      ? "trellis.request.denied"
      : "trellis.request.failed",
    message: isNoResponders
      ? "Trellis could not reach the requested capability."
      : isNatsPermission
      ? "Trellis denied this request."
      : "Trellis could not complete the request.",
    hint: isNoResponders
      ? "Check that the target service is installed and reachable, then try again."
      : isNatsPermission
      ? "Sign in with a profile that has the required capability, then try again."
      : "Retry the request. If it keeps failing, check Trellis runtime health.",
    cause: args.cause,
    method: args.method,
    subject: args.subject,
    context: {
      ...(args.callerCapabilities === undefined
        ? {}
        : { requiredCapabilities: args.callerCapabilities }),
      noResponders: isNoResponders,
      lowLevelMessage: message,
    },
  });
}

function encodeRuntimeSchema(
  schema: unknown,
  data: unknown,
): Result<string, ValidationError | UnexpectedError> {
  return encodeSchema(schema as never, data);
}

function parseRuntimeSchema(
  schema: unknown,
  data: JsonValue,
): Result<unknown, ValidationError | UnexpectedError> {
  return parseUnknownSchema(
    schema as Parameters<typeof parseUnknownSchema>[0],
    data,
  );
}

export function base64urlEncode(data: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...data));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64urlDecode(s: string): Uint8Array {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buf = data.buffer;
  if (buf instanceof ArrayBuffer) {
    return buf.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(digest);
}

export function buildProofInput(
  sessionKey: string,
  subject: string,
  payloadHash: Uint8Array,
  iat: number,
  requestId: string,
): Uint8Array {
  const enc = new TextEncoder();
  const sessionKeyBytes = enc.encode(sessionKey);
  const subjectBytes = enc.encode(subject);
  const iatBytes = enc.encode(String(iat));
  const requestIdBytes = enc.encode(requestId);

  const buf = new Uint8Array(
    4 +
      sessionKeyBytes.length +
      4 +
      subjectBytes.length +
      4 +
      payloadHash.length +
      4 +
      iatBytes.length +
      4 +
      requestIdBytes.length,
  );
  const view = new DataView(buf.buffer);

  let offset = 0;
  view.setUint32(offset, sessionKeyBytes.length);
  offset += 4;
  buf.set(sessionKeyBytes, offset);
  offset += sessionKeyBytes.length;

  view.setUint32(offset, subjectBytes.length);
  offset += 4;
  buf.set(subjectBytes, offset);
  offset += subjectBytes.length;

  view.setUint32(offset, payloadHash.length);
  offset += 4;
  buf.set(payloadHash, offset);
  offset += payloadHash.length;

  view.setUint32(offset, iatBytes.length);
  offset += 4;
  buf.set(iatBytes, offset);
  offset += iatBytes.length;

  view.setUint32(offset, requestIdBytes.length);
  offset += 4;
  buf.set(requestIdBytes, offset);

  return buf;
}

export type TrellisSigner = (
  data: Uint8Array,
) => Promise<Uint8Array> | Uint8Array;

export type TrellisAuth = {
  sessionKey: string;
  sign: TrellisSigner;
  currentIat?: () => number;
};

export type AnyTrellisAPI = TrellisAPI;
export type TrellisMode = "client" | "server";
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type OwnedApiFor<TContract> = TContract extends
  { API: { owned: infer TOwnedApi } }
  ? TOwnedApi extends AnyTrellisAPI ? TOwnedApi
  : never
  : never;
type ContractKvFor<TContract> = TContract extends {
  readonly [CONTRACT_KV_METADATA]?: infer TKv;
} ? NonNullable<TKv> extends ContractKvMetadata ? NonNullable<TKv>
  : {}
  : {};
type ContractJobsFor<TContract> = TContract extends {
  readonly [CONTRACT_JOBS_METADATA]?: infer TJobs;
} ? NonNullable<TJobs> extends ContractJobsMetadata ? NonNullable<TJobs>
  : {}
  : {};
export type RuntimeStateStoreShape = {
  kind: "value" | "map";
  value: unknown;
  schema?: unknown;
  stateVersion?: string;
  acceptedVersions?: Record<string, unknown>;
};
export type RuntimeStateStores = Record<string, RuntimeStateStoreShape>;
export type RuntimeStateStoresForContract<TContract> = TContract extends {
  readonly [CONTRACT_STATE_METADATA]?: infer TState;
} ? NonNullable<TState> extends RuntimeStateStores ? NonNullable<TState>
  : {}
  : {};
type TrellisApiFor<TContract> = TContract extends
  { API: { trellis?: infer TTrellisApi } }
  ? NonNullable<TTrellisApi> extends AnyTrellisAPI ? NonNullable<TTrellisApi>
  : OwnedApiFor<TContract>
  : OwnedApiFor<TContract>;
type RpcMethodsOf<TA extends AnyTrellisAPI> = TA["rpc"];
export type MethodsOf<TA extends AnyTrellisAPI> =
  & keyof RpcMethodsOf<TA>
  & string;
export type RpcMethodNameOf<TA extends AnyTrellisAPI> = MethodsOf<TA>;
export type OperationsOf<TA extends AnyTrellisAPI> =
  & keyof TA["operations"]
  & string;
type EventsOf<TA extends AnyTrellisAPI> = keyof TA["events"] & string;
export type FeedsOf<TA extends AnyTrellisAPI> =
  & keyof NonNullable<TA["feeds"]>
  & string;
type RpcMethodOf<TA extends AnyTrellisAPI, M extends keyof TA["rpc"] & string> =
  RpcMethodsOf<TA>[M];
type MethodInputOf<
  TA extends AnyTrellisAPI,
  M extends keyof TA["rpc"] & string,
> = RpcMethodOf<TA, M> extends { input: infer TInput } ? InferSchemaType<TInput>
  : never;
export type RpcInputOf<
  TA extends AnyTrellisAPI,
  M extends RpcMethodNameOf<TA>,
> = MethodInputOf<TA, M>;
type MethodOutputOf<
  TA extends AnyTrellisAPI,
  M extends keyof TA["rpc"] & string,
> = RpcMethodOf<TA, M> extends { output: infer TOutput }
  ? InferSchemaType<TOutput>
  : never;
export type RpcOutputOf<
  TA extends AnyTrellisAPI,
  M extends RpcMethodNameOf<TA>,
> = MethodOutputOf<TA, M>;
type RpcRequestShapes<TA extends AnyTrellisAPI> = {
  [M in keyof TA["rpc"] & string]: {
    input: MethodInputOf<TA, M>;
    output: MethodOutputOf<TA, M>;
  };
};
type RequestMethodOf<TRequests> = keyof TRequests & string;
type RequestInputOf<TRequests, M extends RequestMethodOf<TRequests>> =
  TRequests[M] extends { input: infer TInput } ? TInput : never;
type RequestOutputOf<TRequests, M extends RequestMethodOf<TRequests>> =
  TRequests[M] extends { output: infer TOutput } ? TOutput : never;
type RpcDescriptorOf<
  TA extends AnyTrellisAPI,
  M extends keyof TA["rpc"] & string,
> = RpcMethodOf<TA, M> extends {
  input: infer TInput;
  output: infer TOutput;
  errors?: infer TErrors;
  runtimeErrors?: infer TRuntimeErrors;
  declaredErrorTypes?: infer TDeclaredErrorTypes;
} ? {
    input: TInput;
    output: TOutput;
    errors?: TErrors;
    runtimeErrors?: TRuntimeErrors;
    declaredErrorTypes?: TDeclaredErrorTypes;
  } & RpcMethodOf<TA, M>
  : never;
type DeclaredBuiltinErrorOf<TNames> = TNames extends readonly (infer TName)[]
  ? TName extends TrellisErrorName ? TrellisErrorMap[TName]
  : never
  : never;
type DeclaredRuntimeErrorOf<TRuntimeErrors> = TRuntimeErrors extends readonly (
  infer TRuntimeError
)[] ? InferRuntimeRpcError<TRuntimeError>
  : never;
type MethodDeclaredErrorOf<
  TA extends AnyTrellisAPI,
  M extends keyof TA["rpc"] & string,
> = RpcDescriptorOf<TA, M> extends {
  errors?: infer TErrors;
  runtimeErrors?: infer TRuntimeErrors;
} ? DeclaredBuiltinErrorOf<TErrors> | DeclaredRuntimeErrorOf<TRuntimeErrors>
  : never;
type RequestErrorOf<TA extends AnyTrellisAPI, M extends MethodsOf<TA>> =
  | MethodDeclaredErrorOf<TA, M>
  | RemoteError
  | TransportError
  | ValidationError
  | UnexpectedError;
type HandlerErrorOf<TA extends AnyTrellisAPI, M extends MethodsOf<TA>> =
  | MethodDeclaredErrorOf<TA, M>
  | TrellisErrorInstance;
type EventOf<TA extends AnyTrellisAPI, E extends EventsOf<TA>> =
  TA["events"][E] extends EventDesc<infer TEvent> ? InferSchemaType<TEvent>
    : never;
type EventDescriptorOf<TA extends AnyTrellisAPI, E extends EventsOf<TA>> =
  TA["events"][E] extends EventDesc<infer TEvent>
    ? EventDesc<TEvent> & TA["events"][E]
    : never;
type EventPayloadOf<TA extends AnyTrellisAPI, E extends EventsOf<TA>> = Omit<
  EventOf<TA, E>,
  "header"
>;
/** A fully encoded event whose subject, payload, and headers are stable. */
export type PreparedTrellisEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> = Readonly<{
  event: string;
  subject: string;
  payload: Readonly<TPayload & { header: { id: string; time: string } }>;
  encodedPayload: string;
  headers: Readonly<Record<string, string>>;
}>;
export type FeedInputOf<TA extends AnyTrellisAPI, F extends FeedsOf<TA>> =
  NonNullable<TA["feeds"]>[F] extends FeedDesc<infer TInput, infer _TEvent>
    ? InferSchemaType<TInput>
    : never;
export type FeedEventOf<TA extends AnyTrellisAPI, F extends FeedsOf<TA>> =
  NonNullable<TA["feeds"]>[F] extends FeedDesc<infer _TInput, infer TEvent>
    ? InferSchemaType<TEvent>
    : never;
type FeedDescriptorOf<TA extends AnyTrellisAPI, F extends FeedsOf<TA>> =
  NonNullable<TA["feeds"]>[F] extends FeedDesc<infer TInput, infer TEvent>
    ? FeedDesc<TInput, TEvent> & NonNullable<TA["feeds"]>[F]
    : never;
export type OperationInputOf<
  TA extends AnyTrellisAPI,
  O extends OperationsOf<TA>,
> = TA["operations"][O] extends { input: infer TInput }
  ? InferSchemaType<TInput>
  : never;
export type OperationProgressOf<
  TA extends AnyTrellisAPI,
  O extends OperationsOf<TA>,
> = TA["operations"][O] extends { progress: infer TProgress }
  ? TProgress extends undefined ? unknown
  : InferSchemaType<NonNullable<TProgress>>
  : unknown;
export type OperationOutputOf<
  TA extends AnyTrellisAPI,
  O extends OperationsOf<TA>,
> = TA["operations"][O] extends { output: infer TOutput }
  ? TOutput extends undefined ? unknown : InferSchemaType<NonNullable<TOutput>>
  : unknown;
export type OperationRuntimeHandle<TProgress = unknown, TOutput = unknown> = {
  id: string;
  started(): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  progress(
    value: TProgress,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  complete(
    value: TOutput,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  fail(
    error: BaseError,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  cancel(): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  attach(
    job: { wait(): AsyncResult<unknown, BaseError> },
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  signals(): AsyncIterable<RuntimeOperationSignal>;
  nextSignal(
    name?: string,
  ): AsyncResult<RuntimeOperationSignal, BaseError>;
  defer(): OperationDeferred;
};
export type OperationDeferred = {
  kind: "deferred";
};

/**
 * Returns true when a handler result explicitly leaves operation completion to
 * an external control path.
 */
export function isOperationDeferred(
  value: unknown,
): value is OperationDeferred {
  return !!value && typeof value === "object" &&
    "kind" in value && value.kind === "deferred";
}
export type AcceptedOperation<TProgress = unknown, TOutput = unknown> =
  & OperationRuntimeHandle<TProgress, TOutput>
  & {
    ref: OperationRefData;
    snapshot: RuntimeOperationSnapshot & {
      progress?: TProgress;
      output?: TOutput;
    };
  };
export type OperationTransferHandle = {
  updates(): AsyncIterable<RuntimeOperationTransferProgress>;
  completed(): AsyncResult<FileInfo, TransferError>;
};
type StateEntryBase<TValue> = {
  value: TValue;
  revision: string;
  updatedAt: string;
  expiresAt?: string;
};
type ValueStateEntry<TValue> = StateEntryBase<TValue>;
type MapStateEntry<TValue> = StateEntryBase<TValue> & { key: string };
type StateMigrationRequiredEntry<TEntry> = {
  migrationRequired: true;
  entry: TEntry;
  stateVersion: string;
  currentStateVersion: string;
  writerContractDigest: string;
};
type StateGetResult<TStore extends RuntimeStateStoreShape> =
  | { found: false }
  | {
    found: true;
    entry: TStore["kind"] extends "map" ? MapStateEntry<TStore["value"]>
      : ValueStateEntry<TStore["value"]>;
  }
  | StateMigrationRequiredEntry<
    TStore["kind"] extends "map" ? MapStateEntry<unknown>
      : ValueStateEntry<unknown>
  >;
type StatePutResult<TStore extends RuntimeStateStoreShape> =
  | {
    applied: true;
    entry: TStore["kind"] extends "map" ? MapStateEntry<TStore["value"]>
      : ValueStateEntry<TStore["value"]>;
  }
  | {
    applied: false;
    found: boolean;
    entry?:
      | (TStore["kind"] extends "map" ? MapStateEntry<TStore["value"]>
        : ValueStateEntry<TStore["value"]>)
      | StateMigrationRequiredEntry<
        TStore["kind"] extends "map" ? MapStateEntry<unknown>
          : ValueStateEntry<unknown>
      >;
  };
type StateDeleteOptions = {
  expectedRevision?: string;
};
type StatePutOptions = {
  expectedRevision?: string | null;
  ttlMs?: number;
};
type StateListOptions = {
  offset?: number;
  limit?: number;
};
export type ValueStateStoreClient<TValue> = {
  get(): AsyncResult<
    StateGetResult<{ kind: "value"; value: TValue }>,
    BaseError
  >;
  put(
    value: TValue,
    opts?: StatePutOptions,
  ): AsyncResult<StatePutResult<{ kind: "value"; value: TValue }>, BaseError>;
  delete(
    opts?: StateDeleteOptions,
  ): AsyncResult<{ deleted: boolean }, BaseError>;
};
export type MapStateStoreClient<TValue> = {
  get(
    key: string,
  ): AsyncResult<StateGetResult<{ kind: "map"; value: TValue }>, BaseError>;
  put(
    key: string,
    value: TValue,
    opts?: StatePutOptions,
  ): AsyncResult<StatePutResult<{ kind: "map"; value: TValue }>, BaseError>;
  delete(
    key: string,
    opts?: StateDeleteOptions,
  ): AsyncResult<{ deleted: boolean }, BaseError>;
  list(opts?: StateListOptions): AsyncResult<{
    entries: Array<
      | MapStateEntry<TValue>
      | StateMigrationRequiredEntry<MapStateEntry<unknown>>
    >;
    count: number;
    offset: number;
    limit: number;
    nextOffset?: number;
  }, BaseError>;
  prefix(path: string): MapStateStoreClient<TValue>;
};
export type StateFacade<TState extends RuntimeStateStores> = {
  [K in keyof TState]: TState[K]["kind"] extends "map"
    ? MapStateStoreClient<TState[K]["value"]>
    : ValueStateStoreClient<TState[K]["value"]>;
};
export type OperationHandlerContext<
  TInput,
  TProgress = unknown,
  TOutput = unknown,
  TTransfer = undefined,
> = {
  input: TInput;
  op: OperationRuntimeHandle<TProgress, TOutput>;
  caller: SessionCaller;
} & (TTransfer extends undefined ? {} : { transfer: TTransfer });
export type OperationRegistration<
  TInput,
  TProgress = unknown,
  TOutput = unknown,
  TTransfer = undefined,
> = {
  accept(args: {
    sessionKey: string;
  }): AsyncResult<AcceptedOperation<TProgress, TOutput>, UnexpectedError>;
  /**
   * Loads an existing operation by id and returns a service-side control handle.
   * The operation must belong to this service and registration name.
   */
  control(
    operationId: string,
  ): AsyncResult<OperationRuntimeHandle<TProgress, TOutput>, BaseError>;
  handle(
    handler: (
      context: OperationHandlerContext<TInput, TProgress, TOutput, TTransfer>,
    ) => unknown | Promise<unknown>,
  ): Promise<void>;
};
export type OperationTransferContextOf<
  TA extends AnyTrellisAPI,
  O extends OperationsOf<TA>,
> = TA["operations"][O] extends { transfer: infer TTransfer }
  ? TTransfer extends undefined ? undefined
  : OperationTransferHandle
  : undefined;
export type OperationSurface<
  TA extends AnyTrellisAPI,
  TMode extends TrellisMode,
  O extends OperationsOf<TA>,
> = TMode extends "server" ? OperationRegistration<
    OperationInputOf<TA, O>,
    OperationProgressOf<TA, O>,
    OperationOutputOf<TA, O>,
    OperationTransferContextOf<TA, O>
  >
  : OperationInvoker<TA["operations"][O] & RuntimeOperationDesc>;

export function isResultLike(
  value: unknown,
): value is Result<unknown, BaseError> {
  return value instanceof Result;
}
export type RuntimeOperationDesc = {
  subject: string;
  input: unknown;
  progress?: unknown;
  output?: unknown;
  signals?: Record<string, { input: unknown }>;
  cancelCapabilities?: readonly string[];
  controlCapabilities?: readonly string[];
  transfer?: {
    store: string;
    key: `/${string}`;
    contentType?: `/${string}`;
    metadata?: `/${string}`;
    expiresInMs?: number;
    maxBytes?: number;
  };
  cancel?: boolean;
};

export type RuntimeOperationSignal = {
  operationId: string;
  sequence: number;
  signal: string;
  input?: JsonValue;
  acceptedAt: string;
};

export type RuntimeOperationSignalWaiter = (
  result: Result<RuntimeOperationSignal, BaseError>,
) => void;

export type RuntimeOperationTransferProgress = {
  chunkIndex: number;
  chunkBytes: number;
  transferredBytes: number;
};

export type RuntimeOperationState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type RuntimeOperationSnapshot = {
  id: string;
  service: string;
  operation: string;
  revision: number;
  state: RuntimeOperationState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  progress?: unknown;
  transfer?: RuntimeOperationTransferProgress;
  output?: unknown;
  error?: {
    type: string;
    message: string;
  };
};

export type RuntimeOperationRecord = {
  id: string;
  service: string;
  operation: string;
  ownerSessionKey: string;
  snapshot: RuntimeOperationSnapshot;
  sequence: number;
  signalSequence: number;
  signals: RuntimeOperationSignal[];
  terminal: boolean;
  watchers: Set<string>;
  waiters: Set<string>;
  signalWaiters: Set<RuntimeOperationSignalWaiter>;
};

export type DurableOperationRecord = {
  ownerSessionKey: string;
  sequence: number;
  signalSequence?: number;
  signals?: RuntimeOperationSignal[];
  snapshot: RuntimeOperationSnapshot;
};

const DurableOperationSignalSchema = Type.Object({
  operationId: Type.String(),
  sequence: Type.Number(),
  signal: Type.String(),
  input: Type.Optional(Type.Any()),
  acceptedAt: Type.String(),
});

const DurableOperationSnapshotSchema = Type.Object({
  id: Type.String(),
  service: Type.String(),
  operation: Type.String(),
  revision: Type.Number(),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
  ]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
  progress: Type.Optional(Type.Any()),
  transfer: Type.Optional(Type.Object({
    chunkIndex: Type.Number(),
    chunkBytes: Type.Number(),
    transferredBytes: Type.Number(),
  })),
  output: Type.Optional(Type.Any()),
  error: Type.Optional(Type.Object({
    type: Type.String(),
    message: Type.String(),
  })),
});

export const DurableOperationRecordSchema = Type.Object({
  ownerSessionKey: Type.String(),
  sequence: Type.Number(),
  signalSequence: Type.Optional(Type.Number()),
  signals: Type.Optional(Type.Array(DurableOperationSignalSchema)),
  snapshot: DurableOperationSnapshotSchema,
});

export type RuntimeOperationAcceptedEnvelope = {
  kind: "accepted";
  ref: OperationRefData;
  snapshot: RuntimeOperationSnapshot;
  transfer?: SendTransferGrant;
};

export type RuntimeOperationControlRequest =
  | {
    action: "get" | "wait" | "watch" | "cancel";
    operationId: string;
  }
  | {
    action: "signal";
    operationId: string;
    signal: string;
    input?: JsonValue;
  };

export type RuntimeOperationController = {
  get(
    operationId: string,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  started(
    operationId: string,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  progress(
    operationId: string,
    progress: unknown,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  complete(
    operationId: string,
    output: unknown,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  fail(
    operationId: string,
    error: BaseError,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  cancel(
    operationId: string,
  ): AsyncResult<RuntimeOperationSnapshot, BaseError>;
  signals(operationId: string): AsyncIterable<RuntimeOperationSignal>;
  nextSignal(
    operationId: string,
    name?: string,
  ): AsyncResult<RuntimeOperationSignal, BaseError>;
};

export function buildRuntimeOperationSnapshot(
  runtime: Pick<
    RuntimeOperationRecord,
    "id" | "service" | "operation" | "snapshot"
  >,
  state: RuntimeOperationState,
  patch?: Partial<RuntimeOperationSnapshot>,
): RuntimeOperationSnapshot {
  const updatedAt = new Date().toISOString();
  const completedAt =
    state === "completed" || state === "failed" || state === "cancelled"
      ? (patch?.completedAt ?? updatedAt)
      : patch?.completedAt;
  return {
    id: runtime.id,
    service: runtime.service,
    operation: runtime.operation,
    revision: patch?.revision ?? runtime.snapshot.revision + 1,
    state,
    createdAt: patch?.createdAt ?? runtime.snapshot.createdAt,
    updatedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(patch?.progress !== undefined
      ? { progress: patch.progress }
      : runtime.snapshot.progress !== undefined
      ? { progress: runtime.snapshot.progress }
      : {}),
    ...(patch?.transfer !== undefined
      ? { transfer: patch.transfer }
      : runtime.snapshot.transfer !== undefined
      ? { transfer: runtime.snapshot.transfer }
      : {}),
    ...(patch?.output !== undefined
      ? { output: patch.output }
      : runtime.snapshot.output !== undefined
      ? { output: runtime.snapshot.output }
      : {}),
    ...(patch?.error
      ? { error: patch.error }
      : runtime.snapshot.error
      ? { error: runtime.snapshot.error }
      : {}),
  };
}

function isRuntimeOperationSnapshot(
  value: unknown,
): value is RuntimeOperationSnapshot {
  return !!value && typeof value === "object" &&
    typeof (value as RuntimeOperationSnapshot).id === "string" &&
    typeof (value as RuntimeOperationSnapshot).service === "string" &&
    typeof (value as RuntimeOperationSnapshot).operation === "string" &&
    typeof (value as RuntimeOperationSnapshot).revision === "number" &&
    typeof (value as RuntimeOperationSnapshot).state === "string" &&
    typeof (value as RuntimeOperationSnapshot).createdAt === "string" &&
    typeof (value as RuntimeOperationSnapshot).updatedAt === "string";
}

export function isTerminalRuntimeOperationSnapshot(
  value: unknown,
): value is RuntimeOperationSnapshot {
  return isRuntimeOperationSnapshot(value) && (
    value.state === "completed" || value.state === "failed" ||
    value.state === "cancelled"
  );
}

type NoResponderRetryOpts = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

export type TrellisOpts<TA extends AnyTrellisAPI> = {
  log?: LoggerLike;
  timeout?: number;
  stream?: string;
  noResponderRetry?: NoResponderRetryOpts;
  api?: TA;
  state?: RuntimeStateStores;
  connection?: TrellisConnection;
  onSessionNotFound?: () => MaybePromise<void>;
};

export type RequestOpts = {
  timeout?: number;
};

export type EventOpts = {
  mode?: "durable" | "ephemeral";
  replay?: "all" | "new";
  /**
   * Contract event consumer group to use for durable service listeners when an
   * event is declared in more than one group.
   */
  group?: string;
  /** @deprecated Durable service listener names are provisioned by Trellis bindings. */
  durableName?: string;
  signal?: AbortSignal;
};

/** Context provided to event listener callbacks. */
export type EventListenerContext = {
  /** Stable event id from the Trellis event header. */
  id: string;
  /** Event creation time from the Trellis event header. */
  time: Date;
  /** NATS subject that delivered the event. */
  subject: string;
  /** Runtime listener mode that delivered the event. */
  mode: "durable" | "ephemeral";
  /** Durable event consumer group, when delivered through a group. */
  group?: string;
  /** JetStream sequence number, when available. */
  sequence?: number;
};

function createEventListenerContext(args: {
  payload: unknown;
  subject: string;
  mode: "durable" | "ephemeral";
  group?: string;
  message: object;
}): EventListenerContext {
  const header = typeof args.payload === "object" && args.payload !== null
    ? Reflect.get(args.payload, "header")
    : undefined;
  const id = typeof header === "object" && header !== null
    ? Reflect.get(header, "id")
    : undefined;
  const time = typeof header === "object" && header !== null
    ? Reflect.get(header, "time")
    : undefined;
  const sequence = Reflect.get(args.message, "seq");

  return {
    id: typeof id === "string" ? id : "",
    time: new Date(typeof time === "string" ? time : 0),
    subject: args.subject,
    mode: args.mode,
    ...(args.group ? { group: args.group } : {}),
    ...(typeof sequence === "number" ? { sequence } : {}),
  };
}

type RuntimeEventConsumers = {
  metadata?: ContractEventConsumers;
  bindings?: Record<string, EventConsumerResourceBinding>;
};

type TrellisInternalOpts<TA extends AnyTrellisAPI> = TrellisOpts<TA> & {
  eventConsumers?: RuntimeEventConsumers;
};

let pendingInternalEventConsumers: RuntimeEventConsumers | undefined;

/**
 * Creates a Trellis runtime with bootstrap-resolved bindings.
 *
 * @internal
 */
export function createTrellisInternal<
  TA extends AnyTrellisAPI = TrellisAPI,
  TMode extends TrellisMode = "client",
  TState extends RuntimeStateStores = RuntimeStateStores,
>(
  name: string,
  nats: NatsConnection,
  auth: TrellisAuth,
  opts?: TrellisInternalOpts<TA>,
): Trellis<TA, TMode, TState> {
  const { eventConsumers, ...publicOpts } = opts ?? {};
  pendingInternalEventConsumers = eventConsumers;
  try {
    return new Trellis<TA, TMode, TState>(name, nats, auth, publicOpts);
  } finally {
    pendingInternalEventConsumers = undefined;
  }
}

type DurableEventRegistration<TA extends AnyTrellisAPI> = {
  event: EventsOf<TA>;
  ctx: EventDescriptorOf<TA, EventsOf<TA>>;
  subject: string;
  fn: EventCallback<EventOf<TA, EventsOf<TA>>>;
};

type DurableEventConsumerLoop<TA extends AnyTrellisAPI> = {
  registrations: Array<DurableEventRegistration<TA>>;
  started: boolean;
  messages?: ConsumerMessages;
};

export type FeedSubscribeOpts = {
  signal?: AbortSignal;
};

export type FeedSubscription<TEvent> = AsyncIterable<TEvent>;

export type FeedInputBuilder<TInput, TEvent> = {
  input(input: TInput): {
    subscribe(
      opts?: FeedSubscribeOpts,
    ): AsyncResult<FeedSubscription<TEvent>, BaseError>;
  };
};

export type FeedHandlerContext<TInput, TEvent> = {
  input: TInput;
  caller: SessionCaller;
  signal: AbortSignal;
  emit(event: TEvent): AsyncResult<void, ValidationError | UnexpectedError>;
};

export type FeedRegistration<TInput, TEvent> = {
  handle(
    handler: (
      context: FeedHandlerContext<TInput, TEvent>,
    ) => unknown | Promise<unknown>,
  ): Promise<void>;
};

type SurfaceGroups<TLeaf> = Record<string, Record<string, TLeaf>>;
type RuntimeRpcLeaf = (
  input: unknown,
  opts?: RequestOpts,
) => AsyncResult<unknown, BaseError>;
type RuntimeEventLeaf = {
  prepare(
    event: Record<string, unknown>,
  ): Result<PreparedTrellisEvent, ValidationError | UnexpectedError>;
  publish(
    event: Record<string, unknown>,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
  listen(
    handler: EventCallback<unknown>,
    subjectData?: Record<string, unknown>,
    opts?: EventOpts,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
};
type RuntimeEventPublishLeaf = Omit<RuntimeEventLeaf, "listen">;
type RuntimeFeedLeaf = (
  input: unknown,
  opts?: FeedSubscribeOpts,
) => AsyncResult<FeedSubscription<unknown>, BaseError>;
type RuntimeOperationLeaf = OperationInvoker<RuntimeOperationDesc>;
type PascalSurfaceName<T extends string> = T extends
  `${infer Head}.${infer Tail}`
  ? `${Capitalize<Head>}${PascalSurfaceName<Tail>}`
  : Capitalize<T>;
type LowerCamelSurfaceName<T extends string> = Uncapitalize<
  PascalSurfaceName<T>
>;
type SurfaceGroupName<T extends string> = T extends `${infer Head}.${string}`
  ? LowerCamelSurfaceName<Head>
  : LowerCamelSurfaceName<T>;
type SurfaceLeafName<T extends string> = T extends `${string}.${infer Tail}`
  ? LowerCamelSurfaceName<Tail>
  : LowerCamelSurfaceName<T>;
type SurfaceKeysForGroup<TKeys extends string, TGroup extends string> =
  TKeys extends string ? SurfaceGroupName<TKeys> extends TGroup ? TKeys : never
    : never;

export type ActiveRpcFacade<TA extends AnyTrellisAPI = TrellisAPI> = {
  readonly [TGroup in SurfaceGroupName<MethodsOf<TA>>]: {
    readonly [
      M in SurfaceKeysForGroup<MethodsOf<TA>, TGroup> as SurfaceLeafName<M>
    ]: (
      input: RpcInputOf<TA, M>,
      opts?: RequestOpts,
    ) => AsyncResult<RpcOutputOf<TA, M>, BaseError>;
  };
};

export type ActiveEventFacade<TA extends AnyTrellisAPI = TrellisAPI> = {
  readonly [TGroup in SurfaceGroupName<EventsOf<TA>>]: {
    readonly [
      E in SurfaceKeysForGroup<EventsOf<TA>, TGroup> as SurfaceLeafName<E>
    ]: {
      prepare(
        event: EventPayloadOf<TA, E>,
      ): Result<
        PreparedTrellisEvent<EventPayloadOf<TA, E>>,
        ValidationError | UnexpectedError
      >;
      publish(
        event: EventPayloadOf<TA, E>,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
      listen(
        handler: EventCallback<EventOf<TA, E>>,
        subjectData?: Record<string, unknown>,
        opts?: EventOpts,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
};

export type ActiveEventPublishFacade<TA extends AnyTrellisAPI = TrellisAPI> = {
  readonly [TGroup in SurfaceGroupName<EventsOf<TA>>]: {
    readonly [
      E in SurfaceKeysForGroup<EventsOf<TA>, TGroup> as SurfaceLeafName<E>
    ]: {
      prepare(
        event: EventPayloadOf<TA, E>,
      ): Result<
        PreparedTrellisEvent<EventPayloadOf<TA, E>>,
        ValidationError | UnexpectedError
      >;
      publish(
        event: EventPayloadOf<TA, E>,
      ): AsyncResult<void, ValidationError | UnexpectedError>;
    };
  };
};

export type ActiveFeedFacade<TA extends AnyTrellisAPI = TrellisAPI> = {
  readonly [TGroup in SurfaceGroupName<FeedsOf<TA>>]: {
    readonly [
      F in SurfaceKeysForGroup<FeedsOf<TA>, TGroup> as SurfaceLeafName<F>
    ]: (
      input: FeedInputOf<TA, F>,
      opts?: FeedSubscribeOpts,
    ) => AsyncResult<FeedSubscription<FeedEventOf<TA, F>>, BaseError>;
  };
};

export type ActiveOperationFacade<TA extends AnyTrellisAPI = TrellisAPI> = {
  readonly [TGroup in SurfaceGroupName<OperationsOf<TA>>]: {
    readonly [
      O in SurfaceKeysForGroup<OperationsOf<TA>, TGroup> as SurfaceLeafName<O>
    ]: OperationInvoker<
      TA["operations"][O] & RuntimeOperationDesc
    >;
  };
};

export type ActiveRpcHandleFacade<
  TA extends AnyTrellisAPI = TrellisAPI,
  TRequests = RpcRequestShapes<TA>,
> = {
  readonly [TGroup in SurfaceGroupName<MethodsOf<TA>>]: {
    readonly [
      M in SurfaceKeysForGroup<MethodsOf<TA>, TGroup> as SurfaceLeafName<M>
    ]: (
      handler: HandlerFn<TA, M, TA, HandlerTrellis<TA, TRequests>>,
    ) => Promise<void>;
  };
};

export type FeedSurface<
  TA extends AnyTrellisAPI,
  TMode extends TrellisMode,
  F extends FeedsOf<TA>,
> = TMode extends "server"
  ? FeedRegistration<FeedInputOf<TA, F>, FeedEventOf<TA, F>>
  : FeedInputBuilder<FeedInputOf<TA, F>, FeedEventOf<TA, F>>;

type MaybePromise<T> = T | Promise<T>;

type EventCallback<TMessage> = {
  bivarianceHack(
    message: TMessage,
    context: EventListenerContext,
  ): MaybeAsync<void, BaseError>;
}["bivarianceHack"];

export type RpcHandlerContext = {
  caller: SessionCaller;
  sessionKey: string;
};

export type HandlerTrellis<
  TA extends AnyTrellisAPI,
  TRequests = RpcRequestShapes<TA>,
> = {
  readonly rpc: ActiveRpcFacade<TA>;
  readonly event: ActiveEventPublishFacade<TA>;
  readonly feed: ActiveFeedFacade<TA>;
  readonly operation: ActiveOperationFacade<TA>;
  request<const M extends RequestMethodOf<TRequests>>(
    method: M,
    input: RequestInputOf<TRequests, M>,
    opts?: RequestOpts,
  ): AsyncResult<RequestOutputOf<TRequests, M>, BaseError>;
  publish(
    event: string,
    data: Record<string, unknown>,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
  prepare(
    event: string,
    data: Record<string, unknown>,
  ): Result<PreparedTrellisEvent, ValidationError | UnexpectedError>;
  publishPrepared(
    event: PreparedTrellisEvent,
  ): AsyncResult<void, UnexpectedError>;
};

function surfaceGroupName(key: string): string {
  return lowerCamelIdent(key.split(".")[0] ?? key);
}

function surfaceLeafName(key: string): string {
  const parts = key.split(".");
  parts.shift();
  return lowerCamelIdent(parts.length === 0 ? key : parts.join("."));
}

function lowerCamelIdent(value: string): string {
  const pascal = value
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return pascal.length === 0 ? "_" : pascal[0]!.toLowerCase() + pascal.slice(1);
}

function addSurfaceLeaf<TLeaf>(
  surface: SurfaceGroups<TLeaf>,
  key: string,
  leaf: TLeaf,
): void {
  const group = surfaceGroupName(key);
  surface[group] ??= {};
  surface[group][surfaceLeafName(key)] = leaf;
}

function natsSubjectMatches(pattern: string, subject: string): boolean {
  const patternParts = pattern.split(".");
  const subjectParts = subject.split(".");
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index];
    if (part === ">") return true;
    const subjectPart = subjectParts[index];
    if (subjectPart === undefined) return false;
    if (part !== "*" && part !== subjectPart) return false;
  }
  return patternParts.length === subjectParts.length;
}

export type HandlerKvFacade<TKv extends ContractKvMetadata> = {
  [K in keyof TKv]: TKv[K]["required"] extends false
    ? TypedKV<TKv[K]["schema"]> | undefined
    : TypedKV<TKv[K]["schema"]>;
};

export type HandlerStoreHandle = {
  open(): AsyncResult<TypedStore, StoreError>;
  waitFor(
    key: string,
    options?: StoreWaitOptions,
  ): AsyncResult<TypedStoreEntry, StoreError>;
};

export type HandlerJobQueue<
  TPayload,
  TResult,
  TTrellis,
> = {
  create(payload: TPayload): AsyncResult<JobRef<TPayload, TResult>, BaseError>;
  handle(
    handler: (args: {
      job: ActiveJob<TPayload, TResult>;
      client: TTrellis;
    }) => Promise<Result<TResult, BaseError>>,
  ): void;
};

export type HandlerJobsFacade<
  TJobs extends Record<string, JobTypeMetadata>,
  TTrellis,
> = {
  [K in keyof TJobs]: HandlerJobQueue<
    TJobs[K]["payload"],
    TJobs[K]["result"],
    TTrellis
  >;
};

export type HandlerTrellisForContract<TContract> =
  & HandlerTrellis<TrellisApiFor<TContract>>
  & {
    kv: HandlerKvFacade<ContractKvFor<TContract>>;
    store: Record<string, HandlerStoreHandle>;
    jobs: HandlerJobsFacade<
      ContractJobsFor<TContract>,
      HandlerTrellisForContract<TContract>
    >;
  };

/** Public client-side surface returned by `TrellisClient.connect`. */
export type ClientTrellis<
  TA extends AnyTrellisAPI = TrellisAPI,
  TState extends RuntimeStateStores = {},
  TRequests = RpcRequestShapes<TA>,
> = {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly api: TA;
  readonly state: StateFacade<TState>;
  readonly connection: TrellisConnection;
  readonly natsConnection: NatsConnection;
  readonly rpc: ActiveRpcFacade<TA>;
  readonly event: ActiveEventFacade<TA>;
  readonly feed: ActiveFeedFacade<TA>;
  readonly operation: ActiveOperationFacade<TA>;
  readonly handle: { readonly rpc: ActiveRpcHandleFacade<TA, TRequests> };
  request<const M extends RequestMethodOf<TRequests>>(
    method: M,
    input: RequestInputOf<TRequests, M>,
    opts?: RequestOpts,
  ): AsyncResult<RequestOutputOf<TRequests, M>, BaseError>;
  publish<E extends EventsOf<TA>>(
    event: E,
    data: EventPayloadOf<TA, E>,
  ): AsyncResult<void, ValidationError | UnexpectedError>;
  prepare<E extends EventsOf<TA>>(
    event: E,
    data: EventPayloadOf<TA, E>,
  ): Result<
    PreparedTrellisEvent<EventPayloadOf<TA, E>>,
    ValidationError | UnexpectedError
  >;
  publishPrepared(
    event: PreparedTrellisEvent,
  ): AsyncResult<void, UnexpectedError>;
  transfer(grant: SendTransferGrant): SendTransferHandle;
  transfer(grant: ReceiveTransferGrant): ReceiveTransferHandle;
  wait(): AsyncResult<void, BaseError>;
};

/** Connected client type for a generated Trellis contract. */
export type ConnectedTrellisClient<TContract> = Simplify<
  ClientTrellis<
    TContract extends { API: { trellis?: infer TApi } }
      ? NonNullable<TApi> extends AnyTrellisAPI ? NonNullable<TApi> : TrellisAPI
      : TrellisAPI,
    RuntimeStateStoresForContract<TContract>
  >
>;

export type HandlerArgs<
  TMountApi extends AnyTrellisAPI,
  M extends MethodsOf<TMountApi>,
  TOutboundApi extends AnyTrellisAPI = TMountApi,
  TTrellis = HandlerTrellis<TOutboundApi>,
> = {
  input: MethodInputOf<TMountApi, M>;
  context: RpcHandlerContext;
  client: TTrellis;
};

export type HandlerFn<
  TMountApi extends AnyTrellisAPI,
  M extends MethodsOf<TMountApi>,
  TOutboundApi extends AnyTrellisAPI = TMountApi,
  TTrellis = HandlerTrellis<TOutboundApi>,
> = (args: HandlerArgs<TMountApi, M, TOutboundApi, TTrellis>) => MaybePromise<
  Result<MethodOutputOf<TMountApi, M>, HandlerErrorOf<TMountApi, M>>
>;
export type RpcHandlerFn<
  TA extends AnyTrellisAPI,
  M extends RpcMethodNameOf<TA>,
> = HandlerFn<TA, M, TA>;
export type TrellisFor<TContract> = HandlerTrellisForContract<TContract>;

const DEFAULT_STATE_LIST_LIMIT = 100;

const STATE_RUNTIME_RPC = {
  get: {
    subject: "rpc.v1.State.Get",
    input: StateGetSchema,
    output: StateGetResponseSchema,
    callerCapabilities: [],
    errors: ["AuthError", "ValidationError", "UnexpectedError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "ValidationError",
      "UnexpectedError",
    ] as const,
  },
  put: {
    subject: "rpc.v1.State.Put",
    input: StatePutSchema,
    output: StatePutResponseSchema,
    callerCapabilities: [],
    errors: ["AuthError", "ValidationError", "UnexpectedError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "ValidationError",
      "UnexpectedError",
    ] as const,
  },
  delete: {
    subject: "rpc.v1.State.Delete",
    input: StateDeleteSchema,
    output: StateDeleteResponseSchema,
    callerCapabilities: [],
    errors: ["AuthError", "ValidationError", "UnexpectedError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "ValidationError",
      "UnexpectedError",
    ] as const,
  },
  list: {
    subject: "rpc.v1.State.List",
    input: StateListSchema,
    output: StateListResponseSchema,
    callerCapabilities: [],
    errors: ["AuthError", "ValidationError", "UnexpectedError"] as const,
    declaredErrorTypes: [
      "AuthError",
      "ValidationError",
      "UnexpectedError",
    ] as const,
  },
} satisfies Record<string, {
  subject: string;
  input: unknown;
  output: unknown;
  callerCapabilities: readonly string[];
  errors: readonly string[];
  declaredErrorTypes: readonly string[];
}>;

function joinStatePath(prefix: string | undefined, key: string): string {
  return [prefix, key]
    .flatMap((value) => value?.split("/") ?? [])
    .filter((segment) => segment.length > 0)
    .join("/");
}

function validateStateValue(
  schema: unknown,
  value: JsonValue,
): Result<unknown, ValidationError | UnexpectedError> {
  return parseRuntimeSchema(schema, value);
}

function validateStateGetResult<TStore extends RuntimeStateStoreShape>(
  descriptor: RuntimeStateStoreShape,
  result: StateGetResult<TStore>,
): Result<StateGetResult<TStore>, ValidationError | UnexpectedError> {
  if ("migrationRequired" in result) {
    const schema = descriptor.acceptedVersions?.[result.stateVersion];
    if (!schema) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/stateVersion",
            message:
              `state version '${result.stateVersion}' is not accepted by the runtime store`,
          }],
        }),
      );
    }
    const parsed = validateStateValue(schema, result.entry.value as JsonValue);
    if (parsed.isErr()) return Result.err(parsed.error);
    return Result.ok({
      ...result,
      entry: {
        ...result.entry,
        value: parsed.unwrapOrElse(() => {
          throw new Error("state value validation unexpectedly failed");
        }),
      },
    });
  }

  if (!result.found) {
    return Result.ok(result);
  }

  const parsed = validateStateValue(
    descriptor.schema,
    result.entry.value as JsonValue,
  );
  if (parsed.isErr()) {
    return Result.err(parsed.error);
  }

  return Result.ok({
    ...result,
    entry: {
      ...result.entry,
      value: parsed.unwrapOrElse(() => {
        throw new Error("state value validation unexpectedly failed");
      }),
    },
  });
}

function validateStatePutResult<TStore extends RuntimeStateStoreShape>(
  descriptor: RuntimeStateStoreShape,
  result: StatePutResult<TStore>,
): Result<StatePutResult<TStore>, ValidationError | UnexpectedError> {
  if (result.applied) {
    const parsed = validateStateValue(
      descriptor.schema,
      result.entry.value as JsonValue,
    );
    if (parsed.isErr()) return Result.err(parsed.error);
    return Result.ok({
      ...result,
      entry: {
        ...result.entry,
        value: parsed.unwrapOrElse(() => {
          throw new Error("state value validation unexpectedly failed");
        }),
      },
    });
  }

  if (!result.entry) {
    return Result.ok(result);
  }

  if ("migrationRequired" in result.entry) {
    const schema = descriptor.acceptedVersions?.[result.entry.stateVersion];
    if (!schema) {
      return Result.err(
        new ValidationError({
          errors: [{
            path: "/stateVersion",
            message:
              `state version '${result.entry.stateVersion}' is not accepted by the runtime store`,
          }],
        }),
      );
    }
    const parsed = validateStateValue(
      schema,
      result.entry.entry.value as JsonValue,
    );
    if (parsed.isErr()) return Result.err(parsed.error);
    return Result.ok({
      ...result,
      entry: {
        ...result.entry,
        entry: {
          ...result.entry.entry,
          value: parsed.unwrapOrElse(() => {
            throw new Error("state value validation unexpectedly failed");
          }),
        },
      },
    });
  }

  const parsed = validateStateValue(
    descriptor.schema,
    result.entry.value as JsonValue,
  );
  if (parsed.isErr()) {
    return Result.err(parsed.error);
  }

  return Result.ok({
    ...result,
    entry: {
      ...result.entry,
      value: parsed.unwrapOrElse(() => {
        throw new Error("state value validation unexpectedly failed");
      }),
    },
  });
}

function validateStateListResult(
  descriptor: RuntimeStateStoreShape,
  result: {
    entries: Array<
      MapStateEntry<unknown> | {
        migrationRequired: true;
        entry: MapStateEntry<unknown>;
        stateVersion: string;
        currentStateVersion: string;
        writerContractDigest: string;
      }
    >;
    count: number;
    offset: number;
    limit: number;
    nextOffset?: number;
  },
): Result<typeof result, ValidationError | UnexpectedError> {
  const entries: typeof result.entries = [];
  for (const entry of result.entries) {
    if ("migrationRequired" in entry) {
      const schema = descriptor.acceptedVersions?.[entry.stateVersion];
      if (!schema) {
        return Result.err(
          new ValidationError({
            errors: [{
              path: "/stateVersion",
              message:
                `state version '${entry.stateVersion}' is not accepted by the runtime store`,
            }],
          }),
        );
      }
      const parsed = validateStateValue(schema, entry.entry.value as JsonValue);
      if (parsed.isErr()) return Result.err(parsed.error);
      entries.push({
        ...entry,
        entry: {
          ...entry.entry,
          value: parsed.unwrapOrElse(() => {
            throw new Error("state value validation unexpectedly failed");
          }),
        },
      });
      continue;
    }

    const parsed = validateStateValue(
      descriptor.schema,
      entry.value as JsonValue,
    );
    if (parsed.isErr()) {
      return Result.err(parsed.error);
    }
    entries.push({
      ...entry,
      value: parsed.unwrapOrElse(() => {
        throw new Error("state value validation unexpectedly failed");
      }),
    });
  }

  return Result.ok({ ...result, entries });
}

export type RpcArgs<
  TContract,
  M extends RpcMethodNameOf<OwnedApiFor<TContract>>,
> = HandlerArgs<
  OwnedApiFor<TContract>,
  M,
  TrellisApiFor<TContract>,
  HandlerTrellisForContract<TContract>
>;
export type RpcResult<
  TContract,
  M extends RpcMethodNameOf<OwnedApiFor<TContract>>,
> = Result<
  RpcOutputOf<OwnedApiFor<TContract>, M>,
  RpcHandlerErrorOf<OwnedApiFor<TContract>, M>
>;
export type RpcRequestErrorOf<
  TA extends AnyTrellisAPI,
  M extends RpcMethodNameOf<TA>,
> = RequestErrorOf<TA, M>;
export type RpcHandlerErrorOf<
  TA extends AnyTrellisAPI,
  M extends RpcMethodNameOf<TA>,
> = HandlerErrorOf<TA, M>;
export type EventName<TContract> = EventsOf<OwnedApiFor<TContract>>;
export type EventType<
  TContract,
  E extends EventName<TContract>,
> = EventOf<OwnedApiFor<TContract>, E>;
export type EventPayload<
  TContract,
  E extends EventName<TContract>,
> = EventPayloadOf<OwnedApiFor<TContract>, E>;
export type EventHandler<
  TContract,
  E extends EventName<TContract>,
> = (
  event: EventType<TContract, E>,
  context: EventListenerContext,
) => MaybeAsync<void, BaseError>;

type DeepRecord<T> = {
  [k: string]: T | DeepRecord<T>;
};

const NATS_SUBJECT_TOKEN_FORBIDDEN = /[\u0000\s.*>~]/gu;

const DEFAULT_NO_RESPONDER_MAX_RETRIES = 2;
const DEFAULT_NO_RESPONDER_RETRY_MS = 200;
const DEFAULT_AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS = 3;
const DEFAULT_AUTH_VALIDATE_SESSION_RETRY_MS = 25;

function activeTraceId(span: Span): string | undefined {
  const traceId = span.spanContext().traceId;
  return traceId === "00000000000000000000000000000000" ? undefined : traceId;
}

function traceIdFromTraceparent(
  traceparent: string | undefined,
): string | undefined {
  const [version, traceId, parentId, flags, extra] = traceparent?.split("-") ??
    [];
  if (
    extra !== undefined ||
    !/^[0-9a-f]{2}$/u.test(version ?? "") ||
    version === "ff" ||
    !/^[0-9a-f]{32}$/u.test(traceId ?? "") ||
    traceId === "00000000000000000000000000000000" ||
    !/^[0-9a-f]{16}$/u.test(parentId ?? "") ||
    parentId === "0000000000000000" ||
    !/^[0-9a-f]{2}$/u.test(flags ?? "")
  ) {
    return undefined;
  }
  return traceId;
}

const EMPTY_TRELLIS_API: TrellisAPI = {
  rpc: {},
  operations: {},
  events: {},
  feeds: {},
  subjects: {},
};

type AuthCacheEntry = {
  caller: SessionCaller;
  expires: number;
};

function isBrowserAuthRequiredError(error: unknown): boolean {
  const isAuthRequiredReason = (reason: unknown): boolean =>
    reason === "session_not_found";

  if (error instanceof AuthError) {
    return isAuthRequiredReason(error.reason);
  }

  if (
    error instanceof RemoteError &&
    error.remoteError.type === "AuthError"
  ) {
    const reason = Reflect.get(error.remoteError, "reason");
    return isAuthRequiredReason(reason);
  }

  return false;
}

function isTransientAuthValidateSessionError(error: unknown): boolean {
  if (error instanceof AuthError) {
    return error.reason === "session_not_found";
  }

  if (
    error instanceof RemoteError &&
    error.remoteError.type === "AuthError"
  ) {
    const reason = Reflect.get(error.remoteError, "reason");
    return reason === "session_not_found";
  }

  return false;
}

function isDeclaredRpcError(
  errorNames: readonly string[] | undefined,
  type: string,
): boolean {
  return !!errorNames?.includes(type);
}

function isRuntimeRpcErrorDesc(value: unknown): value is RuntimeRpcErrorDesc {
  return !!value && typeof value === "object" &&
    typeof Reflect.get(value, "type") === "string" &&
    typeof Reflect.get(value, "fromSerializable") === "function";
}

const payloadSizeEncoder = new TextEncoder();

function payloadByteLength(payload: string | Uint8Array): number {
  return typeof payload === "string"
    ? payloadSizeEncoder.encode(payload).byteLength
    : payload.byteLength;
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function causeLogData(cause: unknown): unknown {
  return cause instanceof Error
    ? { message: cause.message, stack: cause.stack, name: cause.name }
    : cause;
}

function reconstructDeclaredRpcError(
  errorNames: readonly string[] | undefined,
  runtimeErrors: readonly RuntimeRpcErrorDesc[] | undefined,
  data: StaticDecode<typeof TrellisErrorDataSchema>,
  json: JsonValue,
): BaseError | ValidationError | UnexpectedError | null {
  if (!isDeclaredRpcError(errorNames, data.type)) {
    return null;
  }

  const runtimeError = getBuiltinRpcError(data.type) ??
    runtimeErrors?.find((candidate) => candidate.type === data.type);
  if (!runtimeError) {
    return null;
  }

  const parsed = runtimeError.schema
    ? parseRuntimeSchema(runtimeError.schema, json).take()
    : data;
  if (isErr(parsed)) {
    return parsed.error instanceof ValidationError ||
        parsed.error instanceof UnexpectedError
      ? parsed.error
      : new UnexpectedError({ cause: parsed.error });
  }

  try {
    const reconstructed = runtimeError.fromSerializable(parsed);
    if (reconstructed instanceof BaseError) {
      return reconstructed;
    }
    return new UnexpectedError({
      cause: new Error(
        `RPC error '${data.type}' reconstructed to a non-Trellis error instance`,
      ),
    });
  } catch (cause) {
    return new UnexpectedError({ cause });
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class Trellis<
  TA extends AnyTrellisAPI = TrellisAPI,
  TMode extends TrellisMode = "client",
  TState extends RuntimeStateStores = {},
  TRequests = RpcRequestShapes<TA>,
> {
  readonly name: string;
  readonly timeout: number;
  readonly stream: string;
  readonly state: StateFacade<TState>;
  readonly rpc: ActiveRpcFacade<TA>;
  readonly event: ActiveEventFacade<TA>;
  readonly feed: ActiveFeedFacade<TA>;
  readonly operation: ActiveOperationFacade<TA>;
  readonly handle: { readonly rpc: ActiveRpcHandleFacade<TA, TRequests> };
  /** Framework-neutral lifecycle handle for this Trellis runtime connection. */
  readonly connection: TrellisConnection;

  protected nats: NatsConnection;
  protected js: JetStreamClient;
  protected auth: TrellisAuth;
  readonly api: TA;
  #log: LoggerLike;
  #tasks: TrellisTasks;
  #hasExplicitApi: boolean;
  #noResponderMaxRetries: number;
  #noResponderRetryMs: number;
  #onSessionNotFound?: () => MaybePromise<void>;
  #operationStore?: Promise<TypedKV<typeof DurableOperationRecordSchema>>;
  #eventConsumers: RuntimeEventConsumers;
  #durableEventLoops = new Map<string, DurableEventConsumerLoop<TA>>();

  constructor(
    name: string, // Must be unique for a service
    nats: NatsConnection,
    auth: TrellisAuth,
    opts?: TrellisOpts<TA>,
  ) {
    const api = opts?.api;

    this.name = name;
    this.nats = nats;
    this.js = jetstream(this.nats);
    this.auth = auth as TrellisAuth;
    this.api = (api ?? EMPTY_TRELLIS_API) as TA;
    this.#log = (opts?.log ?? logger).child({ lib: "trellis" });
    this.timeout = opts?.timeout ?? 3000;
    this.stream = opts?.stream ?? "trellis";
    this.#hasExplicitApi = api !== undefined;
    this.#noResponderMaxRetries = opts?.noResponderRetry?.maxAttempts ??
      DEFAULT_NO_RESPONDER_MAX_RETRIES;
    this.#noResponderRetryMs = opts?.noResponderRetry?.baseDelayMs ??
      DEFAULT_NO_RESPONDER_RETRY_MS;
    this.#onSessionNotFound = opts?.onSessionNotFound;
    this.#eventConsumers = pendingInternalEventConsumers ?? {};
    this.connection = opts?.connection ??
      new TrellisConnection({ kind: "client" });

    this.#tasks = new TrellisTasks({ log: this.#log });
    this.state = this.#createStateFacade(opts?.state as TState | undefined);
    this.rpc = this.#createRpcFacade();
    this.handle = { rpc: this.#createRpcHandleFacade() };
    this.event = this.#createEventFacade();
    this.feed = this.#createFeedFacade();
    this.operation = this.#createOperationFacade();
  }

  /**
   * Returns the underlying NATS connection.
   */
  get natsConnection(): NatsConnection {
    return this.nats;
  }

  #createStateFacade(state: TState | undefined): StateFacade<TState> {
    const stores = (state ?? {}) as RuntimeStateStores;
    const facade = Object.fromEntries(
      Object.entries(stores).map(([store, descriptor]) => {
        if (descriptor.kind === "value") {
          const client: ValueStateStoreClient<unknown> = {
            get: () =>
              AsyncResult.from((async () => {
                const result = await this.#requestBuiltRpc<
                  StateGetResult<{ kind: "value"; value: unknown }>
                >(
                  "State.Get",
                  { store },
                  STATE_RUNTIME_RPC.get,
                );
                if (result.isErr()) return result;
                return validateStateGetResult(
                  descriptor,
                  result.unwrapOrElse(() => {
                    throw new Error("state get unexpectedly failed");
                  }),
                );
              })()),
            put: (value, opts) =>
              AsyncResult.from((async () => {
                const encoded = encodeRuntimeSchema(descriptor.schema, value)
                  .take();
                if (isErr(encoded)) {
                  return Result.err(encoded.error);
                }
                const result = await this.#requestBuiltRpc<
                  StatePutResult<{ kind: "value"; value: unknown }>
                >(
                  "State.Put",
                  { store, value, ...opts },
                  STATE_RUNTIME_RPC.put,
                );
                if (result.isErr()) return result;
                return validateStatePutResult(
                  descriptor,
                  result.unwrapOrElse(() => {
                    throw new Error("state put unexpectedly failed");
                  }),
                );
              })()),
            delete: (opts) =>
              this.#requestBuiltRpc<{ deleted: boolean }>(
                "State.Delete",
                { store, ...opts },
                STATE_RUNTIME_RPC.delete,
              ),
          };
          return [store, client];
        }

        const mapClient = (prefix?: string): MapStateStoreClient<unknown> => ({
          get: (key) =>
            AsyncResult.from((async () => {
              const result = await this.#requestBuiltRpc<
                StateGetResult<{ kind: "map"; value: unknown }>
              >(
                "State.Get",
                { store, key: joinStatePath(prefix, key) },
                STATE_RUNTIME_RPC.get,
              );
              if (result.isErr()) return result;
              return validateStateGetResult(
                descriptor,
                result.unwrapOrElse(() => {
                  throw new Error("state get unexpectedly failed");
                }),
              );
            })()),
          put: (key, value, opts) =>
            AsyncResult.from((async () => {
              const encoded = encodeRuntimeSchema(descriptor.schema, value)
                .take();
              if (isErr(encoded)) {
                return Result.err(encoded.error);
              }
              const result = await this.#requestBuiltRpc<
                StatePutResult<{ kind: "map"; value: unknown }>
              >(
                "State.Put",
                { store, key: joinStatePath(prefix, key), value, ...opts },
                STATE_RUNTIME_RPC.put,
              );
              if (result.isErr()) return result;
              return validateStatePutResult(
                descriptor,
                result.unwrapOrElse(() => {
                  throw new Error("state put unexpectedly failed");
                }),
              );
            })()),
          delete: (key, opts) =>
            this.#requestBuiltRpc<{ deleted: boolean }>(
              "State.Delete",
              { store, key: joinStatePath(prefix, key), ...opts },
              STATE_RUNTIME_RPC.delete,
            ),
          list: (opts) =>
            AsyncResult.from((async () => {
              const result = await this.#requestBuiltRpc<{
                entries: Array<
                  | MapStateEntry<unknown>
                  | StateMigrationRequiredEntry<MapStateEntry<unknown>>
                >;
                count: number;
                offset: number;
                limit: number;
                nextOffset?: number;
              }>(
                "State.List",
                {
                  store,
                  ...(prefix ? { prefix } : {}),
                  offset: opts?.offset ?? 0,
                  limit: opts?.limit ?? DEFAULT_STATE_LIST_LIMIT,
                },
                STATE_RUNTIME_RPC.list,
              );
              if (result.isErr()) return result;
              return validateStateListResult(
                descriptor,
                result.unwrapOrElse(() => {
                  throw new Error("state list unexpectedly failed");
                }),
              );
            })()),
          prefix: (path) => mapClient(joinStatePath(prefix, path)),
        });

        return [store, mapClient()];
      }),
    );

    return facade as StateFacade<TState>;
  }

  #createRpcFacade(): ActiveRpcFacade<TA> {
    const surface: SurfaceGroups<RuntimeRpcLeaf> = {};
    for (const method of Object.keys(this.api.rpc ?? {})) {
      const leaf: RuntimeRpcLeaf = (input, opts) =>
        this.request(
          method as RequestMethodOf<TRequests>,
          input as RequestInputOf<TRequests, RequestMethodOf<TRequests>>,
          opts,
        );
      addSurfaceLeaf(surface, method, leaf);
    }
    return surface as ActiveRpcFacade<TA>;
  }

  #createRpcHandleFacade(): ActiveRpcHandleFacade<TA, TRequests> {
    const surface: SurfaceGroups<
      (
        handler: HandlerFn<
          TA,
          MethodsOf<TA>,
          TA,
          HandlerTrellis<TA, TRequests>
        >,
      ) => Promise<void>
    > = {};
    for (const method of Object.keys(this.api.rpc ?? {})) {
      addSurfaceLeaf(
        surface,
        method,
        (handler) =>
          this.mount(
            method,
            handler as Parameters<
              Trellis<TA, TMode, TState, TRequests>["mount"]
            >[1],
          ),
      );
    }
    return surface as ActiveRpcHandleFacade<TA, TRequests>;
  }

  #createEventFacade(): ActiveEventFacade<TA> {
    const surface: SurfaceGroups<RuntimeEventLeaf> = {};
    for (const event of Object.keys(this.api.events ?? {})) {
      addSurfaceLeaf(surface, event, {
        prepare: (payload) => this.prepare(event, payload),
        publish: (payload) => this.publish(event, payload),
        listen: (handler, subjectData = {}, opts) =>
          this.listenEvent(event, subjectData, handler, opts),
      });
    }
    return surface as ActiveEventFacade<TA>;
  }

  #createEventPublishFacade(): ActiveEventPublishFacade<TA> {
    const surface: SurfaceGroups<RuntimeEventPublishLeaf> = {};
    for (const event of Object.keys(this.api.events ?? {})) {
      addSurfaceLeaf(surface, event, {
        prepare: (payload) => this.prepare(event, payload),
        publish: (payload) => this.publish(event, payload),
      });
    }
    return surface as ActiveEventPublishFacade<TA>;
  }

  #createFeedFacade(): ActiveFeedFacade<TA> {
    const surface: SurfaceGroups<RuntimeFeedLeaf> = {};
    for (const feed of Object.keys(this.api.feeds ?? {})) {
      const leaf: RuntimeFeedLeaf = (input, opts) =>
        this.feedHandle(feed as FeedsOf<TA>).input(
          input as FeedInputOf<TA, FeedsOf<TA>>,
        ).subscribe(opts) as AsyncResult<
          FeedSubscription<unknown>,
          BaseError
        >;
      addSurfaceLeaf(surface, feed, leaf);
    }
    return surface as ActiveFeedFacade<TA>;
  }

  #createHandlerTrellis(): HandlerTrellis<TA, TRequests> {
    return {
      rpc: this.rpc,
      event: this.#createEventPublishFacade(),
      feed: this.feed,
      operation: this.operation,
      request: this.request.bind(this),
      prepare: (event, data) => this.prepare(event, data),
      publish: (event, data) => this.publish(event, data),
      publishPrepared: (event) => this.publishPrepared(event),
    };
  }

  #createOperationFacade(): ActiveOperationFacade<TA> {
    const surface: SurfaceGroups<RuntimeOperationLeaf> = {};
    for (const operation of Object.keys(this.api.operations ?? {})) {
      addSurfaceLeaf(
        surface,
        operation,
        this.operationHandle(operation) as OperationInvoker<
          RuntimeOperationDesc
        >,
      );
    }
    return surface as ActiveOperationFacade<TA>;
  }

  #unknownApiError(
    kind: "RPC method" | "operation" | "event" | "feed",
    name: string,
  ): Error {
    const base = `Unknown ${kind} '${name}'.`;
    if (this.#hasExplicitApi) {
      return new Error(`${base} Did you forget to include its API module?`);
    }
    return new Error(
      `${base} No API surface was provided. Pass opts.api, use createClient(contract, ...), or await createCoreClient(...) instead.`,
    );
  }

  async operationStoreHandle(): Promise<
    TypedKV<typeof DurableOperationRecordSchema>
  > {
    if (!this.#operationStore) {
      const bucket = `trellis_operations_${this.auth.sessionKey.slice(0, 16)}`;
      this.#operationStore = (async () => {
        const result = await TypedKV.open(
          this.nats,
          bucket,
          DurableOperationRecordSchema,
          {
            history: 5,
            ttl: 0,
          },
        );
        const value = result.take();
        if (isErr(value)) {
          throw value.error;
        }
        return value;
      })();
    }
    return this.#operationStore;
  }

  async loadOperationRecord(
    operationId: string,
  ): Promise<DurableOperationRecord | null> {
    const store = await this.operationStoreHandle();
    const entry = await store.get(operationId);
    const value = entry.take();
    if (isErr(value)) {
      return null;
    }
    return value.value as DurableOperationRecord;
  }

  async saveOperationRecord(runtime: RuntimeOperationRecord): Promise<void> {
    const store = await this.operationStoreHandle();
    const record: DurableOperationRecord = {
      ownerSessionKey: runtime.ownerSessionKey,
      sequence: runtime.sequence,
      signalSequence: runtime.signalSequence,
      signals: runtime.signals,
      snapshot: runtime.snapshot,
    };
    await store.put(runtime.id, record);
  }

  /**
   * Makes an authenticated request to a Trellis RPC method.
   *
   * @template M The specific RPC method being called.
   * @param method The name of the RPC method to call.
   * @param input The input data for the method, conforming to its schema.
   * @param opts Optional request-specific options.
   * @returns An `AsyncResult` containing either the method's output or an error.
   * @returns A `Result` object after awaiting:
   *              ok: A validated response for method M
   *              err: declared RPC errors | RemoteError | ValidationError | UnexpectedError
   */
  request<const M extends RequestMethodOf<TRequests>>(
    method: M,
    input: RequestInputOf<TRequests, M>,
    opts?: RequestOpts,
  ): AsyncResult<RequestOutputOf<TRequests, M>, BaseError>;
  request(
    method: string,
    input: unknown,
    opts?: RequestOpts,
  ): AsyncResult<unknown, BaseError> {
    const rpcApi = this.api["rpc"] as Record<string, unknown>;
    const ctx = rpcApi[method] as {
      subject: string;
      input: unknown;
      output: unknown;
      callerCapabilities: readonly string[];
      errors?: readonly string[];
      declaredErrorTypes?: readonly string[];
      runtimeErrors?: readonly RuntimeRpcErrorDesc[];
    } | undefined;
    if (!ctx) {
      return AsyncResult.from(Promise.resolve(err(
        new UnexpectedError({
          cause: this.#unknownApiError("RPC method", method.toString()),
          context: { method: method.toString() },
        }),
      )));
    }

    return this.#requestBuiltRpcUnknown(method, input, ctx, opts);
  }

  #requestBuiltRpcUnknown(
    method: string,
    input: unknown,
    ctx: {
      subject: string;
      input: unknown;
      output: unknown;
      callerCapabilities: readonly string[];
      errors?: readonly string[];
      declaredErrorTypes?: readonly string[];
      runtimeErrors?: readonly RuntimeRpcErrorDesc[];
    },
    opts?: RequestOpts,
  ): AsyncResult<unknown, BaseError> {
    return this.#requestBuiltRpc(method, input, ctx, opts);
  }

  #requestBuiltRpc<TOutput>(
    method: string,
    input: unknown,
    ctx: {
      subject: string;
      input: unknown;
      output: unknown;
      callerCapabilities: readonly string[];
      errors?: readonly string[];
      declaredErrorTypes?: readonly string[];
      runtimeErrors?: readonly RuntimeRpcErrorDesc[];
    },
    opts?: RequestOpts,
  ): AsyncResult<TOutput, BaseError> {
    return AsyncResult.from((async () => {
      this.#log.trace(
        { method: String(method) },
        `Calling ${method.toString()}.`,
      );

      const msg = encodeRuntimeSchema(ctx.input, input).take();
      if (isErr(msg)) {
        return msg;
      }

      const subject = this.template(ctx.subject, input).take();
      if (isErr(subject)) {
        return subject;
      }

      const span = startClientSpan(method, subject);
      const attempt = async (): Promise<Result<TOutput, BaseError>> => {
        const authHeaders = await this.#createProof(subject, msg);

        const headers = natsHeaders();
        headers.set("session-key", this.auth.sessionKey);
        headers.set("proof", authHeaders.proof);
        headers.set("iat", String(authHeaders.iat));
        headers.set("request-id", authHeaders.requestId);
        injectTraceContext(createNatsHeaderCarrier(headers), span);

        const msgResult = await this.#requestMessageWithRetry({
          method,
          subject,
          payload: msg,
          headers,
          timeout: opts?.timeout ?? this.timeout,
          callerCapabilities: ctx.callerCapabilities,
        });
        const response = msgResult.take();
        if (isErr(response)) {
          return response;
        }

        if (response.headers?.get("status") === "error") {
          const json = safeJson(response).take();
          if (isErr(json)) {
            return err(requestFailedTransportError({
              code: "trellis.request.invalid_response",
              message: "Trellis returned an invalid response.",
              hint:
                "Retry the request. If it keeps happening, check the Trellis capability handling this request.",
              method,
              subject,
              cause: json.error.cause,
            }));
          }

          const errorData = parse(TrellisErrorDataSchema, json).take();
          if (isErr(errorData)) {
            return err(requestFailedTransportError({
              code: "trellis.request.invalid_response",
              message: "Trellis returned an invalid response.",
              hint:
                "Retry the request. If it keeps happening, check the Trellis capability handling this request.",
              method,
              subject,
              cause: errorData.error,
            }));
          }

          const declaredErrorTypes = Array.isArray(ctx.declaredErrorTypes)
            ? ctx.declaredErrorTypes.filter((value): value is string =>
              typeof value === "string"
            )
            : ctx.errors;
          const runtimeErrors = Array.isArray(ctx.runtimeErrors)
            ? ctx.runtimeErrors.filter(isRuntimeRpcErrorDesc)
            : undefined;
          const reconstructed = reconstructDeclaredRpcError(
            declaredErrorTypes,
            runtimeErrors,
            errorData,
            json,
          );
          if (reconstructed) {
            await this.#handleBrowserAuthRequired(reconstructed);
            return err(reconstructed);
          }

          const remoteError = new RemoteError({ error: errorData });
          await this.#handleBrowserAuthRequired(remoteError);
          return err(remoteError);
        }

        const json = safeJson(response).take();
        if (isErr(json)) {
          return err(requestFailedTransportError({
            code: "trellis.request.invalid_response",
            message: "Trellis returned an invalid response.",
            hint:
              "Retry the request. If it keeps happening, check the Trellis capability handling this request.",
            method,
            subject,
            cause: json.error.cause,
          }));
        }

        const outputResult = parseRuntimeSchema(ctx.output, json).take();
        if (isErr(outputResult)) {
          return err(outputResult.error);
        }

        return ok(outputResult as TOutput);
      };

      return await withSpanAsync(span, async () => {
        try {
          const result = await attempt();
          const value = result.take();
          if (isErr(value)) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: value.error.message,
            });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
          return result;
        } catch (cause) {
          const unexpected = cause instanceof TransportError
            ? cause
            : new UnexpectedError({ cause });
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: unexpected.message,
          });
          span.recordException(unexpected);
          return err(unexpected);
        } finally {
          span.end();
        }
      });
    })());
  }

  async #handleBrowserAuthRequired(error: unknown): Promise<void> {
    if (
      !this.#onSessionNotFound || !isBrowserAuthRequiredError(error)
    ) {
      return;
    }

    await this.#onSessionNotFound();
  }

  async #authenticateFeedRequest(args: {
    feed: string;
    subject: string;
    msg: Msg;
    payloadHash: Uint8Array;
    requiredCapabilities: readonly string[];
  }): Promise<Result<SessionCaller, BaseError>> {
    const sessionKey = args.msg.headers?.get("session-key");
    const proof = args.msg.headers?.get("proof");
    const iatHeader = args.msg.headers?.get("iat");
    const requestId = args.msg.headers?.get("request-id");
    if (!sessionKey) {
      return err(new AuthError({ reason: "missing_session_key" }));
    }
    if (!proof) return err(new AuthError({ reason: "missing_proof" }));
    const iat = Number(iatHeader);
    if (!Number.isSafeInteger(iat) || !requestId) {
      return err(new AuthError({ reason: "invalid_signature" }));
    }

    const proofInput = buildProofInput(
      sessionKey,
      args.subject,
      args.payloadHash,
      iat,
      requestId,
    );
    const digest = await sha256(proofInput);
    const verifyResult = await AsyncResult.try(async () => {
      const publicKeyRaw = base64urlDecode(sessionKey);
      const pub = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(publicKeyRaw),
        { name: "Ed25519" },
        true,
        ["verify"],
      );
      return crypto.subtle.verify(
        { name: "Ed25519" },
        pub,
        toArrayBuffer(base64urlDecode(proof)),
        toArrayBuffer(digest),
      );
    });
    if (!verifyResult.isOk() || verifyResult.take() !== true) {
      return err(
        new AuthError({ reason: "invalid_signature", context: { sessionKey } }),
      );
    }

    const auth = await this.requestAuthValidate({
      sessionKey,
      proof,
      subject: args.subject,
      payloadHash: base64urlEncode(args.payloadHash),
      iat,
      requestId,
      capabilities: [...args.requiredCapabilities],
    }).take();
    if (isErr(auth)) return err(auth.error);

    if (!auth.allowed) {
      return err(
        new AuthError({
          reason: "insufficient_permissions",
          context: {
            feed: args.feed,
            requiredCapabilities: args.requiredCapabilities,
            userCapabilities: auth.caller.capabilities,
          },
        }),
      );
    }

    if (
      typeof args.msg.reply !== "string" ||
      !args.msg.reply.startsWith(`${auth.inboxPrefix}.`)
    ) {
      return err(
        new AuthError({
          reason: "reply_subject_mismatch",
          context: { expected: auth.inboxPrefix, actual: args.msg.reply },
        }),
      );
    }

    return ok(auth.caller);
  }

  feedHandle<F extends FeedsOf<TA>>(
    feed: F,
  ):
    & FeedInputBuilder<FeedInputOf<TA, F>, FeedEventOf<TA, F>>
    & FeedRegistration<FeedInputOf<TA, F>, FeedEventOf<TA, F>> {
    const descriptor = this.api.feeds?.[feed] as
      | FeedDescriptorOf<TA, F>
      | undefined;
    if (!descriptor) {
      throw this.#unknownApiError("feed", feed.toString());
    }

    return {
      input: (input: FeedInputOf<TA, F>) => ({
        subscribe: (opts?: FeedSubscribeOpts) =>
          this.#subscribeFeed(
            feed.toString(),
            descriptor,
            input,
            opts,
          ) as AsyncResult<
            FeedSubscription<FeedEventOf<TA, F>>,
            BaseError
          >,
      }),
      handle: (
        handler: (
          context: FeedHandlerContext<FeedInputOf<TA, F>, FeedEventOf<TA, F>>,
        ) => unknown | Promise<unknown>,
      ) => this.#handleFeed(feed.toString(), descriptor, handler),
    };
  }

  #subscribeFeed<TInput, TEvent>(
    feed: string,
    descriptor: FeedDesc,
    input: TInput,
    opts?: FeedSubscribeOpts,
  ): AsyncResult<FeedSubscription<TEvent>, BaseError> {
    return AsyncResult.from((async () => {
      const payload = encodeRuntimeSchema(descriptor.input, input).take();
      if (isErr(payload)) return payload;

      const subject = this.template(
        descriptor.subject,
        input as Record<string, unknown>,
      ).take();
      if (isErr(subject)) return subject;

      const authHeaders = await this.#createProof(subject, payload);
      const headers = natsHeaders();
      headers.set("session-key", this.auth.sessionKey);
      headers.set("proof", authHeaders.proof);
      headers.set("iat", String(authHeaders.iat));
      headers.set("request-id", authHeaders.requestId);
      injectTraceContext(createNatsHeaderCarrier(headers));

      const inbox = createInbox(`_INBOX.${this.auth.sessionKey.slice(0, 16)}`);
      const sub = this.nats.subscribe(inbox);
      const iterator = sub[Symbol.asyncIterator]();
      const abort = () => sub.unsubscribe();
      opts?.signal?.addEventListener("abort", abort, { once: true });

      try {
        this.nats.publish(subject, payload, { headers, reply: inbox });
        await this.nats.flush();
      } catch (cause) {
        opts?.signal?.removeEventListener("abort", abort);
        sub.unsubscribe();
        return err(createTransportError({
          code: "trellis.feed.subscribe_failed",
          message: "Trellis could not subscribe to the feed.",
          hint:
            "Retry the subscription. If it keeps failing, check Trellis runtime health.",
          cause,
          context: { feed, subject },
        }));
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let abortHandler: (() => void) | undefined;
      const handshakePromises: Array<
        Promise<IteratorResult<Msg> | "aborted" | "timeout">
      > = [
        iterator.next(),
        new Promise<"timeout">((resolve) => {
          timeoutId = setTimeout(() => resolve("timeout"), this.timeout);
        }),
      ];
      const signal = opts?.signal;
      if (signal) {
        handshakePromises.push(
          new Promise<"aborted">((resolve) => {
            abortHandler = () => resolve("aborted");
            signal.addEventListener("abort", abortHandler, { once: true });
          }),
        );
      }

      const firstFrame = await Promise.race(handshakePromises);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (firstFrame === "timeout" || firstFrame === "aborted") {
        opts?.signal?.removeEventListener("abort", abort);
        sub.unsubscribe();
        return err(createTransportError({
          code: firstFrame === "timeout"
            ? "trellis.feed.subscribe_timeout"
            : "trellis.feed.subscribe_aborted",
          message: firstFrame === "timeout"
            ? "Trellis did not receive a feed acknowledgement."
            : "The feed subscription was aborted before Trellis acknowledged it.",
          hint: firstFrame === "timeout"
            ? "Check that the target service is running and has the current deployment digest, then retry."
            : "Retry the subscription if the feed is still needed.",
          context: { feed, subject },
        }));
      }
      if (firstFrame.done) {
        opts?.signal?.removeEventListener("abort", abort);
        sub.unsubscribe();
        return err(createTransportError({
          code: "trellis.feed.subscribe_closed",
          message: "Trellis closed the feed before acknowledging it.",
          hint:
            "Retry the subscription. If it keeps failing, check Trellis runtime health.",
          context: { feed, subject },
        }));
      }
      const firstMessage = firstFrame.value;
      if (firstMessage.headers?.get("status") === "error") {
        opts?.signal?.removeEventListener("abort", abort);
        sub.unsubscribe();
        return err(createTransportError({
          code: "trellis.feed.failed",
          message: "Trellis rejected the feed subscription.",
          hint:
            "Retry the subscription. If it keeps failing, check Trellis runtime health and permissions.",
          context: { feed, subject, frame: firstMessage.string() },
        }));
      }
      const firstEvent = firstMessage.headers?.get("feed-status") === "ready"
        ? undefined
        : firstMessage;

      const eventSchema = descriptor.event;
      return ok((async function* () {
        try {
          const parseFeedFrame = (msg: Msg): TEvent => {
            if (msg.headers?.get("status") === "error") {
              throw createTransportError({
                code: "trellis.feed.failed",
                message: "Trellis stopped the feed.",
                hint:
                  "Retry the subscription. If it keeps failing, check Trellis runtime health.",
                context: { feed, subject, frame: msg.string() },
              });
            }
            const json = safeJson(msg).take();
            if (isErr(json)) throw json.error;
            const parsed = parseRuntimeSchema(eventSchema, json).take();
            if (isErr(parsed)) throw parsed.error;
            return parsed as TEvent;
          };
          if (firstEvent) yield parseFeedFrame(firstEvent);
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            yield parseFeedFrame(next.value);
          }
        } finally {
          opts?.signal?.removeEventListener("abort", abort);
          sub.unsubscribe();
        }
      })());
    })());
  }

  async #handleFeed<TInput, TEvent>(
    feed: string,
    descriptor: FeedDesc,
    handler: (
      context: FeedHandlerContext<TInput, TEvent>,
    ) => unknown | Promise<unknown>,
  ): Promise<void> {
    const subject = this.template(descriptor.subject, {}, true).take();
    if (isErr(subject)) throw subject.error;
    let sub: ReturnType<NatsConnection["subscribe"]>;
    try {
      sub = this.nats.subscribe(subject);
      await this.nats.flush();
    } catch (cause) {
      throw createTransportError({
        code: "trellis.feed.listen_failed",
        message: "Trellis could not listen for feed requests.",
        hint:
          "Check the service deployment digest and runtime permissions, then restart the service.",
        cause,
        context: { feed, subject },
      });
    }
    const task = AsyncResult.try(async () => {
      for await (const msg of sub) {
        void (async () => {
          try {
            const result = await this.#processFeedMessage(
              feed,
              descriptor,
              msg,
              handler,
            );
            const value = result.take();
            if (isErr(value)) {
              this.#respondWithError(msg, value.error);
            }
          } catch (cause) {
            const error = cause instanceof BaseError
              ? cause
              : new UnexpectedError({ cause });
            this.#respondWithError(msg, error);
          }
        })();
      }
    });
    this.#tasks.add(`feed:${feed}`, task);
  }

  async #processFeedMessage<TInput, TEvent>(
    feed: string,
    descriptor: FeedDesc,
    msg: Msg,
    handler: (
      context: FeedHandlerContext<TInput, TEvent>,
    ) => unknown | Promise<unknown>,
  ): Promise<Result<void, BaseError>> {
    const json = safeJson(msg).take();
    if (isErr(json)) return json;
    const parsed = parseRuntimeSchema(descriptor.input, json).take();
    if (isErr(parsed)) return parsed;

    const caller = await this.#authenticateFeedRequest({
      feed,
      subject: msg.subject,
      msg,
      payloadHash: await sha256(msg.data ?? new Uint8Array()),
      requiredCapabilities: descriptor.subscribeCapabilities,
    });
    const callerValue = caller.take();
    if (isErr(callerValue)) return callerValue;
    if (!msg.reply) {
      return err(
        new UnexpectedError({
          context: { feed, reason: "missing_reply" },
        }),
      );
    }
    const readyHeaders = natsHeaders();
    readyHeaders.set("feed-status", "ready");
    this.nats.publish(msg.reply, new Uint8Array(), { headers: readyHeaders });
    await this.nats.flush();

    const controller = new AbortController();
    try {
      await handler({
        input: parsed as TInput,
        caller: callerValue,
        signal: controller.signal,
        emit: (event: TEvent) =>
          AsyncResult.from((async () => {
            const payload = encodeRuntimeSchema(descriptor.event, event).take();
            if (isErr(payload)) return payload;
            if (!msg.reply) {
              return err(
                new UnexpectedError({
                  context: { feed, reason: "missing_reply" },
                }),
              );
            }
            this.nats.publish(msg.reply, payload);
            await this.nats.flush();
            return ok(undefined);
          })()),
      });
      return ok(undefined);
    } finally {
      controller.abort();
    }
  }

  operationHandle<O extends OperationsOf<TA>>(
    operation: O,
  ): OperationSurface<TA, TMode, O> {
    const descriptor = this.api["operations"]?.[operation];
    if (!descriptor) {
      throw this.#unknownApiError("operation", operation.toString());
    }

    const transport: OperationTransport = {
      requestJson: (subject, body) =>
        this.#requestJson(subject, body as JsonValue),
      watchJson: (subject, body) => this.#watchJson(subject, body as JsonValue),
      putTransfer: (
        grant: SendTransferGrant,
        body: TransferBody,
      ): AsyncResult<FileInfo, TransferError> =>
        AsyncResult.from((async () => {
          const handle = createTransferHandle(
            this.nats,
            this.auth,
            this.timeout,
            grant,
          );
          if (!(handle instanceof Object) || !("send" in handle)) {
            return err(
              new TransferError({
                operation: "transfer",
                context: { reason: "invalid_operation_transfer_grant" },
              }),
            );
          }
          return await handle.send(body);
        })()),
    };

    return new OperationInvoker(
      transport,
      descriptor as TA["operations"][O] & RuntimeOperationDesc,
    ) as OperationSurface<TA, TMode, O>;
  }

  /**
   * Creates a helper for a short-lived Trellis transfer grant.
   */
  transfer(grant: SendTransferGrant): SendTransferHandle;
  transfer(grant: ReceiveTransferGrant): ReceiveTransferHandle;
  transfer(grant: TransferGrant): ReturnType<typeof createTransferHandle> {
    return createTransferHandle(this.nats, this.auth, this.timeout, grant);
  }

  /*
   * Mount a handler to process requests made to a specific Trellis API
   */
  async mount(
    method: string,
    fn: (args: {
      input: unknown;
      context: RpcHandlerContext;
      client: HandlerTrellis<TA, TRequests>;
    }) => MaybePromise<Result<unknown, BaseError>>,
  ) {
    const methodName = method as MethodsOf<TA>;
    const ctx = this.api["rpc"][methodName];
    if (!ctx) {
      throw this.#unknownApiError("RPC method", method.toString());
    }
    const task = this.#handleRPC(
      methodName,
      fn as HandlerFn<TA, MethodsOf<TA>, TA, HandlerTrellis<TA, TRequests>>,
    );
    this.#tasks.add(methodName, task);
  }

  #handleRPC(
    method: MethodsOf<TA>,
    fn: HandlerFn<TA, MethodsOf<TA>, TA, HandlerTrellis<TA, TRequests>>,
    subjectData: Record<string, unknown> = {},
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    // Get API details
    const ctx = this.api["rpc"][method] as RpcDescriptorOf<TA, MethodsOf<TA>>;

    const subject = this.template(ctx.subject, subjectData, true).take();
    if (isErr(subject)) {
      return AsyncResult.lift(subject);
    }

    const handlerTrellis = this.#createHandlerTrellis();

    this.#log.info(
      { method: String(method) },
      `Mounting ${method.toString()} RPC handler`,
    );
    const sub = this.nats.subscribe(subject);

    return AsyncResult.try(async () => {
      for await (const msg of sub) {
        const resultPromise = await this.#processRPCMessage(
          method,
          ctx,
          msg,
          fn,
          handlerTrellis,
        );
        const result = resultPromise.take();

        if (isErr(result)) {
          this.#respondWithError(msg, result.error, { method: String(method) });
          continue;
        }

        const sent = this.#respondWithPayload(msg, result, undefined, {
          method: String(method),
          responseKind: "success",
        });
        if (sent.isErr()) {
          const responseBytes = payloadByteLength(result);
          const message = causeMessage(sent.error.cause);
          this.#respondWithError(
            msg,
            new TransportError({
              code: "trellis.rpc.response_send_failed",
              message: message.includes("max_payload")
                ? "Trellis RPC response exceeded NATS max_payload."
                : "Trellis could not send the RPC response.",
              hint:
                "Reduce the requested page size or use a narrower RPC that does not include large detail payloads.",
              cause: sent.error.cause,
              context: {
                method: String(method),
                subject: msg.subject,
                responseBytes,
                causeMessage: message,
              },
            }),
            { method: String(method), responseBytes },
          );
        }
      }
    });
  }

  async #processRPCMessage(
    method: MethodsOf<TA>,
    ctx: RpcDescriptorOf<TA, MethodsOf<TA>>,
    msg: Msg,
    fn: HandlerFn<TA, MethodsOf<TA>, TA, HandlerTrellis<TA, TRequests>>,
    handlerTrellis: HandlerTrellis<TA, TRequests>,
  ): Promise<Result<string, BaseError>> {
    this.#log.debug(
      { method: String(method), subject: msg.subject },
      "Processing RPC message",
    );

    // Extract trace context from incoming NATS headers
    const parentContext = extractTraceContext(
      createNatsHeaderCarrier({
        get: (k: string) => msg.headers?.get(k) ?? undefined,
        set: () => {}, // Server doesn't need to set headers on incoming messages
      }),
    );

    // Start a server span for this RPC handler
    const span = startServerSpan(method, msg.subject, parentContext);
    const incomingTraceId = traceIdFromTraceparent(
      msg.headers?.get("traceparent"),
    );

    // Execute the handler within the span's context
    return withSpanAsync(span, async () => {
      const execute = async (): Promise<Result<string, BaseError>> => {
        const jsonData = safeJson(msg).take();
        if (isErr(jsonData)) {
          this.#log.warn(
            { method, error: jsonData.error.message },
            "Failed to parse JSON",
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse JSON",
          });
          return jsonData;
        }

        const parsedInput = parseRuntimeSchema(ctx.input, jsonData).take();
        if (isErr(parsedInput)) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Input validation failed",
          });
          return parsedInput;
        }

        let caller: SessionCaller;
        const callerSessionKey = msg.headers?.get("session-key") ?? "";

        const authRequired = ctx.authRequired ?? true;
        if (!authRequired) {
          caller = {
            type: "service",
            id: "system",
            active: true,
            name: "System",
            capabilities: ["service"],
          };
        } else {
          const sessionKey = msg.headers?.get("session-key");
          const proof = msg.headers?.get("proof");
          const iatHeader = msg.headers?.get("iat");
          const requestId = msg.headers?.get("request-id");
          if (!sessionKey) {
            this.#log.warn({ method }, "Missing session-key header");
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Missing session-key",
            });
            return err(new AuthError({ reason: "missing_session_key" }));
          }
          if (!proof) {
            this.#log.warn({ method }, "Missing proof in request");
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Missing proof",
            });
            return err(new AuthError({ reason: "missing_proof" }));
          }
          const iat = Number(iatHeader);
          if (!Number.isSafeInteger(iat) || !requestId) {
            return err(new AuthError({ reason: "invalid_signature" }));
          }

          // Verify proof signature locally using the raw request bytes we received.
          const payloadBytes = msg.data ?? new Uint8Array();
          const payloadHash = await sha256(payloadBytes);
          const proofInput = buildProofInput(
            sessionKey,
            msg.subject,
            payloadHash,
            iat,
            requestId,
          );
          const digest = await sha256(proofInput);

          const verifyResult = await AsyncResult.try(async () => {
            const publicKeyRaw = base64urlDecode(sessionKey);
            const pub = await crypto.subtle.importKey(
              "raw",
              toArrayBuffer(publicKeyRaw),
              { name: "Ed25519" },
              true,
              ["verify"],
            );
            return crypto.subtle.verify(
              { name: "Ed25519" },
              pub,
              toArrayBuffer(base64urlDecode(proof)),
              toArrayBuffer(digest),
            );
          });
          const signatureOk = verifyResult.isOk() &&
            verifyResult.take() === true;

          if (!signatureOk) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Invalid signature",
            });
            return err(
              new AuthError({
                reason: "invalid_signature",
                context: { sessionKey },
              }),
            );
          }

          let auth:
            | AuthRequestsValidateResponse
            | AuthError
            | RemoteError
            | TransportError
            | ValidationError
            | UnexpectedError
            | undefined;
          for (
            let attempt = 0;
            attempt < DEFAULT_AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS;
            attempt++
          ) {
            const authValue = await this.requestAuthValidate({
              sessionKey,
              proof,
              subject: msg.subject,
              payloadHash: base64urlEncode(payloadHash),
              iat,
              requestId,
              capabilities: [...ctx.callerCapabilities],
            }).take();
            if (!isErr(authValue)) {
              auth = authValue;
              break;
            }

            const authError = authValue.error;

            if (
              !isTransientAuthValidateSessionError(authError) ||
              attempt === DEFAULT_AUTH_VALIDATE_SESSION_RETRY_ATTEMPTS - 1
            ) {
              auth = authError;
              break;
            }

            await sleep(
              DEFAULT_AUTH_VALIDATE_SESSION_RETRY_MS * (attempt + 1),
            );
          }

          if (!auth) {
            return err(
              new UnexpectedError({
                context: { reason: "missing_auth_validate_result" },
              }),
            );
          }

          if (auth instanceof Error) {
            this.#log.warn(
              {
                method,
                error: auth.message,
                errorType: auth.name,
                remoteError: auth instanceof RemoteError
                  ? auth.toSerializable()
                  : undefined,
              },
              "Auth.Requests.Validate failed",
            );
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Auth.Requests.Validate failed",
            });
            if (auth instanceof BaseError) {
              return err(auth);
            }
            return err(new UnexpectedError({ cause: auth }));
          }

          if (!auth.allowed) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Insufficient permissions",
            });
            return err(
              new AuthError({
                reason: "insufficient_permissions",
                context: {
                  requiredCapabilities: ctx.callerCapabilities,
                  userCapabilities: auth.caller.capabilities,
                },
              }),
            );
          }

          if (
            typeof msg.reply !== "string" ||
            !msg.reply.startsWith(`${auth.inboxPrefix}.`)
          ) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Reply subject mismatch",
            });
            return err(
              new AuthError({
                reason: "reply_subject_mismatch",
                context: { expected: auth.inboxPrefix, actual: msg.reply },
              }),
            );
          }

          caller = auth.caller;
        }

        span.setAttribute("auth.caller.type", caller.type);
        if (caller.type === "user") {
          span.setAttribute("user.id", caller.userId);
          span.setAttribute("user.identity.provider", caller.identity.provider);
          span.setAttribute("user.identity.subject", caller.identity.subject);
        }
        if (caller.type === "service") {
          const { id } = caller;
          span.setAttribute("service.id", id);
        }
        if (caller.type === "device") {
          span.setAttribute("device.id", caller.deviceId);
          span.setAttribute("device.deployment_id", caller.deploymentId);
        }

        const invokeHandler = fn as (
          args: {
            input: unknown;
            context: RpcHandlerContext;
            client: HandlerTrellis<TA, TRequests>;
          },
        ) => MaybeAsync<unknown, BaseError>;
        const handlerResultWrapped = await AsyncResult.try(async () =>
          await Promise.resolve(
            invokeHandler({
              input: parsedInput,
              context: {
                caller,
                sessionKey: callerSessionKey,
              },
              client: handlerTrellis,
            }),
          )
        );

        if (handlerResultWrapped.isErr()) {
          const error = handlerResultWrapped.error.withContext({ method });
          this.#log.error(
            {
              method,
              error: error.message,
              cause: error.cause instanceof Error
                ? { message: error.cause.message, stack: error.cause.stack }
                : error.cause,
            },
            "Handler threw unexpectedly.",
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          span.recordException(error);
          return err(error);
        }

        const handlerResult = handlerResultWrapped.take() as {
          take: () => unknown;
        };
        const handlerOutcome = handlerResult.take();
        if (isErr(handlerOutcome)) {
          const handlerError = handlerOutcome.error;

          const error = handlerError instanceof BaseError &&
              !(handlerError instanceof RemoteError)
            ? handlerError
            : new UnexpectedError({ cause: handlerError });

          this.#log.error(
            {
              method,
              error: error.message,
              errorType: error.name,
              cause: error.cause instanceof Error
                ? { message: error.cause.message, stack: error.cause.stack }
                : error.cause,
            },
            "Handler returned error.",
          );
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          return err(error);
        }

        const encoded = encodeSchema(ctx.output, handlerOutcome).take();
        if (isErr(encoded)) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Output encoding failed",
          });
          return encoded;
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return ok(encoded);
      };

      const result = await execute();
      if (isErr(result)) {
        result.error.withTraceId(activeTraceId(span) ?? incomingTraceId);
      }
      span.end();
      return result;
    });
  }

  #respondWithPayload(
    msg: Msg,
    payload: string,
    options: { headers?: MsgHdrs } | undefined,
    context: {
      method?: string;
      responseKind: "success" | "error";
    },
  ): Result<void, UnexpectedError> {
    const responseBytes = payloadByteLength(payload);
    try {
      msg.respond(payload, options);
      return ok(undefined);
    } catch (cause) {
      const error = new UnexpectedError({
        cause,
        context: {
          method: context.method,
          responseKind: context.responseKind,
          subject: msg.subject,
          reply: msg.reply,
          responseBytes,
          causeMessage: causeMessage(cause),
        },
      });
      this.#log.error(
        {
          method: context.method,
          responseKind: context.responseKind,
          subject: msg.subject,
          reply: msg.reply,
          responseBytes,
          cause: causeLogData(cause),
        },
        "Failed to send RPC response",
      );
      return err(error);
    }
  }

  #respondWithError(
    msg: Msg,
    error: Error | BaseError,
    context: { method?: string; responseBytes?: number } = {},
  ): void {
    const trellisError = error instanceof BaseError &&
        !(error instanceof RemoteError)
      ? error
      : new UnexpectedError({ cause: error });

    this.#log.error(
      {
        method: context.method,
        subject: msg.subject,
        responseBytes: context.responseBytes,
        error: trellisError.toSerializable(),
      },
      "RPC error",
    );

    const errorData = trellisError.toSerializable();
    const hdrs = natsHeaders();
    hdrs.set("status", "error");

    const serialized = Result.try(() => JSON.stringify(errorData));
    if (serialized.isErr()) {
      this.#log.error(
        { error: serialized.error },
        "Failed to serialize error response",
      );
      this.#respondWithPayload(
        msg,
        '{"type":"UnexpectedError","message":"Failed to serialize error"}',
        { headers: hdrs },
        { method: context.method, responseKind: "error" },
      );
      return;
    }
    this.#respondWithPayload(
      msg,
      serialized.take() as string,
      { headers: hdrs },
      { method: context.method, responseKind: "error" },
    );
  }

  respondWithError(msg: Msg, error: Error | BaseError): void {
    this.#respondWithError(msg, error);
  }

  /**
   * Builds a stable event subject, encoded payload, and publish headers.
   *
   * The prepared event intentionally carries no contract id or digest so callers
   * can persist it in a service-owned outbox without coupling storage to the
   * publisher's current deployment metadata.
   */
  prepare(
    event: string,
    data: Record<string, unknown>,
  ): Result<PreparedTrellisEvent, ValidationError | UnexpectedError> {
    try {
      const eventName = event as EventsOf<TA>;
      const ctx = this.api["events"][eventName] as EventDescriptorOf<
        TA,
        typeof eventName
      >;
      if (!ctx) {
        return err(
          new UnexpectedError({
            cause: this.#unknownApiError("event", event.toString()),
            context: { event: event.toString() },
          }),
        );
      }

      const subject = this.template(ctx.subject, data).take();
      if (isErr(subject)) {
        logger.error({ err: subject.error }, "Failed to template event.");
        return subject;
      }

      const header = {
        id: ulid(),
        time: new Date().toISOString(),
      };
      const payload = Object.freeze({
        ...data,
        header: Object.freeze(header),
      });
      const msg = encodeSchema(ctx.event, payload).take();
      if (isErr(msg)) {
        logger.error({ err: msg.error }, "Failed to encode event.");
        return err(new UnexpectedError({ cause: msg.error }));
      }

      const headers = natsHeaders();
      headers.set("Nats-Msg-Id", header.id);
      injectTraceContext(createNatsHeaderCarrier(headers));

      const headerRecord: Record<string, string> = {};
      for (const [key, value] of headers) {
        headerRecord[key] = value.join(",");
      }

      return ok(Object.freeze({
        event: event.toString(),
        subject,
        payload,
        encodedPayload: msg,
        headers: Object.freeze(headerRecord),
      }));
    } catch (cause) {
      return err(
        new UnexpectedError({ cause, context: { event: event.toString() } }),
      );
    }
  }

  /**
   * Publishes a previously prepared event without regenerating its id, time,
   * subject, payload, or headers.
   */
  publishPrepared(
    event: PreparedTrellisEvent,
  ): AsyncResult<void, UnexpectedError> {
    return AsyncResult.from((async () => {
      try {
        const headers = natsHeaders();
        for (const [key, value] of Object.entries(event.headers)) {
          headers.set(key, value);
        }

        logger.trace(
          { subject: event.subject },
          `Publishing ${event.event} event.`,
        );
        await this.js.publish(event.subject, event.encodedPayload, { headers });
        return ok(undefined);
      } catch (cause) {
        return err(
          new UnexpectedError({ cause, context: { event: event.event } }),
        );
      }
    })());
  }

  publish(
    event: string,
    data: Record<string, unknown>,
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    return AsyncResult.from((async () => {
      const prepared = this.prepare(event, data).take();
      if (isErr(prepared)) return prepared;
      return await this.publishPrepared(prepared);
    })());
  }

  listenEvent<E extends EventsOf<TA>>(
    event: E,
    subjectData: Record<string, unknown>,
    fn: EventCallback<EventOf<TA, E>>,
    opts?: EventOpts,
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    return AsyncResult.from((async () => {
      try {
        const eventName = event as EventsOf<TA>;
        const ctx = this.api["events"][eventName] as EventDescriptorOf<
          TA,
          typeof eventName
        >;
        if (!ctx) {
          return err(
            new UnexpectedError({
              cause: this.#unknownApiError("event", event.toString()),
              context: { event: event.toString() },
            }),
          );
        }
        const subject = this.template(ctx.subject, subjectData, true).take();
        if (isErr(subject)) return subject;

        if (opts?.mode === "ephemeral") {
          return this.#startEphemeralEvent(
            eventName,
            ctx,
            subject,
            fn,
            opts.signal,
          );
        }

        if (opts?.durableName) {
          return err(
            new UnexpectedError({
              cause: new Error(
                "Durable event listener names are provisioned by Trellis event consumer bindings; use opts.group instead.",
              ),
              context: {
                event: event.toString(),
                durableName: opts.durableName,
              },
            }),
          );
        }

        const groupResult = this.#resolveEventConsumerGroup(eventName, opts);
        const group = groupResult.take();
        if (isErr(group)) return group;

        this.#registerDurableEventHandler({
          group,
          event: eventName,
          ctx,
          subject,
          fn,
          signal: opts?.signal,
        });
        return ok(undefined);
      } catch (cause) {
        return err(
          new UnexpectedError({ cause, context: { event: event.toString() } }),
        );
      }
    })());
  }

  #startEphemeralEvent(
    event: EventsOf<TA>,
    ctx: EventDescriptorOf<TA, EventsOf<TA>>,
    subject: string,
    fn: EventCallback<EventOf<TA, EventsOf<TA>>>,
    signal?: AbortSignal,
  ): Result<void, ValidationError | UnexpectedError> {
    const sub = this.nats.subscribe(subject);
    if (signal) {
      if (signal.aborted) {
        sub.unsubscribe();
        return ok(undefined);
      }
      signal.addEventListener("abort", () => sub.unsubscribe(), { once: true });
    }

    const task = AsyncResult.try(async () => {
      for await (const msg of sub) {
        const parsedEvent = this.#parseEventMessage(event, ctx, msg);
        const m = parsedEvent.take();
        if (isErr(m)) {
          this.#log.error({ error: m.error }, "Event validation failed");
          continue;
        }

        const handlerResult = await AsyncResult.lift(
          fn(
            m as EventOf<TA, EventsOf<TA>>,
            createEventListenerContext({
              payload: m,
              subject: msg.subject,
              mode: "ephemeral",
              message: msg,
            }),
          ),
        );
        if (handlerResult.isErr()) {
          this.#log.error(
            {
              error: handlerResult.error.toSerializable(),
              event,
              subject: msg.subject,
            },
            "Event handler failed",
          );
        }
      }
    });

    this.#tasks.add(`event:${event}:${ulid()}`, task);
    return ok(undefined);
  }

  #resolveEventConsumerGroup(
    event: EventsOf<TA>,
    opts: EventOpts | undefined,
  ): Result<string, UnexpectedError> {
    const metadata = this.#eventConsumers.metadata;
    const bindings = this.#eventConsumers.bindings ?? {};
    const groups = Object.entries(metadata ?? {})
      .filter(([, group]) =>
        group.events.some((entry) => entry.event === String(event))
      )
      .map(([group]) => group);

    if (opts?.group) {
      if (!groups.includes(opts.group)) {
        return err(
          new UnexpectedError({
            cause: new Error(
              `Event '${
                String(event)
              }' is not declared in event consumer group '${opts.group}'.`,
            ),
            context: { event: String(event), group: opts.group },
          }),
        );
      }
      if (!bindings[opts.group]) {
        return err(
          new UnexpectedError({
            cause: new Error(
              `Event consumer group '${opts.group}' has no Trellis-provisioned binding.`,
            ),
            context: { event: String(event), group: opts.group },
          }),
        );
      }
      return ok(opts.group);
    }

    if (groups.length === 0) {
      return err(
        new UnexpectedError({
          cause: new Error(
            `Event '${
              String(event)
            }' is not declared in any event consumer group.`,
          ),
          context: { event: String(event) },
        }),
      );
    }
    if (groups.length > 1) {
      return err(
        new UnexpectedError({
          cause: new Error(
            `Event '${
              String(event)
            }' is declared in multiple event consumer groups; pass opts.group.`,
          ),
          context: { event: String(event), groups },
        }),
      );
    }

    const group = groups[0]!;
    if (!bindings[group]) {
      return err(
        new UnexpectedError({
          cause: new Error(
            `Event consumer group '${group}' has no Trellis-provisioned binding.`,
          ),
          context: { event: String(event), group },
        }),
      );
    }
    return ok(group);
  }

  #registerDurableEventHandler(args: {
    group: string;
    event: EventsOf<TA>;
    ctx: EventDescriptorOf<TA, EventsOf<TA>>;
    subject: string;
    fn: EventCallback<EventOf<TA, EventsOf<TA>>>;
    signal?: AbortSignal;
  }): void {
    if (args.signal?.aborted) return;

    const loop = this.#durableEventLoops.get(args.group) ?? {
      registrations: [],
      started: false,
    };
    const registration: DurableEventRegistration<TA> = {
      event: args.event,
      ctx: args.ctx,
      subject: args.subject,
      fn: args.fn,
    };
    loop.registrations.push(registration);
    this.#durableEventLoops.set(args.group, loop);

    args.signal?.addEventListener("abort", () => {
      const index = loop.registrations.indexOf(registration);
      if (index >= 0) loop.registrations.splice(index, 1);
      if (!this.#durableEventConsumerGroupReady(args.group, loop)) {
        loop.messages?.stop();
      }
    }, { once: true });

    this.#startDurableEventConsumer(args.group, loop);
  }

  #startDurableEventConsumer(
    group: string,
    loop: DurableEventConsumerLoop<TA>,
  ): void {
    if (loop.started || !this.#durableEventConsumerGroupReady(group, loop)) {
      return;
    }
    loop.started = true;

    this.#tasks.add(
      `event-consumer:${group}:${ulid()}`,
      this.#runDurableEventConsumer(group, loop),
    );
  }

  #durableEventConsumerGroupReady(
    group: string,
    loop: DurableEventConsumerLoop<TA>,
  ): boolean {
    const metadata = this.#eventConsumers.metadata?.[group];
    if (!metadata) return false;
    return metadata.events.every((entry) =>
      loop.registrations.some((registration) =>
        String(registration.event) === entry.event
      )
    );
  }

  #runDurableEventConsumer(
    group: string,
    loop: DurableEventConsumerLoop<TA>,
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    return AsyncResult.from((async () => {
      const binding = this.#eventConsumers.bindings?.[group];
      if (!binding) {
        return err(
          new UnexpectedError({
            cause: new Error(
              `Event consumer group '${group}' has no Trellis-provisioned binding.`,
            ),
            context: { group },
          }),
        );
      }

      try {
        const infoResult = await AsyncResult.try(async () => {
          const jsm = await jetstreamManager(this.nats);
          return await jsm.consumers.info(binding.stream, binding.consumerName);
        });
        const info = infoResult.take();
        if (isErr(info)) return info;

        const consumer = this.js.consumers.getConsumerFromInfo(info);
        while (this.#durableEventConsumerGroupReady(group, loop)) {
          const messages = await consumer.fetch({
            max_messages: 1,
            expires: 30_000,
          });
          loop.messages = messages;
          if (!this.#durableEventConsumerGroupReady(group, loop)) {
            messages.stop();
            break;
          }
          await this.#handleDurableEventConsumer(group, loop, messages)
            .orThrow();
        }
      } finally {
        loop.started = false;
        loop.messages = undefined;
        this.#startDurableEventConsumer(group, loop);
      }
      return ok(undefined);
    })());
  }

  #handleDurableEvent(
    event: EventsOf<TA>,
    ctx: EventDescriptorOf<TA, EventsOf<TA>>,
    messages: ConsumerMessages,
    fn: EventCallback<EventOf<TA, EventsOf<TA>>>,
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    return AsyncResult.try(async () => {
      for await (const msg of messages) {
        const parsedEvent = this.#parseEventMessage(event, ctx, msg);
        const m = parsedEvent.take();
        if (isErr(m)) {
          this.#log.error({ error: m.error }, "Event validation failed");
          msg.term();
          continue;
        }

        const handlerResult = await AsyncResult.lift(
          fn(
            m as EventOf<TA, EventsOf<TA>>,
            createEventListenerContext({
              payload: m,
              subject: msg.subject,
              mode: "durable",
              message: msg,
            }),
          ),
        );
        if (handlerResult.isErr()) {
          this.#log.error(
            {
              error: handlerResult.error.toSerializable(),
              event,
              subject: msg.subject,
            },
            "Event handler failed",
          );
          msg.nak();
          continue;
        }

        msg.ack();
      }
    });
  }

  #handleDurableEventConsumer(
    group: string,
    loop: DurableEventConsumerLoop<TA>,
    messages: ConsumerMessages,
  ): AsyncResult<void, ValidationError | UnexpectedError> {
    return AsyncResult.try(async () => {
      for await (const msg of messages) {
        if (!this.#durableEventConsumerGroupReady(group, loop)) {
          messages.stop();
          break;
        }
        const matching = loop.registrations.filter((registration) =>
          natsSubjectMatches(registration.subject, msg.subject)
        );
        if (matching.length === 0) {
          this.#log.warn(
            { group, subject: msg.subject },
            "Durable event consumer received message without registered handler",
          );
          msg.nak();
          continue;
        }

        let failed = false;
        for (const registration of matching) {
          const parsedEvent = this.#parseEventMessage(
            registration.event,
            registration.ctx,
            msg,
          );
          const eventPayload = parsedEvent.take();
          if (isErr(eventPayload)) {
            this.#log.error(
              { error: eventPayload.error },
              "Event validation failed",
            );
            msg.term();
            failed = true;
            break;
          }

          const handlerResult = await AsyncResult.lift(
            registration.fn(
              eventPayload as EventOf<TA, EventsOf<TA>>,
              createEventListenerContext({
                payload: eventPayload,
                subject: msg.subject,
                mode: "durable",
                group,
                message: msg,
              }),
            ),
          );
          if (handlerResult.isErr()) {
            this.#log.error(
              {
                error: handlerResult.error.toSerializable(),
                event: registration.event,
                subject: msg.subject,
              },
              "Event handler failed",
            );
            msg.nak();
            failed = true;
            break;
          }
        }

        if (!failed) msg.ack();
      }
    });
  }

  #parseEventMessage(
    event: EventsOf<TA>,
    ctx: EventDescriptorOf<TA, EventsOf<TA>>,
    msg: Pick<Msg, "json" | "subject">,
  ): Result<unknown, ValidationError | UnexpectedError> {
    const jsonData = Result.try<JsonValue>(() => msg.json());
    const json = jsonData.take();
    if (isErr(json)) {
      this.#log.error(
        { error: json.error, event, subject: msg.subject },
        "Event parse failed",
      );
      return json;
    }

    return parseRuntimeSchema(ctx.event, json);
  }

  wait(): AsyncResult<void, BaseError> {
    return this.#tasks.wait();
  }

  // FIXME: If are validating things twice in most cases...
  template(
    subject: string,
    data: unknown,
    allowWildcards = false,
  ): Result<string, ValidationError> {
    // Find all template placeholders and check if values exist
    const placeholders = subject.match(/\{([^}]+)\}/g) || [];
    for (const placeholder of placeholders) {
      const key = placeholder.slice(1, -1); // Remove { and }
      const value = Pointer.Get(data, key);

      if ((value === undefined || value === null) && !allowWildcards) {
        return err(
          new ValidationError({
            errors: [
              {
                path: key,
                message: "Missing required data for subject template",
              },
            ],
            context: { key },
          }),
        );
      }
    }

    const result = subject.replace(/\{([^}]+)\}/g, (_, key) => {
      const value = Pointer.Get(data, key);
      if (allowWildcards && value === "*") {
        return "*";
      }
      if (allowWildcards && (value === undefined || value === null)) {
        return "*";
      }
      return this.#escapeSubjectToken(`${value}`);
    });

    return ok(result);
  }

  #escapeSubjectToken(token: string): string {
    const out = token.replace(
      NATS_SUBJECT_TOKEN_FORBIDDEN,
      (ch) => `~${ch.codePointAt(0)!.toString(16).toUpperCase()}~`,
    );

    // Protect stapRet with $ due to NATS internal use of it
    if (out.length === 0 || out.startsWith("$")) {
      return `_${out}`;
    }

    return out;
  }

  #currentIat(): number {
    return this.auth.currentIat?.() ?? Math.floor(Date.now() / 1000);
  }

  async #createProof(
    subject: string,
    payload: string,
  ): Promise<{ proof: string; iat: number; requestId: string }> {
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadHash = await sha256(payloadBytes);
    const iat = this.#currentIat();
    const requestId = ulid();
    const input = buildProofInput(
      this.auth.sessionKey,
      subject,
      payloadHash,
      iat,
      requestId,
    );
    const digest = await sha256(input);
    const sigBytes = await this.auth.sign(digest);
    return { proof: base64urlEncode(sigBytes), iat, requestId };
  }

  async #requestMessageWithRetry(args: {
    method?: string;
    subject: string;
    payload: string;
    headers: MsgHdrs;
    timeout: number;
    callerCapabilities?: readonly string[];
  }): Promise<Result<Msg, TransportError>> {
    for (let retry = 0; retry <= this.#noResponderMaxRetries; retry++) {
      const result = await AsyncResult.try(() =>
        this.nats.request(args.subject, args.payload, {
          headers: args.headers,
          timeout: args.timeout,
        })
      );

      if (result.isOk()) {
        return ok(result.take() as Msg);
      }

      const cause = result.error.cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      const isNoResponders = message.includes("no responders");

      if (isNoResponders && retry < this.#noResponderMaxRetries) {
        this.#log.debug(
          { method: args.method, subject: args.subject, retry },
          "No responders, retrying...",
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.#noResponderRetryMs * (retry + 1))
        );
        continue;
      }

      this.#log.warn(
        { method: args.method, subject: args.subject, error: message },
        "NATS request failed",
      );
      return err(classifyRequestTransportFailure({
        method: args.method,
        subject: args.subject,
        callerCapabilities: args.callerCapabilities,
        cause,
      }));
    }

    return err(
      requestFailedTransportError({
        code: "trellis.request.retry_exhausted",
        message: "Trellis could not complete the request after retrying.",
        hint:
          "Retry the request. If it keeps failing, check that the target service is available.",
        method: args.method,
        subject: args.subject,
        context: { retries: this.#noResponderMaxRetries + 1 },
      }),
    );
  }

  #requestJson(
    subject: string,
    body: JsonValue,
  ): AsyncResult<JsonValue, TransportError | UnexpectedError> {
    return AsyncResult.from((async () => {
      const span = startClientSpan(subject, subject);
      return await withSpanAsync(span, async () => {
        try {
          const payload = JSON.stringify(body);
          const authHeaders = await this.#createProof(subject, payload);

          const headers = natsHeaders();
          headers.set("session-key", this.auth.sessionKey);
          headers.set("proof", authHeaders.proof);
          headers.set("iat", String(authHeaders.iat));
          headers.set("request-id", authHeaders.requestId);
          injectTraceContext(createNatsHeaderCarrier(headers), span);

          const response = (await this.#requestMessageWithRetry({
            subject,
            payload,
            headers,
            timeout: this.timeout,
          })).take();
          if (isErr(response)) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: response.error.message,
            });
            return response;
          }

          const json = safeJson(response).take();
          if (isErr(json)) {
            const error = createTransportError({
              code: "trellis.request.invalid_response",
              message: "Trellis returned an invalid response.",
              hint:
                "Retry the request. If it keeps happening, reconnect to Trellis and try again.",
              cause: json.error.cause,
              context: { subject },
            });
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
            return err(error);
          }

          span.setStatus({ code: SpanStatusCode.OK });
          return ok(json);
        } catch (cause) {
          const error = new UnexpectedError({ cause });
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          span.recordException(error);
          return err(error);
        } finally {
          span.end();
        }
      });
    })());
  }

  #watchJson(
    subject: string,
    body: JsonValue,
  ): AsyncResult<
    AsyncIterable<Result<JsonValue, TransportError | UnexpectedError>>,
    TransportError | UnexpectedError
  > {
    return AsyncResult.from((async () => {
      const payload = JSON.stringify(body);
      const authHeaders = await this.#createProof(subject, payload);

      const headers = natsHeaders();
      headers.set("session-key", this.auth.sessionKey);
      headers.set("proof", authHeaders.proof);
      headers.set("iat", String(authHeaders.iat));
      headers.set("request-id", authHeaders.requestId);

      const inbox = createInbox(`_INBOX.${this.auth.sessionKey.slice(0, 16)}`);
      const sub = this.nats.subscribe(inbox);

      try {
        this.nats.publish(subject, payload, {
          headers,
          reply: inbox,
        });
        await this.nats.flush();
      } catch (cause) {
        sub.unsubscribe();
        return err(createTransportError({
          code: "trellis.watch.failed",
          message: "Trellis could not start the operation watch.",
          hint:
            "Retry watching the operation. If it keeps failing, reconnect to Trellis and try again.",
          cause,
          context: { subject },
        }));
      }

      return ok((async function* () {
        try {
          for await (const msg of sub) {
            if (msg.headers?.get("status") === "error") {
              yield err(createTransportError({
                code: "trellis.watch.failed",
                message: "Trellis stopped the operation watch.",
                hint:
                  "Retry watching the operation. If it keeps happening, reconnect to Trellis and try again.",
                context: { subject, frame: msg.string() },
              }));
              continue;
            }

            const json = safeJson(msg).take();
            if (isErr(json)) {
              yield err(createTransportError({
                code: "trellis.watch.invalid_response",
                message: "Trellis returned an invalid watch update.",
                hint:
                  "Retry watching the operation. If it keeps happening, reconnect to Trellis and try again.",
                cause: json.error.cause,
                context: { subject },
              }));
              continue;
            }

            yield ok(json);
          }
        } finally {
          sub.unsubscribe();
        }
      })());
    })());
  }

  protected requestAuthValidate(
    input: AuthRequestsValidateInput,
  ): AsyncResult<
    AuthRequestsValidateResponse,
    AuthError | RemoteError | TransportError | ValidationError | UnexpectedError
  > {
    const request = this.request.bind(this) as (
      method: string,
      input: unknown,
      opts?: RequestOpts,
    ) => AsyncResult<
      unknown,
      | AuthError
      | RemoteError
      | TransportError
      | ValidationError
      | UnexpectedError
    >;
    return request("Auth.Requests.Validate", input) as AsyncResult<
      AuthRequestsValidateResponse,
      | AuthError
      | RemoteError
      | TransportError
      | ValidationError
      | UnexpectedError
    >;
  }
}
