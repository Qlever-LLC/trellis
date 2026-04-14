import type { TSchema } from "typebox";
import type { BaseError } from "../result/mod.ts";
import {
  canonicalizeJson,
  digestJson,
  isJsonValue,
  type JsonValue,
  sha256Base64urlSync,
} from "./canonical.ts";
import {
  type EventDesc,
  type InferSchemaType,
  type InferRuntimeRpcError,
  type OperationDesc,
  type RPCDesc,
  type RpcErrorClass,
  type RuntimeRpcErrorDesc,
  type Schema,
  schema,
  type SchemaLike,
  type SubjectDesc,
  type TransportErrorData,
  type TrellisAPI,
  unwrapSchema,
} from "./runtime.ts";
import {
  assertDataPointersExistAndAreTokenable,
  type SubjectParam,
} from "./schema_pointers.ts";

export {
  ContractJobQueueResourceSchema,
  ContractJobsResourceSchema,
  ContractKvResourceSchema,
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
  ContractSchemaRefSchema,
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
  type StoreResourceBinding,
  StoreResourceBindingSchema,
  type Paginated,
  PaginatedSchema,
  type StreamResourceBinding,
  StreamResourceBindingSchema,
} from "./protocol.ts";

export const CONTRACT_FORMAT_V1 = "trellis.contract.v1" as const;
export const CATALOG_FORMAT_V1 = "trellis.catalog.v1" as const;

const CONTRACT_MODULE_METADATA = Symbol.for(
  "@qlever-llc/trellis-contracts/contract-module",
);
const CONTRACT_ERROR_RUNTIME_METADATA = Symbol.for(
  "@qlever-llc/trellis-contracts/error-runtime",
);

type UnionToIntersection<U> =
  (U extends unknown ? (value: U) => void : never) extends
    (value: infer I) => void ? I
    : never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type StringKeyOf<T> = Extract<keyof T, string>;
type KeysFromList<T> = T extends readonly (infer K)[] ? Extract<K, string>
  : never;

export type ContractManifestMetadata = {
  displayName: string;
  description: string;
};

export type ContractKind = "service" | "app" | "portal" | "device" | "cli";

export type Capability = string;
export type JsonSchema = JsonValue | boolean;

export type ContractSchemaRef<TSchemaName extends string = string> = {
  schema: TSchemaName;
};

export type ContractSchemas = Record<string, JsonSchema>;

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

export type ContractJobsResource = {
  queues: Record<string, ContractJobQueueResource>;
};

export type ContractKvResource = {
  purpose: string;
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
  subjects: string[];
};

export type ContractResources = {
  kv?: Record<string, ContractKvResource>;
  store?: Record<string, ContractStoreResource>;
  streams?: Record<string, ContractStreamResource>;
  jobs?: ContractJobsResource;
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
  uses?: ContractUses;
  rpc?: Record<string, ContractRpcMethod>;
  operations?: Record<string, ContractOperation>;
  events?: Record<string, ContractEvent>;
  subjects?: Record<string, ContractSubject>;
  errors?: Record<string, ContractErrorDecl>;
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

type ContractErrorRuntimeMarker<
  TClass extends RpcErrorClass = RpcErrorClass,
> = {
  readonly [CONTRACT_ERROR_RUNTIME_METADATA]: TClass;
};

export type ErrorClass<
  TData extends TransportErrorData = TransportErrorData,
  TError extends BaseError = BaseError,
  TRuntimeSchema extends TSchema = TSchema,
> = RpcErrorClass<TData, TError> & {
  readonly name: string;
  readonly schema: TRuntimeSchema;
};

function isTransportErrorData(value: unknown): value is TransportErrorData {
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

export type ContractSourceSchemas = Record<string, TSchema>;

export type ContractSourceRpcMethod<TSchemaName extends string = string> = {
  version: `v${number}`;
  input: ContractSchemaRef<TSchemaName>;
  output: ContractSchemaRef<TSchemaName>;
  capabilities?: { call?: readonly Capability[] };
  errors?: readonly string[];
  authRequired?: boolean;
  subject?: string;
};

export type ContractSourceOperation<TSchemaName extends string = string> = {
  version: `v${number}`;
  input: ContractSchemaRef<TSchemaName>;
  progress?: ContractSchemaRef<TSchemaName>;
  output?: ContractSchemaRef<TSchemaName>;
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

export type ContractSourceJobQueueResource<
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

export type ContractSourceJobsResource<TSchemaName extends string = string> = {
  queues: Record<string, ContractSourceJobQueueResource<TSchemaName>>;
};

export type ContractSourceKvResource = {
  purpose: string;
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
};

export type ContractSourceResources<TSchemaName extends string = string> = {
  kv?: Record<string, ContractSourceKvResource>;
  store?: Record<string, ContractSourceStoreResource>;
  streams?: Record<string, ContractSourceStreamResource>;
  jobs?: ContractSourceJobsResource<TSchemaName>;
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
  uses?: Record<string, ContractSourceUse>;
  rpc?: Record<string, ContractSourceRpcMethod>;
  operations?: Record<string, ContractSourceOperation>;
  events?: Record<string, ContractSourceEvent>;
  subjects?: Record<string, ContractSourceSubject>;
  errors?: Record<string, ContractSourceErrorDecl>;
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

type RuntimeErrorFromSourceDecl<TDecl, TSchemas> = TDecl extends {
  type: infer TType extends string;
  schema?: infer TSchemaRef;
}
  ? TDecl extends ContractErrorRuntimeMarker<infer TClass>
    ? TClass extends RpcErrorClass<TransportErrorData, infer TError>
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

type ProjectedRpc<
  T extends Readonly<Record<string, ContractSourceRpcMethod>> | undefined,
  TSchemas,
  TErrors,
> = T extends Readonly<Record<string, ContractSourceRpcMethod>> ? {
    [K in keyof T]:
      & RPCDesc<
        ResolveSchemaFromMap<TSchemas, T[K]["input"]>,
        ResolveSchemaFromMap<TSchemas, T[K]["output"]>,
        T[K]["errors"],
        RuntimeErrorsForNames<T[K]["errors"], TErrors, TSchemas>
      >
      & { authRequired?: boolean };
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
    >;
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
    errors?: Readonly<Record<string, ContractSourceErrorDecl>>;
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
> = {
  CONTRACT_ID: TContractId;
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: ContractApiViews<TOwnedApi, TUsedApi, TTrellisApi>;
  use: ContractUseFn<TContractId, TOwnedApi>;
};

export type SdkContractModule<
  TContractId extends string,
  TOwnedApi extends ApiShape,
> = ContractModule<TContractId, TOwnedApi, EmptyApi, TOwnedApi>;

export type DefinedContract<
  TOwnedApi extends ApiShape,
  TUsedApi extends ApiShape,
  TTrellisApi extends ApiShape,
  TContractId extends string = string,
> = ContractModule<TContractId, TOwnedApi, TUsedApi, TTrellisApi>;

export type DefineContractInput<
  TSchemas extends Readonly<Record<string, TSchema>> | undefined = undefined,
  TUses extends Readonly<Record<string, AnyContractDependencyUse>> | undefined =
    undefined,
  TErrors extends
    | Readonly<Record<string, ContractSourceErrorDecl<SchemaNameOf<TSchemas>>>>
    | undefined = undefined,
  TRpc extends
    | Readonly<Record<string, ContractSourceRpcMethod<SchemaNameOf<TSchemas>>>>
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
  uses?: TUses;
  errors?: TErrors;
  rpc?: TRpc;
  operations?: TOperations;
  events?: TEvents;
  subjects?: TSubjects;
  resources?: ContractSourceResources<SchemaNameOf<TSchemas>>;
};

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
  if (!resources?.kv && !resources?.store && !resources?.streams && !resources?.jobs) {
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
              subjects: [...resource.subjects],
            } satisfies ContractStreamResource,
          ]),
        ),
      }
      : {}),
    ...(resources.jobs
      ? {
        jobs: {
          queues: Object.fromEntries(
            Object.entries(resources.jobs.queues).map(([queueType, queue]) => [
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
                ...(queue.progress !== undefined
                  ? { progress: queue.progress }
                  : {}),
                ...(queue.logs !== undefined ? { logs: queue.logs } : {}),
                ...(queue.dlq !== undefined ? { dlq: queue.dlq } : {}),
                ...(queue.concurrency !== undefined
                  ? { concurrency: queue.concurrency }
                  : {}),
              } satisfies ContractJobQueueResource,
            ]),
          ),
        } satisfies ContractJobsResource,
      }
      : {}),
  };
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

  const resources = emitResources(source.resources);
  const uses = emitUses(source.uses);

  return {
    format: CONTRACT_FORMAT_V1,
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(source.schemas ? { schemas: cloneSchemas(source.schemas) } : {}),
    ...(uses ? { uses } : {}),
    ...(rpc ? { rpc } : {}),
    ...(operations ? { operations } : {}),
    ...(events ? { events } : {}),
    ...(subjects ? { subjects } : {}),
    ...(errors ? { errors } : {}),
    ...(resources ? { resources } : {}),
  };
}

function buildOwnedApi(source: TrellisContractSource): TrellisApiLike {
  const localRuntimeErrors = Object.fromEntries(
    Object.entries(source.errors ?? {}).flatMap(([name, errorDecl]) => {
      const errorClass = getContractErrorRuntimeClass(errorDecl);
      if (!errorClass) {
        return [];
      }

      const runtimeError: RuntimeRpcErrorDesc = {
        type: errorDecl.type,
        ...(resolveErrorSchemaRef(source.schemas, name, errorDecl)
          ? {
            schema: schema(
              resolveSchemaRef(
                source.schemas,
                resolveErrorSchemaRef(source.schemas, name, errorDecl)!,
                `error '${name}' schema`,
              ),
            ),
          }
          : {}),
        fromSerializable(data) {
          if (!isTransportErrorData(data)) {
            throw new Error(
              `Transport error '${errorDecl.type}' is missing base error fields`,
            );
          }
          return errorClass.fromSerializable(data);
        },
      };

      return [[name, runtimeError] as const];
    }),
  ) as Record<string, RuntimeRpcErrorDesc>;

  const rpc = Object.fromEntries(
    Object.entries(source.rpc ?? {}).map(([name, method]) => [
      name,
      {
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
        runtimeErrors: method.errors
          ?.flatMap((errorName) => {
            const runtimeError = localRuntimeErrors[errorName];
            return runtimeError ? [runtimeError] : [];
          }),
      },
    ]),
  ) as Record<string, RPCDesc>;

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

  return { rpc, operations, events, subjects };
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

  const errorClass = getContractErrorRuntimeClass(errorDecl);
  const runtimeSchema = errorClass ? Reflect.get(errorClass, "schema") : undefined;
  if (!runtimeSchema) {
    return undefined;
  }

  if (!schemas) {
    throw new Error(
      `error '${errorName}' defines a runtime schema but the contract has no schemas`,
    );
  }

  const runtimeSchemaDigest = digestCanonicalJson(cloneSchema(runtimeSchema as TSchema));
  for (const [schemaName, schemaValue] of Object.entries(schemas)) {
    if (schemaValue === runtimeSchema) {
      return { schema: schemaName };
    }

    if (digestCanonicalJson(cloneSchema(schemaValue)) === runtimeSchemaDigest) {
      return { schema: schemaName };
    }
  }

  throw new Error(
    `error '${errorName}' schema must be declared in contract.schemas`,
  );
}

/**
 * Define a transportable contract error with JS runtime reconstruction metadata.
 *
 * The returned object stays JSON-serializable for manifest emission while carrying
 * hidden runtime metadata used by Trellis to reconstruct concrete `Error` instances.
 */
export function defineError<
  TData extends TransportErrorData = TransportErrorData,
  TError extends BaseError = BaseError,
  TRuntimeSchema extends TSchema = TSchema,
>(
  errorClass: ErrorClass<TData, TError, TRuntimeSchema>,
): ContractSourceErrorDecl<string> &
  ContractErrorRuntimeMarker<ErrorClass<TData, TError, TRuntimeSchema>> {
  const errorDecl: ContractSourceErrorDecl<string> = {
    type: errorClass.name,
  };
  return attachContractErrorRuntimeMetadata(errorDecl, errorClass);
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
  useValue: ContractSourceUse | AnyContractDependencyUse,
): ContractModule<string, TrellisApiLike, TrellisApiLike, TrellisApiLike> {
  const contractModule =
    (useValue as ContractModuleMarker)[CONTRACT_MODULE_METADATA];
  if (!contractModule) {
    throw new Error(
      `Contract use '${alias}' must be created with contractModule.use(...) from @qlever-llc/trellis-contracts`,
    );
  }
  return contractModule;
}

function normalizeUses(
  uses: Readonly<Record<string, AnyContractDependencyUse>> | undefined,
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
    if (useValue.contract !== contractModule.CONTRACT_ID) {
      throw new Error(
        `Contract use '${alias}' references '${useValue.contract}' but module id is '${contractModule.CONTRACT_ID}'`,
      );
    }

    assertValidUseSpec(
      contractModule.CONTRACT_ID,
      useValue,
      contractModule.API.owned,
    );

    manifestUses[alias] = {
      contract: contractModule.CONTRACT_ID,
      ...(useValue.rpc?.call ? { rpc: { call: [...useValue.rpc.call] } } : {}),
      ...(useValue.operations?.call
        ? { operations: { call: [...useValue.operations.call] } }
        : {}),
      ...((useValue.events?.publish || useValue.events?.subscribe)
        ? {
          events: {
            ...(useValue.events.publish
              ? { publish: [...useValue.events.publish] }
              : {}),
            ...(useValue.events.subscribe
              ? { subscribe: [...useValue.events.subscribe] }
              : {}),
          },
        }
        : {}),
      ...((useValue.subjects?.publish || useValue.subjects?.subscribe)
        ? {
          subjects: {
            ...(useValue.subjects.publish
              ? { publish: [...useValue.subjects.publish] }
              : {}),
            ...(useValue.subjects.subscribe
              ? { subscribe: [...useValue.subjects.subscribe] }
              : {}),
          },
        }
        : {}),
    };

    const rpcKeys = selectedKeys(
      useValue.rpc?.call as readonly string[] | undefined,
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
      useValue.operations?.call as readonly string[] | undefined,
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
      ...selectedKeys(
        useValue.events?.publish as readonly string[] | undefined,
      ),
      ...selectedKeys(
        useValue.events?.subscribe as readonly string[] | undefined,
      ),
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
      ...selectedKeys(
        useValue.subjects?.publish as readonly string[] | undefined,
      ),
      ...selectedKeys(
        useValue.subjects?.subscribe as readonly string[] | undefined,
      ),
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

export function defineContract<
  const T extends DefineContractInput<any, any, any, any, any, any, any>,
>(
  source: T,
): DefinedContract<
  OwnedApiFromSource<T>,
  UsedApiFromUses<T["uses"]>,
  MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>,
  T["id"]
> {
  const { manifestUses, usedApi } = normalizeUses(source.uses);
  const emittedSource: TrellisContractSource = {
    id: source.id,
    displayName: source.displayName,
    description: source.description,
    kind: source.kind,
    ...(source.schemas ? { schemas: source.schemas } : {}),
    ...(manifestUses ? { uses: manifestUses } : {}),
    ...(source.rpc ? { rpc: source.rpc } : {}),
    ...(source.operations ? { operations: source.operations } : {}),
    ...(source.events ? { events: source.events } : {}),
    ...(source.subjects ? { subjects: source.subjects } : {}),
    ...(source.errors ? { errors: source.errors } : {}),
    ...(source.resources ? { resources: source.resources } : {}),
  };

  const ownedApi = buildOwnedApi(emittedSource);
  const trellisApi = mergeDerivedApis(
    ownedApi as OwnedApiFromSource<T> & TrellisApiLike,
    usedApi as UsedApiFromUses<T["uses"]> & TrellisApiLike,
  ) as MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>;
  const CONTRACT = emitContract(emittedSource);
  const CONTRACT_DIGEST = digestCanonicalJson(CONTRACT as JsonValue);

  type ConcreteDefinedContract = DefinedContract<
    OwnedApiFromSource<T>,
    UsedApiFromUses<T["uses"]>,
    MergeApis<OwnedApiFromSource<T>, UsedApiFromUses<T["uses"]>>,
    T["id"]
  >;

  let contract!: ConcreteDefinedContract;
  contract = {
    CONTRACT_ID: source.id,
    CONTRACT,
    CONTRACT_DIGEST,
    API: {
      owned: ownedApi as OwnedApiFromSource<T>,
      used: usedApi as UsedApiFromUses<T["uses"]>,
      trellis: trellisApi,
    },
    use: createUseHelper(
      () => contract,
    ),
  };

  return contract;
}

export type {
  EventDesc,
  InferSchemaType,
  InferRuntimeRpcError,
  JsonValue,
  RPCDesc,
  RpcErrorClass,
  RuntimeRpcErrorDesc,
  Schema,
  SchemaLike,
  SubjectDesc,
  TransportErrorData,
  TrellisAPI,
};
export { canonicalizeJson, digestJson, isJsonValue, schema, unwrapSchema };
