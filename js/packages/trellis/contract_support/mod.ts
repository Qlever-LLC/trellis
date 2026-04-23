import Type, {
  type Static,
  type TObject,
  type TProperties,
  type TSchema,
} from "typebox";
import type { BaseError } from "@qlever-llc/result";
import { TrellisError } from "../errors/TrellisError.ts";
import {
  canonicalizeJson,
  digestJson,
  isJsonValue,
  type JsonValue,
  sha256Base64urlSync,
} from "./canonical.ts";
import {
  type EventDesc,
  type InferRuntimeRpcError,
  type InferSchemaType,
  type OperationDesc,
  type RPCDesc,
  type RpcErrorClass,
  type RuntimeRpcErrorDesc,
  type Schema,
  schema,
  type SchemaLike,
  type SerializableErrorData,
  type SubjectDesc,
  type TrellisAPI,
  unwrapSchema,
} from "./runtime.ts";
import {
  assertDataPointersExistAndAreTokenable,
  getSubschemaAtDataPointer,
  type SubjectParam,
} from "./schema_pointers.ts";

export {
  ContractJobQueueSchema,
  ContractJobsSchema,
  ContractKvResourceSchema,
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
  ContractSchemaRefSchema,
  ContractStateSchema,
  ContractStateStoreSchema,
  ContractStoreResourceSchema,
  ContractStreamResourceSchema,
  type EventHeader,
  EventHeaderSchema,
  type InstalledServiceContract,
  InstalledServiceContractSchema,
  IsoDateSchema,
  type JobsQueueBinding,
  JobsQueueBindingSchema,
  type JobsResourceBinding,
  JobsResourceBindingSchema,
  type KvResourceBinding,
  KvResourceBindingSchema,
  type Paginated,
  PaginatedSchema,
  type StoreResourceBinding,
  StoreResourceBindingSchema,
  type StreamResourceBinding,
  StreamResourceBindingSchema,
} from "./protocol.ts";

export const CONTRACT_FORMAT_V1 = "trellis.contract.v1" as const;
export const CATALOG_FORMAT_V1 = "trellis.catalog.v1" as const;

const CONTRACT_MODULE_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/contract-module",
);
export const CONTRACT_JOBS_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/jobs",
);
export const CONTRACT_KV_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/kv",
);
export const CONTRACT_STATE_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/state",
);
const CONTRACT_ERROR_RUNTIME_METADATA = Symbol.for(
  "@qlever-llc/trellis/contracts/error-runtime",
);

type UnionToIntersection<U> =
  (U extends unknown ? (value: U) => void : never) extends
    (value: infer I) => void ? I
    : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type StringKeyOf<T> = Extract<keyof T, string>;
type KeysFromList<T> = T extends readonly (infer K)[] ? Extract<K, string>
  : never;

type ReservedDefinedErrorFieldName =
  | "id"
  | "type"
  | "message"
  | "context"
  | "traceId"
  | "cause";

const RESERVED_DEFINED_ERROR_FIELD_NAMES: ReadonlySet<
  ReservedDefinedErrorFieldName
> = new Set([
  "id",
  "type",
  "message",
  "context",
  "traceId",
  "cause",
]);

const DEFINED_ERROR_PAYLOAD = Symbol.for(
  "@qlever-llc/trellis/contracts/defined-error-payload",
);

export type ContractManifestMetadata = {
  displayName: string;
  description: string;
};

export type ContractKind = "service" | "app" | "portal" | "device" | "agent";

export type Capability = string;
export type JsonSchema = JsonValue | boolean;

export type ContractSchemaRef<TSchemaName extends string = string> = {
  schema: TSchemaName;
};

function createSchemaRef<
  const TSchemas extends Readonly<Record<string, TSchema>>,
>(_schemas: TSchemas) {
  void _schemas;
  return <const TName extends keyof TSchemas & string>(
    schemaName: TName,
  ): ContractSchemaRef<TName> => ({ schema: schemaName });
}

export type BuiltinContractErrorName =
  | "UnexpectedError"
  | "TransportError"
  | "AuthError"
  | "ValidationError"
  | "KVError"
  | "StoreError"
  | "TransferError";

type ErrorNameOf<TErrors> =
  | Extract<keyof NonNullable<TErrors>, string>
  | BuiltinContractErrorName;

export type ContractRefBuilder<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
> = {
  schema<const TName extends SchemaNameOf<TSchemas>>(
    schemaName: TName,
  ): ContractSchemaRef<TName>;
  error<const TName extends ErrorNameOf<TErrors>>(
    errorName: TName,
  ): TName;
};

export type ContractSchemas = Record<string, JsonSchema>;

export type ContractStateKind = "value" | "map";

export type ContractStateStore = {
  kind: ContractStateKind;
  schema: ContractSchemaRef;
};

export type ContractState = Record<string, ContractStateStore>;

type ContractIdentityFields = {
  id: string;
  displayName: string;
  description: string;
};

export type ContractErrorDecl = {
  type: string;
  schema?: ContractSchemaRef;
};

export type ContractErrorRef = {
  type: string;
};

export type ContractRpcMethod = {
  version: `v${number}`;
  subject: string;
  input: ContractSchemaRef;
  output: ContractSchemaRef;
  capabilities?: { call?: Capability[] };
  errors?: ContractErrorRef[];
};

export type ContractOperation = {
  version: `v${number}`;
  subject: string;
  input: ContractSchemaRef;
  progress?: ContractSchemaRef;
  output?: ContractSchemaRef;
  transfer?: {
    store: string;
    key: `/${string}`;
    contentType?: `/${string}`;
    metadata?: `/${string}`;
    expiresInMs?: number;
    maxBytes?: number;
  };
  capabilities?: {
    call?: Capability[];
    read?: Capability[];
    cancel?: Capability[];
  };
  cancel?: boolean;
};

export type ContractEvent = {
  version: `v${number}`;
  subject: string;
  params?: string[];
  event: ContractSchemaRef;
  capabilities?: { publish?: Capability[]; subscribe?: Capability[] };
};

export type ContractSubject = {
  subject: string;
  message?: ContractSchemaRef;
  capabilities?: { publish?: Capability[]; subscribe?: Capability[] };
};

export type ContractJobQueueResource = {
  payload: ContractSchemaRef;
  result?: ContractSchemaRef;
  maxDeliver?: number;
  backoffMs?: number[];
  ackWaitMs?: number;
  defaultDeadlineMs?: number;
  progress?: boolean;
  logs?: boolean;
  dlq?: boolean;
  concurrency?: number;
};

export type ContractJobQueue = ContractJobQueueResource;

export type ContractJobs = Record<string, ContractJobQueue>;

export type ContractKvResource = {
  purpose: string;
  schema: ContractSchemaRef;
  required?: boolean;
  history?: number;
  ttlMs?: number;
  maxValueBytes?: number;
};

export type ContractStoreResource = {
  purpose: string;
  required?: boolean;
  ttlMs?: number;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
};

export type ContractStreamResource = {
  purpose: string;
  required?: boolean;
  retention?: "limits" | "interest" | "workqueue";
  storage?: "file" | "memory";
  numReplicas?: number;
  maxAgeMs?: number;
  maxBytes?: number;
  maxMsgs?: number;
  discard?: "old" | "new";
  subjects: string[];
  sources?: Array<{
    fromAlias: string;
    filterSubject?: string;
    subjectTransformDest?: string;
  }>;
};

export type ContractResources = {
  kv?: Record<string, ContractKvResource>;
  store?: Record<string, ContractStoreResource>;
  streams?: Record<string, ContractStreamResource>;
};

export type ContractUsesRpc = {
  call?: string[];
};

export type ContractUsesPubSub = {
  publish?: string[];
  subscribe?: string[];
};

export type ContractUse = {
  contract: string;
  rpc?: ContractUsesRpc;
  operations?: ContractUsesRpc;
  events?: ContractUsesPubSub;
  subjects?: ContractUsesPubSub;
};

export type ContractUses = Record<string, ContractUse>;

export type TrellisContractV1 = {
  format: typeof CONTRACT_FORMAT_V1;
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  schemas?: ContractSchemas;
  state?: ContractState;
  uses?: ContractUses;
  rpc?: Record<string, ContractRpcMethod>;
  operations?: Record<string, ContractOperation>;
  events?: Record<string, ContractEvent>;
  subjects?: Record<string, ContractSubject>;
  errors?: Record<string, ContractErrorDecl>;
  jobs?: ContractJobs;
  resources?: ContractResources;
};

export type TrellisCatalogEntry = {
  id: string;
  digest: string;
  displayName: string;
  description: string;
};

export type TrellisCatalogV1 = {
  format: typeof CATALOG_FORMAT_V1;
  contracts: TrellisCatalogEntry[];
};

export type ContractSourceErrorDecl<TSchemaName extends string = string> = {
  type: string;
  schema?: ContractSchemaRef<TSchemaName>;
};

type ExtractErrorClasses<TErrors> =
  TErrors extends Readonly<Record<string, unknown>> ? {
      [K in keyof TErrors as TErrors[K] extends ErrorClass ? K
        : never]: Extract<TErrors[K], ErrorClass>;
    }
  : undefined;

type ContractErrorRuntimeMarker<
  TClass extends RpcErrorClass = RpcErrorClass,
> = {
  readonly [CONTRACT_ERROR_RUNTIME_METADATA]: TClass;
};

export type ErrorClass<
  TData extends SerializableErrorData = SerializableErrorData,
  TError extends BaseError = BaseError,
  TRuntimeSchema extends TSchema = TSchema,
> = RpcErrorClass<TData, TError> & {
  readonly name: string;
  readonly schema: TRuntimeSchema;
  readonly type?: string;
};

type DefinedErrorPayload<TFields extends TProperties> =
  & Static<TObject<TFields>>
  & object;

type DefinedErrorData<TType extends string, TFields extends TProperties> =
  & SerializableErrorData
  & { type: TType }
  & DefinedErrorPayload<TFields>;

type DefinedErrorSchema = TObject<TProperties>;

type DefinedErrorPayloadCarrier<TPayload extends object> = {
  [DEFINED_ERROR_PAYLOAD]: Readonly<TPayload>;
};

export type DefineErrorOptions<
  TType extends string,
  TFields extends TProperties,
> = {
  type: TType;
  fields: TFields;
  message:
    | string
    | ((payload: Readonly<DefinedErrorPayload<TFields>>) => string);
};

export type DefinedErrorInit<TFields extends TProperties> =
  & DefinedErrorPayload<TFields>
  & ErrorOptions
  & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
  };

export type DefinedErrorInstance<
  TType extends string,
  TFields extends TProperties,
> =
  & TrellisError<DefinedErrorData<TType, TFields>>
  & DefinedErrorPayloadCarrier<DefinedErrorPayload<TFields>>
  & Readonly<DefinedErrorPayload<TFields>>;

export type DefinedErrorClass<
  TType extends string,
  TFields extends TProperties,
> = ErrorClass<
  DefinedErrorData<TType, TFields>,
  DefinedErrorInstance<TType, TFields>,
  DefinedErrorSchema
> & {
  new (options: DefinedErrorInit<TFields>): DefinedErrorInstance<TType, TFields>;
  readonly type: TType;
  readonly schema: DefinedErrorSchema;
  fromSerializable(
    data: DefinedErrorData<TType, TFields>,
  ): DefinedErrorInstance<TType, TFields>;
};

function getContractErrorType(errorClass: ErrorClass): string {
  const explicitType = Reflect.get(errorClass, "type");
  return typeof explicitType === "string" ? explicitType : errorClass.name;
}

function isSerializableErrorData(value: unknown): value is SerializableErrorData {
  return !!value && typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { message?: unknown }).message === "string";
}

function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === "function" &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "fromSerializable") === "function" &&
    typeof Reflect.get(value, "schema") === "object";
}

function assertNoReservedDefinedErrorFieldNames(fields: TProperties): void {
  for (const fieldName of Object.keys(fields)) {
    if (
      RESERVED_DEFINED_ERROR_FIELD_NAMES.has(
        fieldName as ReservedDefinedErrorFieldName,
      )
    ) {
      throw new Error(`Defined error field '${fieldName}' is reserved`);
    }
  }
}

function createDefinedErrorSchema<
  TType extends string,
  TFields extends TProperties,
>(
  type: TType,
  fields: TFields,
): DefinedErrorSchema {
  return Type.Object({
    id: Type.String(),
    type: Type.Literal(type),
    message: Type.String(),
    ...fields,
    context: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    traceId: Type.Optional(Type.String()),
  });
}

function definedErrorPayloadFieldNames<TFields extends TProperties>(
  fields: TFields,
): readonly (keyof DefinedErrorPayload<TFields> & string)[] {
  return Object.keys(fields) as Array<keyof DefinedErrorPayload<TFields> & string>;
}

function pickDefinedErrorPayload<TPayload extends object>(
  fieldNames: readonly (keyof TPayload & string)[],
  source: TPayload,
): Readonly<TPayload> {
  return Object.fromEntries(
    fieldNames.map((fieldName) => [fieldName, source[fieldName]]),
  ) as TPayload;
}

function definedErrorBaseOptions<TPayload extends object>(
  options: TPayload & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
    cause?: unknown;
  },
): ErrorOptions & {
  context?: Record<string, unknown>;
  id?: string;
  traceId?: string;
} {
  const baseOptions: ErrorOptions & {
    context?: Record<string, unknown>;
    id?: string;
    traceId?: string;
  } = {};
  if (options.cause !== undefined) {
    baseOptions.cause = options.cause;
  }
  if (options.context !== undefined) {
    baseOptions.context = options.context;
  }
  if (options.id !== undefined) {
    baseOptions.id = options.id;
  }
  if (options.traceId !== undefined) {
    baseOptions.traceId = options.traceId;
  }
  return baseOptions;
}

function attachDefinedErrorPayload<
  TError extends TrellisError<SerializableErrorData>,
  TPayload extends object,
>(
  error: TError & DefinedErrorPayloadCarrier<TPayload>,
  payload: Readonly<TPayload>,
): TError & Readonly<TPayload> & DefinedErrorPayloadCarrier<TPayload> {
  error[DEFINED_ERROR_PAYLOAD] = payload;
  return Object.assign(error, payload);
}

export type ContractSourceSchemas = Record<string, TSchema>;

export type ContractSourceStateStore<TSchemaName extends string = string> = {
  kind: ContractStateKind;
  schema: ContractSchemaRef<TSchemaName>;
};

export type ContractSourceState<TSchemaName extends string = string> = Record<
  string,
  ContractSourceStateStore<TSchemaName>
>;

export type ContractSourceRpcMethod<
  TSchemaName extends string = string,
  TErrorName extends string = string,
> = {
  version: `v${number}`;
  input: ContractSchemaRef<TSchemaName>;
  output: ContractSchemaRef<TSchemaName>;
  capabilities?: { call?: readonly Capability[] };
  errors?: readonly TErrorName[];
  authRequired?: boolean;
  subject?: string;
};

export type ContractSourceOperation<TSchemaName extends string = string> = {
  version: `v${number}`;
  input: ContractSchemaRef<TSchemaName>;
  progress?: ContractSchemaRef<TSchemaName>;
  output?: ContractSchemaRef<TSchemaName>;
  transfer?: {
    store: string;
    key: `/${string}`;
    contentType?: `/${string}`;
    metadata?: `/${string}`;
    expiresInMs?: number;
    maxBytes?: number;
  };
  capabilities?: {
    call?: readonly Capability[];
    read?: readonly Capability[];
    cancel?: readonly Capability[];
  };
  cancel?: boolean;
  subject?: string;
};

export type ContractSourceEvent<TSchemaName extends string = string> = {
  version: `v${number}`;
  event: ContractSchemaRef<TSchemaName>;
  params?: readonly SubjectParam[];
  capabilities?: {
    publish?: readonly Capability[];
    subscribe?: readonly Capability[];
  };
  subject?: string;
};

export type ContractSourceSubject<TSchemaName extends string = string> = {
  subject: string;
  message?: ContractSchemaRef<TSchemaName>;
  capabilities?: {
    publish?: readonly Capability[];
    subscribe?: readonly Capability[];
  };
};

export type ContractSourceJobQueue<
  TSchemaName extends string = string,
> = {
  payload: ContractSchemaRef<TSchemaName>;
  result?: ContractSchemaRef<TSchemaName>;
  maxDeliver?: number;
  backoffMs?: readonly number[];
  ackWaitMs?: number;
  defaultDeadlineMs?: number;
  progress?: boolean;
  logs?: boolean;
  dlq?: boolean;
  concurrency?: number;
};

export type ContractSourceJobs<TSchemaName extends string = string> = Record<
  string,
  ContractSourceJobQueue<TSchemaName>
>;

export type ContractSourceKvResource<TSchemaName extends string = string> = {
  purpose: string;
  schema: ContractSchemaRef<TSchemaName>;
  required?: boolean;
  history?: number;
  ttlMs?: number;
  maxValueBytes?: number;
};

export type ContractSourceStoreResource = {
  purpose: string;
  required?: boolean;
  ttlMs?: number;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
};

export type ContractSourceStreamResource = {
  purpose: string;
  required?: boolean;
  subjects: readonly string[];
  retention?: "limits" | "interest" | "workqueue";
  storage?: "file" | "memory";
  numReplicas?: number;
  maxAgeMs?: number;
  maxBytes?: number;
  maxMsgs?: number;
  discard?: "old" | "new";
  sources?: ReadonlyArray<{
    fromAlias: string;
    filterSubject?: string;
    subjectTransformDest?: string;
  }>;
};

export type ContractSourceResources<TSchemaName extends string = string> = {
  kv?: Record<string, ContractSourceKvResource<TSchemaName>>;
  store?: Record<string, ContractSourceStoreResource>;
  streams?: Record<string, ContractSourceStreamResource>;
};

export type ContractSourceUse = {
  contract: string;
  rpc?: { call?: readonly string[] };
  operations?: { call?: readonly string[] };
  events?: { publish?: readonly string[]; subscribe?: readonly string[] };
  subjects?: { publish?: readonly string[]; subscribe?: readonly string[] };
};

export type TrellisContractSource = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  schemas?: ContractSourceSchemas;
  state?: ContractSourceState;
  uses?: Record<string, ContractSourceUse>;
  rpc?: Record<string, ContractSourceRpcMethod>;
  operations?: Record<string, ContractSourceOperation>;
  events?: Record<string, ContractSourceEvent>;
  subjects?: Record<string, ContractSourceSubject>;
  errors?: Record<string, ContractSourceErrorDecl>;
  jobs?: ContractSourceJobs;
  resources?: ContractSourceResources;
};

export type TrellisApiLike = {
  rpc: Record<string, RPCDesc>;
  operations: Record<string, OperationDesc>;
  events: Record<string, EventDesc>;
  subjects: Record<string, SubjectDesc>;
};

type ApiShape = {
  rpc: Record<string, unknown>;
  operations: Record<string, unknown>;
  events: Record<string, unknown>;
  subjects: Record<string, unknown>;
};

export type EmptyApi = {
  rpc: {};
  operations: {};
  events: {};
  subjects: {};
};

export type ContractApiViews<
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
> = {
  owned: TOwnedApi;
  used: TUsedApi;
  trellis: TTrellisApi;
};

export type UseSpec<TApi extends ApiShape> = {
  rpc?: {
    call?: readonly StringKeyOf<TApi["rpc"]>[];
  };
  operations?: {
    call?: readonly StringKeyOf<TApi["operations"]>[];
  };
  events?: {
    publish?: readonly StringKeyOf<TApi["events"]>[];
    subscribe?: readonly StringKeyOf<TApi["events"]>[];
  };
  subjects?: {
    publish?: readonly StringKeyOf<TApi["subjects"]>[];
    subscribe?: readonly StringKeyOf<TApi["subjects"]>[];
  };
};

type UseRpcCall<TSpec> =
  NonNullable<TSpec extends { rpc?: infer TRpc } ? TRpc : never> extends
    { call?: infer TCall } ? TCall
    : never;
type UseEventsPublish<TSpec> = NonNullable<
  TSpec extends { events?: infer TEvents } ? TEvents : never
> extends { publish?: infer TPublish } ? TPublish
  : never;
type UseOperationsCall<TSpec> = NonNullable<
  TSpec extends { operations?: infer TOperations } ? TOperations : never
> extends { call?: infer TCall } ? TCall
  : never;
type UseEventsSubscribe<TSpec> = NonNullable<
  TSpec extends { events?: infer TEvents } ? TEvents : never
> extends { subscribe?: infer TSubscribe } ? TSubscribe
  : never;
type UseSubjectsPublish<TSpec> = NonNullable<
  TSpec extends { subjects?: infer TSubjects } ? TSubjects : never
> extends { publish?: infer TPublish } ? TPublish
  : never;
type UseSubjectsSubscribe<TSpec> = NonNullable<
  TSpec extends { subjects?: infer TSubjects } ? TSubjects : never
> extends { subscribe?: infer TSubscribe } ? TSubscribe
  : never;

type NormalizeUseSelection<T extends readonly string[] | undefined> = T extends
  readonly string[] ? T[number][] : undefined;

type ContractModuleMarker<
  TContractModule = ContractModule<
    string,
    TrellisApiLike,
    TrellisApiLike,
    TrellisApiLike
  >,
> = {
  readonly [CONTRACT_MODULE_METADATA]: TContractModule;
};

export type ContractDependencyUse<
  TContractId extends string,
  TApi extends ApiShape,
  TSpec extends UseSpec<TApi> = UseSpec<TApi>,
> = {
  contract: TContractId;
  rpc?: { call?: UseRpcCall<TSpec> };
  operations?: { call?: UseOperationsCall<TSpec> };
  events?: {
    publish?: UseEventsPublish<TSpec>;
    subscribe?: UseEventsSubscribe<TSpec>;
  };
  subjects?: {
    publish?: UseSubjectsPublish<TSpec>;
    subscribe?: UseSubjectsSubscribe<TSpec>;
  };
};

type InternalContractDependencyUse<
  TContractId extends string,
  TApi extends ApiShape,
  TSpec extends UseSpec<TApi> = UseSpec<TApi>,
> = ContractDependencyUse<TContractId, TApi, TSpec> & ContractModuleMarker;

type AnyContractDependencyUse = InternalContractDependencyUse<
  string,
  TrellisApiLike,
  UseSpec<TrellisApiLike>
>;

type AuthorContractDependencyUse = ContractDependencyUse<
  string,
  TrellisApiLike,
  any
>;

export type ContractUseFn<TContractId extends string, TApi extends ApiShape> = <
  const TRpcCall extends readonly StringKeyOf<TApi["rpc"]>[] | undefined =
    undefined,
  const TOperationsCall extends
    | readonly StringKeyOf<TApi["operations"]>[]
    | undefined = undefined,
  const TEventsPublish extends
    | readonly StringKeyOf<TApi["events"]>[]
    | undefined = undefined,
  const TEventsSubscribe extends
    | readonly StringKeyOf<TApi["events"]>[]
    | undefined = undefined,
  const TSubjectsPublish extends
    | readonly StringKeyOf<TApi["subjects"]>[]
    | undefined = undefined,
  const TSubjectsSubscribe extends
    | readonly StringKeyOf<TApi["subjects"]>[]
    | undefined = undefined,
>(spec: {
  rpc?: { call?: TRpcCall };
  operations?: { call?: TOperationsCall };
  events?: { publish?: TEventsPublish; subscribe?: TEventsSubscribe };
  subjects?: { publish?: TSubjectsPublish; subscribe?: TSubjectsSubscribe };
}) => ContractDependencyUse<TContractId, TApi>;

type MergeRecordUnion<U> = [U] extends [never] ? {}
  : Simplify<UnionToIntersection<U>>;

type SchemaNameOf<TSchemas> = Extract<keyof NonNullable<TSchemas>, string>;

type ResolveSchemaFromMap<
  TSchemas,
  TRef,
> = TRef extends { schema: infer TName }
  ? TName extends SchemaNameOf<TSchemas>
    ? NonNullable<TSchemas>[TName] extends TSchema ? Schema<
        import("./runtime.ts").InferSchemaType<NonNullable<TSchemas>[TName]>
      >
    : Schema<unknown>
  : Schema<unknown>
  : Schema<unknown>;

type ResolveSchemaTypeFromMap<
  TSchemas,
  TRef,
> = TRef extends { schema: infer TName }
  ? TName extends SchemaNameOf<TSchemas>
    ? NonNullable<TSchemas>[TName] extends TSchema
      ? InferSchemaType<NonNullable<TSchemas>[TName]>
      : unknown
    : unknown
  : unknown;

export type ContractJobsMetadata = Record<string, {
  payload: unknown;
  result: unknown;
}>;
export type ContractKvMetadata = Record<string, {
  required: boolean;
  value: unknown;
  schema: TSchema;
}>;
export type ContractStateMetadata = Record<string, {
  kind: ContractStateKind;
  value: unknown;
  schema: unknown;
}>;

type ResolveTypeBoxSchemaFromMap<TSchemas, TRef> = TRef extends {
  schema: infer TName;
} ? TName extends SchemaNameOf<TSchemas>
  ? NonNullable<TSchemas>[TName] extends TSchema ? NonNullable<TSchemas>[TName]
    : TSchema
  : TSchema
  : TSchema;

type ProjectedJobs<
  T extends ContractSourceJobs<string> | undefined,
  TSchemas,
> = T extends ContractSourceJobs<string> ? {
    [K in keyof T]: {
      payload: ResolveSchemaTypeFromMap<TSchemas, T[K]["payload"]>;
      result: ResolveSchemaTypeFromMap<TSchemas, T[K]["result"]>;
    };
  }
  : {};

type ProjectedState<
  T extends ContractSourceState<string> | undefined,
  TSchemas,
> = T extends ContractSourceState<string> ? {
    [K in keyof T]: T[K] extends { kind: infer TKind extends ContractStateKind }
      ? {
        kind: TKind;
        value: ResolveSchemaTypeFromMap<TSchemas, T[K]["schema"]>;
        schema: unknown;
      }
      : never;
  }
  : {};

type ProjectedKvResources<
  T extends ContractSourceResources<string> | undefined,
  TSchemas,
> = T extends { kv?: infer TKv }
  ? TKv extends Record<
      string,
      { schema: ContractSchemaRef<string>; required?: boolean }
    > ? {
      [K in keyof TKv]: {
        required: TKv[K] extends { required: infer TRequired extends boolean }
          ? TRequired
          : true;
        value: ResolveSchemaTypeFromMap<TSchemas, TKv[K]["schema"]>;
        schema: ResolveTypeBoxSchemaFromMap<TSchemas, TKv[K]["schema"]>;
      };
    }
  : {}
  : {};

type JobsFromSource<T> = T extends { jobs?: infer TJobs }
  ? Extract<TJobs, ContractSourceJobs<string> | undefined>
  : undefined;
type ResourcesFromSource<T> = T extends { resources?: infer TResources }
  ? Extract<TResources, ContractSourceResources<string> | undefined>
  : undefined;
type StateFromSource<T> = T extends { state?: infer TState }
  ? Extract<TState, ContractSourceState<string> | undefined>
  : undefined;

type SchemasFromSource<T> = T extends { schemas?: infer TSchemas } ? TSchemas
  : undefined;

type RuntimeErrorFromSourceDecl<TDecl, TSchemas> = TDecl extends {
  type: infer TType extends string;
  schema?: infer TSchemaRef;
}
  ? TDecl extends ContractErrorRuntimeMarker<infer TClass>
    ? TClass extends RpcErrorClass<SerializableErrorData, infer TError>
      ? RuntimeRpcErrorDesc<
        TType,
        ResolveSchemaFromMap<TSchemas, TSchemaRef>,
        TError
      >
    : never
  : never
  : never;

type RuntimeErrorsForNames<TNames, TErrors, TSchemas> = TNames extends
  readonly string[] ? readonly RuntimeErrorFromSourceDecl<
    NonNullable<TErrors>[Extract<TNames[number], keyof NonNullable<TErrors>>],
    TSchemas
  >[]
  : undefined;

type ProjectedRpcMethod<
  TMethod extends ContractSourceRpcMethod,
  TSchemas,
  _TErrors,
> = {
  subject: string;
  input: ResolveSchemaFromMap<TSchemas, TMethod["input"]>;
  output: ResolveSchemaFromMap<TSchemas, TMethod["output"]>;
  callerCapabilities: readonly string[];
  authRequired?: boolean;
  errors?: TMethod["errors"];
  runtimeErrors?: readonly RuntimeRpcErrorDesc[];
  declaredErrorTypes?: readonly string[];
};

type BuiltRuntimeErrorDesc = {
  type: string;
  schema?: Schema<unknown>;
  fromSerializable(data: SerializableErrorData): BaseError;
};

type BuiltRpcDesc = {
  subject: string;
  input: Schema<unknown>;
  output: Schema<unknown>;
  callerCapabilities: readonly string[];
  authRequired?: boolean;
  errors?: readonly string[];
  declaredErrorTypes?: readonly string[];
  runtimeErrors?: readonly BuiltRuntimeErrorDesc[];
};

type ProjectedRpc<
  T extends Readonly<Record<string, ContractSourceRpcMethod>> | undefined,
  TSchemas,
  TErrors,
> = T extends Readonly<Record<string, ContractSourceRpcMethod>> ? {
    [K in keyof T]: ProjectedRpcMethod<T[K], TSchemas, TErrors>;
  }
  : {};

type ProjectedOperations<
  T extends Readonly<Record<string, ContractSourceOperation>> | undefined,
  TSchemas,
> = T extends Readonly<Record<string, ContractSourceOperation>> ? {
    [K in keyof T]: OperationDesc<
      ResolveSchemaFromMap<TSchemas, T[K]["input"]>,
      ResolveSchemaFromMap<TSchemas, T[K]["progress"]>,
      ResolveSchemaFromMap<TSchemas, T[K]["output"]>
    > & (T[K]["transfer"] extends undefined ? {} : { transfer: T[K]["transfer"] });
  }
  : {};

type ProjectedEvents<
  T extends Readonly<Record<string, ContractSourceEvent>> | undefined,
  TSchemas,
> = T extends Readonly<Record<string, ContractSourceEvent>> ? {
    [K in keyof T]: EventDesc<
      ResolveSchemaFromMap<TSchemas, T[K]["event"]>
    >;
  }
  : {};

type ProjectedSubjects<
  T extends Readonly<Record<string, ContractSourceSubject>> | undefined,
  TSchemas,
> = T extends Readonly<Record<string, ContractSourceSubject>> ? {
    [K in keyof T]: SubjectDesc<
      ResolveSchemaFromMap<TSchemas, T[K]["message"]>
    >;
  }
  : {};

export type OwnedApiFromSource<
  T extends {
    schemas?: Readonly<Record<string, TSchema>>;
    errors?: Readonly<Record<string, ErrorClass>>;
    rpc?: Readonly<Record<string, ContractSourceRpcMethod>>;
    operations?: Readonly<Record<string, ContractSourceOperation>>;
    events?: Readonly<Record<string, ContractSourceEvent>>;
    subjects?: Readonly<Record<string, ContractSourceSubject>>;
  },
> = {
  rpc: ProjectedRpc<T["rpc"], T["schemas"], T["errors"]>;
  operations: ProjectedOperations<T["operations"], T["schemas"]>;
  events: ProjectedEvents<T["events"], T["schemas"]>;
  subjects: ProjectedSubjects<T["subjects"], T["schemas"]>;
};

type RpcKeysFromSpec<TSpec> = TSpec extends { rpc?: { call?: infer TCall } }
  ? KeysFromList<TCall>
  : never;
type EventKeysFromSpec<TSpec> =
  | (TSpec extends { events?: { publish?: infer TPublish } }
    ? KeysFromList<TPublish>
    : never)
  | (TSpec extends { events?: { subscribe?: infer TSubscribe } }
    ? KeysFromList<TSubscribe>
    : never);
type OperationKeysFromSpec<TSpec> = TSpec extends
  { operations?: { call?: infer TCall } } ? KeysFromList<TCall>
  : never;
type SubjectKeysFromSpec<TSpec> =
  | (TSpec extends { subjects?: { publish?: infer TPublish } }
    ? KeysFromList<TPublish>
    : never)
  | (TSpec extends { subjects?: { subscribe?: infer TSubscribe } }
    ? KeysFromList<TSubscribe>
    : never);

type ApiFromDependencyUse<TUse> = TUse extends
  ContractDependencyUse<string, infer TApi, infer TSpec> ? {
    rpc: Pick<TApi["rpc"], RpcKeysFromSpec<TSpec>>;
    operations: Pick<TApi["operations"], OperationKeysFromSpec<TSpec>>;
    events: Pick<TApi["events"], EventKeysFromSpec<TSpec>>;
    subjects: Pick<TApi["subjects"], SubjectKeysFromSpec<TSpec>>;
  }
  : EmptyApi;

export type UsedApiFromUses<TUses> = [TUses] extends [undefined] ? EmptyApi
  : TUses extends Record<string, unknown> ? {
      rpc: MergeRecordUnion<ApiFromDependencyUse<TUses[keyof TUses]>["rpc"]>;
      operations: MergeRecordUnion<
        ApiFromDependencyUse<TUses[keyof TUses]>["operations"]
      >;
      events: MergeRecordUnion<
        ApiFromDependencyUse<TUses[keyof TUses]>["events"]
      >;
      subjects: MergeRecordUnion<
        ApiFromDependencyUse<TUses[keyof TUses]>["subjects"]
      >;
    }
  : EmptyApi;

export type MergeApis<TOwnedApi extends ApiShape, TUsedApi extends ApiShape> = {
  rpc: Simplify<TUsedApi["rpc"] & TOwnedApi["rpc"]>;
  operations: Simplify<TUsedApi["operations"] & TOwnedApi["operations"]>;
  events: Simplify<TUsedApi["events"] & TOwnedApi["events"]>;
  subjects: Simplify<TUsedApi["subjects"] & TOwnedApi["subjects"]>;
};

export type ContractModule<
  TContractId extends string,
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
  TJobs extends ContractJobsMetadata = {},
  TState extends ContractStateMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = {
  CONTRACT_ID: TContractId;
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: ContractApiViews<TOwnedApi, TUsedApi, TTrellisApi>;
  use: ContractUseFn<TContractId, TOwnedApi>;
  readonly [CONTRACT_JOBS_METADATA]?: TJobs;
  readonly [CONTRACT_STATE_METADATA]?: TState;
  readonly [CONTRACT_KV_METADATA]?: TKv;
};

export type SdkContractModule<
  TContractId extends string,
  TOwnedApi extends ApiShape,
  TJobs extends ContractJobsMetadata = {},
  TState extends ContractStateMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = ContractModule<
  TContractId,
  TOwnedApi,
  EmptyApi,
  TOwnedApi,
  TJobs,
  TState,
  TKv
>;

export type DefinedContract<
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
  TContractId extends string = string,
  TJobs extends ContractJobsMetadata = {},
  TState extends ContractStateMetadata = {},
  TKv extends ContractKvMetadata = ContractKvMetadata,
> = ContractModule<
  TContractId,
  TOwnedApi,
  TUsedApi,
  TTrellisApi,
  TJobs,
  TState,
  TKv
>;

export type DefineContractInput<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
  TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<SchemaNameOf<TSchemas>, ErrorNameOf<TErrors>>
      >
    >
    | undefined = undefined,
  TOperations extends
    | Readonly<Record<string, ContractSourceOperation<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
  TEvents extends
    | Readonly<Record<string, ContractSourceEvent<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
  TSubjects extends
    | Readonly<Record<string, ContractSourceSubject<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
> = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  schemas?: TSchemas;
  state?: ContractSourceState<SchemaNameOf<TSchemas>>;
  uses?: TUses;
  errors?: TErrors;
  rpc?: TRpc;
  operations?: TOperations;
  events?: TEvents;
  subjects?: TSubjects;
  jobs?: ContractSourceJobs<SchemaNameOf<TSchemas>>;
  resources?: ContractSourceResources<SchemaNameOf<TSchemas>>;
};

type DefineContractSource = {
  id: string;
  displayName: string;
  description: string;
  kind: ContractKind;
  schemas?: Readonly<Record<string, TSchema>>;
  state?: ContractSourceState;
  uses?: Readonly<Record<string, AuthorContractDependencyUse>>;
  errors?: Readonly<Record<string, ContractSourceErrorDecl>>;
  rpc?: Readonly<Record<string, ContractSourceRpcMethod>>;
  operations?: Readonly<Record<string, ContractSourceOperation>>;
  events?: Readonly<Record<string, ContractSourceEvent>>;
  subjects?: Readonly<Record<string, ContractSourceSubject>>;
  jobs?: ContractSourceJobs;
  resources?: ContractSourceResources;
};

type ConstrainSection<TSection, TExpected> = [TSection] extends [undefined]
  ? undefined
  : TSection & TExpected;

type ValidateDefineContractInput<T extends DefineContractSource> =
  & T
  & DefineContractInput<
    T["schemas"],
    ConstrainSection<
      T["uses"],
      Readonly<Record<string, AuthorContractDependencyUse>>
    >,
    ConstrainSection<
      T["errors"],
      Readonly<Record<string, ErrorClass>>
    >,
    ConstrainSection<
      T["rpc"],
      Readonly<
        Record<
          string,
          ContractSourceRpcMethod<
            SchemaNameOf<T["schemas"]>,
            ErrorNameOf<T["errors"]>
          >
        >
      >
    >,
    ConstrainSection<
      T["operations"],
      Readonly<
        Record<string, ContractSourceOperation<SchemaNameOf<T["schemas"]>>>
      >
    >,
    ConstrainSection<
      T["events"],
      Readonly<Record<string, ContractSourceEvent<SchemaNameOf<T["schemas"]>>>>
    >,
    ConstrainSection<
      T["subjects"],
      Readonly<
        Record<string, ContractSourceSubject<SchemaNameOf<T["schemas"]>>>
      >
    >
  >;

type DefineContractRegistry<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, unknown>>
    | undefined = undefined,
> = {
  schemas?: TSchemas;
  errors?: TErrors;
};

type AnyDefineContractRegistry = {
  schemas?: Readonly<Record<string, TSchema>>;
  errors?: Readonly<Record<string, unknown>>;
};

type ClientContractRegistry<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
> = {
  schemas?: TSchemas;
};

type RegistrySchemas<TRegistry extends AnyDefineContractRegistry> =
  TRegistry extends { schemas?: infer TSchemas }
    ? TSchemas extends Readonly<Record<string, TSchema>> | undefined ? TSchemas
    : undefined
    : undefined;

type RegistryErrors<TRegistry extends AnyDefineContractRegistry> =
  TRegistry extends { errors?: infer TErrors }
    ? TErrors extends
      Readonly<Record<string, unknown>> | undefined ? ExtractErrorClasses<
          TErrors
        >
    : undefined
    : undefined;

type RegistryUses =
  | Readonly<Record<string, AuthorContractDependencyUse>>
  | undefined;

type RegistryRpcMethods<TRegistry extends AnyDefineContractRegistry> =
  | Readonly<
    Record<
      string,
      ContractSourceRpcMethod<
        SchemaNameOf<RegistrySchemas<TRegistry>>,
        ErrorNameOf<RegistryErrors<TRegistry>>
      >
    >
  >
  | undefined;

type RegistryOperations<TRegistry extends AnyDefineContractRegistry> =
  | Readonly<
    Record<
      string,
      ContractSourceOperation<SchemaNameOf<RegistrySchemas<TRegistry>>>
    >
  >
  | undefined;

type RegistryEvents<TRegistry extends AnyDefineContractRegistry> =
  | Readonly<
    Record<
      string,
      ContractSourceEvent<SchemaNameOf<RegistrySchemas<TRegistry>>>
    >
  >
  | undefined;

type RegistrySubjects<TRegistry extends AnyDefineContractRegistry> =
  | Readonly<
    Record<
      string,
      ContractSourceSubject<SchemaNameOf<RegistrySchemas<TRegistry>>>
    >
  >
  | undefined;

type UsedApiOf<TBody extends { uses?: unknown }> = UsedApiFromUses<
  TBody["uses"]
>;

type DefineContractBodyInput<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
  TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<SchemaNameOf<TSchemas>, ErrorNameOf<TErrors>>
      >
    >
    | undefined = undefined,
  TOperations extends
    | Readonly<Record<string, ContractSourceOperation<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
  TEvents extends
    | Readonly<Record<string, ContractSourceEvent<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
  TSubjects extends
    | Readonly<Record<string, ContractSourceSubject<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
> =
  & Omit<
    DefineContractInput<
      TSchemas,
      TUses,
      TErrors,
      TRpc,
      TOperations,
      TEvents,
      TSubjects
    >,
    "schemas" | "errors"
  >
  & {
    schemas?: never;
    errors?: never;
  };

type ServiceContractBodyInput<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined = undefined,
  TErrors extends
    | Readonly<Record<string, ErrorClass>>
    | undefined = undefined,
  TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<SchemaNameOf<TSchemas>, ErrorNameOf<TErrors>>
      >
    >
    | undefined = undefined,
  TOperations extends
    | Readonly<Record<string, ContractSourceOperation<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
  TEvents extends
    | Readonly<Record<string, ContractSourceEvent<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
  TSubjects extends
    | Readonly<Record<string, ContractSourceSubject<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
> =
  & Omit<
    DefineContractBodyInput<
      TSchemas,
      TUses,
      TErrors,
      TRpc,
      TOperations,
      TEvents,
      TSubjects
    >,
    "kind"
  >
  & { kind?: never };

type ClientContractBodyInput<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined = undefined,
> = ContractIdentityFields & {
  state?: ContractSourceState<SchemaNameOf<TSchemas>>;
  uses?: TUses;
  kind?: never;
  schemas?: never;
  errors?: never;
  rpc?: never;
  operations?: never;
  events?: never;
  subjects?: never;
  resources?: never;
};

type BuiltContractSource<
  TRegistry extends AnyDefineContractRegistry,
  TBody extends { id: string },
> = Simplify<
  & Omit<TBody, "schemas" | "errors">
  & Pick<TRegistry, Extract<keyof TRegistry, "schemas" | "errors">>
>;

type WithKind<TBody extends { id: string }, TKind extends ContractKind> =
  Simplify<
    Omit<TBody, "kind"> & { kind: TKind }
  >;

function createContractRefBuilder<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  TErrors extends Readonly<Record<string, ErrorClass>> | undefined,
>(
  registry: DefineContractRegistry<TSchemas, TErrors>,
): ContractRefBuilder<TSchemas, TErrors> {
  const schemaRef = registry.schemas
    ? createSchemaRef(registry.schemas)
    : undefined;
  return {
    schema<const TName extends SchemaNameOf<TSchemas>>(
      schemaName: TName,
    ): ContractSchemaRef<TName> {
      if (!schemaRef) {
        throw new Error(
          `Contract builder ref.schema('${schemaName}') requires a schemas registry`,
        );
      }
      return schemaRef(schemaName);
    },
    error<const TName extends ErrorNameOf<TErrors>>(errorName: TName): TName {
      return errorName;
    },
  };
}

function cloneSchema(schemaValue: TSchema): JsonSchema {
  const cloned = JSON.parse(JSON.stringify(schemaValue));
  if (!isJsonValue(cloned)) {
    throw new Error("Contract schema is not JSON-serializable");
  }
  return cloned;
}

function cloneSchemas(
  schemas: ContractSourceSchemas | undefined,
): ContractSchemas | undefined {
  if (!schemas) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(schemas).map((
      [name, schemaValue],
    ) => [name, cloneSchema(schemaValue)]),
  );
}

function getErrorRuntimeSchema(errorDecl: ContractSourceErrorDecl): TSchema | undefined {
  const errorClass = getContractErrorRuntimeClass(errorDecl);
  const runtimeSchema = errorClass
    ? Reflect.get(errorClass, "schema")
    : undefined;
  if (!runtimeSchema || typeof runtimeSchema !== "object") {
    return undefined;
  }

  return runtimeSchema as TSchema;
}

function createContractErrorDecl<TClass extends ErrorClass>(
  errorClass: TClass,
): ContractSourceErrorDecl<string> & ContractErrorRuntimeMarker<TClass> {
  const errorDecl: ContractSourceErrorDecl<string> = {
    type: getContractErrorType(errorClass),
  };
  return attachContractErrorRuntimeMetadata(errorDecl, errorClass);
}

function normalizeErrorRegistry(
  errors: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, ContractSourceErrorDecl>> | undefined {
  if (!errors) {
    return undefined;
  }

  const normalizedEntries = Object.entries(errors).flatMap(([key, value]) =>
    isErrorClass(value) ? [[key, createContractErrorDecl(value)]] : []
  );
  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function getErrorClassRegistry(
  errors: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, ErrorClass>> | undefined {
  if (!errors) {
    return undefined;
  }

  const classEntries = Object.entries(errors).flatMap(([key, value]) =>
    isErrorClass(value) ? [[key, value]] : []
  );
  if (classEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(classEntries);
}

function findMatchingSchemaName(
  schemas: ContractSourceSchemas | undefined,
  targetSchema: TSchema,
): string | undefined {
  if (!schemas) {
    return undefined;
  }

  const targetDigest = digestCanonicalJson(cloneSchema(targetSchema));
  for (const [schemaName, schemaValue] of Object.entries(schemas)) {
    if (schemaValue === targetSchema) {
      return schemaName;
    }

    if (digestCanonicalJson(cloneSchema(schemaValue)) === targetDigest) {
      return schemaName;
    }
  }

  return undefined;
}

function chooseDerivedErrorSchemaName(
  schemas: ContractSourceSchemas,
  errorName: string,
  errorType: string,
): string {
  const baseNames = [`${errorType}Data`, `${errorName}Data`];

  for (const baseName of baseNames) {
    if (!Object.hasOwn(schemas, baseName)) {
      return baseName;
    }
  }

  let suffix = 2;
  while (true) {
    const candidate = `${errorType}Data${suffix}`;
    if (!Object.hasOwn(schemas, candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

function materializeErrorSchemas(
  schemas: ContractSourceSchemas | undefined,
  errors: Record<string, ContractSourceErrorDecl> | undefined,
): ContractSourceSchemas | undefined {
  if (!errors) {
    return schemas;
  }

  let mergedSchemas = schemas;
  for (const [errorName, errorDecl] of Object.entries(errors)) {
    if (errorDecl.schema) {
      continue;
    }

    const runtimeSchema = getErrorRuntimeSchema(errorDecl);
    if (!runtimeSchema) {
      continue;
    }

    if (findMatchingSchemaName(mergedSchemas, runtimeSchema)) {
      continue;
    }

    mergedSchemas = { ...(mergedSchemas ?? {}) };
    const derivedSchemaName = chooseDerivedErrorSchemaName(
      mergedSchemas,
      errorName,
      errorDecl.type,
    );
    mergedSchemas[derivedSchemaName] = runtimeSchema;
  }

  return mergedSchemas;
}

function assertSchemaRefExists(
  schemas: ContractSourceSchemas | undefined,
  ref: ContractSchemaRef,
  context: string,
): void {
  if (!schemas || !Object.hasOwn(schemas, ref.schema)) {
    throw new Error(`${context} references unknown schema '${ref.schema}'`);
  }
}

function resolveSchemaRef(
  schemas: ContractSourceSchemas | undefined,
  ref: ContractSchemaRef,
  context: string,
): JsonSchema {
  assertSchemaRefExists(schemas, ref, context);
  return cloneSchema(schemas![ref.schema]);
}

function digestCanonicalJson(value: JsonValue): string {
  return sha256Base64urlSync(canonicalizeJson(value));
}

function rpcSubject(name: string, version: `v${number}`): string {
  return `rpc.${version}.${name}`;
}

function operationSubject(name: string, version: `v${number}`): string {
  return `operations.${version}.${name}`;
}

function eventSubject(
  name: string,
  version: `v${number}`,
  params: readonly SubjectParam[] | undefined,
): string {
  const suffix = params && params.length > 0
    ? `.${params.map((pointer) => `{${pointer}}`).join(".")}`
    : "";
  return `events.${version}.${name}${suffix}`;
}

function emitResources(
  resources: ContractSourceResources | undefined,
): ContractResources | undefined {
  if (!resources?.kv && !resources?.store && !resources?.streams) {
    return undefined;
  }

  return {
    ...(resources.kv
      ? {
        kv: Object.fromEntries(
          Object.entries(resources.kv).map(([alias, resource]) => [
            alias,
            {
              purpose: resource.purpose,
              schema: { ...resource.schema },
              required: resource.required ?? true,
              history: resource.history ?? 1,
              ttlMs: resource.ttlMs ?? 0,
              ...(resource.maxValueBytes
                ? { maxValueBytes: resource.maxValueBytes }
                : {}),
            } satisfies ContractKvResource,
          ]),
        ),
      }
      : {}),
    ...(resources.store
      ? {
        store: Object.fromEntries(
          Object.entries(resources.store).map(([alias, resource]) => [
            alias,
            {
              purpose: resource.purpose,
              required: resource.required ?? true,
              ttlMs: resource.ttlMs ?? 0,
              ...(resource.maxObjectBytes !== undefined
                ? { maxObjectBytes: resource.maxObjectBytes }
                : {}),
              ...(resource.maxTotalBytes !== undefined
                ? { maxTotalBytes: resource.maxTotalBytes }
                : {}),
            } satisfies ContractStoreResource,
          ]),
        ),
      }
      : {}),
    ...(resources.streams
      ? {
        streams: Object.fromEntries(
          Object.entries(resources.streams).map(([alias, resource]) => [
            alias,
            {
              purpose: resource.purpose,
              required: resource.required ?? true,
              ...(resource.retention ? { retention: resource.retention } : {}),
              ...(resource.storage ? { storage: resource.storage } : {}),
              ...(resource.numReplicas !== undefined
                ? { numReplicas: resource.numReplicas }
                : {}),
              ...(resource.maxAgeMs !== undefined
                ? { maxAgeMs: resource.maxAgeMs }
                : {}),
              ...(resource.maxBytes !== undefined
                ? { maxBytes: resource.maxBytes }
                : {}),
              ...(resource.maxMsgs !== undefined
                ? { maxMsgs: resource.maxMsgs }
                : {}),
              ...(resource.discard ? { discard: resource.discard } : {}),
              subjects: [...resource.subjects],
              ...(resource.sources
                ? {
                  sources: resource.sources.map((source) => ({
                    fromAlias: source.fromAlias,
                    ...(source.filterSubject
                      ? { filterSubject: source.filterSubject }
                      : {}),
                    ...(source.subjectTransformDest
                      ? { subjectTransformDest: source.subjectTransformDest }
                      : {}),
                  })),
                }
                : {}),
            } satisfies ContractStreamResource,
          ]),
        ),
      }
      : {}),
  };
}

function emitJobs(
  jobs: ContractSourceJobs | undefined,
): ContractJobs | undefined {
  if (!jobs) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(jobs).map(([queueType, queue]) => [
      queueType,
      {
        payload: { ...queue.payload },
        ...(queue.result ? { result: { ...queue.result } } : {}),
        ...(queue.maxDeliver !== undefined
          ? { maxDeliver: queue.maxDeliver }
          : {}),
        ...(queue.backoffMs ? { backoffMs: [...queue.backoffMs] } : {}),
        ...(queue.ackWaitMs !== undefined
          ? { ackWaitMs: queue.ackWaitMs }
          : {}),
        ...(queue.defaultDeadlineMs !== undefined
          ? { defaultDeadlineMs: queue.defaultDeadlineMs }
          : {}),
        ...(queue.progress !== undefined ? { progress: queue.progress } : {}),
        ...(queue.logs !== undefined ? { logs: queue.logs } : {}),
        ...(queue.dlq !== undefined ? { dlq: queue.dlq } : {}),
        ...(queue.concurrency !== undefined
          ? { concurrency: queue.concurrency }
          : {}),
      } satisfies ContractJobQueue,
    ]),
  );
}

function buildContractJobsMetadata(
  jobs: ContractSourceJobs | undefined,
): ContractJobsMetadata {
  if (!jobs) {
    return {};
  }

  return Object.fromEntries(
    Object.keys(jobs).map((queueType) => [queueType, {
      payload: undefined,
      result: undefined,
    }]),
  ) as ContractJobsMetadata;
}

function buildContractKvMetadata(
  resources: ContractSourceResources | undefined,
  schemas: ContractSourceSchemas | undefined,
): ContractKvMetadata {
  const kv = resources?.kv;
  if (!kv) {
    return {};
  }

  const metadata: ContractKvMetadata = {};
  for (const [alias, resource] of Object.entries(kv)) {
    assertSchemaRefExists(schemas, resource.schema, `kv resource '${alias}'`);
    metadata[alias] = {
      required: resource.required ?? true,
      value: undefined,
      schema: schemas![resource.schema.schema],
    };
  }
  return metadata;
}

function buildContractStateMetadata(
  state: ContractSourceState | undefined,
  schemas: ContractSourceSchemas | undefined,
): ContractStateMetadata {
  if (!state) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(state).map(([storeName, store]) => [storeName, {
      kind: store.kind,
      value: undefined,
      schema: resolveSchemaRef(schemas, store.schema, `state store '${storeName}'`),
    }]),
  ) as ContractStateMetadata;
}

function emitState(
  state: ContractSourceState | undefined,
): ContractState | undefined {
  if (!state) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(state).map(([storeName, store]) => [storeName, {
      kind: store.kind,
      schema: { ...store.schema },
    } satisfies ContractStateStore]),
  );
}

function emitUses(
  uses: Record<string, ContractSourceUse> | undefined,
): ContractUses | undefined {
  if (!uses) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(uses).map(([alias, use]) => [
      alias,
      {
        contract: use.contract,
        ...(use.rpc?.call ? { rpc: { call: [...use.rpc.call] } } : {}),
        ...(use.operations?.call
          ? { operations: { call: [...use.operations.call] } }
          : {}),
        ...((use.events?.publish || use.events?.subscribe)
          ? {
            events: {
              ...(use.events.publish
                ? { publish: [...use.events.publish] }
                : {}),
              ...(use.events.subscribe
                ? { subscribe: [...use.events.subscribe] }
                : {}),
            },
          }
          : {}),
        ...((use.subjects?.publish || use.subjects?.subscribe)
          ? {
            subjects: {
              ...(use.subjects.publish
                ? { publish: [...use.subjects.publish] }
                : {}),
              ...(use.subjects.subscribe
                ? { subscribe: [...use.subjects.subscribe] }
                : {}),
            },
          }
          : {}),
      } satisfies ContractUse,
    ]),
  );
}

function emitContract(source: TrellisContractSource): TrellisContractV1 {
  const rpc = source.rpc
    ? Object.fromEntries(
      Object.entries(source.rpc).map(([name, method]) => {
        const emitted: ContractRpcMethod = {
          version: method.version,
          subject: method.subject ?? rpcSubject(name, method.version),
          input: { ...method.input },
          output: { ...method.output },
        };
        if (method.capabilities?.call) {
          emitted.capabilities = { call: [...method.capabilities.call] };
        }
        if (method.errors && method.errors.length > 0) {
          emitted.errors = method.errors.map((errorName) => ({
            type: source.errors?.[errorName]?.type ?? errorName,
          }));
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const operations = source.operations
    ? Object.fromEntries(
      Object.entries(source.operations).map(([name, operation]) => {
        if (operation.transfer) {
          const store = source.resources?.store?.[operation.transfer.store];
          if (!store) {
            throw new Error(
              `Operation '${name}' references unknown store resource '${operation.transfer.store}'`,
            );
          }

          const inputSchema = resolveSchemaRef(
            source.schemas,
            operation.input,
            `operation '${name}' input`,
          );
          for (const pointer of [
            operation.transfer.key,
            operation.transfer.contentType,
            operation.transfer.metadata,
          ]) {
            if (!pointer) {
              continue;
            }
            if (getSubschemaAtDataPointer(inputSchema, pointer) === undefined) {
              throw new Error(
                `Invalid transfer pointer '${pointer}' for operation '${name}' (path not found in input schema)`,
              );
            }
          }
        }

        const emitted: ContractOperation = {
          version: operation.version,
          subject: operation.subject ??
            operationSubject(name, operation.version),
          input: { ...operation.input },
        };
        if (operation.progress) {
          emitted.progress = { ...operation.progress };
        }
        if (operation.output) {
          emitted.output = { ...operation.output };
        }
        if (operation.transfer) {
          emitted.transfer = { ...operation.transfer };
        }
        if (
          operation.capabilities?.call || operation.capabilities?.read ||
          operation.capabilities?.cancel
        ) {
          emitted.capabilities = {
            ...(operation.capabilities.call
              ? { call: [...operation.capabilities.call] }
              : {}),
            ...(operation.capabilities.read
              ? { read: [...operation.capabilities.read] }
              : {}),
            ...(operation.capabilities.cancel
              ? { cancel: [...operation.capabilities.cancel] }
              : {}),
          };
        }
        if (operation.cancel !== undefined) {
          emitted.cancel = operation.cancel;
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const events = source.events
    ? Object.fromEntries(
      Object.entries(source.events).map(([name, event]) => {
        if (event.params && event.params.length > 0) {
          assertDataPointersExistAndAreTokenable(
            name,
            resolveSchemaRef(source.schemas, event.event, `event '${name}'`),
            event.params,
          );
        }

        const emitted: ContractEvent = {
          version: event.version,
          subject: event.subject ??
            eventSubject(name, event.version, event.params),
          event: { ...event.event },
        };
        if (event.params && event.params.length > 0) {
          emitted.params = [...event.params];
        }
        if (event.capabilities?.publish || event.capabilities?.subscribe) {
          emitted.capabilities = {
            ...(event.capabilities.publish
              ? { publish: [...event.capabilities.publish] }
              : {}),
            ...(event.capabilities.subscribe
              ? { subscribe: [...event.capabilities.subscribe] }
              : {}),
          };
        }

        return [name, emitted];
      }),
    )
    : undefined;

  const subjects = source.subjects
    ? Object.fromEntries(
      Object.entries(source.subjects).map(([name, subject]) => {
        const emitted: ContractSubject = {
          subject: subject.subject,
        };
        if (subject.message) {
          emitted.message = { ...subject.message };
        }
        if (subject.capabilities?.publish || subject.capabilities?.subscribe) {
          emitted.capabilities = {
            ...(subject.capabilities.publish
              ? { publish: [...subject.capabilities.publish] }
              : {}),
            ...(subject.capabilities.subscribe
              ? { subscribe: [...subject.capabilities.subscribe] }
              : {}),
          };
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const errors = source.errors
    ? Object.fromEntries(
      Object.entries(source.errors).map(([name, error]) => {
        const emitted: ContractErrorDecl = { type: error.type };
        const schemaRef = resolveErrorSchemaRef(source.schemas, name, error);
        if (schemaRef) {
          emitted.schema = { ...schemaRef };
        }
        return [name, emitted];
      }),
    )
    : undefined;

  const jobs = emitJobs(source.jobs);
  const state = emitState(source.state);
  const resources = emitResources(source.resources);
  const uses = emitUses(source.uses);

  return {
    format: CONTRACT_FORMAT_V1,
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(source.schemas ? { schemas: cloneSchemas(source.schemas) } : {}),
    ...(state ? { state } : {}),
    ...(uses ? { uses } : {}),
    ...(rpc ? { rpc } : {}),
    ...(operations ? { operations } : {}),
    ...(events ? { events } : {}),
    ...(subjects ? { subjects } : {}),
    ...(errors ? { errors } : {}),
    ...(jobs ? { jobs } : {}),
    ...(resources ? { resources } : {}),
  };
}

function buildOwnedApi(source: TrellisContractSource): ApiShape {
  const localRuntimeErrors: Record<string, BuiltRuntimeErrorDesc> = {};
  for (const [name, errorDecl] of Object.entries(source.errors ?? {})) {
    const errorClass = getContractErrorRuntimeClass(errorDecl);
    if (!errorClass) {
      continue;
    }

    const errorSchemaRef = resolveErrorSchemaRef(
      source.schemas,
      name,
      errorDecl,
    );
    localRuntimeErrors[name] = {
      type: errorDecl.type,
      ...(errorSchemaRef
        ? {
          schema: schema(
            resolveSchemaRef(
              source.schemas,
              errorSchemaRef,
              `error '${name}' schema`,
            ),
          ),
        }
        : {}),
      fromSerializable(data: SerializableErrorData) {
        if (!isSerializableErrorData(data)) {
          throw new Error(
            `Transport error '${errorDecl.type}' is missing base error fields`,
          );
        }
        return errorClass.fromSerializable(data);
      },
    };
  }

  const rpc: Record<string, BuiltRpcDesc> = {};
  for (const [name, method] of Object.entries(source.rpc ?? {})) {
    rpc[name] = {
      subject: method.subject ?? rpcSubject(name, method.version),
      input: schema(
        resolveSchemaRef(source.schemas, method.input, `rpc '${name}' input`),
      ),
      output: schema(
        resolveSchemaRef(
          source.schemas,
          method.output,
          `rpc '${name}' output`,
        ),
      ),
      callerCapabilities: method.capabilities?.call ?? [],
      authRequired: method.authRequired ?? true,
      errors: method.errors,
      declaredErrorTypes: method.errors?.map((errorName) =>
        source.errors?.[errorName]?.type ?? errorName
      ),
      runtimeErrors: method.errors?.flatMap((errorName) => {
        const runtimeError = localRuntimeErrors[errorName];
        return runtimeError ? [runtimeError] : [];
      }),
    };
  }

  const operations = Object.fromEntries(
    Object.entries(source.operations ?? {}).map(([name, operation]) => [
      name,
      {
        subject: operation.subject ?? operationSubject(name, operation.version),
        input: schema(
          resolveSchemaRef(
            source.schemas,
            operation.input,
            `operation '${name}' input`,
          ),
        ),
        progress: operation.progress
          ? schema(
            resolveSchemaRef(
              source.schemas,
              operation.progress,
              `operation '${name}' progress`,
            ),
          )
          : undefined,
        output: operation.output
          ? schema(
              resolveSchemaRef(
                source.schemas,
                operation.output,
                `operation '${name}' output`,
              ),
            )
          : undefined,
        transfer: operation.transfer
          ? { ...operation.transfer }
          : undefined,
        callerCapabilities: operation.capabilities?.call ?? [],
        readCapabilities: operation.capabilities?.read ?? [],
        cancelCapabilities: operation.capabilities?.cancel ?? [],
        cancel: operation.cancel,
      },
    ]),
  ) as Record<string, OperationDesc>;

  const events = Object.fromEntries(
    Object.entries(source.events ?? {}).map(([name, event]) => {
      if (event.params && event.params.length > 0) {
        assertDataPointersExistAndAreTokenable(
          name,
          resolveSchemaRef(source.schemas, event.event, `event '${name}'`),
          event.params,
        );
      }

      return [
        name,
        {
          subject: event.subject ??
            eventSubject(name, event.version, event.params),
          params: event.params,
          event: schema(
            resolveSchemaRef(source.schemas, event.event, `event '${name}'`),
          ),
          publishCapabilities: event.capabilities?.publish ?? [],
          subscribeCapabilities: event.capabilities?.subscribe ?? [],
        },
      ];
    }),
  ) as Record<string, EventDesc>;

  const subjects = Object.fromEntries(
    Object.entries(source.subjects ?? {}).map(([name, subject]) => [
      name,
      {
        subject: subject.subject,
        schema: subject.message
          ? schema(
            resolveSchemaRef(
              source.schemas,
              subject.message,
              `subject '${name}'`,
            ),
          )
          : undefined,
        publishCapabilities: subject.capabilities?.publish ?? [],
        subscribeCapabilities: subject.capabilities?.subscribe ?? [],
      },
    ]),
  ) as Record<string, SubjectDesc>;

  return { rpc, operations, events, subjects } as ApiShape;
}

function mergeRecord(
  kind: "rpc" | "operations" | "events" | "subjects",
  out: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(next)) {
    if (Object.hasOwn(out, key)) {
      throw new Error(
        `Duplicate ${kind} key '${key}' while deriving contract API`,
      );
    }
    out[key] = value;
  }
}

function assertSelectedKeysExist(
  contractId: string,
  kind: "rpc" | "operations" | "events" | "subjects",
  keys: readonly string[] | undefined,
  api: Record<string, unknown>,
) {
  if (!keys) {
    return;
  }

  for (const key of keys) {
    if (!Object.hasOwn(api, key)) {
      throw new Error(
        `Contract '${contractId}' does not expose ${kind} key '${key}'`,
      );
    }
  }
}

function assertValidUseSpec<TApi extends TrellisApiLike>(
  contractId: string,
  spec: UseSpec<TApi>,
  api: TApi,
) {
  assertSelectedKeysExist(contractId, "rpc", spec.rpc?.call, api.rpc);
  assertSelectedKeysExist(
    contractId,
    "operations",
    spec.operations?.call,
    api.operations,
  );
  assertSelectedKeysExist(
    contractId,
    "events",
    spec.events?.publish,
    api.events,
  );
  assertSelectedKeysExist(
    contractId,
    "events",
    spec.events?.subscribe,
    api.events,
  );
  assertSelectedKeysExist(
    contractId,
    "subjects",
    spec.subjects?.publish,
    api.subjects,
  );
  assertSelectedKeysExist(
    contractId,
    "subjects",
    spec.subjects?.subscribe,
    api.subjects,
  );
}

function attachContractModuleMetadata<
  TValue extends object,
  TContractModule,
>(
  value: TValue,
  contractModule: TContractModule,
): TValue & ContractModuleMarker<TContractModule> {
  Object.defineProperty(value, CONTRACT_MODULE_METADATA, {
    value: contractModule,
    enumerable: false,
  });
  return value as TValue & ContractModuleMarker<TContractModule>;
}

function attachContractErrorRuntimeMetadata<
  TValue extends object,
  TClass extends RpcErrorClass,
>(
  value: TValue,
  errorClass: TClass,
): TValue & ContractErrorRuntimeMarker<TClass> {
  Object.defineProperty(value, CONTRACT_ERROR_RUNTIME_METADATA, {
    value: errorClass,
    enumerable: false,
  });
  return value as TValue & ContractErrorRuntimeMarker<TClass>;
}

function getContractErrorRuntimeClass(
  errorDecl: ContractSourceErrorDecl,
): ErrorClass | undefined {
  const value = Object.getOwnPropertyDescriptor(
    errorDecl,
    CONTRACT_ERROR_RUNTIME_METADATA,
  )?.value;
  if (isErrorClass(value)) {
    return value;
  }
  return undefined;
}

function resolveErrorSchemaRef(
  schemas: ContractSourceSchemas | undefined,
  errorName: string,
  errorDecl: ContractSourceErrorDecl,
): ContractSchemaRef | undefined {
  if (errorDecl.schema) {
    return errorDecl.schema;
  }

  const runtimeSchema = getErrorRuntimeSchema(errorDecl);
  if (!runtimeSchema) {
    return undefined;
  }

  const schemaName = findMatchingSchemaName(schemas, runtimeSchema);
  if (schemaName) {
    return { schema: schemaName };
  }

  throw new Error(
    `error '${errorName}' schema must be declared in contract.schemas`,
  );
}

/**
 * Define a transportable Trellis error class from a payload-object schema.
 *
 * The returned value is a real runtime error class that carries the wire schema
 * and reconstruction logic needed by `defineServiceContract(...)`.
 */
export function defineError<
  const TType extends string,
  const TFields extends TProperties,
>(
  options: DefineErrorOptions<TType, TFields>,
): DefinedErrorClass<TType, TFields> {
  assertNoReservedDefinedErrorFieldNames(options.fields);

  const errorSchema = createDefinedErrorSchema(options.type, options.fields);
  const fieldNames = definedErrorPayloadFieldNames(options.fields);

  type TPayload = DefinedErrorPayload<TFields>;
  type TData = DefinedErrorData<TType, TFields>;
  type TInit = DefinedErrorInit<TFields>;

  class DefinedErrorImpl extends TrellisError<SerializableErrorData>
    implements DefinedErrorPayloadCarrier<TPayload> {
    static readonly type = options.type;
    static readonly schema = errorSchema;
    override readonly name = options.type;
    [DEFINED_ERROR_PAYLOAD]: Readonly<TPayload>;

    constructor(payload: TInit) {
      const customPayload = pickDefinedErrorPayload(fieldNames, payload);
      const message = typeof options.message === "function"
        ? options.message(customPayload)
        : options.message;
      super(message, definedErrorBaseOptions(payload));
      this[DEFINED_ERROR_PAYLOAD] = customPayload;
      Object.assign(this, customPayload);
    }

    static fromSerializable(data: TData): DefinedErrorInstance<TType, TFields> {
      const customPayload = pickDefinedErrorPayload(fieldNames, data);
      const ErrorCtor = DefinedErrorImpl as new (
        payload: object,
      ) => TrellisError<SerializableErrorData> &
        DefinedErrorPayloadCarrier<Record<string, unknown>>;
      const error = new ErrorCtor({
        ...customPayload,
        id: data.id,
        context: data.context,
        traceId: data.traceId,
      });
      error[DEFINED_ERROR_PAYLOAD] = customPayload;
      return Object.assign(error, customPayload) as DefinedErrorInstance<TType, TFields>;
    }

    override toSerializable(): SerializableErrorData {
      return {
        ...this.baseSerializable(),
        type: this.name,
        ...this[DEFINED_ERROR_PAYLOAD],
      };
    }
  }

  // @ts-expect-error TypeScript cannot model the dynamically assigned payload
  // fields on the generated class instance constructor return type.
  return DefinedErrorImpl;
}

function createUseHelper<
  TContractId extends string,
  TOwnedApi extends TrellisApiLike,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
>(
  getContractModule: () => ContractModule<
    TContractId,
    TOwnedApi,
    TUsedApi,
    TTrellisApi
  >,
) {
  return ((spec) => {
    const contractModule = getContractModule();
    assertValidUseSpec(
      contractModule.CONTRACT_ID,
      spec,
      contractModule.API.owned,
    );

    const dependencyUse = {
      contract: contractModule.CONTRACT_ID,
      ...(spec.rpc?.call ? { rpc: { call: [...spec.rpc.call] } } : {}),
      ...(spec.operations?.call
        ? { operations: { call: [...spec.operations.call] } }
        : {}),
      ...((spec.events?.publish || spec.events?.subscribe)
        ? {
          events: {
            ...(spec.events.publish
              ? { publish: [...spec.events.publish] }
              : {}),
            ...(spec.events.subscribe
              ? { subscribe: [...spec.events.subscribe] }
              : {}),
          },
        }
        : {}),
      ...((spec.subjects?.publish || spec.subjects?.subscribe)
        ? {
          subjects: {
            ...(spec.subjects.publish
              ? { publish: [...spec.subjects.publish] }
              : {}),
            ...(spec.subjects.subscribe
              ? { subscribe: [...spec.subjects.subscribe] }
              : {}),
          },
        }
        : {}),
    };

    return attachContractModuleMetadata(
      dependencyUse,
      contractModule,
    );
  }) as ContractUseFn<TContractId, TOwnedApi>;
}

function getContractModuleFromUse(
  alias: string,
  useValue: ContractSourceUse | AuthorContractDependencyUse,
): ContractModule<string, TrellisApiLike, TrellisApiLike, TrellisApiLike> {
  const contractModule = Object.getOwnPropertyDescriptor(
    useValue,
    CONTRACT_MODULE_METADATA,
  )?.value as
    | ContractModule<
      string,
      TrellisApiLike,
      TrellisApiLike,
      TrellisApiLike
    >
    | undefined;
  if (!contractModule) {
    throw new Error(
      `Contract use '${alias}' must be created with contractModule.use(...) from @qlever-llc/trellis/contracts`,
    );
  }
  return contractModule;
}

function normalizeUses(
  uses: Readonly<Record<string, AuthorContractDependencyUse>> | undefined,
): {
  manifestUses: Record<string, ContractSourceUse> | undefined;
  usedApi: TrellisApiLike;
} {
  if (!uses) {
    return {
      manifestUses: undefined,
      usedApi: { rpc: {}, operations: {}, events: {}, subjects: {} },
    };
  }

  const manifestUses: Record<string, ContractSourceUse> = {};
  const usedApi: TrellisApiLike = {
    rpc: {},
    operations: {},
    events: {},
    subjects: {},
  };

  for (const [alias, useValue] of Object.entries(uses)) {
    const contractModule = getContractModuleFromUse(alias, useValue);
    const rpcCall = useValue.rpc?.call as readonly string[] | undefined;
    const operationsCall = useValue.operations?.call as
      | readonly string[]
      | undefined;
    const eventsPublish = useValue.events?.publish as
      | readonly string[]
      | undefined;
    const eventsSubscribe = useValue.events?.subscribe as
      | readonly string[]
      | undefined;
    const subjectsPublish = useValue.subjects?.publish as
      | readonly string[]
      | undefined;
    const subjectsSubscribe = useValue.subjects?.subscribe as
      | readonly string[]
      | undefined;

    if (useValue.contract !== contractModule.CONTRACT_ID) {
      throw new Error(
        `Contract use '${alias}' references '${useValue.contract}' but module id is '${contractModule.CONTRACT_ID}'`,
      );
    }

    assertValidUseSpec(
      contractModule.CONTRACT_ID,
      {
        ...(rpcCall ? { rpc: { call: rpcCall } } : {}),
        ...(operationsCall ? { operations: { call: operationsCall } } : {}),
        ...((eventsPublish || eventsSubscribe)
          ? {
            events: {
              ...(eventsPublish ? { publish: eventsPublish } : {}),
              ...(eventsSubscribe ? { subscribe: eventsSubscribe } : {}),
            },
          }
          : {}),
        ...((subjectsPublish || subjectsSubscribe)
          ? {
            subjects: {
              ...(subjectsPublish ? { publish: subjectsPublish } : {}),
              ...(subjectsSubscribe ? { subscribe: subjectsSubscribe } : {}),
            },
          }
          : {}),
      },
      contractModule.API.owned,
    );

    manifestUses[alias] = {
      contract: contractModule.CONTRACT_ID,
      ...(rpcCall ? { rpc: { call: [...rpcCall] } } : {}),
      ...(operationsCall ? { operations: { call: [...operationsCall] } } : {}),
      ...((eventsPublish || eventsSubscribe)
        ? {
          events: {
            ...(eventsPublish ? { publish: [...eventsPublish] } : {}),
            ...(eventsSubscribe ? { subscribe: [...eventsSubscribe] } : {}),
          },
        }
        : {}),
      ...((subjectsPublish || subjectsSubscribe)
        ? {
          subjects: {
            ...(subjectsPublish ? { publish: [...subjectsPublish] } : {}),
            ...(subjectsSubscribe ? { subscribe: [...subjectsSubscribe] } : {}),
          },
        }
        : {}),
    };

    const rpcKeys = selectedKeys(
      rpcCall,
    );
    if (rpcKeys.length > 0) {
      mergeRecord(
        "rpc",
        usedApi.rpc,
        Object.fromEntries(
          rpcKeys.map((key) => [key, contractModule.API.owned.rpc[key]]),
        ),
      );
    }

    const operationKeys = selectedKeys(
      operationsCall,
    );
    if (operationKeys.length > 0) {
      mergeRecord(
        "operations",
        usedApi.operations,
        Object.fromEntries(
          operationKeys.map((
            key,
          ) => [key, contractModule.API.owned.operations[key]]),
        ),
      );
    }

    const eventKeys = new Set([
      ...selectedKeys(eventsPublish),
      ...selectedKeys(eventsSubscribe),
    ]);
    if (eventKeys.size > 0) {
      mergeRecord(
        "events",
        usedApi.events,
        Object.fromEntries(
          [...eventKeys].map((
            key,
          ) => [key, contractModule.API.owned.events[key]]),
        ),
      );
    }

    const subjectKeys = new Set([
      ...selectedKeys(subjectsPublish),
      ...selectedKeys(subjectsSubscribe),
    ]);
    if (subjectKeys.size > 0) {
      mergeRecord(
        "subjects",
        usedApi.subjects,
        Object.fromEntries(
          [...subjectKeys].map((
            key,
          ) => [key, contractModule.API.owned.subjects[key]]),
        ),
      );
    }
  }

  return { manifestUses, usedApi };
}

function selectedKeys(keys: readonly string[] | undefined): readonly string[] {
  return keys ?? [];
}

function mergeApiSection(
  kind: keyof TrellisApiLike,
  usedEntries: Record<string, unknown>,
  ownedEntries: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  mergeRecord(kind, merged, usedEntries);
  mergeRecord(kind, merged, ownedEntries);
  return merged;
}

function mergeDerivedApis<
  TOwnedApi extends TrellisApiLike,
  TUsedApi extends TrellisApiLike,
>(
  ownedApi: TOwnedApi,
  usedApi: TUsedApi,
): MergeApis<TOwnedApi, TUsedApi> {
  return {
    rpc: mergeApiSection("rpc", usedApi.rpc, ownedApi.rpc) as MergeApis<
      TOwnedApi,
      TUsedApi
    >["rpc"],
    operations: mergeApiSection(
      "operations",
      usedApi.operations,
      ownedApi.operations,
    ) as MergeApis<TOwnedApi, TUsedApi>["operations"],
    events: mergeApiSection(
      "events",
      usedApi.events,
      ownedApi.events,
    ) as MergeApis<TOwnedApi, TUsedApi>["events"],
    subjects: mergeApiSection(
      "subjects",
      usedApi.subjects,
      ownedApi.subjects,
    ) as MergeApis<TOwnedApi, TUsedApi>["subjects"],
  };
}

function defineContract(
  registry: AnyDefineContractRegistry,
  build: (
    ref: ContractRefBuilder,
  ) => Omit<DefineContractSource, "schemas" | "errors">,
): DefinedContract<TrellisApiLike, ApiShape, ApiShape, string>;
function defineContract(
  registry: AnyDefineContractRegistry,
  build: (
    ref: ContractRefBuilder,
  ) => Omit<DefineContractSource, "schemas" | "errors">,
): DefinedContract<
  TrellisApiLike,
  ApiShape,
  ApiShape,
  string
> {
  const errorClasses = getErrorClassRegistry(registry.errors);
  const normalizedErrors = normalizeErrorRegistry(registry.errors);
  const body = build(createContractRefBuilder({
    ...(registry.schemas ? { schemas: registry.schemas } : {}),
    ...(errorClasses ? { errors: errorClasses } : {}),
  }));
  const materializedSchemas = materializeErrorSchemas(
    registry.schemas,
    normalizedErrors,
  );
  const source: DefineContractSource = {
    ...body,
    ...(materializedSchemas ? { schemas: materializedSchemas } : {}),
    ...(normalizedErrors ? { errors: normalizedErrors } : {}),
  };

  const { manifestUses, usedApi } = normalizeUses(source.uses);
  const emittedSource: TrellisContractSource = {
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(source.schemas ? { schemas: source.schemas } : {}),
    ...(source.state ? { state: source.state } : {}),
    ...(manifestUses ? { uses: manifestUses } : {}),
    ...(source.rpc ? { rpc: source.rpc } : {}),
    ...(source.operations ? { operations: source.operations } : {}),
    ...(source.events ? { events: source.events } : {}),
    ...(source.subjects ? { subjects: source.subjects } : {}),
    ...(source.errors ? { errors: source.errors } : {}),
    ...(source.jobs ? { jobs: source.jobs } : {}),
    ...(source.resources ? { resources: source.resources } : {}),
  };

  const ownedApi = buildOwnedApi(emittedSource);
  const trellisApi = mergeDerivedApis(
    ownedApi as ApiShape & TrellisApiLike,
    usedApi as ApiShape & TrellisApiLike,
  ) as ApiShape;
  const CONTRACT = emitContract(emittedSource);
  const CONTRACT_DIGEST = digestCanonicalJson(CONTRACT as JsonValue);

  type ConcreteDefinedContract = DefinedContract<
    TrellisApiLike,
    ApiShape,
    ApiShape,
    string
  >;

  let contract!: ConcreteDefinedContract;
  contract = {
    CONTRACT_ID: source.id,
    CONTRACT,
    CONTRACT_DIGEST,
    API: {
      owned: ownedApi as TrellisApiLike,
      used: usedApi as ApiShape,
      trellis: trellisApi,
    },
    use: createUseHelper(
      () => contract,
    ),
    [CONTRACT_JOBS_METADATA]: buildContractJobsMetadata(source.jobs),
    [CONTRACT_KV_METADATA]: buildContractKvMetadata(
      source.resources,
      source.schemas,
    ),
    [CONTRACT_STATE_METADATA]: buildContractStateMetadata(
      source.state,
      source.schemas,
    ),
  };

  return contract;
}

export function defineServiceContract<
  const TRegistry extends AnyDefineContractRegistry,
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TRpc extends
    | Readonly<
      Record<
        string,
        ContractSourceRpcMethod<
          SchemaNameOf<RegistrySchemas<TRegistry>>,
          ErrorNameOf<RegistryErrors<TRegistry>>
        >
      >
    >
    | undefined,
  const TOperations extends
    | Readonly<
      Record<
        string,
        ContractSourceOperation<SchemaNameOf<RegistrySchemas<TRegistry>>>
      >
    >
    | undefined,
  const TEvents extends
    | Readonly<
      Record<
        string,
        ContractSourceEvent<SchemaNameOf<RegistrySchemas<TRegistry>>>
      >
    >
    | undefined,
  const TSubjects extends
    | Readonly<
      Record<
        string,
        ContractSourceSubject<SchemaNameOf<RegistrySchemas<TRegistry>>>
      >
    >
    | undefined,
  const TBody extends ServiceContractBodyInput<
    RegistrySchemas<TRegistry>,
    TUses,
    RegistryErrors<TRegistry>,
    TRpc,
    TOperations,
    TEvents,
    TSubjects
  >,
>(
  registry: TRegistry,
  build: (
    ref: ContractRefBuilder<
      RegistrySchemas<TRegistry>,
      RegistryErrors<TRegistry>
    >,
  ) => TBody,
): DefinedContract<
  OwnedApiFromSource<
    BuiltContractSource<TRegistry, WithKind<TBody, "service">>
  >,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  ProjectedJobs<
    JobsFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
    SchemasFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>
  >,
  ProjectedState<
    StateFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
    SchemasFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>
  >,
  ProjectedKvResources<
    ResourcesFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
    SchemasFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>
  >
> {
  return defineContract(
    registry,
    (ref) => ({
      ...build(ref),
      kind: "service",
    }),
  ) as unknown as DefinedContract<
    OwnedApiFromSource<
      BuiltContractSource<TRegistry, WithKind<TBody, "service">>
    >,
    UsedApiFromUses<TBody["uses"]>,
    MergeApis<
      OwnedApiFromSource<
        BuiltContractSource<TRegistry, WithKind<TBody, "service">>
      >,
      UsedApiFromUses<TBody["uses"]>
    >,
    TBody["id"],
    ProjectedJobs<
      JobsFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
      SchemasFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>
    >,
    ProjectedState<
      StateFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
      SchemasFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>
    >,
    ProjectedKvResources<
      ResourcesFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>,
      SchemasFromSource<BuiltContractSource<TRegistry, WithKind<TBody, "service">>>
    >
  >;
}

function defineClientContract<
  const TKind extends Exclude<ContractKind, "service">,
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  kind: TKind,
  registry: ClientContractRegistry<TSchemas>,
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>,
    SchemasFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>
  >
> {
  return defineContract(
    registry,
    (ref) => ({ ...build(ref), kind }),
  ) as unknown as DefinedContract<
    OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>,
    UsedApiFromUses<TBody["uses"]>,
    MergeApis<
      OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>,
      UsedApiFromUses<TBody["uses"]>
    >,
    TBody["id"],
    {},
    ProjectedState<
      StateFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>,
      SchemasFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, TKind>>>
    >
  >;
}

export function defineAppContract<
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  registry: ClientContractRegistry<TSchemas>,
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "app">>>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "app">>>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "app">>>,
    SchemasFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "app">>>
  >
>;
export function defineAppContract<
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<undefined, TUses>,
>(build: () => TBody): DefinedContract<
  OwnedApiFromSource<WithKind<TBody, "app">>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<WithKind<TBody, "app">>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<StateFromSource<WithKind<TBody, "app">>, SchemasFromSource<WithKind<TBody, "app">>>
>;
export function defineAppContract(
  ...args:
    | [() => ContractIdentityFields & Record<string, unknown>]
    | [
      ClientContractRegistry<Readonly<Record<string, TSchema>>>,
      (ref: ContractRefBuilder<Readonly<Record<string, TSchema>>>) =>
        ContractIdentityFields & Record<string, unknown>,
    ]
) {
  const [registryOrBuild, maybeBuild] = args;
  if (typeof registryOrBuild === "function") {
    return defineClientContract("app", {}, () => registryOrBuild());
  }

  return defineClientContract("app", registryOrBuild, maybeBuild!);
}

export function definePortalContract<
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  registry: ClientContractRegistry<TSchemas>,
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "portal">>>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "portal">>>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "portal">>>,
    SchemasFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "portal">>>
  >
>;
export function definePortalContract<
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<undefined, TUses>,
>(build: () => TBody): DefinedContract<
  OwnedApiFromSource<WithKind<TBody, "portal">>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<WithKind<TBody, "portal">>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<StateFromSource<WithKind<TBody, "portal">>, SchemasFromSource<WithKind<TBody, "portal">>>
>;
export function definePortalContract(
  ...args:
    | [() => ContractIdentityFields & Record<string, unknown>]
    | [
      ClientContractRegistry<Readonly<Record<string, TSchema>>>,
      (ref: ContractRefBuilder<Readonly<Record<string, TSchema>>>) =>
        ContractIdentityFields & Record<string, unknown>,
    ]
) {
  const [registryOrBuild, maybeBuild] = args;
  if (typeof registryOrBuild === "function") {
    return defineClientContract("portal", {}, () => registryOrBuild());
  }

  return defineClientContract("portal", registryOrBuild, maybeBuild!);
}

export function defineAgentContract<
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  registry: ClientContractRegistry<TSchemas>,
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "agent">>>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "agent">>>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "agent">>>,
    SchemasFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "agent">>>
  >
>;
export function defineAgentContract<
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<undefined, TUses>,
>(build: () => TBody): DefinedContract<
  OwnedApiFromSource<WithKind<TBody, "agent">>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<WithKind<TBody, "agent">>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<StateFromSource<WithKind<TBody, "agent">>, SchemasFromSource<WithKind<TBody, "agent">>>
>;
export function defineAgentContract(
  ...args:
    | [() => ContractIdentityFields & Record<string, unknown>]
    | [
      ClientContractRegistry<Readonly<Record<string, TSchema>>>,
      (ref: ContractRefBuilder<Readonly<Record<string, TSchema>>>) =>
        ContractIdentityFields & Record<string, unknown>,
    ]
) {
  const [registryOrBuild, maybeBuild] = args;
  if (typeof registryOrBuild === "function") {
    return defineClientContract("agent", {}, () => registryOrBuild());
  }

  return defineClientContract("agent", registryOrBuild, maybeBuild!);
}

export function defineDeviceContract<
  const TSchemas extends Readonly<Record<string, TSchema>> | undefined,
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<TSchemas, TUses>,
>(
  registry: ClientContractRegistry<TSchemas>,
  build: (ref: ContractRefBuilder<TSchemas>) => TBody,
): DefinedContract<
  OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "device">>>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "device">>>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<
    StateFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "device">>>,
    SchemasFromSource<BuiltContractSource<ClientContractRegistry<TSchemas>, WithKind<TBody, "device">>>
  >
>;
export function defineDeviceContract<
  const TUses extends
    | Readonly<Record<string, AuthorContractDependencyUse>>
    | undefined,
  const TBody extends ClientContractBodyInput<undefined, TUses>,
>(build: () => TBody): DefinedContract<
  OwnedApiFromSource<WithKind<TBody, "device">>,
  UsedApiFromUses<TBody["uses"]>,
  MergeApis<
    OwnedApiFromSource<WithKind<TBody, "device">>,
    UsedApiFromUses<TBody["uses"]>
  >,
  TBody["id"],
  {},
  ProjectedState<StateFromSource<WithKind<TBody, "device">>, SchemasFromSource<WithKind<TBody, "device">>>
>;
export function defineDeviceContract(
  ...args:
    | [() => ContractIdentityFields & Record<string, unknown>]
    | [
      ClientContractRegistry<Readonly<Record<string, TSchema>>>,
      (ref: ContractRefBuilder<Readonly<Record<string, TSchema>>>) =>
        ContractIdentityFields & Record<string, unknown>,
    ]
) {
  const [registryOrBuild, maybeBuild] = args;
  if (typeof registryOrBuild === "function") {
    return defineClientContract("device", {}, () => registryOrBuild());
  }

  return defineClientContract("device", registryOrBuild, maybeBuild!);
}

export type {
  EventDesc,
  InferRuntimeRpcError,
  InferSchemaType,
  JsonValue,
  RPCDesc,
  RpcErrorClass,
  RuntimeRpcErrorDesc,
  Schema,
  SchemaLike,
  SerializableErrorData,
  SubjectDesc,
  TrellisAPI,
};
export { canonicalizeJson, digestJson, isJsonValue, schema, unwrapSchema };
